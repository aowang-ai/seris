import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { answer, call, marketsFixture, until } from './markets-fixture.mjs';
import { defineTool } from '../dist/tools/registry.js';
import { SerisRuntime } from '../dist/runtime/serisRuntime.js';
import { SessionStore } from '../dist/runtime/sessionStore.js';
import { startGateway } from '../dist/gateway/server.js';
import { isChatEvent, isSnapshot } from '../dist/protocol.js';

const done = () => answer([{ type: 'text', text: 'Finished' }]);
const write = (n) => call('strategy_save_draft', { variant: n }, `save-${n}`);
function registerWriter(tools, execute) {
  tools.register(defineTool({ name: 'strategy_save_draft', approval: 'ask', category: 'workspace', description: 'Permission regression writer',
    parameters: { type: 'object', properties: { variant: { type: 'number' } }, required: ['variant'] }, execute }));
}

test('a single request completes 96 tool rounds without a model-interaction limit', async t => {
  const responses = Array.from({ length: 96 }, (_, n) => call('fixture_read', { n }, `read-${n}`));
  responses.push(done());
  const { runtime, tools } = await marketsFixture(t, responses);
  let executions = 0;
  tools.register(defineTool({ name: 'fixture_read', category: 'market-data', description: 'Long task fixture',
    parameters: { type: 'object', properties: { n: { type: 'number' } } }, execute() { return { result: ++executions }; } }));
  const session = await runtime.createSession();
  await runtime.prompt(session.id, 'Complete all rounds', { requestId: 'unlimited-rounds' });
  assert.equal(executions, 96);
  assert.equal(runtime.runState(session.id).status, 'completed');
  const history = await runtime.sessionHistory(session.id);
  assert.equal(history.filter(m => m.role === 'assistant').length, 97);
  assert.equal(history.filter(m => m.role === 'tool').length, 96);
  assert.equal(history.at(-1).text, 'Finished');
});

test('allow-all releases a waiting action, allows subsequent actions, persists, and stays scoped to its chat', async t => {
  const { runtime, tools, deps } = await marketsFixture(t, [write(1), write(2), write(3), done()]);
  let executions = 0;
  registerWriter(tools, () => ({ saved: ++executions }));
  const events = [];
  runtime.onEvent(event => events.push(event));
  const session = await runtime.createSession();
  assert.equal(session.approvalMode, 'ask');
  const run = runtime.startPrompt(session.id, 'Save three variants');
  await until(() => runtime.approvals.list(session.id).length === 1);
  assert.equal(executions, 0);
  await runtime.setApprovalMode(session.id, 'allow-all');
  await run.done;
  assert.equal(executions, 3);
  assert.equal(runtime.runState(session.id).status, 'completed');
  assert.equal(events.filter(event => event.type === 'approval').length, 1);
  assert.equal(runtime.approvals.list(session.id).length, 0);
  const snapshot = await runtime.snapshot(session.id, () => ({ epoch: 'fixture', seq: 1 }));
  assert.equal(snapshot.approvalMode, 'allow-all');
  assert.equal(isSnapshot(snapshot), true);
  assert.equal(isSnapshot({ ...snapshot, approvalMode: 'invalid' }), false);
  assert.ok(events.filter(event => event.type === 'session-updated').every(isChatEvent));
  await runtime.dispose();
  const reopened = new SerisRuntime(deps);
  await reopened.init();
  t.after(() => reopened.dispose());
  assert.equal((await reopened.listSessions()).find(s => s.id === session.id).approvalMode, 'allow-all');
  assert.equal((await reopened.createSession()).approvalMode, 'ask');
  await reopened.setApprovalMode(session.id, 'ask');
  assert.equal((await reopened.snapshot(session.id, () => ({ epoch: 'fixture', seq: 1 }))).approvalMode, 'ask');
  await assert.rejects(reopened.setApprovalMode(session.id, 'invalid'), /Invalid approval mode/);
});

test('switching back to ask during a run gates the next action and can be cancelled', async t => {
  const { runtime, tools } = await marketsFixture(t, [write(1), write(2), done()]);
  const session = await runtime.createSession();
  await runtime.setApprovalMode(session.id, 'allow-all');
  let executions = 0;
  registerWriter(tools, async () => {
    executions++;
    await runtime.setApprovalMode(session.id, 'ask');
    return { saved: true };
  });
  const run = runtime.startPrompt(session.id, 'Save two variants');
  await until(() => runtime.approvals.list(session.id).length === 1);
  assert.equal(executions, 1);
  assert.equal(runtime.approvals.list(session.id)[0].toolCallId, 'save-2');
  run.abort();
  await run.done;
  assert.equal(executions, 1);
  assert.equal(runtime.runState(session.id).status, 'cancelled');
  assert.equal(runtime.approvals.list(session.id).length, 0);
});

test('Stop still cancels an unrestricted run after more than 32 rounds', async t => {
  const { runtime, tools } = await marketsFixture(t, Array.from({ length: 80 }, (_, n) => call('fixture_wait', {}, `wait-${n}`)));
  let executions = 0;
  tools.register(defineTool({ name: 'fixture_wait', category: 'workspace', description: 'Cancellation fixture',
    parameters: { type: 'object', properties: {} }, async execute(_id, _args, signal) {
      if (++executions === 48) await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { completed: true };
    } }));
  const session = await runtime.createSession();
  const run = runtime.startPrompt(session.id, 'Keep going');
  await until(() => executions === 48);
  run.abort();
  await run.done;
  assert.equal(executions, 48);
  assert.equal(runtime.runState(session.id).status, 'cancelled');
});

test('old persisted chats without an approval-mode field load with ask enabled', async t => {
  const { dir } = await marketsFixture(t);
  const { createSession, defineDoc } = await import('@earendil-works/pi-durable');
  const { openNodeJsonlStorage } = await import('@earendil-works/pi-durable/storage/jsonl/node');
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context');
  const path = join(dir, 'legacy-sessions');
  const session = createSession(await openNodeJsonlStorage(path, BACKGROUND_CONTEXT, { fsync: true }));
  const legacyMeta = defineDoc({ kind: 'seris.chat', version: 1, scope: 'conversation', history: 'latest', fork: 'current',
    initial: () => ({ name: 'Legacy chat', createdAt: 100, modifiedAt: 100 }) });
  const id = await session.commit(async tx => {
    const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } });
    const meta = await tx.doc(legacyMeta, conversation.id);
    meta.name = 'Legacy chat';
    return String(conversation.id);
  }, BACKGROUND_CONTEXT);
  await session.close(BACKGROUND_CONTEXT);
  const store = await SessionStore.open(path);
  t.after(() => store.close());
  assert.equal((await store.metadata(id)).approvalMode, 'ask');
  assert.equal((await store.list())[0].approvalMode, 'ask');
  assert.equal((await store.setName(id, 'Renamed')).approvalMode, 'ask');
  await store.setApprovalMode(id, 'allow-all');
  await store.close();
  const reopened = await SessionStore.open(path);
  t.after(() => reopened.close());
  assert.equal((await reopened.metadata(id)).approvalMode, 'allow-all');
});

test('only an authenticated UI request changes permissions; prompt parameters cannot grant allow-all', async t => {
  const { runtime, tools } = await marketsFixture(t, [write(1), done()]);
  registerWriter(tools, () => ({ saved: true }));
  const session = await runtime.createSession();
  const gateway = await startGateway({ runtime });
  t.after(() => gateway.close());
  const url = `${gateway.url}/api/sessions/${session.id}/approval-mode`;
  const headers = { authorization: `Bearer ${gateway.token}`, 'content-type': 'application/json' };
  const post = (body, customHeaders = headers) => fetch(url, { method: 'POST', headers: customHeaders, body: JSON.stringify(body) });
  assert.equal((await post({ mode: 'allow-all' }, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await post({ mode: 'allow-all' }, { ...headers, origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await post({ mode: 'invalid' })).status, 400);
  assert.equal((await runtime.listSessions())[0].approvalMode, 'ask');
  const accepted = await fetch(`${gateway.url}/api/sessions/${session.id}/prompt`, { method: 'POST', headers,
    body: JSON.stringify({ text: 'Save', requestId: 'cannot-grant-permissions', approvalMode: 'allow-all' }) });
  assert.equal(accepted.status, 202);
  await until(() => runtime.approvals.list(session.id).length === 1);
  const updated = await (await post({ mode: 'allow-all' })).json();
  assert.equal(updated.approvalMode, 'allow-all');
  await until(() => runtime.runState(session.id).status === 'completed');
  const snapshot = await (await fetch(`${gateway.url}/api/sessions/${session.id}/snapshot`, { headers })).json();
  assert.equal(snapshot.approvalMode, 'allow-all');
  assert.equal(snapshot.approvals.length, 0);
  assert.equal(isSnapshot(snapshot), true);
});
