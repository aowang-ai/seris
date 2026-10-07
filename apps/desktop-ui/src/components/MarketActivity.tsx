import { useI18n } from '../i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { seris } from '../seris';
import type {
  Instrument,
  MarketAlert,
  MarketRule,
  MarketNotification,
  MarketNews,
} from '../../../core/src/markets/types';
import { time, price, alertLabel, openMarketLink } from './marketUi';
import { Modal } from './Modal';

export function MarketNewsPanel({
  news,
  newsError,
  newsLoading,
  onError,
  onAsk,
}: {
  news: MarketNews[];
  newsError: string;
  newsLoading: boolean;
  onError: (s: string) => void;
  onAsk: (text: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  return (
    <section className="market-activity">
      {newsError && (
        <p className="muted">
          {t('News unavailable. Check the data connection and retry.')}
        </p>
      )}
      {!news.length && !newsError && (
        <p className="muted">
          {newsLoading ? t('Loading news…') : t('No related news')}
        </p>
      )}
      {[...news]
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .map((n, i) => (
          <article key={`${n.url}:${i}`} className="market-news">
            <a
              href={n.url}
              onClick={(e) => {
                e.preventDefault();
                void openMarketLink(n.url).catch((err) => onError(String(err)));
              }}
            >
              {n.title} ↗
            </a>
            <small>
              {n.source} · {time(n.publishedAt, locale)}
            </small>
            <button
              className="market-text-action"
              onClick={() =>
                void onAsk(
                  t(
                    'Explain this news in the context of the instrument and verify the original. News: {title}\nSource: {source}\nPublished: {date}\nURL: {url}{summary}',
                    {
                      title: n.title,
                      source: n.source,
                      date: time(n.publishedAt, locale),
                      url: n.url,
                      summary: n.summary
                        ? t('\nSummary: {summary}', { summary: n.summary })
                        : '',
                    },
                  ),
                )
              }
            >
              {t('Ask Seris ↗')}
            </button>
          </article>
        ))}
    </section>
  );
}

export function MarketAlertsPanel({
  alerts,
  notifications,
  onError,
  onStatus,
  onAsk,
  onCreate,
}: {
  alerts: MarketAlert[];
  notifications: MarketNotification[];
  onError: (s: string) => void;
  onStatus: (id: string, status: MarketAlert['status']) => Promise<void>;
  onAsk: (text: string) => Promise<void>;
  onCreate: () => void;
}) {
  const { t, language, locale } = useI18n();
  const [pending, setPending] = useState<string>();
  const updating = useRef(false);
  const update = async (id: string, status: MarketAlert['status']) => {
    if (updating.current) return;
    updating.current = true;
    setPending(id);
    try {
      await onStatus(id, status);
    } catch (e) {
      onError(t('Could not update alert. Please retry.'));
    } finally {
      updating.current = false;
      setPending(undefined);
    }
  };
  return (
    <section className="market-activity">
      <div className="market-section-heading">
        <h2>
          {t('Monitor conditions')}
          <small>{alerts.length}</small>
        </h2>
        <button className="market-text-action" onClick={onCreate}>
          {t('＋ New alert')}
        </button>
      </div>
      {!alerts.length && (
        <p className="muted">
          {t('No alerts yet. Set a condition for Seris to watch.')}
        </p>
      )}
      {alerts.map((a) => (
        <div key={a.id} className="market-alert">
          <strong>{alertLabel(a.rule, language, locale)}</strong>
          <small>
            {a.status === 'paused' ? t('Paused') : t('Monitoring')} ·{' '}
            {a.lastRunAt
              ? t('Checked {date}', { date: time(a.lastRunAt, locale) })
              : t('Waiting for first check')}
          </small>
          {a.lastRunAt && a.lastObservation === undefined && !a.error && (
            <small>{t('Waiting for fresh market data')}</small>
          )}
          {a.error && (
            <small className="down">{t('Unable to check market data')}</small>
          )}
          <div>
            <button
              disabled={!!pending}
              onClick={() =>
                void update(a.id, a.status === 'active' ? 'paused' : 'active')
              }
            >
              {pending === a.id
                ? t('Updating…')
                : a.status === 'active'
                  ? t('Pause')
                  : t('Resume')}
            </button>
            <button
              disabled={!!pending}
              onClick={() => void update(a.id, 'closed')}
            >
              {t('Close')}
            </button>
          </div>
        </div>
      ))}
      <h2 className="notifications-title">{t('Trigger history')}</h2>
      {notifications.slice(0, 10).map((n) => (
        <article key={n.id} className="market-notification">
          <span>
            {t('{symbol} alert triggered', { symbol: n.instrument.symbol })}
            {n.quote
              ? ` · ${n.quote.price.toLocaleString(locale)} ${n.quote.currency}`
              : ''}
          </span>
          <small>{time(n.time, locale)}</small>
          <button
            className="market-text-action"
            onClick={() =>
              void onAsk(
                t(
                  'Explain this {symbol} alert, distinguishing triggered and current prices.\nRecord: {text}\nTriggered: {date}{quote}',
                  {
                    symbol: n.instrument.symbol,
                    text: t('{symbol} alert triggered', {
                      symbol: n.instrument.symbol,
                    }),
                    date: time(n.time, locale),
                    quote: n.quote
                      ? t(
                          '\nTriggered quote: {price} {currency}; source: {source}; quote time: {date}',
                          {
                            price: price(n.quote.price, locale),
                            currency: n.quote.currency,
                            source: n.quote.source,
                            date: time(n.quote.time, locale),
                          },
                        )
                      : '',
                  },
                ),
              )
            }
          >
            {t('Ask Seris ↗')}
          </button>
        </article>
      ))}
      {!notifications.length && <p className="muted">{t('No triggers yet')}</p>}
    </section>
  );
}

export function AlertEditor({
  open,
  instrument,
  initialPrice,
  onSaved,
  onCancel,
}: {
  open: boolean;
  instrument: Instrument;
  initialPrice?: number;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [metric, setMetric] = useState<MarketRule['metric']>('price');
  const [direction, setDirection] = useState<MarketRule['direction']>('above');
  const [threshold, setThreshold] = useState(
    initialPrice ? String(Number((initialPrice * 1.03).toPrecision(6))) : '',
  );
  const [once, setOnce] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    setMetric('price');
    setDirection('above');
    setOnce(true);
    setSaveError('');
    setThreshold(
      initialPrice ? String(Number((initialPrice * 1.03).toPrecision(6))) : '',
    );
    // Seed the form on open; live quote updates must not replace user edits.
  }, [open]);
  const pending = useRef<{ key: string; requestId: string }>();
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setSaveError('');
    setSaving(true);
    try {
      const rule: MarketRule = {
        instrument,
        metric,
        direction,
        threshold: Number(threshold),
        once,
      };
      const key = JSON.stringify(rule);
      if (pending.current?.key !== key)
        pending.current = { key, requestId: crypto.randomUUID() };
      await seris.createAlert(rule, pending.current.requestId);
      await onSaved();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      initialFocus={input}
      title={t('Set {symbol} alert', { symbol: instrument.symbol })}
      onClose={onCancel}
      dismissible={!saving}
    >
      <form
        className="market-alert-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <strong>{t('Watch {symbol}', { symbol: instrument.symbol })}</strong>
        {saveError && (
          <p role="alert" className="market-error">
            {t(
              'Unable to save alert. Check the threshold and connection, then retry.',
            )}
          </p>
        )}
        <select
          disabled={saving}
          aria-label={t('Alert metric')}
          value={metric}
          onChange={(e) => setMetric(e.target.value as MarketRule['metric'])}
        >
          <option value="price">
            {t('Price')}
            {['binance', 'binance-tradifi'].includes(instrument.venue) ? 'USDT' : 'USD'}
          </option>
          <option value="changePct">{t('Change %')}</option>
          {instrument.venue === 'hyperliquid' && (
            <option value="fundingHourlyPct">{t('Funding % / hour')}</option>
          )}
        </select>
        <select
          disabled={saving}
          aria-label={t('Alert direction')}
          value={direction}
          onChange={(e) =>
            setDirection(e.target.value as MarketRule['direction'])
          }
        >
          <option value="above">{t('At or above')}</option>
          <option value="below">{t('At or below')}</option>
        </select>
        <input
          ref={input}
          disabled={saving}
          type="number"
          step="any"
          aria-label={t('Alert threshold')}
          required
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
        <label>
          <input
            disabled={saving}
            type="checkbox"
            checked={once}
            onChange={(e) => setOnce(e.target.checked)}
          />
          {t('Alert only once')}
        </label>
        <small>
          {t(
            'Checked every minute while the app runs; no checks against stale quotes.',
          )}
        </small>
        <button className="market-primary" disabled={saving || !threshold}>
          {saving ? t('Saving…') : t('Save alert')}
        </button>
        <button type="button" disabled={saving} onClick={onCancel}>
          {t('Cancel')}
        </button>
      </form>
    </Modal>
  );
}
