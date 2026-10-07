import { parseInstrument, type Instrument, type InstrumentKind } from './types.js';

const commodities = new Set([
  'GOLD', 'SILVER', 'XAU', 'XAG', 'XPT', 'XPD', 'CL', 'BZ', 'BRENTOIL',
  'NATGAS', 'COPPER', 'PLATINUM', 'PALLADIUM', 'URANIUM', 'WHEAT', 'CORN',
  'HO', 'ALUMINIUM',
]);
const forex = new Set(['EUR', 'JPY', 'GBP', 'KRW', 'USDBRL']);
const indices = new Set([
  'SP500', 'XYZ100', 'DXY', 'VIX', 'NIFTY', 'IBOV', 'JP225', 'KR200',
  'TOTAL2', 'MAG7', 'US500', 'USA500', 'SMALL2000', 'BTCD', 'H100',
  'SEMIS', 'ES', 'ESP',
]);
const etfs = new Set([
  'TLT', 'XBI', 'XLE', 'URNM', 'EWJ', 'EWT', 'EWY', 'EWZ', 'SMH', 'XLU',
  'IWM', 'SPY', 'QQQ', 'TQQQ', 'SQQQ', 'SOXL', 'MAGS', 'DIA', 'VOO', 'VTI', 'GLD',
]);

/** Underlying asset kind; the venue still identifies the perpetual contract. */
export function traditionalKind(symbol: string, underlyingType?: string): InstrumentKind {
  if (underlyingType === 'COMMODITY') return 'commodity';
  if (underlyingType === 'FX') return 'forex';
  return knownTraditionalKind(symbol) ?? 'stock';
}

function knownTraditionalKind(symbol: string): InstrumentKind | undefined {
  if (commodities.has(symbol)) return 'commodity';
  if (forex.has(symbol)) return 'forex';
  if (indices.has(symbol)) return 'index';
  if (etfs.has(symbol)) return 'etf';
  if (symbol === 'AVGO') return 'stock';
}

/** Also repair classifications saved by versions that mislabelled these tickers. */
export function normalizeInstrument(value: unknown): Instrument {
  const instrument = parseInstrument(value);
  if (['hyperliquid-xyz', 'binance-tradifi'].includes(instrument.venue))
    instrument.kind = knownTraditionalKind(instrument.symbol) ?? instrument.kind;
  return instrument;
}

/** Split only the venue prefix: xyz provider symbols contain another colon. */
export function instrumentFromId(id: string): Instrument {
  const colon = id.indexOf(':');
  const venue = id.slice(0, colon) as Instrument['venue'];
  const providerSymbol = id.slice(colon + 1);
  const symbol = venue === 'us' ? providerSymbol.replace(/\.US$/, '')
    : venue === 'hyperliquid-xyz' ? providerSymbol.replace(/^xyz:/, '')
    : venue === 'binance' || venue === 'binance-tradifi' ? providerSymbol.replace(/USDT$/, '')
    : providerSymbol;
  return parseInstrument({
    id, venue, providerSymbol, symbol,
    name: venue === 'hyperliquid-xyz' ? `${symbol} (xyz perp)`
      : venue === 'binance-tradifi' ? `${symbol} / USDT perpetual`
      : venue === 'hyperliquid' ? `${symbol} Perpetual` : symbol,
    kind: venue === 'binance' || venue === 'hyperliquid' ? 'crypto'
      : venue === 'us' ? (etfs.has(symbol) ? 'etf' : 'stock') : traditionalKind(symbol),
  });
}
