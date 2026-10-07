/**
 * InstrumentInfoBar — the always-visible top strip above the chart.
 *
 * Layout mirrors Minara's trade page:
 *   [★ + icon + symbol ⌄] | 标记价格 | 预言机价格 | 24小时涨跌 | 24小时成交 | 持仓量 | 资金费率
 *
 * The leftmost cell is the instrument switcher — click to open the market
 * dropdown (parent controls visibility). The rest are read-only metric cells
 * derived from the current quote. Unavailable metrics show "—".
 */

import type { JSX } from 'react';
import { useI18n } from '../i18n';
import type { Instrument, MarketQuote } from '../../../core/src/markets/types';
import { price, fundingText } from './marketUi';

import { instrumentIcon } from './instrumentIcons';
import { BrandIcon } from './BrandIcon';

function abbrevUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export interface InstrumentInfoBarProps {
  instrument: Instrument;
  quote?: MarketQuote;
  watched: boolean;
  watchPending: boolean;
  dropdownOpen: boolean;
  onToggleWatch: () => void;
  onOpenDropdown: () => void;
}

export function InstrumentInfoBar(p: InstrumentInfoBarProps): JSX.Element {
  const { t, locale } = useI18n();
  const { instrument: i, quote: q } = p;
  const icon = instrumentIcon(i.symbol);
  const change = q?.changePct;
  const sign = change == null ? '' : change > 0 ? '+' : '';

  return (
    <div className="instrument-info-bar" role="region" aria-label={t('Instrument summary')}>
      <button
        className="instrument-switcher"
        onClick={p.onOpenDropdown}
        aria-expanded={p.dropdownOpen}
        aria-haspopup="dialog"
      >
        <span
          className={`switcher-star ${p.watched ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!p.watchPending) p.onToggleWatch();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              if (!p.watchPending) p.onToggleWatch();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={p.watched ? t('Unwatch current instrument') : t('Watch current instrument')}
        >
          {p.watched ? '★' : '☆'}
        </span>
        {icon ? (
          <img src={icon} alt="" className="switcher-icon" width={22} height={22} />
        ) : (
          <BrandIcon symbol={i.symbol} />
        )}
        <strong className="switcher-symbol">{i.symbol}</strong>
        <span className="switcher-arrow" aria-hidden>⌄</span>
      </button>

      <div className="info-cell">
        <small>{t(q?.priceType === 'mark' ? 'Mark price' : 'Last price')}</small>
        <strong className="tabular">
          {q ? (q.currency === 'USDT' ? `${price(q.price, locale)} USDT` : `$${price(q.price, locale)}`) : '—'}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t(q?.changePeriod === 'session' ? 'Session change' : '24h change')}</small>
        <strong className={`tabular ${change == null ? '' : change < 0 ? 'down' : 'up'}`}>
          {change == null ? '—' : `${sign}${change.toFixed(2)}%`}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t(i.venue === 'us' ? 'Volume (shares)' : '24h volume')}</small>
        <strong className="tabular">
          {q?.volume != null ? (i.venue === 'us' ? q.volume.toLocaleString(locale) : abbrevUsd(q.volume)) : '—'}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t('Open interest')}</small>
        <strong className="tabular">
          {q?.openInterestUsd != null
            ? abbrevUsd(q.openInterestUsd)
            : '—'}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t('Funding / hour')}</small>
        <strong className="tabular">
          {fundingText(q?.fundingHourlyPct)}
        </strong>
      </div>
    </div>
  );
}
