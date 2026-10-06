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
