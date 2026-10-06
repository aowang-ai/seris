/**
 * MarketDropdown — Minara-style anchored panel for switching instruments.
 *
 * Layout (matches Minara's market list):
 *   [🔍 Search Token_________________]
 *   [Favorites | All]                (tab strip — Favorites shows watchlist)
 *   Symbol | Last Price | 24H change | Funding | OI
 *   ⭐ BTC ⌄ 40X  $86,102  -0.17%  +0.0125%  $3.44B
 *   ⭐ ETH ⌄ 25X  $2,709   -0.18%  +0.0300%  $3.19B
 *   ...
 *
 * The panel is anchored below the trigger (position: absolute) inside a
 * relative parent. It closes on outside click or Escape.
 *
 * The "Favorites" tab content is the watchlist (rows are also clickable to
 * select). The "All" tab content comes from a search query.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useI18n } from '../i18n';
import { seris } from '../seris';
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
import ltzIconPlaceholder from 'cryptocurrency-icons/svg/color/ltc.svg';
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

const ltcIcon = ltzIconPlaceholder;

const ICONS: Record<string, string> = {
  btc: btcIcon, eth: ethIcon, sol: solIcon, avax: avaxIcon, doge: dogeIcon,
  uni: uniIcon, aave: aaveIcon, mkr: mkrIcon, crv: crvIcon, link: linkIcon,
  dot: dotIcon, atom: atomIcon, matic: maticIcon, bnb: bnbIcon, xrp: xrpIcon,
  ada: adaIcon, ltc: ltcIcon, bch: bchIcon, etc: etcIcon, fil: filIcon,
  icp: icpIcon, sand: sandIcon, snx: snxIcon, sushi: sushiIcon, theta: thetaIcon,
  vet: vetIcon, xlm: xlmIcon, xmr: xmrIcon, xtz: xtzIcon, yfi: yfiIcon,
  zec: zecIcon,
};

function iconFor(symbol: string): string | null {
  return ICONS[symbol.toLowerCase().replace(/usdt$/i, '').replace(/usd$/i, '')] ?? null;
}

function abbrevUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtFunding(pct: number | undefined): string {
  if (pct == null) return '—';
  return `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(4)}%`;
}

export interface MarketDropdownProps {
  open: boolean;
  onClose: (instrument?: Instrument) => void;
  watchlist: Instrument[];
  quotes: Record<string, { quote?: MarketQuote; error?: string }>;
  onToggleWatch: (i: Instrument) => Promise<void>;
  selectedId?: string;
}

type Tab = 'favorites' | 'all';

export function MarketDropdown(p: MarketDropdownProps): JSX.Element | null {
  const { t, locale } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('favorites');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [all, setAll] = useState<Instrument[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Close on outside click / escape
  useEffect(() => {
    if (!p.open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        p.onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        p.onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [p.open, p]);

  // Fetch full universe on mount + when query changes
  useEffect(() => {
    if (!p.open) return;
    let alive = true;
    const q = query.trim();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        // Hyperliquid search returns top volume when q is empty; rough server
        // search when q is present.
        const res = await seris.searchMarkets(q || 'BTC');
        if (alive) setAll(res.instruments);
      } catch { /* swallow */ } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [p.open, query]);

  const rows = useMemo(() => {
    const base = tab === 'favorites' ? p.watchlist : all;
    const q = query.trim().toUpperCase();
    if (!q) return base;
    return base.filter(
      (i) =>
        i.symbol.toUpperCase().includes(q) ||
        i.name.toUpperCase().includes(q),
    );
  }, [tab, p.watchlist, all, query]);

  if (!p.open) return null;

  const pick = (i: Instrument) => p.onClose(i);
  const toggle = async (i: Instrument, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (pendingId) return;
    setPendingId(i.id);
    try {
      await p.onToggleWatch(i);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="market-dropdown" ref={root} role="dialog" aria-label={t('Select instrument')}>
      <div className="dropdown-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </svg>
        <input
          autoFocus
          placeholder={t('Search Token')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('Search markets')}
        />
      </div>
      <div className="dropdown-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'favorites'}
          className={tab === 'favorites' ? 'active' : ''}
          onClick={() => setTab('favorites')}
        >
          {t('Watchlist')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'all'}
          className={tab === 'all' ? 'active' : ''}
          onClick={() => setTab('all')}
        >
          {t('All')}
        </button>
      </div>
      <div className="dropdown-header">
        <span className="col-symbol">{t('Symbol')}</span>
        <span className="col-price">{t('Price')}</span>
        <span className="col-change">{t('24H')}</span>
        <span className="col-funding">{t('Funding')}</span>
        <span className="col-oi">{t('OI')}</span>
      </div>
      <div className="dropdown-rows" role="listbox">
        {searching && rows.length === 0 && (
          <div className="dropdown-status">{t('Searching…')}</div>
        )}
        {!searching && rows.length === 0 && (
          <div className="dropdown-status">
            {tab === 'favorites' ? t('No favorites yet. Star an instrument to add one.') : t('No matches.')}
          </div>
        )}
        {rows.map((i) => {
          const row = p.quotes[i.id];
          const change = row?.quote?.changePct;
          const watched = p.watchlist.some((w) => w.id === i.id);
          const isHl = i.venue === 'hyperliquid';
          return (
            <button
              key={i.id}
              role="option"
              aria-selected={p.selectedId === i.id}
              className={`dropdown-row ${p.selectedId === i.id ? 'selected' : ''}`}
              onClick={() => pick(i)}
            >
              <span className="col-symbol">
                <span
                  className={`row-star ${watched ? 'active' : ''}`}
                  data-pending={pendingId === i.id ? 'true' : undefined}
                  onClick={(e) => void toggle(i, e)}
                  role="button"
                  aria-label={watched ? t('Unwatch {symbol}', { symbol: i.symbol }) : t('Watch {symbol}', { symbol: i.symbol })}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void toggle(i, e as unknown as React.MouseEvent);
                    }
                  }}
                >
                  {watched ? '★' : '☆'}
                </span>
                {iconFor(i.symbol) && (
                  <img src={iconFor(i.symbol)!} alt="" width={18} height={18} />
                )}
                <strong>{i.symbol}</strong>
                {i.maxLeverage && <em className="row-leverage">{i.maxLeverage}X</em>}
                {i.name && i.name !== i.symbol && (
                  <span className="row-name" title={i.name}>{i.name}</span>
                )}
              </span>
              <span className="col-price tabular">
                {row?.quote ? price(row.quote.price, locale) : '—'}
              </span>
              <span
                className={`col-change tabular ${change == null ? '' : change < 0 ? 'down' : 'up'}`}
              >
                {change == null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}
              </span>
              <span className="col-funding tabular">
                {isHl && row?.quote?.fundingHourlyPct != null ? fmtFunding(row.quote.fundingHourlyPct) : '—'}
              </span>
              <span className="col-oi tabular">
                {isHl && row?.quote?.openInterestUsd ? abbrevUsd(row.quote.openInterestUsd) : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
