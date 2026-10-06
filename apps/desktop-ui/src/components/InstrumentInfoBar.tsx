/**
 * InstrumentInfoBar — the always-visible top strip above the chart.
 *
 * Layout mirrors Minara's trade page:
 *   [★ + icon + symbol ⌄] | 标记价格 | 预言机价格 | 24小时涨跌 | 24小时成交 | 持仓量 | 资金费率
 *
 * The leftmost cell is the instrument switcher — click to open the market
 * dropdown (parent controls visibility). The rest are read-only metric cells
 * derived from the current quote. Hyperliquid-only fields (funding, OI) show
 * "—" on other venues.
 */

import type { JSX } from 'react';
import { useI18n } from '../i18n';
import type { Instrument, MarketQuote } from '../../../core/src/markets/types';
import { price } from './marketUi';

import btcIcon from 'cryptocurrency-icons/svg/color/btc.svg';
import ethIcon from 'cryptocurrency-icons/svg/color/eth.svg';
import solIcon from 'cryptocurrency-icons/svg/color/sol.svg';
import avaxIcon from 'cryptocurrency-icons/svg/color/avax.svg';
import dogeIcon from 'cryptocurrency-icons/svg/color/doge.svg';
import uniIcon from 'cryptocurrency-icons/svg/color/uni.svg';
import aaveIcon from 'cryptocurrency-icons/svg/color/aave.svg';
import mkrIcon from 'cryptocurrency-icons/svg/color/mkr.svg';
import crvIcon from 'cryptocurrency-icons/svg/color/crv.svg';
import linkIcon from 'cryptocurrency-icons/svg/color/link.svg';
import dotIcon from 'cryptocurrency-icons/svg/color/dot.svg';
import atomIcon from 'cryptocurrency-icons/svg/color/atom.svg';
import maticIcon from 'cryptocurrency-icons/svg/color/matic.svg';
import bnbIcon from 'cryptocurrency-icons/svg/color/bnb.svg';
import xrpIcon from 'cryptocurrency-icons/svg/color/xrp.svg';
import adaIcon from 'cryptocurrency-icons/svg/color/ada.svg';
import ltcIcon from 'cryptocurrency-icons/svg/color/ltc.svg';
import bchIcon from 'cryptocurrency-icons/svg/color/bch.svg';
import etcIcon from 'cryptocurrency-icons/svg/color/etc.svg';
import filIcon from 'cryptocurrency-icons/svg/color/fil.svg';
import icpIcon from 'cryptocurrency-icons/svg/color/icp.svg';
import sandIcon from 'cryptocurrency-icons/svg/color/sand.svg';
import snxIcon from 'cryptocurrency-icons/svg/color/snx.svg';
import sushiIcon from 'cryptocurrency-icons/svg/color/sushi.svg';
import thetaIcon from 'cryptocurrency-icons/svg/color/theta.svg';
import vetIcon from 'cryptocurrency-icons/svg/color/vet.svg';
import xlmIcon from 'cryptocurrency-icons/svg/color/xlm.svg';
import xmrIcon from 'cryptocurrency-icons/svg/color/xmr.svg';
import xtzIcon from 'cryptocurrency-icons/svg/color/xtz.svg';
import yfiIcon from 'cryptocurrency-icons/svg/color/yfi.svg';
import zecIcon from 'cryptocurrency-icons/svg/color/zec.svg';

const ICONS: Record<string, string> = {
  btc: btcIcon, eth: ethIcon, sol: solIcon, avax: avaxIcon, doge: dogeIcon,
  uni: uniIcon, aave: aaveIcon, mkr: mkrIcon, crv: crvIcon, link: linkIcon,
  dot: dotIcon, atom: atomIcon, matic: maticIcon, bnb: bnbIcon, xrp: xrpIcon,
  ada: adaIcon, ltc: ltcIcon, bch: bchIcon, etc: etcIcon, fil: filIcon,
  icp: icpIcon, sand: sandIcon, snx: snxIcon, sushi: sushiIcon, theta: thetaIcon,
  vet: vetIcon, xlm: xlmIcon, xmr: xmrIcon, xtz: xtzIcon, yfi: yfiIcon,
  zec: zecIcon,
};

import { BrandIcon } from './BrandIcon';

function iconFor(symbol: string): string | null {
  return ICONS[symbol.toLowerCase().replace(/usdt$/i, '').replace(/usd$/i, '')] ?? null;
}

function abbrevUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fundingText(pct: number | undefined, countdown?: string): string {
  if (pct === undefined || pct === null) return '—';
  const rate = `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
  return countdown ? `${rate} ${countdown}` : rate;
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
  const icon = iconFor(i.symbol);
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
        <small>{t('Mark price')}</small>
        <strong className="tabular">
          {q ? (q.currency === 'USDT' ? `${price(q.price, locale)}` : `$${price(q.price, locale)}`) : '—'}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t('24h change')}</small>
        <strong className={`tabular ${change == null ? '' : change < 0 ? 'down' : 'up'}`}>
          {change == null ? '—' : `${sign}${change.toFixed(2)}%`}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t('24h volume')}</small>
        <strong className="tabular">
          {q?.volume != null ? abbrevUsd(q.volume) : '—'}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t('Open interest')}</small>
        <strong className="tabular">
          {i.venue === 'hyperliquid' && q?.openInterestUsd != null
            ? abbrevUsd(q.openInterestUsd)
            : '—'}
        </strong>
      </div>

      <div className="info-cell">
        <small>{t('Funding')}</small>
        <strong className="tabular">
          {i.venue === 'hyperliquid' ? fundingText(q?.fundingHourlyPct) : '—'}
        </strong>
      </div>
    </div>
  );
}
