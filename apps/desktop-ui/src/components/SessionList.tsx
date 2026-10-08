import { Menu } from '@base-ui/react/menu';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { isUntitledSessionName, type SessionMeta, type SessionUpdateInput } from '../../../core/src/protocol';
import { Modal } from './Modal';

type IconKind = 'pin' | 'rename' | 'trash' | 'restore' | 'more';
function ChatIcon({ kind }: { kind: IconKind }) {
  const paths = {
    pin: 'm9 3 6 0-1 6 4 4v2h-5v6l-1-2-1 2v-6H6v-2l4-4Z',
    rename: 'm16 3 5 5-12 12-6 1 1-6ZM14 5l5 5',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6',
    restore: 'M3 10h7M3 10V3m0 7a9 9 0 1 1 0 5',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'more' ? <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></> : <path d={paths[kind]} />}
  </svg>;
}

export interface SessionRowData { session: SessionMeta; name: string; preview: string; time: string }
interface ListProps {
  rows: SessionRowData[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, changes: SessionUpdateInput) => Promise<void>;
}

export function SessionList({ rows, currentId, onSelect, onUpdate }: ListProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<SessionRowData | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const working = useRef(false);
  const update = async (id: string, changes: SessionUpdateInput) => {
    if (working.current) return false;
    working.current = true;
    setPending(id); setError('');
    try {
      await onUpdate(id, changes);
      return true;
    } catch {
      setError(t('Chat update failed. Please retry.'));
      return false;
    } finally {
      working.current = false;
      setPending(null);
    }
  };
  return <>
    {error && !editing && <p className="session-list-error" role="alert">{error}</p>}
    {rows.map(row => <SessionRow key={row.session.id} row={row} active={row.session.id === currentId} disabled={!!pending}
      onSelect={onSelect}
      onPin={() => { void update(row.session.id, { pinned: !row.session.pinnedAt }); }}
      onDelete={() => { void update(row.session.id, { deleted: true }); }}
      onRename={() => { setError(''); setName(row.name); setEditing(row); composing.current = false; }} />)}
    <Modal open={!!editing} title={t('Rename chat')} onClose={() => setEditing(null)} className="chat-rename-modal" dismissible={!pending} initialFocus={input}>
      <form className="chat-rename-form" onSubmit={event => {
        event.preventDefault();
        if (!editing || composing.current || !name.trim()) return;
        void update(editing.session.id, { name: name.trim() }).then(saved => { if (saved) setEditing(null); });
      }}>
        <label htmlFor="chat-name">{t('Chat name')}</label>
        <input id="chat-name" ref={input} value={name} maxLength={160} onChange={event => setName(event.target.value)} disabled={!!pending}
          onFocus={event => event.currentTarget.select()}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { composing.current = false; }}
          onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
        {error && <p className="session-list-error" role="alert">{error}</p>}
        <div className="chat-dialog-actions"><button type="button" disabled={!!pending} onClick={() => setEditing(null)}>{t('Cancel')}</button>
          <button type="submit" className="chat-dialog-primary" disabled={!!pending || !name.trim()}>{t('Save changes')}</button></div>
      </form>
    </Modal>
  </>;
}

function SessionRow({ row, active, disabled, onSelect, onPin, onRename, onDelete }: {
  row: SessionRowData; active: boolean; disabled: boolean;
  onSelect: (id: string) => void; onPin: () => void; onRename: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <div className={`session-row ${active ? 'active' : ''} ${open ? 'menu-open' : ''}`} onContextMenu={event => { event.preventDefault(); if (!disabled) setOpen(true); }}>
    <button className="session-main" onClick={() => onSelect(row.session.id)} aria-current={active ? 'page' : undefined}>
      <span className="session-heading"><span className="session-name" title={row.name}>{!!row.session.pinnedAt && <span className="session-pin" title={t('Pinned')}><ChatIcon kind="pin" /></span>}<span>{row.name}</span></span>
        <span className="session-time">{row.time}</span></span>
      {row.preview && <span className="session-preview">{row.preview}</span>}
    </button>
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger className="session-actions-trigger" disabled={disabled} aria-label={t('Chat actions for {name}', { name: row.name })} title={t('Chat actions')}><ChatIcon kind="more" /></Menu.Trigger>
      <Menu.Portal><Menu.Positioner side="right" align="start" sideOffset={6} className="z-[60] outline-none">
        <Menu.Popup className="session-actions-menu">
          <Menu.Item onClick={onPin}><ChatIcon kind="pin" /><span>{t(row.session.pinnedAt ? 'Unpin chat' : 'Pin chat')}</span></Menu.Item>
          <Menu.Item onClick={onRename}><ChatIcon kind="rename" /><span>{t('Rename chat')}</span></Menu.Item>
          <Menu.Separator />
          <Menu.Item className="session-delete-action" onClick={onDelete}><ChatIcon kind="trash" /><span>{t('Delete chat')}</span></Menu.Item>
        </Menu.Popup>
      </Menu.Positioner></Menu.Portal>
    </Menu.Root>
  </div>;
}

export function DeletedChats({ load, onRestore }: { load: () => Promise<SessionMeta[]>; onRestore: (id: string) => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const show = async () => {
    setOpen(true); setLoading(true); setError('');
    try { setRows(await load()); } catch { setError(t('Chat update failed. Please retry.')); }
    finally { setLoading(false); }
  };
  const restore = async (id: string) => {
    setPending(id); setError('');
    try { await onRestore(id); setRows(list => list.filter(row => row.id !== id)); }
    catch { setError(t('Chat update failed. Please retry.')); }
    finally { setPending(null); }
  };
  return <>
    <button type="button" className="session-trash-trigger" aria-label={t('Recently deleted')} title={t('Recently deleted')} onClick={() => { void show(); }}><ChatIcon kind="trash" /></button>
    <Modal open={open} title={t('Recently deleted')} onClose={() => setOpen(false)} className="deleted-chats-modal" dismissible={!pending}>
      <div className="deleted-chats-content">
        <p className="deleted-chats-description">{t('Deleted chats stay here until you restore them. Messages and permissions are preserved.')}</p>
        {error && <p className="session-list-error" role="alert">{error}</p>}
        {loading ? <p className="deleted-chats-empty">{t('Loading…')}</p> : !rows.length ? <p className="deleted-chats-empty">{t('No deleted chats.')}</p> : rows.map(row => <div className="deleted-chat-row" key={row.id}>
          <div><span>{!row.customName && isUntitledSessionName(row.name) ? t('New chat') : row.name}</span>{row.preview && <small>{row.preview}</small>}</div>
          <button type="button" disabled={!!pending} onClick={() => { void restore(row.id); }} aria-label={t('Restore {name}', { name: row.name })}><ChatIcon kind="restore" /><span>{t('Restore')}</span></button>
        </div>)}
      </div>
    </Modal>
  </>;
}
