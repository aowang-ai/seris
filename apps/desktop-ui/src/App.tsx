import { useI18n } from './i18n';
import type { MessageKey } from './locales';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import {
  seris,
  type SessionMeta,
  type HistoryEntry,
  type RunRecord,
  type ApprovalRequest,
  type ApprovalMode,
  type ModelConfig,
  type MarketsState,
} from './seris';
import { applyChatEvent, snapshotMessages } from './chatState';
import {
  isUntitledSessionName,
  sessionTitleFallback,
  type Cursor,
} from '../../core/src/protocol';

interface CoreStatus {
  ready: boolean;
  circuitBroken?: boolean;
  tail?: string;
}
import { ChatPanel } from './components/ChatPanel';
import { useAutoAnimate } from '@formkit/auto-animate/react';
const MarketsPanel = lazy(() =>
  import('./components/MarketsPanel').then((m) => ({
    default: m.MarketsPanel,
  })),
);
import type {
  MarketContext,
  MarketContextInput,
  MarketAction,
  MarketNotification,
} from '../../core/src/markets/types';
import { SettingsPage } from './components/SettingsPage';
import { StrategiesPanel } from './components/StrategiesPanel';

type View = 'chat' | 'markets' | 'strategies' | 'settings';

const NAV: {
  id: Exclude<View, 'settings'>;
  label: MessageKey;
  icon: ReactNode;
}[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a8.5 8.5 0 0 1 17 0Z" />
    ),
  },
  {
    id: 'markets',
    label: 'Markets',
    icon: (
      <>
        <path d="M3 3v18h18" />
        <path d="m6 15 5-5 4 3 6-7" />
      </>
    ),
  },
  {
    id: 'strategies',
    label: 'Strategies',
    icon: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10m0-3c0-5 12-1 12-6" />
      </>
    ),
  },
];

/** compact hh:mm or short-date renderer for session rows */
function fmtTime(ts: number, locale: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    locale,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' },
  );
}

/** one line of plaintext from a message list (last assistant>user>any) */
function sessionPreview(msgs: { role: string; text: string }[]): string {
  if (!msgs || msgs.length === 0) return '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant') return m.text.replace(/\s+/g, ' ').slice(0, 80);
  }
  const last = msgs[msgs.length - 1];
  return last.text.replace(/\s+/g, ' ').slice(0, 80);
}

export function App() {
  const { t, locale } = useI18n();
  const [sessionList] = useAutoAnimate<HTMLDivElement>({
    duration: 180,
    easing: 'ease-out',
  });
  const [sidebarPreference, setSidebarPreference] = useState<
    boolean | undefined
  >(() => {
    const saved = localStorage.getItem('seris.sidebarCollapsed');
    return saved === null ? undefined : saved === 'true';
  });
  const [marketChatOpen, setMarketChatOpen] = useState(false);
  const [view, setView] = useState<View>('chat');
  const viewRef = useRef(view);
  viewRef.current = view;
  const [marketChatRequest, setMarketChatRequest] = useState(0);
  const sidebarCollapsed =
    sidebarPreference ?? (view === 'markets' && marketChatOpen);
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarPreference(next);
    localStorage.setItem('seris.sidebarCollapsed', String(next));
  };
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, HistoryEntry[]>>({});
  const [runs, setRuns] = useState<Record<string, RunRecord | null>>({});
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [newApprovalMode, setNewApprovalMode] = useState<ApprovalMode>('ask');
  const [savingApprovalMode, setSavingApprovalMode] = useState(false);
  const [goals, setGoals] = useState<
    { id: string; status: string; reason: string; payload: unknown }[]
  >([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[currentId ?? 'new'] ?? '';
  const setDraft = (text: string) =>
    setDrafts((d) => ({ ...d, [currentId ?? 'new']: text }));
  const [marketsVisited, setMarketsVisited] = useState(false);
  const [marketSession, setMarketSession] = useState<string | null>(() =>
    localStorage.getItem('seris.marketSession'),
  );
  const marketSessionRef = useRef(marketSession);
  marketSessionRef.current = marketSession;
  const marketOpening = useRef<Promise<void> | null>(null);
  const marketContext = useRef<MarketContext>();
  const [marketsState, setMarketsState] = useState<MarketsState>();
  const [marketNotification, setMarketNotification] =
    useState<MarketNotification>();
  const seenNotifications = useRef<Set<string>>();
  const [context, setContext] = useState<MarketContext>();
  const attachContext = useCallback((c: MarketContext | undefined) => {
    marketContext.current = c;
    setContext(c);
  }, []);
  const pendingMarketActions = useRef<
    { action: MarketAction; automatic: boolean }[]
  >([]);
  const marketActionHandler =
    useRef<(a: MarketAction, automatic?: boolean) => void>();
  const registerActions = useCallback(
    (handler: (a: MarketAction, automatic?: boolean) => void) => {
      marketActionHandler.current = handler;
      if (viewRef.current === 'markets') {
        for (const pending of pendingMarketActions.current.splice(0))
          handler(pending.action, pending.automatic);
      }
      return () => {
        if (marketActionHandler.current === handler)
          marketActionHandler.current = undefined;
      };
    },
    [],
  );
  useEffect(() => {
    if (view !== 'markets') {
      pendingMarketActions.current = [];
      return;
    }
    const handler = marketActionHandler.current;
    if (handler)
      for (const pending of pendingMarketActions.current.splice(0))
        handler(pending.action, pending.automatic);
  }, [view]);
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [notice, setNotice] = useState('');
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const watermarks = useRef<Record<string, Cursor>>({});
  const loaded = useRef(new Set<string>());
  const initialized = useRef(false);
  const request = useRef<
    Record<
      string,
      {
        id: string;
        text: string;
        sessionId: string;
        context?: MarketContextInput;
      }
    >
  >({});
  const busy =
    !!sending[currentId ?? 'new'] ||
    !!(
      currentId &&
      runs[currentId] &&
      ['running', 'awaiting-approval', 'cancelling'].includes(
        runs[currentId]!.status,
      )
    );
  const ready = status?.ready === true && config?.configured === true;
  const connectionState = status?.circuitBroken
    ? 'Offline'
    : !status?.ready
      ? 'Connecting'
      : config?.configured === false
        ? 'Setup'
        : ready
          ? 'Ready'
          : 'Connecting';
  const connectionDescription =
    connectionState === 'Ready'
      ? t('Connected — ready to chat')
      : connectionState === 'Setup'
        ? t('Connected — model setup required')
        : connectionState === 'Offline'
          ? t('Connection offline')
          : t('Connecting…');

  const handledMarketActions = useRef(new Set<string>());
  const receiveMarketAction = useCallback((sessionId: string, action: MarketAction) => {
    if (action.kind !== 'view' || sessionId !== currentRef.current || handledMarketActions.current.has(action.id)) return;
    handledMarketActions.current.add(action.id);
    if (handledMarketActions.current.size > 500)
      handledMarketActions.current.delete(handledMarketActions.current.values().next().value!);
    if (
      viewRef.current === 'chat' &&
      (action.originViewId === undefined ||
        action.originViewId === marketContext.current?.viewId ||
        pendingMarketActions.current.some(pending => pending.action.context.viewId === action.originViewId))
    ) {
      marketSessionRef.current = sessionId;
      setMarketSession(sessionId);
      localStorage.setItem('seris.marketSession', sessionId);
      pendingMarketActions.current.push({ action, automatic: true });
      setMarketsVisited(true);
      setMarketChatRequest(n => n + 1);
      setView('markets');
    } else if (viewRef.current === 'markets' && action.originViewId !== undefined && sessionId === marketSessionRef.current) {
      if (marketActionHandler.current) marketActionHandler.current(action, true);
      else pendingMarketActions.current.push({ action, automatic: true });
    }
  }, []);
  const restore = useCallback(async (id: string, liveRunId?: string) => {
    const snapshot = await seris.snapshot(id);
    const watermark = watermarks.current[id];
    if (watermark?.epoch === snapshot.epoch && watermark.seq > snapshot.seq)
      return;
    watermarks.current[id] = { epoch: snapshot.epoch, seq: snapshot.seq };
    loaded.current.add(id);
    setMessages((m) => ({ ...m, [id]: snapshotMessages(snapshot) }));
    setRuns((r) => ({ ...r, [id]: snapshot.run }));
    setSessions(list => list.map(session => session.id === id ? { ...session, approvalMode: snapshot.approvalMode } : session));
    setApprovals((a) => [
      ...a.filter((p) => p.sessionId !== id),
      ...snapshot.approvals,
    ]);
    // Only reconcile this submitted run. Opening saved history never replays chart actions.
    if (liveRunId) for (const message of snapshot.messages) {
      if (message.id.startsWith(`${liveRunId}:`) && message.marketAction)
        receiveMarketAction(id, message.marketAction);
    }
  }, [receiveMarketAction]);
  useEffect(() => {
    let active = true;
    const stop = seris.onChatEvent(
      (e, cursor) => {
        if (!active) return;
        const watermark = watermarks.current[e.sessionId];
        if (watermark?.epoch === cursor.epoch && cursor.seq <= watermark.seq)
          return;
        watermarks.current[e.sessionId] = { ...cursor };
        if (e.type === 'session-updated' && e.session) {
          setSessions((list) =>
            list.map((s) => (s.id === e.sessionId ? e.session! : s)),
          );
          if (e.session.approvalMode === 'allow-all') {
            setApprovals(list => list.filter(approval => approval.sessionId !== e.sessionId));
          }
          return;
        }
        setMessages((m) => ({
          ...m,
          [e.sessionId]: applyChatEvent(m[e.sessionId] ?? [], e),
        }));
        const action =
          e.type === 'message' ? e.message?.marketAction : undefined;
        if (action) receiveMarketAction(e.sessionId, action);
        if (e.type === 'run-start')
          setRuns((r) => ({
            ...r,
            [e.sessionId]: {
              id: e.runId,
              sessionId: e.sessionId,
              status: 'running',
              startedAt: Date.now(),
              model: e.model,
            },
          }));
        if (e.type === 'approval' && e.approval) {
          setApprovals((a) => [
            ...a.filter((p) => p.id !== e.approval!.id),
            e.approval!,
          ]);
          setRuns((r) => ({
            ...r,
            [e.sessionId]: {
              id: e.runId,
              sessionId: e.sessionId,
              status: 'awaiting-approval',
              startedAt: r[e.sessionId]?.startedAt ?? Date.now(),
            },
          }));
        }
        if (e.type === 'run-end') {
          setRuns((r) => ({
            ...r,
            [e.sessionId]: {
              id: e.runId,
              sessionId: e.sessionId,
              status: e.status!,
              startedAt: r[e.sessionId]?.startedAt ?? Date.now(),
              error: e.error,
            },
          }));
          setApprovals((a) => a.filter((p) => p.runId !== e.runId));
          void seris
            .goalApprovals()
            .then((p) => {
              if (active)
                setGoals(p.goals.filter((g) => g.status === 'pending'));
            })
            .catch(() => {});
        }
      },
      async () => {
        const [list, cfg] = await Promise.all([
          seris.listSessions(),
          seris.config(),
        ]);
        if (!active) return;
        setSessions(list);
        setConfig(cfg);
        if (!initialized.current) {
          initialized.current = true;
          if (!cfg.configured) setView('settings');
        }
        const selected = list.some((s) => s.id === currentRef.current)
          ? currentRef.current
          : (list[0]?.id ?? null);
        currentRef.current = selected;
        setCurrentId(selected);
        const ids = list
          .filter((s) => loaded.current.has(s.id) || s.id === selected)
          .map((s) => s.id);
        for (const id of ids) {
          const snapshot = await seris.snapshot(id);
          if (!active) return;
          watermarks.current[id] = { epoch: snapshot.epoch, seq: snapshot.seq };
          loaded.current.add(id);
          setMessages((m) => ({ ...m, [id]: snapshotMessages(snapshot) }));
          setRuns((r) => ({ ...r, [id]: snapshot.run }));
          setSessions(list => list.map(session => session.id === id ? { ...session, approvalMode: snapshot.approvalMode } : session));
          setApprovals((a) => [
            ...a.filter((p) => p.sessionId !== id),
            ...snapshot.approvals,
          ]);
        }
        const pending = await seris.goalApprovals();
        if (active)
          setGoals(pending.goals.filter((p) => p.status === 'pending'));
      },
      (connected, error) => {
        if (active) setStatus({ ready: connected, tail: error });
      },
    );
    const poll = setInterval(() => {
      void seris.shellStatus()?.then((s) => {
        if (active && !s.ready)
          setStatus({
            ready: false,
            circuitBroken: s.circuitBroken,
            tail: s.tail,
          });
      });
    }, 3000);
    return () => {
      active = false;
      stop();
      clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    if (!status?.ready) return;
    let active = true,
      working = false;
    const poll = async () => {
      if (working) return;
      working = true;
      try {
        const state = await seris.marketsState();
        if (!active) return;
        setMarketsState(state);
        if (seenNotifications.current) {
          const fresh = state.notifications.find(
            (n) => !seenNotifications.current!.has(n.id),
          );
          if (fresh) setMarketNotification(fresh);
        }
        seenNotifications.current = new Set(
          state.notifications.map((n) => n.id),
        );
      } catch {
      } finally {
        working = false;
      }
    };
    void poll();
    const timer = setInterval(
      poll,
      marketsState?.provider.connecting ? 2000 : 10000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [status?.ready, marketsState?.provider.connecting]);
  const newSession = useCallback(async () => {
    try {
      const s = await seris.createSession();
      setSessions((p) => [s, ...p]);
      setCurrentId(s.id);
      currentRef.current = s.id;
      setView('chat');
      await restore(s.id);
    } catch (e) {
      setNotice(String(e));
    }
  }, [restore]);
  const switchTo = useCallback(
    async (id: string) => {
      setCurrentId(id);
      currentRef.current = id;
      setView('chat');
      try {
        await restore(id);
      } catch (e) {
        setNotice(String(e));
      }
    },
    [restore],
  );
  const openMarketChat = useCallback(async () => {
    if (marketOpening.current) return marketOpening.current;
    const work = (async () => {
      let id = marketSessionRef.current;
      const list = await seris.listSessions();
      if (!id || !list.some((s) => s.id === id)) {
        const session = await seris.createSession();
        id = session.id;
        setSessions((p) => [session, ...p]);
        setMarketSession(id);
        marketSessionRef.current = id;
        localStorage.setItem('seris.marketSession', id);
      }
      currentRef.current = id;
      setCurrentId(id);
      await restore(id);
    })();
    marketOpening.current = work;
    try {
      await work;
    } finally {
      marketOpening.current = null;
    }
  }, [restore]);
  const send = useCallback(async () => {
    const submittedDraft = draft;
    const text = draft.trim();
    if (!text || busy || savingApprovalMode) return;
    const sendingKey = currentId ?? 'new';
    setSending((s) => ({ ...s, [sendingKey]: true }));
    setNotice('');
    const c =
      currentId === marketSessionRef.current &&
      ['markets', 'chat'].includes(view)
        ? marketContext.current
        : undefined;
    const frozen: MarketContextInput | undefined = c
      ? {
          viewId: c.viewId,
          dataRef: c.dataRef,
          visibleRange: c.visibleRange,
          selectedRange: c.selectedRange,
          annotations: c.annotations,
        }
      : undefined;
    let sid = currentId;
    try {
      if (!sid) {
        const s = await seris.createSession();
        sid = s.id;
        setSessions((p) => [s, ...p]);
        // Keep the first request busy after the composer switches from the
        // unsaved draft to its new session, and carry any text typed meanwhile.
        setSending((p) => ({ ...p, [s.id]: true }));
        setDrafts((d) => ({ ...d, [s.id]: d[sendingKey] ?? submittedDraft }));
        setCurrentId(sid);
        currentRef.current = sid;
        if (newApprovalMode !== 'ask') {
          const updated = await seris.setApprovalMode(sid, newApprovalMode);
          setSessions(list => list.map(session => session.id === sid ? updated : session));
        }
        await restore(sid);
      }
      const pending =
        request.current[sid]?.text === text
          ? request.current[sid]
          : { id: crypto.randomUUID(), text, sessionId: sid, context: frozen };
      request.current[sid] = pending;
      const result = await seris.prompt(sid, text, pending.id, pending.context);
      delete request.current[sid];
      // A delayed receipt belongs to the submitted draft, not to text typed
      // while the request was in flight or to a newly selected session.
      setDrafts((d) => {
        const next = { ...d };
        for (const key of new Set([sendingKey, sid!])) {
          if (d[key] === submittedDraft) next[key] = '';
        }
        return next;
      });
      setRuns((r) =>
        r[sid!]?.id === result.runId
          ? r
          : {
              ...r,
              [sid!]: {
                id: result.runId,
                sessionId: sid!,
                status: 'running',
                startedAt: Date.now(),
              },
            },
      );
      // Snapshot catches a run that finished before the POST response arrived.
      await restore(sid, result.runId);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setSending((s) => {
        const next = { ...s };
        delete next[sendingKey];
        if (sid) delete next[sid];
        return next;
      });
    }
  }, [draft, busy, currentId, restore, view, savingApprovalMode, newApprovalMode]);
  const changeApprovalMode = async (mode: ApprovalMode) => {
    const sessionId = currentId;
    if (!sessionId) { setNewApprovalMode(mode); return; }
    if (savingApprovalMode) return;
    setSavingApprovalMode(true);
    try {
      const updated = await seris.setApprovalMode(sessionId, mode);
      setSessions(list => list.map(session => session.id === sessionId ? updated : session));
      await restore(sessionId);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setSavingApprovalMode(false);
    }
  };
  const decide = async (p: ApprovalRequest, allowed: boolean) => {
    try {
      await seris.approve(p.id, p.runId, allowed);
      setApprovals((a) => a.filter((x) => x.id !== p.id));
      await restore(p.sessionId);
    } catch (e) {
      setNotice(String(e));
    }
  };
  const list = currentId ? (messages[currentId] ?? []) : [];
  const openAction = (action: MarketAction) => {
    setMarketsVisited(true);
    setView('markets');
    // Mount a never-opened Markets view before applying the explicit action.
    if (viewRef.current === 'markets' && marketActionHandler.current)
      marketActionHandler.current(action);
    else pendingMarketActions.current = [{ action, automatic: false }];
    if (currentRef.current) {
      marketSessionRef.current = currentRef.current;
      setMarketSession(currentRef.current);
      localStorage.setItem('seris.marketSession', currentRef.current);
    }
    setMarketChatRequest((n) => n + 1);
  };
  const chat = (compact = false) => (
    <ChatPanel
      approvalMode={sessions.find(session => session.id === currentId)?.approvalMode ?? (currentId ? 'ask' : newApprovalMode)}
      approvalModePending={savingApprovalMode || !!sending['new']}
      onApprovalMode={mode => void changeApprovalMode(mode)}
      modelConfig={config}
      onSelectModel={selection=>{void seris.selectModel(selection).then(setConfig).catch(e=>setNotice(String(e)));}}
      onModelSettings={()=>setView('settings')}
      runningModel={busy&&currentId?runs[currentId]?.model:undefined}
      messages={list}
      draft={draft}
      onDraft={setDraft}
      ready={ready}
      busy={busy}
      onSend={() => void send()}
      onStop={() => {
        if (currentId)
          void seris
            .abort(currentId)
            .then(() => restore(currentId))
            .catch((e) => setNotice(String(e)));
      }}
      approvals={approvals.filter((a) => a.sessionId === currentId)}
      onApprove={(a, allowed) => void decide(a, allowed)}
      context={currentId === marketSession ? context : undefined}
      onMarketAction={openAction}
      compact={compact}
    />
  );

  return (
    <div
      className="flex h-screen bg-background text-foreground"
      style={
        {
          '--app-sidebar-width': sidebarCollapsed ? '52px' : '232px',
        } as CSSProperties
      }
    >
      {/* Compact navigation and session list share one sidebar. */}
      <aside
        aria-label={t('App sidebar')}
        className={`app-sidebar flex shrink-0 flex-col border-r border-border bg-panel ${sidebarCollapsed ? 'is-collapsed' : ''}`}
      >
        <div className="sidebar-brand flex shrink-0 items-center gap-2 px-3">
          <div className="flex h-9 w-9 items-center justify-center p-1.5">
            <img
              src="/brand/logos/mark-on-light.svg"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 dark:hidden"
            />
            <img
              src="/brand/logos/mark-on-dark.svg"
              alt=""
              width={24}
              height={24}
              className="hidden h-6 w-6 dark:block"
            />
          </div>
          <img
            src="/brand/logos/wordmark-on-light.svg"
            alt="Seris"
            className="sidebar-wordmark h-5 w-auto dark:hidden"
          />
          <img
            src="/brand/logos/wordmark-on-dark.svg"
            alt="Seris"
            className="sidebar-wordmark hidden h-5 w-auto dark:block"
          />
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={
            sidebarCollapsed
              ? t('Expand main sidebar')
              : t('Collapse main sidebar')
          }
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar')}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d={sidebarCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
          </svg>
        </button>
        <nav
          aria-label={t('Main navigation')}
          className="flex shrink-0 flex-col gap-0.5 px-2"
        >
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setView(n.id);
                if (n.id === 'markets') {
                  setMarketsVisited(true);
                  if (marketSessionRef.current)
                    void openMarketChat().catch((e) => setNotice(String(e)));
                }
              }}
              title={t(n.label)}
              aria-label={t(n.label)}
              aria-current={view === n.id ? 'page' : undefined}
              className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors focus-visible:outline-1 focus-visible:outline-ring ${
                view === n.id
                  ? 'bg-secondary text-foreground'
                  : 'text-foreground/80 hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                {n.icon}
              </svg>
              <span className="sidebar-label">{t(n.label)}</span>
            </button>
          ))}
        </nav>
        {view === 'chat' && !sidebarCollapsed && (
          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-[11px] text-muted-foreground">
                {t('Sessions')}
              </span>
              <button
                onClick={newSession}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t('+ New')}
              </button>
            </div>
            <div
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
              ref={sessionList}
            >
              {sessions.length === 0 && (
                <div className="px-2 py-4 text-xs leading-relaxed text-muted-foreground">
                  {t('No sessions yet.')}
                  <br />
                  {t('Start one — or just ask something below.')}
                </div>
              )}
              {sessions.map((s) => {
                const preview = sessionPreview(messages[s.id] ?? []);
                const name = isUntitledSessionName(s.name)
                  ? sessionTitleFallback(
                      (messages[s.id] ?? []).find((m) => m.role === 'user')
                        ?.text ?? '',
                    ) || t('New chat')
                  : s.name;
                return (
                  <button
                    key={s.id}
                    onClick={() => void switchTo(s.id)}
                    className={`block w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                      s.id === currentId
                        ? 'bg-secondary text-foreground'
                        : 'text-foreground/80 hover:bg-secondary/60 hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span title={name} className="truncate text-[13px]">
                        {name}
                      </span>
                      <span className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {fmtTime(s.modifiedAt, locale)}
                      </span>
                    </div>
                    {preview && (
                      <div className="mt-1 truncate text-[11px] leading-snug text-muted-foreground">
                        {preview}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-auto shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={() => setView('settings')}
            title={`${connectionDescription}. ${t('Open settings')}`}
            aria-label={t('Settings')}
            aria-current={view === 'settings' ? 'page' : undefined}
            className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors hover:bg-secondary focus-visible:outline-1 focus-visible:outline-ring ${view === 'settings' ? 'bg-secondary' : ''}`}
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 3-.5 2a8 8 0 0 0-2 1L4.5 5.5 2 10l1.5 1.5a8 8 0 0 0 0 2L2 15l2.5 4.5 2-.5a8 8 0 0 0 2 1l.5 2h6l.5-2a8 8 0 0 0 2-1l2 .5L22 15l-1.5-1.5a8 8 0 0 0 0-2L22 10l-2.5-4.5-2 .5a8 8 0 0 0-2-1L15 3Z" />
              <circle cx="12" cy="12.5" r="3" />
            </svg>
            <span className="sidebar-label">{t('Settings')}</span>
            <span
              className="sidebar-connection ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"
              role="status"
              aria-label={connectionDescription}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${connectionState === 'Ready' ? 'bg-success' : connectionState === 'Offline' ? 'bg-destructive' : 'bg-warning'}`}
              />
              {t(connectionState)}
            </span>
          </button>
        </div>
      </aside>

      {/* ── main surface ──────────────────────────────────────────────── */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
          <span className="text-[13px] font-medium">
            {view === 'settings'
              ? t('Settings')
              : t(NAV.find((n) => n.id === view)!.label)}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {status?.ready
              ? config?.configured
                ? t('Connected')
                : t('Model setup required')
              : t('Connecting…')}
          </span>
        </div>
        {marketNotification && (
          <div className="market-toast" role="status">
            <button
              onClick={() => {
                setMarketsVisited(true);
                setView('markets');
                setMarketNotification(undefined);
              }}
            >
              {t('{symbol} alert triggered', {
                symbol: marketNotification.instrument.symbol,
              })}{' '}
              · {t('View Markets ↗')}
            </button>
            <button
              aria-label={t('Dismiss market notification')}
              onClick={() => setMarketNotification(undefined)}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div role="alert" className="px-4 py-2 text-sm text-destructive">
            {t('Could not complete this action. Please try again.')}
          </div>
        )}
        {goals.map((p) => (
          <div key={p.id} className="border-b border-border p-4 text-sm">
            <p>{p.reason}</p>
            <pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(p.payload, null, 2)}
            </pre>
            <button
              className="mr-3"
              onClick={() =>
                void seris
                  .decideGoal(p.id, true)
                  .then(() => setGoals((g) => g.filter((x) => x.id !== p.id)))
                  .catch((e) => setNotice(String(e)))
              }
            >
              {t('Approve')}
            </button>
            <button
              onClick={() =>
                void seris
                  .decideGoal(p.id, false)
                  .then(() => setGoals((g) => g.filter((x) => x.id !== p.id)))
                  .catch((e) => setNotice(String(e)))
              }
            >
              {t('Reject')}
            </button>
          </div>
        ))}
        {view === 'settings' && (
          <SettingsPage
            config={config}
            connected={status?.ready === true}
            onConfigChange={setConfig}
          />
        )}
        {view === 'chat' && chat()}
        {marketsVisited && (
          <Suspense
            fallback={
              view === 'markets' ? (
                <div className="chart-empty">{t('Loading Markets…')}</div>
              ) : null
            }
          >
            <MarketsPanel
              state={marketsState}
              setState={setMarketsState}
              active={view === 'markets'}
              chatRequest={marketChatRequest}
              chat={view === 'markets' ? chat(true) : null}
              onOpenChat={openMarketChat}
              onChatOpenChange={setMarketChatOpen}
              onFullChat={() => setView('chat')}
              onAsk={async (text) => {
                await openMarketChat();
                const id = marketSessionRef.current!;
                setDrafts((d) => ({ ...d, [id]: text }));
              }}
              onContext={attachContext}
              registerActions={registerActions}
            />
          </Suspense>
        )}
        {view === 'strategies' && <StrategiesPanel />}
      </main>

      {/* circuit-break banner */}
      {status?.circuitBroken && (
        <div className="absolute inset-x-0 bottom-0 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
          {t('The service could not start after repeated attempts.')}
          {status.tail && (
            <span className="ml-2 opacity-70">{status.tail.slice(-200)}</span>
          )}
          <span className="ml-2">{t('Restart the app.')}</span>
        </div>
      )}
    </div>
  );
}
