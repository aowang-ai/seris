import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createSession, defineDoc, type ConversationId, type Cursor, type Session, type Tx } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { ApprovalMode, SessionMeta } from '../protocol.js';

const ChatMeta = defineDoc({
  kind: 'seris.chat', version: 1, scope: 'conversation', history: 'latest', fork: 'current',
  initial: () => ({ name: 'New chat', createdAt: 0, modifiedAt: 0, approvalMode: 'ask' as ApprovalMode }),
});

// Separate from UI metadata: existing conversations lazily get an empty selection.
const ToolSelection = defineDoc({
  kind: 'seris.tools', version: 1, scope: 'conversation', history: 'latest', fork: 'current',
  initial: () => ({ active: [] as string[] }),
});

function metadata(id: string, meta: Omit<SessionMeta, 'id'>): SessionMeta {
  // Existing v1 chat documents predate approval modes and keep asking by default.
  return { id, ...meta, approvalMode: meta.approvalMode ?? 'ask' };
}

/** Pi owns JSONL transactions and recovery; Seris owns chat metadata and its agent loop. */
export class SessionStore {
  private constructor(private readonly session: Session) {}

  static async open(directory: string): Promise<SessionStore> {
    const storage = await openNodeJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });
    return new SessionStore(createSession(storage));
  }

  async create(): Promise<SessionMeta> {
    return this.session.commit(async tx => {
      const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } });
      const meta = await tx.doc(ChatMeta, conversation.id);
      meta.createdAt = meta.modifiedAt = Date.now();
      return metadata(String(conversation.id), meta);
    }, BACKGROUND_CONTEXT);
  }

  async list(): Promise<SessionMeta[]> {
    return this.session.commit(async tx => {
      const result: SessionMeta[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanConversations({}, 100, cursor);
        for (const conversation of page.items) {
          const meta = await tx.doc(ChatMeta, conversation.id);
          result.push(metadata(String(conversation.id), meta));
        }
        cursor = page.next;
      } while (cursor);
      return result.sort((a, b) => b.modifiedAt - a.modifiedAt);
    }, BACKGROUND_CONTEXT);
  }

  async metadata(id: string): Promise<SessionMeta> {
    return this.session.commit(async tx => metadata(id, await this.meta(tx, id)), BACKGROUND_CONTEXT);
  }

  async setName(id: string, name: string, expectedName?: string): Promise<SessionMeta | undefined> {
    return this.session.commit(async tx => {
      const meta = await this.meta(tx, id);
      if (expectedName !== undefined && meta.name !== expectedName) return;
      meta.name = name;
      meta.modifiedAt = Date.now();
      return metadata(id, meta);
    }, BACKGROUND_CONTEXT);
  }

  async setApprovalMode(id: string, approvalMode: ApprovalMode): Promise<SessionMeta> {
    return this.session.commit(async tx => {
      const meta = await this.meta(tx, id);
      meta.approvalMode = approvalMode;
      meta.modifiedAt = Date.now();
      return metadata(id, meta);
    }, BACKGROUND_CONTEXT);
  }

  async activeTools(id: string): Promise<string[]> {
    return this.session.commit(async tx => {
      await this.meta(tx, id);
      return [...(await tx.doc(ToolSelection, this.id(id))).active];
    }, BACKGROUND_CONTEXT);
  }

  async activateTools(id: string, names: string[]): Promise<void> {
    await this.session.commit(async tx => {
      await this.meta(tx, id);
      const state = await tx.doc(ToolSelection, this.id(id));
      state.active = [...new Set([...state.active, ...names])];
    }, BACKGROUND_CONTEXT);
  }

  async entries(id: string): Promise<{ id: string; message: AgentMessage }[]> {
    return this.session.commit(async tx => {
      const conversationId = this.id(id);
      if (!await tx.conversation(conversationId)) throw new Error(`Unknown session: ${id}`);
      const entries = [];
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId }, 100, cursor);
        entries.push(...page.items);
        cursor = page.next;
      } while (cursor);
      return entries.reverse().flatMap(entry => (entry.model ?? []).map(message => ({ id: String(entry.id), message })));
    }, BACKGROUND_CONTEXT);
  }

  async append(id: string, message: AgentMessage): Promise<void> {
    await this.session.commit(async tx => {
      const meta = await this.meta(tx, id);
      await tx.appendEntry(this.id(id), { kind: 'seris.message', model: [message as Message] });
      meta.modifiedAt = Date.now();
    }, BACKGROUND_CONTEXT);
  }

  close(): Promise<void> { return this.session.close(BACKGROUND_CONTEXT); }

  private id(id: string): ConversationId {
    const value = Number(id);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(value)) throw new Error(`Unknown session: ${id}`);
    return value as ConversationId;
  }

  private async meta(tx: Tx, id: string) {
    const conversationId = this.id(id);
    if (!await tx.conversation(conversationId)) throw new Error(`Unknown session: ${id}`);
    return tx.doc(ChatMeta, conversationId);
  }
}
