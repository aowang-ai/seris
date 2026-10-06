import type {
  Instrument,
  MarketContext,
  MarketInterval,
  MarketRule,
} from '../../../core/src/markets/types';
import { openUrl } from '@tauri-apps/plugin-opener';
import { translate, type Language } from '../i18n';
export const pricePrecision = (v: number) =>
  Math.min(12, Math.max(2, Math.ceil(-Math.log10(v)) + 3));
export const price = (v: number, locale?: string) =>
  v.toLocaleString(locale, { maximumFractionDigits: pricePrecision(v) });
export const time = (v: number, locale?: string) =>
  new Date(v).toLocaleString(locale);
export const venue = (i: Instrument, language: Language) =>
  i.venue === 'hyperliquid'
    ? `Hyperliquid · ${translate(language, 'Perpetual')}`
    : i.venue === 'binance'
      ? `Binance · ${translate(language, 'USDT spot')}`
      : i.venue === 'binance-tradifi'
        ? `Binance · ${translate(language, 'USDT TradFi perpetual')}`
        : i.kind === 'etf'
          ? `${translate(language, 'US stocks')} · ETF`
          : translate(language, 'US stocks');
export const instrumentName = (i: Instrument, language: Language) =>
  i.name === `${i.symbol} Perpetual`
    ? `${i.symbol} ${translate(language, 'Perpetual')}`
    : i.name;
export const intervalLabel = (interval: MarketInterval, language: Language) =>
  translate(language, interval);
export const contextLabel = (c: MarketContext, language: Language) =>
  `${c.instrument.symbol} · ${venue(c.instrument, language)} · ${intervalLabel(c.interval, language)}`;
export function alertLabel(
  rule: MarketRule,
  language: Language,
  locale: string,
) {
  const metric = translate(
    language,
    rule.metric === 'price'
      ? 'Price'
      : rule.metric === 'changePct'
        ? 'Change'
        : 'Funding',
  );
  const unit =
    rule.metric === 'price'
      ? rule.instrument.venue === 'binance'
        ? 'USDT'
        : 'USD'
      : rule.metric === 'changePct'
        ? '%'
        : translate(language, '% / hour');
  return `${rule.instrument.symbol} ${metric} ${rule.direction === 'above' ? '≥' : '≤'} ${rule.threshold.toLocaleString(locale, { maximumFractionDigits: 12 })} ${unit}`;
}
export async function openMarketLink(url: string) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol))
    throw new Error('Unsupported link');
  if (window.__TAURI__) await openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
