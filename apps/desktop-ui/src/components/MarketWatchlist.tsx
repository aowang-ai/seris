/**
 * MarketWatchlist — table layout aligned with Minara's market list.
 *
 * Columns (left to right):
 *   ⭐ | Symbol (icon + name + leverage tag) | Price | 24H Change | Funding | Volume | OI | ×
 *
 * Unavailable Funding/OI metrics show "—". Volume and OI are abbreviated
 * ($1.85B style) to fit a narrow list.
 */

import { useI18n } from '../i18n';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import type { MarketsState } from '../seris';
import type { Instrument, MarketQuote } from '../../../core/src/markets/types';
import { price, openMarketLink, fundingText } from './marketUi';

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

const ICON_MAP: Record<string, string> = {
  btc: btcIcon, eth: ethIcon, sol: solIcon, avax: avaxIcon, doge: dogeIcon,
  uni: uniIcon, aave: aaveIcon, mkr: mkrIcon, crv: crvIcon, link: linkIcon,
  dot: dotIcon, atom: atomIcon, matic: maticIcon, bnb: bnbIcon, xrp: xrpIcon,
  ada: adaIcon, ltc: ltcIcon, bch: bchIcon, etc: etcIcon, fil: filIcon,
  icp: icpIcon, sand: sandIcon, snx: snxIcon, sushi: sushiIcon, theta: thetaIcon,
  vet: vetIcon, xlm: xlmIcon, xmr: xmrIcon, xtz: xtzIcon, yfi: yfiIcon,
  zec: zecIcon,
};

import { BrandIcon } from './BrandIcon';

function instrumentIcon(symbol: string): string | null {
  const s = symbol.toLowerCase().replace(/usdt$/, '').replace(/usd$/, '');
  return ICON_MAP[s] ?? null;
}

function abbrevUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

interface Props {
  state?: MarketsState;
  quotes: Record<string, { quote?: MarketQuote; error?: string }>;
  selected?: string;
  onSelect: (i: Instrument) => void;
  onRemove: (i: Instrument) => Promise<void>;
  onConnect: () => Promise<void>;
  onError: (error: string) => void;
}

export function MarketWatchlist({
  state,
  quotes,
  selected,
  onSelect,
  onRemove,
  onConnect,
  onError,
}: Props) {
  const { t, locale } = useI18n();
  const [list] = useAutoAnimate<HTMLDivElement>({
    duration: 180,
    easing: 'ease-out',
  });

  const hasHyperliquid = state?.watchlist.some((i) =>
    ['hyperliquid', 'hyperliquid-xyz', 'binance-tradifi'].includes(i.venue));

  return (
    <aside className="market-watchlist" aria-label={t('Watchlist')}>
      <div className="watchlist-title">
        <span>{t('Watchlist')}</span>
        <span>{state?.watchlist.length ?? 0}</span>
      </div>
      {!state?.watchlist.length && (
        <p className="muted watchlist-empty">
          {t('No watched instruments yet. Search and use the star to add one.')}
        </p>
      )}
      {hasHyperliquid && (
        <div className="watchlist-col-headers">
          <span></span>
          <span></span>
          <span>{t('Price')}</span>
          <span>{t('24H')}</span>
          <span>{t('Funding / hour')}</span>
          <span>{t('OI')}</span>
          <span></span>
        </div>
      )}
      <div className="watchlist-rows" ref={list}>
        {state?.watchlist.map((i) => {
          const row = quotes[i.id];
          const change = row?.quote?.changePct;
          return (
            <button
              key={i.id}
              className={`watchlist-row watchlist-select ${selected === i.id ? 'selected' : ''}`}
              onClick={() => onSelect(i)}
            >
              <span className="watchlist-cell watchlist-icon">
                {instrumentIcon(i.symbol) ? (
                  <img src={instrumentIcon(i.symbol)!} alt="" width={22} height={22} />
                ) : (
                  <BrandIcon symbol={i.symbol} />
                )}
              </span>
              <span className="watchlist-cell watchlist-symbol">
                <strong>{i.symbol}</strong>
                {i.maxLeverage && (
                  <span className="watchlist-leverage">{i.maxLeverage}X</span>
                )}
              </span>
              <span className="watchlist-cell watchlist-price tabular">
                {row?.quote ? price(row.quote.price, locale) : '—'}
              </span>
              <span
                className={`watchlist-cell watchlist-change tabular ${
                  change == null ? '' : change < 0 ? 'down' : 'up'
                }`}
              >
                {change == null
                  ? '—'
                  : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}
              </span>
              {hasHyperliquid && (
                <>
                  <span className="watchlist-cell watchlist-funding tabular">
                    {row?.quote?.fundingHourlyPct !== undefined
                      ? fundingText(row.quote.fundingHourlyPct)
                      : '—'}
                  </span>
                  <span className="watchlist-cell watchlist-oi tabular">
                    {row?.quote?.openInterestUsd != null
                      ? abbrevUsd(row.quote.openInterestUsd)
                      : '—'}
                  </span>
                </>
              )}
              <span
                className="watchlist-cell watchlist-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  void onRemove(i);
                }}
                aria-label={t('Remove {symbol}', { symbol: i.symbol })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    void onRemove(i);
                  }
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
      {!state?.provider.connected && (
        <div className="market-connection">
          <p>
            {t(
              'Connect Longbridge for US stocks, ETF quotes, news and company information.',
            )}
          </p>
          <button
            disabled={state?.provider.connecting}
            onClick={() => void onConnect()}
          >
            {state?.provider.connecting
              ? t('Waiting for authorization…')
              : t('Connect US market data')}
          </button>
          {state?.provider.authorizationUrl && (
            <button
              onClick={() =>
                void openMarketLink(state.provider.authorizationUrl!).catch(
                  (e) => onError(String(e)),
                )
              }
            >
              {t('Open authorization page ↗')}
            </button>
          )}
          {state?.provider.error && (
            <p role="alert">{t('Data connection failed. Please retry.')}</p>
          )}
        </div>
      )}
    </aside>
  );
}
