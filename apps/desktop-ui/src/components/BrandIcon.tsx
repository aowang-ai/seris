/**
 * BrandIcon — fallback icon for instruments with no `cryptocurrency-icons` SVG.
 *
 * Renders a small circular badge with a brand-color background and a glyph
 * (1-3 chars). Used for stock tickers (TSLA/NVDA/AAPL/...) and index codes
 * (SPY/QQQ/SPX/ES) that the crypto icon set doesn't ship.
 *
 * Indexes/stocks have no canonical brand SVG, so the badge is a styled
 * placeholder. Keep entries conservative — wrong-brand color is worse than
 * a neutral default.
 */

import type { JSX } from 'react';

const BRANDS: Record<string, { bg: string; fg: string; glyph: string }> = {
  tsla:  { bg: '#e82127', fg: '#ffffff', glyph: 'T' },
  nvda:  { bg: '#76b900', fg: '#0a0a0a', glyph: 'NV' },
  aapl:  { bg: '#555555', fg: '#ffffff', glyph: '' },
  msft:  { bg: '#00a4ef', fg: '#ffffff', glyph: '⊞' },
  amzn:  { bg: '#ff9900', fg: '#0a0a0a', glyph: 'a' },
  coin:  { bg: '#0052ff', fg: '#ffffff', glyph: 'C' },
  googl: { bg: '#4285f4', fg: '#ffffff', glyph: 'G' },
  meta:  { bg: '#0082fb', fg: '#ffffff', glyph: '∞' },
  nflx:  { bg: '#e50914', fg: '#ffffff', glyph: 'N' },
  amd:   { bg: '#ed1c24', fg: '#ffffff', glyph: 'A' },
  intc:  { bg: '#0068b5', fg: '#ffffff', glyph: 'i' },
  hood:  { bg: '#00c805', fg: '#0a0a0a', glyph: '⊘' },
  pltr:  { bg: '#121212', fg: '#ffffff', glyph: 'P' },
  ionq:  { bg: '#6a2c91', fg: '#ffffff', glyph: 'IQ' },
  spy:   { bg: '#1f2937', fg: '#ffffff', glyph: 'SP' },
  qqq:   { bg: '#1f2937', fg: '#ffffff', glyph: 'Q' },
  tqqq:  { bg: '#1f2937', fg: '#fbbf24', glyph: 'T3' },
  sqqq:  { bg: '#1f2937', fg: '#dc2626', glyph: 'S3' },
  spx:   { bg: '#1f2937', fg: '#ffffff', glyph: 'SPX' },
  esp:   { bg: '#1f2937', fg: '#ffffff', glyph: 'ES' },
  // ── xyz dex: commodities, FX, indices ──
  gold:     { bg: '#d97706', fg: '#ffffff', glyph: 'Au' },
  silver:   { bg: '#9ca3af', fg: '#1f2937', glyph: 'Ag' },
  cl:       { bg: '#0a0a0a', fg: '#facc15', glyph: 'CL' },
  brentoil: { bg: '#1f2937', fg: '#facc15', glyph: 'BR' },
  natgas:   { bg: '#0ea5e9', fg: '#ffffff', glyph: 'NG' },
  copper:   { bg: '#b45309', fg: '#ffffff', glyph: 'Cu' },
  platinum: { bg: '#94a3b8', fg: '#0a0a0a', glyph: 'Pt' },
  palladium:{ bg: '#64748b', fg: '#ffffff', glyph: 'Pd' },
  uranium:  { bg: '#14b8a6', fg: '#0a0a0a', glyph: 'U' },
  wheat:    { bg: '#facc15', fg: '#0a0a0a', glyph: 'W' },
  corn:     { bg: '#eab308', fg: '#0a0a0a', glyph: 'C' },
  aluminium:{ bg: '#a8a29e', fg: '#0a0a0a', glyph: 'Al' },
  ho:       { bg: '#0a0a0a', fg: '#facc15', glyph: 'HO' },
  sp500:    { bg: '#1e40af', fg: '#ffffff', glyph: 'SPX' },
  xyz100:   { bg: '#4c1d95', fg: '#ffffff', glyph: 'XYZ' },
  dxy:      { bg: '#059669', fg: '#ffffff', glyph: 'DX' },
  vix:      { bg: '#dc2626', fg: '#ffffff', glyph: 'VX' },
  nifty:    { bg: '#f59e0b', fg: '#0a0a0a', glyph: 'N50' },
  ibov:     { bg: '#16a34a', fg: '#ffffff', glyph: 'IB' },
  jp225:    { bg: '#bc002d', fg: '#ffffff', glyph: 'N225' },
  kr200:    { bg: '#003876', fg: '#ffffff', glyph: 'K200' },
  mags:     { bg: '#0a0a0a', fg: '#10b981', glyph: 'MAG' },
  total2:   { bg: '#4c1d95', fg: '#ffffff', glyph: 'T2' },
  mag7:     { bg: '#0a0a0a', fg: '#10b981', glyph: 'M7' },
  us500:    { bg: '#1e40af', fg: '#ffffff', glyph: 'SPX' },
  usa500:   { bg: '#1e40af', fg: '#ffffff', glyph: 'SPX' },
  small2000:{ bg: '#1e40af', fg: '#ffffff', glyph: 'R2K' },
  eur:      { bg: '#003399', fg: '#ffcc00', glyph: '€' },
  jpy:      { bg: '#bc002d', fg: '#ffffff', glyph: '¥' },
  gbp:      { bg: '#012169', fg: '#ffffff', glyph: '£' },
  krw:      { bg: '#003876', fg: '#ffffff', glyph: '₩' },
  tlt:      { bg: '#065f46', fg: '#ffffff', glyph: 'TLT' },
  xbi:      { bg: '#059669', fg: '#ffffff', glyph: 'XBI' },
  xle:      { bg: '#dc2626', fg: '#ffffff', glyph: 'XLE' },
  urnm:     { bg: '#14b8a6', fg: '#0a0a0a', glyph: 'URN' },
  smsn:     { bg: '#1428a0', fg: '#ffffff', glyph: 'SS' },
  skhy:     { bg: '#2563eb', fg: '#ffffff', glyph: 'SK' },
  tsm:      { bg: '#1e3a8a', fg: '#ffffff', glyph: 'TSM' },
  hyundai:  { bg: '#002c5f', fg: '#ffffff', glyph: 'HY' },
  softbank: { bg: '#fbbf24', fg: '#0a0a0a', glyph: 'SB' },
  oura:     { bg: '#0a0a0a', fg: '#ffffff', glyph: 'OU' },
  shein:    { bg: '#000000', fg: '#ffffff', glyph: 'SH' },
};

export function BrandIcon({ symbol, size = 18 }: { symbol: string; size?: number }): JSX.Element {
  const brand = BRANDS[symbol.toLowerCase()];
  const initial = (symbol[0] ?? '?').toUpperCase();
  return (
    <span
      className={`brand-icon${brand ? '' : ' brand-icon-default'}`}
      style={{
        width: size,
        height: size,
        fontSize: size * (brand?.glyph && brand.glyph.length > 1 ? 0.42 : 0.55),
        background: brand?.bg,
        color: brand?.fg,
      }}
      aria-hidden
    >
      {brand?.glyph || initial}
    </span>
  );
}
