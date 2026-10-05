import { useI18n } from '../i18n';
import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Time,
} from 'lightweight-charts';
import type {
  MarketChart as ChartData,
  TimeRange,
} from '../../../core/src/markets/types';
import { pricePrecision } from './marketUi';
export interface PriceLine {
  id: string;
  price: number;
  label: string;
  color?: string;
}
export function MarketChart({
  data,
  viewId,
  active = true,
  restoreRange,
  lines,
  selection,
  onVisible,
  onSelected,
}: {
  data: ChartData;
  viewId: string;
  active?: boolean;
  restoreRange?: TimeRange;
  lines: PriceLine[];
  selection?: TimeRange;
  onVisible: (r: TimeRange) => void;
  onSelected: (r: TimeRange) => void;
}) {
  const { t, locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    series: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
  } | null>(null);
  const callbacks = useRef({ onVisible, onSelected, active });
  callbacks.current = { onVisible, onSelected, active };
  const anchor = useRef<number | null>(null);
  const identity = `${data.instrument.id}:${data.interval}`;
  useEffect(() => {
    const host = container.current!;
    const styles = getComputedStyle(host);
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: {
          type: ColorType.Solid,
          color: styles.getPropertyValue('--background').trim() || '#fafafa',
        },
        textColor: '#858585',
        fontFamily: styles.fontFamily,
        fontSize: 11,
        attributionLogo: true,
      },
      localization: { locale },
      grid: {
        vertLines: { color: 'rgba(130,130,130,.07)' },
        horzLines: { color: 'rgba(130,130,130,.1)' },
      },
      rightPriceScale: { borderColor: 'rgba(130,130,130,.15)' },
      timeScale: {
        borderColor: 'rgba(130,130,130,.15)',
        timeVisible: true,
        secondsVisible: false,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        horzLine: { labelBackgroundColor: '#555' },
        vertLine: { labelBackgroundColor: '#555' },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#38a88c',
      downColor: '#dc777b',
      borderVisible: false,
      wickUpColor: '#38a88c',
      wickDownColor: '#dc777b',
      priceFormat: {
        type: 'price',
        precision: pricePrecision(data.quote.price),
        minMove: 10 ** -pricePrecision(data.quote.price),
      },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart
      .priceScale('volume')
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    series
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (
        callbacks.current.active &&
        range &&
        typeof range.from === 'number' &&
        typeof range.to === 'number'
      )
        callbacks.current.onVisible({ from: range.from, to: range.to });
    });
    // Use the chart's coordinate API. Its click stream suppresses rapid far-apart
    // clicks while testing for a double click, which would lose a range endpoint.
    const selectRange = (event: MouseEvent) => {
      if (!event.shiftKey) return;
      const timestamp = chart
        .timeScale()
        .coordinateToTime(event.clientX - host.getBoundingClientRect().left);
      if (typeof timestamp !== 'number') return;
      if (anchor.current === null) {
        anchor.current = timestamp;
        callbacks.current.onSelected({ from: timestamp, to: timestamp });
      } else {
        callbacks.current.onSelected({
          from: Math.min(anchor.current, timestamp),
          to: Math.max(anchor.current, timestamp),
        });
        anchor.current = null;
      }
    };
    host.addEventListener('click', selectRange, true);
    api.current = { chart, series, volume };
    anchor.current = null;
    return () => {
      host.removeEventListener('click', selectRange, true);
      api.current = null;
      chart.remove();
    };
  }, [identity]);
  useEffect(() => {
    api.current?.chart.applyOptions({ localization: { locale } });
  }, [locale, identity]);
  const loadedIdentity = useRef('');
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.series.setData(
      data.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
    );
    a.volume.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color:
          c.close >= c.open ? 'rgba(56,168,140,.22)' : 'rgba(220,119,123,.22)',
      })),
    );
    if (loadedIdentity.current !== identity) {
      a.chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, data.candles.length - 100),
        to: data.candles.length + 4,
      });
      loadedIdentity.current = identity;
    }
  }, [data, identity]);
  useEffect(() => {
    if (active && restoreRange)
      api.current?.chart.timeScale().setVisibleRange({
        from: restoreRange.from as UTCTimestamp,
        to: restoreRange.to as UTCTimestamp,
      });
  }, [viewId, identity, active]);
  useEffect(() => {
    const series = api.current?.series;
    if (!series) return;
    const created = lines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.color ?? '#b09163',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.label,
      }),
    );
    return () => {
      if (api.current?.series === series)
        created.forEach((l) => series.removePriceLine(l));
    };
  }, [lines, identity]);
  useEffect(() => {
    const series = api.current?.series;
    if (!series) return;
    if (!selection) anchor.current = null;
    const markers = createSeriesMarkers(
      series,
      selection
        ? [
            {
              time: selection.from as Time,
              position: 'aboveBar',
              shape: 'arrowDown',
              color: '#8a82ba',
              text: t('Start'),
            },
            ...(selection.to === selection.from
              ? []
              : [
                  {
                    time: selection.to as Time,
                    position: 'aboveBar',
                    shape: 'arrowDown',
                    color: '#8a82ba',
                    text: t('End'),
                  } as const,
                ]),
          ]
        : [],
    );
    return () => {
      if (api.current?.series === series) markers.detach();
    };
  }, [selection, identity, t]);
  return (
    <div
      className="market-chart"
      ref={container}
      aria-label={t('{symbol} candlestick chart', {
        symbol: data.instrument.symbol,
      })}
    />
  );
}
