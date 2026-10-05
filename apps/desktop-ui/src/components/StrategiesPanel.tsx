/** Strategy catalog, documentation and backtest results. */

import { useEffect, useState, type JSX } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { seris, type BacktestRunSummary, type BacktestRunDetail } from '../seris';
import { BacktestChart } from './BacktestChart';
import { CodeBlock } from './CodeBlock';
import { Markdown } from './Markdown';
import { useI18n } from '../i18n';

interface StrategyItem {
  name: string;
  description: string;
  valid: boolean;
  problems?: string[];
}

interface StrategyDetail {
  source: string;
  skillDoc?: string;
  params?: Record<string, { type: string; default: number | boolean | string; min?: number; max?: number; description?: string }>;
  timeframe?: string;
  valid: boolean;
}

function fmtPct(n: number | undefined): string {
  if (n === undefined) return '—';
  return (n * 100).toFixed(2) + '%';
}
function fmtN(n: number | null | undefined, d = 2): string {
  return n === null ? '∞' : n === undefined ? '—' : n.toFixed(d);
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function StrategiesPanel(): JSX.Element {
  const { t } = useI18n();
  const [strategies, setStrategies] = useState<StrategyItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StrategyDetail | null>(null);
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{ id: string; result: BacktestRunDetail } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load catalog once + poll gently
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      seris.strategiesList().then((r) => {
        if (alive) setStrategies(r.strategies);
      }).catch(() => { /* tolerate startup timing */ });
    };
    refresh();
    const id = setInterval(refresh, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Load detail + runs when selected
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setRuns([]);
    setSelectedRun(null);
    setRunDetail(null);
    setTab('overview');
    if (!selected) return;
    setLoading(true);
    setError(null);
    Promise.all([
      seris.strategyGet(selected).catch((e) => { if (alive) setError(String(e?.message ?? e)); return null; }),
      seris.strategyBacktests(selected).catch(() => ({ runs: [] as BacktestRunSummary[] })),
    ]).then(([d, r]) => {
      if (!alive) return;
      setLoading(false);
      if (d) setDetail(d);
      setRuns(r.runs);
      setSelectedRun(r.runs[0]?.id ?? null);
    });
    const id = setInterval(() => {
      seris.strategyBacktests(selected).then((r) => {
        if (!alive) return;
        setRuns(r.runs);
        setSelectedRun((id) => r.runs.some((run) => run.id === id) ? id : r.runs[0]?.id ?? null);
      }).catch(() => {});
    }, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [selected]);

  // Keep results in a stable detail area, independently of the selected list row.
  useEffect(() => {
    let alive = true;
    setRunDetail(null);
    setRunError(null);
    if (!selectedRun) return;
    seris.strategyBacktestGet(selectedRun).then((result) => {
      if (alive) setRunDetail({ id: selectedRun, result });
    }).catch(() => { if (alive) setRunError(t('Unable to load backtest results.')); });
    return () => { alive = false; };
  }, [selectedRun, t]);

  const activeRun = runs.find((r) => r.id === selectedRun);
  const result = runDetail?.id === selectedRun ? runDetail.result : null;

  return (
    <div className="strategies-panel">
      <aside className="strategies-list">
        <header>
          <h2>{t('Strategies')}</h2>
          <p className="muted">
            {t('Tell Seris to "write me a strategy that does X" and it will draft one for review.')}
          </p>
        </header>
        <ul>
          {strategies.map((s) => (
            <li key={s.name}>
              <button
                className={selected === s.name ? 'active' : ''}
                onClick={() => setSelected(s.name)}
              >
                <strong>{s.name}</strong>
                {!s.valid && <span className="pill warn">{t('broken')}</span>}
                {s.valid && <span className="pill ok">{t('ok')}</span>}
                {s.description && <small>{s.description}</small>}
              </button>
            </li>
          ))}
          {!strategies.length && (
            <li className="muted">{t('No strategies yet. Ask Seris to write one.')}</li>
          )}
        </ul>
      </aside>

      <section className="strategies-detail">
        {!selected && (
          <div className="empty-state">
            <h3>{t('Pick a strategy on the left')}</h3>
            <p className="muted">
              {t('Backtests run from Chat will appear here.')}
            </p>
          </div>
        )}
        {selected && (
          <>
            <header className="strategies-detail-header">
              <h2>{selected}</h2>
            </header>
            {loading && <p className="muted">{t('Loading…')}</p>}
            {error && <p role="alert" className="error">{error}</p>}
            <Tabs.Root value={tab} onValueChange={(value) => setTab(String(value))}>
              <Tabs.List className="surface-tabs" aria-label={t('Strategy details')}>
                <Tabs.Tab value="overview">{t('Strategy overview')}</Tabs.Tab>
                <Tabs.Tab value="code">{t('Strategy code')}</Tabs.Tab>
                <Tabs.Tab value="doc">{t('Strategy documentation')}</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="code" className="strategy-tab-panel">
                {detail && <div className="strategies-source"><CodeBlock code={detail.source} language="typescript" maxHeight={640} /></div>}
              </Tabs.Panel>
              <Tabs.Panel value="doc" className="strategy-tab-panel">
                {detail && (detail.skillDoc
                  ? <div className="strategies-doc"><Markdown text={detail.skillDoc.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')} /></div>
                  : <p className="muted">{t('No strategy documentation yet.')}</p>)}
              </Tabs.Panel>
              <Tabs.Panel value="overview" className="strategy-tab-panel">

                {detail?.params && Object.keys(detail.params).length > 0 && (
                  <section className="strategies-params">
                    <h3>{t('Parameters')}</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>{t('name')}</th>
                          <th>{t('type')}</th>
                          <th>{t('default')}</th>
                          <th>{t('range')}</th>
                          <th>{t('description')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(detail.params).map(([k, v]) => (
                          <tr key={k}>
                            <td><code>{k}</code></td>
                            <td>{v.type}</td>
                            <td>{String(v.default)}</td>
                            <td>{v.min !== undefined || v.max !== undefined ? `${v.min ?? '—'} .. ${v.max ?? '—'}` : '—'}</td>
                            <td>{v.description ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <section className="strategies-runs">
                  <h3>{t('Backtest runs')} ({runs.length})</h3>
                  {!runs.length && (
                    <p className="muted">
                      {t('No runs yet. In Chat, ask:')}{' '}
                      <code>{t('Backtest {name} on BTCUSDT 1h for the last 90 days', { name: selected })}</code>
                    </p>
                  )}
                  <ul>
                    {runs.map((r) => (
                      <li key={r.id}>
                        <button
                          className={selectedRun === r.id ? 'active run' : 'run'}
                          aria-pressed={selectedRun === r.id}
                          onClick={() => setSelectedRun(r.id)}
                        >
                          <strong>{r.symbol}</strong>
                          <span className="muted">{r.interval}</span>
                          <span className={r.metrics.totalReturn >= 0 ? 'gain' : 'loss'}>
                            {fmtPct(r.metrics.totalReturn)}
                          </span>
                          <span className="muted">{t('Sharpe')} {fmtN(r.metrics.sharpe)}</span>
                          <span className="muted">{t('Trades')} {r.metrics.tradeCount}</span>
                          <span className="muted">{fmtTime(r.startedAt)}</span>
                        </button>

                      </li>
                    ))}
                  </ul>
                </section>
                {activeRun && (
                  <section className="run-detail" aria-label={t('Run {id}', { id: activeRun.id })} aria-busy={!result && !runError}>
                    <header className="run-detail-header">
                      <h3>{activeRun.symbol} · {activeRun.interval}</h3>
                      <span className="muted">{t('Run {id}', { id: activeRun.id })} · {fmtTime(activeRun.startedAt)}</span>
                    </header>
                    {runError && <p role="alert" className="error">{runError}</p>}
                    {!result && !runError && <p className="muted">{t('Loading…')}</p>}
                    {result && (
                      <>
                        <div className="run-metrics">
                          <div><strong>{t('Total return')}</strong> {fmtPct(result.metrics.totalReturn)}</div>
                          <div><strong>{t('Sharpe')}</strong> {fmtN(result.metrics.sharpe)}</div>
                          <div><strong>{t('Sortino')}</strong> {fmtN(result.metrics.sortino)}</div>
                          <div><strong>{t('Max drawdown')}</strong> {fmtPct(result.metrics.maxDrawdown)}</div>
                          <div><strong>{t('Win rate')}</strong> {fmtPct(result.metrics.winRate)}</div>
                          <div><strong>{t('Profit factor')}</strong> {fmtN(result.metrics.profitFactor)}</div>
                          <div><strong>{t('Trades')}</strong> {result.metrics.tradeCount}</div>
                          <div><strong>{t('Fees paid')}</strong> ${fmtN(result.metrics.totalFees)}</div>
                        </div>
                        <BacktestChart candles={result.candleSeries} fills={result.fills} equity={result.equity} stopTrail={result.stopTrail} />
                      </>
                    )}
                  </section>
                )}
              </Tabs.Panel>
            </Tabs.Root>
          </>
        )}
      </section>
    </div>
  );
}
