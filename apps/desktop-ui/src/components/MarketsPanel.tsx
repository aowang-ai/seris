import { useI18n } from '../i18n';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { seris, type MarketsState } from '../seris';
import { Tabs } from '@base-ui/react/tabs';
import {
  MARKET_INTERVALS,
  type Instrument,
  type MarketChart as ChartData,
  type MarketInterval,
  type MarketContext,
  type MarketAction,
  type MarketQuote,
  type MarketNews,
  type TimeRange,
} from '../../../core/src/markets/types';
import { MarketChart, type PriceLine } from './MarketChart';
import {
  price,
  time,
  venue,
  contextLabel,
  intervalLabel,
  instrumentName,
  openMarketLink,
} from './marketUi';
import { MarketWatchlist } from './MarketWatchlist';
import {
  MarketNewsPanel,
  MarketAlertsPanel,
  AlertEditor,
} from './MarketActivity';
import { MarketSearch } from './MarketSearch';

const DETAIL_TABS = [
  ['chart', 'Chart'],
  ['news', 'News'],
  ['alerts', 'Alerts'],
] as const;
type DetailTab = (typeof DETAIL_TABS)[number][0];

interface Props {
  active: boolean;
  chatRequest?: number;
  state?: MarketsState;
  setState: Dispatch<SetStateAction<MarketsState | undefined>>;
  chat: ReactNode;
  onOpenChat: () => Promise<void>;
  onChatOpenChange: (open: boolean) => void;
  onFullChat: () => void;
  onAsk: (text: string) => Promise<void>;
  onContext: (context: MarketContext | undefined) => void;
  registerActions: (
    handler: (action: MarketAction, automatic?: boolean) => void,
  ) => () => void;
}
export function MarketsPanel(p: Props) {
  const { t, language, locale } = useI18n();
  const { state, setState } = p;
  const [instrument, setInstrument] = useState<Instrument>();
  const [interval, setIntervalValue] = useState<MarketInterval>('1d');
  const [viewId, setViewId] = useState<string>(() => crypto.randomUUID());
  const [chart, setChart] = useState<ChartData>();
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState('');
  const [error, setError] = useState('');
  const [quotes, setQuotes] = useState<
    Record<string, { quote?: MarketQuote; error?: string }>
  >({});
  const [news, setNews] = useState<MarketNews[]>([]);
  const [newsError, setNewsError] = useState('');
  const [newsLoading, setNewsLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatToggle = useRef<HTMLButtonElement>(null);
  const watchToggle = useRef<HTMLButtonElement>(null);
  const closeWatchlist = () => {
    setWatchlistPreference(false);
    watchToggle.current?.focus();
  };
  const closeChat = () => {
    setChatOpen(false);
    chatToggle.current?.focus();
  };
  const [tab, setTab] = useState<DetailTab>('chart');
  useEffect(() => {
    if (p.chatRequest) {
      setChatOpen(true);
      setTab('chart');
    }
  }, [p.chatRequest]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [watchlistPreference, setWatchlistPreference] = useState<boolean>();
  const [narrow, setNarrow] = useState(
    () => window.matchMedia('(max-width: 1200px)').matches,
  );
  const [watchPending, setWatchPending] = useState(false);
  const watchUpdating = useRef(false);
  const watchlistVisible = watchlistPreference ?? !(chatOpen && narrow);
  const watched =
    state?.watchlist.some((i) => i.id === instrument?.id) ?? false;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1200px)');
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    p.onChatOpenChange(chatOpen);
  }, [chatOpen, p.onChatOpenChange]);
  const [chatWidth, setChatWidth] = useState(380);
  const [resizing, setResizing] = useState(false);
  const [visible, setVisible] = useState<TimeRange>();
  const [selected, setSelected] = useState<TimeRange>();
  const [annotations, setAnnotations] = useState<
    Array<PriceLine & { instrumentId: string; interval: MarketInterval }>
  >([]);
  const [showAlert, setShowAlert] = useState(false);
  const interactionBlocked = useRef(false);
  interactionBlocked.current = searchOpen || showAlert;
  const [refresh, setRefresh] = useState(0);
  const intentSequence = useRef(0);
  const chartSequence = useRef(0);
  const skipInitial = useRef<string>();
  const active = useRef(p.active);
  active.current = p.active;
  const current = useRef({ viewId, instrument, interval });
  current.current = { viewId, instrument, interval };
  const queue = useRef(Promise.resolve());
  const alerts =
    state?.alerts.filter(
      (a) => a.rule.instrument.id === instrument?.id && a.status !== 'closed',
    ) ?? [];
  const lines = useMemo(
    () => [
      ...annotations.filter(
        (a) => a.instrumentId === instrument?.id && a.interval === interval,
      ),
      ...alerts
        .filter((a) => a.rule.metric === 'price' && a.status === 'active')
        .map((a) => ({
          id: a.id,
          price: a.rule.threshold,
          label: t('Alert'),
          color: '#9b8bbb',
        })),
    ],
    [annotations, instrument?.id, interval, state?.alerts, t],
  );
  const context = useMemo<MarketContext | undefined>(
    () =>
      chart
        ? {
            viewId,
            dataRef: chart.id,
            instrument: chart.instrument,
            interval: chart.interval,
            quote: chart.quote,
            fetchedAt: chart.fetchedAt,
            source: chart.source,
            adjustment: chart.adjustment,
            visibleRange: visible,
            selectedRange: selected,
            annotations: lines.map((l) => ({ price: l.price, label: l.label })),
          }
        : undefined,
    [chart, viewId, visible, selected, lines],
  );
  useEffect(() => {
    p.onContext(context);
  }, [context, p.onContext]);
  const sync = useCallback(async () => {
    const next = await seris.marketsState();
    setState(next);
    return next;
  }, [setState]);
  useEffect(() => {
    if (p.active) setInstrument((previous) => previous ?? state?.watchlist[0]);
  }, [p.active, state?.watchlist]);
  useEffect(() => {
    if (!p.active) return;
    let alive = true,
      working = false;
    const update = async () => {
      if (working) return;
      working = true;
      try {
        const { quotes: rows } = await seris.marketQuotes();
        if (alive)
          setQuotes(
            Object.fromEntries(rows.map((row) => [row.instrument.id, row])),
          );
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        working = false;
      }
    };
    void update();
    const timer = window.setInterval(update, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [
    p.active,
    state?.watchlist.map((i) => i.id).join(','),
    state?.provider.connected,
  ]);
  const change = useCallback(
    (next: Instrument, period: MarketInterval = interval) => {
      intentSequence.current++;
      setShowAlert(false);
      setTab('chart');
      p.onContext(undefined);
      setChart(undefined);
      setChartError('');
      setVisible(undefined);
      setSelected(undefined);
      const nextInterval =
        next.venue === 'us' && period === '4h' ? '1d' : period;
      const id = crypto.randomUUID();
      current.current = {
        viewId: id,
        instrument: next,
        interval: nextInterval,
      };
      setViewId(id);
      setInstrument(next);
      setIntervalValue(nextInterval);
    },
    [interval, p.onContext],
  );
  useEffect(() => {
    if (!p.active || !instrument) return;
    const seq = ++chartSequence.current;
    let alive = true,
      working = false;
    const update = async () => {
      if (working) return;
      working = true;
      setLoading(true);
      try {
        const result = await seris.marketChart(instrument, interval);
        if (
          alive &&
          seq === chartSequence.current &&
          current.current.viewId === viewId
        ) {
          setChart(result);
          setChartError('');
        }
      } catch (e) {
        if (
          alive &&
          seq === chartSequence.current &&
          current.current.viewId === viewId
        )
          setChartError(String(e));
      } finally {
        working = false;
        if (
          alive &&
          seq === chartSequence.current &&
          current.current.viewId === viewId
        )
          setLoading(false);
      }
    };
    if (skipInitial.current === viewId) skipInitial.current = undefined;
    else void update();
    const timer = window.setInterval(update, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [
    p.active,
    instrument?.id,
    interval,
    viewId,
    refresh,
    state?.provider.connected,
  ]);
  useEffect(() => {
    if (!p.active || !instrument) return;
    let alive = true;
    setNewsLoading(true);
    setNews([]);
    setNewsError('');
    void seris
      .marketNews(instrument)
      .then((r) => {
        if (alive) setNews(r.news);
      })
      .catch((e) => {
        if (alive) setNewsError(String(e));
      })
      .finally(() => {
        if (alive) setNewsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [p.active, instrument?.id, state?.provider.connected, refresh]);
  const changeTab = (value: DetailTab) => {
    // A later user tab choice must invalidate an in-flight automatic view action.
    intentSequence.current++;
    const id = crypto.randomUUID();
    current.current = { ...current.current, viewId: id };
    skipInitial.current = id;
    setViewId(id);
    setTab(value);
  };
  const apply = useCallback(
    async (action: MarketAction, automatic = false) => {
      if (
        automatic &&
        (!active.current ||
          interactionBlocked.current ||
          action.kind !== 'view' ||
          (action.originViewId !== undefined &&
            current.current.viewId !== action.originViewId))
      )
        return;
      const token = ++intentSequence.current;
      const result = await seris.marketSnapshot(action.context.dataRef);
      if (
        token !== intentSequence.current ||
        (automatic &&
          (!active.current ||
            interactionBlocked.current ||
            (action.originViewId !== undefined &&
              current.current.viewId !== action.originViewId)))
      )
        return;
      p.onContext(undefined);
      // A manual restore/annotation is a new user view, even on the same market.
      // This restarts its refresh generation and invalidates older automatic actions.
      const nextViewId = automatic
        ? action.context.viewId
        : crypto.randomUUID();
      skipInitial.current = nextViewId;
      current.current = {
        viewId: nextViewId,
        instrument: result.instrument,
        interval: result.interval,
      };
      setTab('chart');
      setShowAlert(false);
      setInstrument(result.instrument);
      setIntervalValue(result.interval);
      setViewId(nextViewId);
      setLoading(false);
      setChart(result);
      setChartError('');
      setVisible(action.context.visibleRange);
      setSelected(action.context.selectedRange);
      if (action.kind === 'price-line')
        setAnnotations((a) =>
          [
            ...a.filter((v) => v.id !== action.id),
            {
              id: action.id,
              price: action.price!,
              label: action.label,
              instrumentId: result.instrument.id,
              interval: result.interval,
            },
          ].slice(-30),
        );
    },
    [p.onContext],
  );
  useEffect(
    () =>
      p.registerActions((action, automatic) => {
        queue.current = queue.current
          .then(() => apply(action, automatic))
          .catch((e) => {
            setError(String(e));
            setRefresh((r) => r + 1);
          });
      }),
    [apply, p.registerActions],
  );
  const openChat = async () => {
    try {
      await p.onOpenChat();
      setChatOpen(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const ask = async (text: string) => {
    try {
      await p.onAsk(text);
      setChatOpen(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const connect = async () => {
    try {
      setError('');
      const provider = await seris.connectMarkets();
      setState((s) => (s ? { ...s, provider } : s));
      if (provider.authorizationUrl)
        await openMarketLink(provider.authorizationUrl);
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = async (i: Instrument) => {
    const result = await seris.removeMarket(i.id);
    setState((s) => (s ? { ...s, ...result } : s));
  };
  const toggleWatch = async (i: Instrument) => {
    if (watchUpdating.current) return;
    watchUpdating.current = true;
    setWatchPending(true);
    try {
      const result = state?.watchlist.some((w) => w.id === i.id)
        ? await seris.removeMarket(i.id)
        : await seris.marketWatchlist(i);
      setState((s) => (s ? { ...s, ...result } : s));
    } finally {
      watchUpdating.current = false;
      setWatchPending(false);
    }
  };
  const q =
    chart?.quote ?? (instrument ? quotes[instrument.id]?.quote : undefined);
  const dataAge = q ? Date.now() - q.time : 0;
  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    setResizing(true);
    const start = e.clientX,
      width = chatWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
    const host = e.currentTarget;
    host.onpointermove = (event) =>
      setChatWidth(Math.max(300, Math.min(560, width + start - event.clientX)));
    host.onpointerup = host.onpointercancel = () => {
      setResizing(false);
      host.onpointermove = null;
      host.onpointerup = null;
      host.onpointercancel = null;
    };
  };
  return (
    <div
      className="markets-workspace"
      style={{ display: p.active ? undefined : 'none' }}
    >
      <div className="markets-topbar">
        <button
          className="market-watchlist-toggle"
          ref={watchToggle}
          aria-label={
            watchlistVisible ? t('Collapse watchlist') : t('Expand watchlist')
          }
          aria-expanded={watchlistVisible}
          onClick={() => setWatchlistPreference(!watchlistVisible)}
        >
          ☰ <span>{t('Watchlist')}</span>
        </button>
        <button
          className="market-search-trigger"
          onClick={() => setSearchOpen(true)}
          aria-label={t('Search markets')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <span>{t('Search symbol or name…')}</span>
        </button>
        <button
          className="market-top-chat"
          ref={chatToggle}
          aria-label={
            chatOpen ? t('Collapse Markets Chat') : t('Open Markets Chat')
          }
          aria-expanded={chatOpen}
          aria-controls="markets-agent-chat"
          title={t('Seris Agent')}
          onClick={() => (chatOpen ? closeChat() : void openChat())}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="7" width="16" height="13" rx="3" />
            <path d="M12 3v4M2 12v4m20-4v4M9 16h6" />
            <circle cx="9" cy="11" r=".75" fill="currentColor" stroke="none" />
            <circle cx="15" cy="11" r=".75" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
      <div className="markets-body">
        {watchlistVisible && chatOpen && narrow && (
          <button
            className="watchlist-backdrop"
            aria-label={t('Close watchlist')}
            onClick={closeWatchlist}
          />
        )}
        <div
          className={`market-watchlist-shell ${watchlistVisible ? '' : 'is-closed'} ${chatOpen && narrow ? 'is-overlay' : ''}`}
          aria-hidden={!watchlistVisible}
          {...(!watchlistVisible ? { inert: '' } : {})}
        >
          <MarketWatchlist
            state={state}
            quotes={quotes}
            selected={instrument?.id}
            onSelect={(i) => {
              change(i);
              if (chatOpen && narrow) closeWatchlist();
            }}
            onRemove={async (i) => {
              try {
                await remove(i);
              } catch (e) {
                setError(String(e));
              }
            }}
            onConnect={connect}
            onError={setError}
          />
        </div>
        <section className="market-detail">
          {error && (
            <div role="alert" className="market-error">
              {t('Could not complete this action. Please try again.')}
              <button onClick={() => setError('')}>×</button>
            </div>
          )}
          {instrument ? (
            <>
              <header className="market-heading">
                <div>
                  <h1>
                    {instrument.symbol}
                    <button
                      className="market-star"
                      disabled={watchPending}
                      aria-label={
                        watched
                          ? t('Unwatch current instrument')
                          : t('Watch current instrument')
                      }
                      aria-pressed={watched}
                      onClick={() =>
                        void toggleWatch(instrument).catch((e) =>
                          setError(String(e)),
                        )
                      }
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill={watched ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z" />
                      </svg>
                    </button>
                    <span>{instrumentName(instrument, language)}</span>
                  </h1>
                  <small>{venue(instrument, language)}</small>
                </div>
              </header>
              <div className="market-quote">
                <strong>
                  {q
                    ? q.currency === 'USDT'
                      ? `${price(q.price, locale)} USDT`
                      : `$${price(q.price, locale)}`
                    : '—'}
                </strong>
                {q?.changePct != null && (
                  <span className={q.changePct < 0 ? 'down' : 'up'}>
                    {q.changePct > 0 ? '+' : ''}
                    {q.changePct.toFixed(2)}%{' '}
                    <small>
                      {q.changePeriod === '24h'
                        ? t('24h')
                        : t('Previous close')}
                    </small>
                  </span>
                )}
                {q && (
                  <small className="market-update">
                    {dataAge > 300000 ? t('Historical quote') : t('Updated')}{' '}
                    {new Date(q.time).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                )}
              </div>
              <Tabs.Root
                value={tab}
                onValueChange={(value) => changeTab(value as DetailTab)}
              >
                <Tabs.List
                  className="market-tabs"
                  aria-label={t('Instrument details')}
                >
                  {DETAIL_TABS.map(([id, label]) => (
                    <Tabs.Tab key={id} value={id}>
                      {t(label)}
                      {id === 'alerts' && alerts.length > 0 && (
                        <small>{alerts.length}</small>
                      )}
                    </Tabs.Tab>
                  ))}
                  <Tabs.Indicator className="market-tab-indicator" />
                </Tabs.List>
                <Tabs.Panel
                  value="chart"
                  keepMounted
                  className="market-tab-panel"
                >
                  <div className="market-toolbar">
                    <div className="market-periods">
                      {MARKET_INTERVALS.map((v) => (
                        <button
                          aria-pressed={v === interval}
                          key={v}
                          disabled={instrument.venue === 'us' && v === '4h'}
                          onClick={() => change(instrument, v)}
                        >
                          {intervalLabel(v, language)}
                        </button>
                      ))}
                    </div>
                    <div>
                      <button
                        onClick={() => setRefresh((v) => v + 1)}
                        disabled={loading}
                      >
                        {loading ? t('Updating…') : t('Refresh')}
                      </button>
                      {selected && (
                        <button onClick={() => setSelected(undefined)}>
                          {t('Clear range')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="market-chart-frame">
                    {chart ? (
                      <MarketChart
                        data={chart}
                        viewId={viewId}
                        active={p.active && tab === 'chart'}
                        restoreRange={visible}
                        lines={lines}
                        selection={selected}
                        onVisible={setVisible}
                        onSelected={setSelected}
                      />
                    ) : (
                      <div className="chart-empty">
                        <span>
                          {loading
                            ? t('Loading candles…')
                            : chartError
                              ? t(
                                  'Market data unavailable. Check the connection or retry.',
                                )
                              : t('No chart data')}
                        </span>
                        {instrument.venue === 'us' &&
                          !state?.provider.connected && (
                            <>
                              <button
                                disabled={state?.provider.connecting}
                                onClick={() => void connect()}
                              >
                                {state?.provider.connecting
                                  ? t('Waiting for Longbridge authorization…')
                                  : t('Connect US market data')}
                              </button>
                              {state?.provider.authorizationUrl && (
                                <button
                                  onClick={() =>
                                    void openMarketLink(
                                      state.provider.authorizationUrl!,
                                    ).catch((e) => setError(String(e)))
                                  }
                                >
                                  {t('Open authorization page ↗')}
                                </button>
                              )}
                            </>
                          )}
                        {!loading && (
                          <button onClick={() => setRefresh((v) => v + 1)}>
                            {t('Retry')}
                          </button>
                        )}
                      </div>
                    )}
                    {chart && chartError && (
                      <div className="chart-warning">
                        {t('Update failed; showing the snapshot from {date}', {
                          date: time(chart.fetchedAt, locale),
                        })}
                      </div>
                    )}
                  </div>
                </Tabs.Panel>
                <Tabs.Panel
                  value="news"
                  keepMounted
                  className="market-tab-panel"
                >
                  <MarketNewsPanel
                    news={news}
                    newsError={newsError}
                    newsLoading={newsLoading}
                    onError={setError}
                    onAsk={(text) =>
                      ask(
                        `${instrument.symbol} · ${venue(instrument, language)}\n${text}`,
                      )
                    }
                  />
                  {newsError && (
                    <button
                      className="market-text-action"
                      onClick={() => setRefresh((v) => v + 1)}
                    >
                      {t('Retry')}
                    </button>
                  )}
                </Tabs.Panel>
                <Tabs.Panel
                  value="alerts"
                  keepMounted
                  className="market-tab-panel"
                >
                  <MarketAlertsPanel
                    alerts={alerts}
                    notifications={(state?.notifications ?? []).filter(
                      (n) => n.instrument.id === instrument.id,
                    )}
                    onError={setError}
                    onAsk={ask}
                    onCreate={() => setShowAlert(true)}
                    onStatus={async (id, status) => {
                      await seris.setAlert(id, status);
                      await sync();
                    }}
                  />
                </Tabs.Panel>
              </Tabs.Root>
              {instrument && (
                <AlertEditor
                  open={showAlert}
                  key={instrument.id}
                  instrument={instrument}
                  initialPrice={q?.price}
                  onSaved={async () => {
                    await sync();
                    setShowAlert(false);
                    setTab('alerts');
                  }}
                  onCancel={() => setShowAlert(false)}
                />
              )}
            </>
          ) : (
            <div className="chart-empty">
              <span>
                {t('Search for an instrument to start following markets.')}
              </span>
              <button onClick={() => setSearchOpen(true)}>
                {t('Search markets')}
              </button>
            </div>
          )}
        </section>
        <div
          className={`market-chat-shell ${chatOpen ? '' : 'is-closed'} ${resizing ? 'is-resizing' : ''}`}
          style={
            { '--chat-requested-width': `${chatWidth}px` } as CSSProperties
          }
          aria-hidden={!chatOpen}
          {...(!chatOpen ? { inert: '' } : {})}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('Resize Markets Chat')}
            className="chat-resizer"
            onPointerDown={resize}
          />
          <aside className="market-chat" id="markets-agent-chat">
            <header>
              <span>
                {context
                  ? contextLabel(context, language)
                  : `${instrument?.symbol ?? ''} · ${t('Chart data not ready')}`}
              </span>
              <div>
                <button onClick={p.onFullChat} title={t('Expand to full Chat')}>
                  ↗
                </button>
                <button
                  onClick={closeChat}
                  aria-label={t('Collapse Markets Chat')}
                >
                  ×
                </button>
              </div>
            </header>
            {p.chat}
          </aside>
        </div>
      </div>
      <MarketSearch
        open={searchOpen}
        watchlist={state?.watchlist ?? []}
        onSelect={change}
        onToggle={toggleWatch}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  );
}
