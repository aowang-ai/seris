/**
 * BacktestChart — render a backtest run's candlesticks overlaid with
 * entry/exit markers and a per-bar stop-loss trail line, plus an equity
 * curve in a second pane below.
 *
 * The chart shows the same candles the strategy saw, with markers for each
 * fill (buy = arrow up, sell = arrow down, stop = highlighted). A trailing
 * stop series (when the strategy used `adjust-stop`) is drawn on top as a
 * dashed orange line so the user can see exactly where the stop sat at
 * each bar.
 */

import { useEffect, useMemo, useRef, type JSX } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useI18n } from '../i18n';

interface CandleRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FillRow {
  time: number;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  via: 'signal' | 'stop' | 'take-profit' | 'end';
  reason: string;
}

interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestChartProps {
  candles: CandleRow[];
  fills: FillRow[];
  equity: EquityPoint[];
  stopTrail?: { time: number; value: number }[];
}

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

const baseChartOpts = (el: HTMLElement, locale: string) => {
  const styles = getComputedStyle(el);
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: styles.getPropertyValue('--background').trim() || '#fafafa' },
      textColor: '#858585',
      fontFamily: styles.fontFamily,
      fontSize: 11,
      attributionLogo: false,
    },
    localization: { locale },
    grid: {
      vertLines: { color: 'rgba(130,130,130,.07)' },
      horzLines: { color: 'rgba(130,130,130,.1)' },
    },
    rightPriceScale: { borderColor: 'rgba(130,130,130,.15)' },
    timeScale: { borderColor: 'rgba(130,130,130,.15)', timeVisible: true, secondsVisible: false },
    crosshair: {
      horzLine: { labelBackgroundColor: '#555' },
      vertLine: { labelBackgroundColor: '#555' },
    },
  } as const;
};

export function BacktestChart(props: BacktestChartProps): JSX.Element {
  const { locale } = useI18n();
  const priceRef = useRef<HTMLDivElement>(null);
  const equityRef = useRef<HTMLDivElement>(null);
  const { candles, fills, equity, stopTrail } = props;

  const markers = useMemo(
    () =>
      fills.map((f) => ({
        time: toSec(f.time),
        position: (f.side === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color:
          f.via === 'stop' ? '#e2863c' : f.via === 'take-profit' ? '#38a88c' : f.side === 'buy' ? '#3b82f6' : '#dc777b',
        shape: (f.side === 'buy' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: `${f.side === 'buy' ? 'B' : 'S'}${f.via === 'stop' ? '⛔' : f.via === 'take-profit' ? '★' : ''}`,
        size: 1,
      })),
    [fills],
  );

  useEffect(() => {
    if (!priceRef.current) return;
    const host = priceRef.current;
    const chart = createChart(host, baseChartOpts(host, locale) as Parameters<typeof createChart>[1]);
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#38a88c',
      downColor: '#dc777b',
      borderVisible: false,
      wickUpColor: '#38a88c',
      wickDownColor: '#dc777b',
    }) as ISeriesApi<'Candlestick'>;
    candleSeries.setData(
      candles.map((c) => ({
        time: toSec(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.setData(
      candles.map((c) => ({
        time: toSec(c.time),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(56,168,140,.35)' : 'rgba(220,119,123,.35)',
      })),
    );
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });

    if (stopTrail && stopTrail.length > 1) {
      const stop = chart.addSeries(LineSeries, {
        color: '#e2863c',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      stop.setData(stopTrail.map((p) => ({ time: toSec(p.time), value: p.value })));
    }

    if (markers.length) {
      createSeriesMarkers(candleSeries, markers);
    }

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
    };
  }, [candles, fills, markers, stopTrail, locale]);

  useEffect(() => {
    if (!equityRef.current) return;
    const host = equityRef.current;
    const chart: IChartApi = createChart(host, baseChartOpts(host, locale) as Parameters<typeof createChart>[1]);
    const line = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
    });
    line.setData(equity.map((p) => ({ time: toSec(p.time), value: p.equity })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [equity, locale]);

  return (
    <div className="backtest-chart">
      <div ref={priceRef} className="backtest-chart-price" />
      <div ref={equityRef} className="backtest-chart-equity" />
    </div>
  );
}
