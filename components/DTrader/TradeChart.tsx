'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  LineStyle,
  UTCTimestamp,
} from 'lightweight-charts';
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  ChevronRight, 
  ChevronDown, 
  Activity, 
  Play, 
  Square, 
  X, 
  Sliders, 
  Settings, 
  TrendingUp, 
  Zap,
  RefreshCw
} from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { ticksToDecimals } from '@/lib/deriv/constants';
import { derivWS } from '@/lib/deriv/websocket';

// ─── Types ───────────────────────────────────────────────────────────────────

type ChartType = 'candlestick' | 'line' | 'area';
type Timeframe = { label: string; granularity: number; count: number };
type IndicatorId = 'ma20' | 'ma50' | 'bb' | 'rsi' | 'volume';

interface OHLCBar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface Props {
  symbol: string;
  displayName: string;
  token?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIMEFRAMES: Timeframe[] = [
  { label: '1 Tick',   granularity: 0,     count: 1000  },
  { label: '1 Min',    granularity: 60,    count: 300   },
  { label: '2 Min',    granularity: 120,   count: 300   },
  { label: '3 Min',    granularity: 180,   count: 300   },
  { label: '5 Min',    granularity: 300,   count: 300   },
  { label: '10 Min',   granularity: 600,   count: 200   },
  { label: '15 Min',   granularity: 900,   count: 200   },
  { label: '30 Min',   granularity: 1800,  count: 200   },
  { label: '1 Hour',   granularity: 3600,  count: 150   },
  { label: '2 Hours',  granularity: 7200,  count: 100   },
  { label: '4 Hours',  granularity: 14400, count: 100   },
  { label: '8 Hours',  granularity: 28800, count: 100   },
  { label: '1 Day',    granularity: 86400, count: 50    },
];

const CHART_COLORS = {
  bg:          '#0d1117',
  grid:        'rgba(255,255,255,0.04)',
  border:      'rgba(255,255,255,0.06)',
  text:        '#8b95a1',
  crosshair:   'rgba(45,212,191,0.5)',
  upColor:     '#2dd4bf',
  downColor:   '#f87171',
  wickUp:      '#2dd4bf',
  wickDown:    '#f87171',
  ma20:        '#f59e0b',
  ma50:        '#818cf8',
  bbUpper:     'rgba(99,102,241,0.6)',
  bbLower:     'rgba(99,102,241,0.6)',
  bbMid:       'rgba(99,102,241,0.3)',
  rsiLine:     '#34d399',
  volume:      'rgba(45,212,191,0.15)',
};

// ─── SMA helper ──────────────────────────────────────────────────────────────

function calcSMA(data: OHLCBar[], period: number) {
  return data.map((bar, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, b) => s + b.close, 0) / period;
    return { time: bar.time, value: avg };
  }).filter(Boolean) as { time: UTCTimestamp; value: number }[];
}

function calcBB(data: OHLCBar[], period = 20, mult = 2) {
  const upper: { time: UTCTimestamp; value: number }[] = [];
  const mid:   { time: UTCTimestamp; value: number }[] = [];
  const lower: { time: UTCTimestamp; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, b) => s + b.close, 0) / period;
    const std = Math.sqrt(slice.reduce((s, b) => s + Math.pow(b.close - avg, 2), 0) / period);
    const t = data[i].time;
    upper.push({ time: t, value: avg + mult * std });
    mid.push({   time: t, value: avg });
    lower.push({ time: t, value: avg - mult * std });
  }
  return { upper, mid, lower };
}

function calcRSI(data: OHLCBar[], period = 14) {
  const result: { time: UTCTimestamp; value: number }[] = [];
  for (let i = period; i < data.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].close - data[j - 1].close;
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    result.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
  }
  return result;
}

const getDecimals = (pipSize: number | undefined, activeSymbol: string): number => {
  return ticksToDecimals(activeSymbol);
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function TradeChart({ symbol, displayName, token }: Props) {
  const { manualContractType: contractType, manualPrediction: prediction, setManualPrediction: setPrediction, setManualMarket: setMarket } = useDerivStore();
  const isDigitMode = contractType?.startsWith('DIGIT');
  const isRiseFallMode = contractType === 'CALL' || contractType === 'PUT' || contractType === 'CALL_HIGHER' || contractType === 'CALL_LOWER';
  const pipSizeRef = useRef<number | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef    = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const wsRef       = useRef<WebSocket | null>(null);
  const ohlcDataRef = useRef<OHLCBar[]>([]);

  // Series refs (using ISeriesApi with corresponding series types from lightweight-charts)
  const candleSeriesRef  = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const areaSeriesRef    = useRef<ISeriesApi<'Area'> | null>(null);
  const ma20Ref          = useRef<ISeriesApi<'Line'> | null>(null);
  const ma50Ref          = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef       = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef         = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef       = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef  = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiSeriesRef     = useRef<ISeriesApi<'Line'> | null>(null);

  const [chartType,    setChartType]    = useState<ChartType>('line');
  const [selectedTf,   setSelectedTf]   = useState<Timeframe>(TIMEFRAMES[1]); // 1 Min default
  const [customCount,  setCustomCount]  = useState<number>(1000);
  const [indicators,   setIndicators]   = useState<Set<IndicatorId>>(new Set());
  const [isLoading,    setIsLoading]    = useState(true);
  const [lastPrice,    setLastPrice]    = useState<number | null>(null);
  const [priceChange,  setPriceChange]  = useState<number>(0);
  const [crosshairInfo, setCrosshairInfo] = useState<OHLCBar | null>(null);

  // Premium state
  const [positions, setPositions] = useState<any[]>([]);
  const [barrier, setBarrier] = useState('+0.001');
  const [showActiveTrades, setShowActiveTrades] = useState(false);
  const [ticksWindow, setTicksWindow] = useState(1000);
  const [digitsHistory, setDigitsHistory] = useState<number[]>([]);
  const [latestDigit, setLatestDigit] = useState<number | null>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const [showTimeframeDropdown, setShowTimeframeDropdown] = useState(false);
  const [showIndicatorsDropdown, setShowIndicatorsDropdown] = useState(false);
  const marketDropdownRef = useRef<HTMLDivElement>(null);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const digitStreamRef = useRef<HTMLDivElement>(null);
  // R/F stream: raw price history and derived Rise/Fall sequence
  const priceHistoryRef = useRef<number[]>([]);
  const [rfHistory, setRfHistory] = useState<('R' | 'F')[]>([]);

  // Contract overlay state — visual data for active contracts on chart
  const [contractOverlays, setContractOverlays] = useState<Array<{
    contractId: number;
    startTime: number;          // unix timestamp seconds
    expiryTime: number | null;  // unix timestamp seconds (null = tick-based)
    durationValue: number;
    durationUnit: string;
    barrier: string | null;
    entrySpot: string;
    type: string;
  }>>([]);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  const overlayClockRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (digitStreamRef.current) {
      digitStreamRef.current.scrollLeft = digitStreamRef.current.scrollWidth;
    }
  }, [digitsHistory]);
  const indicatorsDropdownRef = useRef<HTMLDivElement>(null);

  // Computed timeframe object
  const timeframe = useMemo(() => ({
    ...selectedTf,
    count: customCount
  }), [selectedTf, customCount]);

  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (marketDropdownRef.current && !marketDropdownRef.current.contains(e.target as Node)) {
        setShowMarketDropdown(false);
      }
      if (timeframeDropdownRef.current && !timeframeDropdownRef.current.contains(e.target as Node)) {
        setShowTimeframeDropdown(false);
      }
      if (indicatorsDropdownRef.current && !indicatorsDropdownRef.current.contains(e.target as Node)) {
        setShowIndicatorsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Sync positions from global event
  useEffect(() => {
    if ((window as any).laxPositions) {
      setPositions((window as any).laxPositions);
      if ((window as any).laxPositions.filter((p: any) => !p.isSold).length > 0) {
        setShowActiveTrades(true);
      }
    }
    const posHandler = (e: any) => {
      setPositions(e.detail);
      const active = e.detail.filter((p: any) => !p.isSold);
      if (active.length > 0) {
        setShowActiveTrades(true);
      }
    };
    window.addEventListener('laxPositionsUpdated', posHandler);
    return () => window.removeEventListener('laxPositionsUpdated', posHandler);
  }, []);

  // Sync barrier from global event
  useEffect(() => {
    if ((window as any).laxBarrier) {
      setBarrier((window as any).laxBarrier);
    }
    const barHandler = (e: any) => setBarrier(e.detail);
    window.addEventListener('laxBarrierUpdated', barHandler);
    return () => window.removeEventListener('laxBarrierUpdated', barHandler);
  }, []);

  // Price lines references
  const positionLinesRef = useRef<any[]>([]);

  // Sync contract overlays from positions
  useEffect(() => {
    const active = positions.filter((p: any) => !p.isSold);
    setContractOverlays(active.map((p: any) => ({
      contractId: p.contractId,
      startTime: p.dateStart,
      expiryTime: p.expiryTime ?? null,
      durationValue: p.durationValue ?? 1,
      durationUnit: p.durationUnit ?? 't',
      barrier: p.barrier ?? null,
      entrySpot: p.entrySpot,
      type: p.type,
    })));
  }, [positions]);

  // Clock tick for countdowns
  useEffect(() => {
    overlayClockRef.current = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => { if (overlayClockRef.current) clearInterval(overlayClockRef.current); };
  }, []);

  // Update active positions entry spot, barrier lines, and tick markers
  useEffect(() => {
    const series = candleSeriesRef.current || lineSeriesRef.current || areaSeriesRef.current;
    if (!series) return;

    // 1. Clear all previously drawn lines
    positionLinesRef.current.forEach(line => {
      try { series.removePriceLine(line); } catch {}
    });
    positionLinesRef.current = [];

    const activePos = positions.filter(p => !p.isSold && p.symbol === symbol);
    const markers: any[] = [];

    const findClosestTime = (targetEpoch: number, data: any[]) => {
      if (!data.length) return targetEpoch;
      const match = data.find(d => (d.time as number) >= targetEpoch);
      return match ? match.time : data[data.length - 1].time;
    };

    // 2. Draw lines and gather markers
    activePos.forEach(pos => {
      const entrySpotPrice = parseFloat(pos.entrySpot);
      if (isNaN(entrySpotPrice)) return;

      const isRise   = pos.type === 'CALL';
      const isFall   = pos.type === 'PUT';
      const isHigher = pos.type === 'HIGHER';
      const isLower  = pos.type === 'LOWER';
      const isTouch  = pos.type === 'ONETOUCH';
      const isNoTouch = pos.type === 'NOTOUCH';

      const entryColor  = '#f59e0b';  // Amber for entry spot
      const barrierColor = isNoTouch  ? '#ef4444'
                         : isTouch    ? '#f97316'
                         : isHigher   ? '#2dd4bf'
                         : isLower    ? '#f87171'
                         : isRise     ? '#2dd4bf'
                         : isFall     ? '#f87171'
                         : '#818cf8';

      // Draw Entry Line
      const entryLine = series.createPriceLine({
        price: entrySpotPrice,
        color: entryColor,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `▶ Entry  #${pos.contractId}`,
      });
      positionLinesRef.current.push(entryLine);

      // Draw Barrier Line
      if (pos.barrier) {
        const barrierStr = String(pos.barrier);
        let barrierPrice: number;

        if (barrierStr.startsWith('+') || barrierStr.startsWith('-')) {
          const offset = parseFloat(barrierStr) || 0;
          barrierPrice = entrySpotPrice + offset;
        } else {
          barrierPrice = parseFloat(barrierStr);
        }

        if (!isNaN(barrierPrice)) {
          const typeLabel = isTouch ? 'TOUCH' : isNoTouch ? 'NO TOUCH' : isHigher ? 'BARRIER ↑' : isLower ? 'BARRIER ↓' : 'BARRIER';
          const barrierLine = series.createPriceLine({
            price: barrierPrice,
            color: barrierColor,
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${typeLabel}  #${pos.contractId}`,
          });
          positionLinesRef.current.push(barrierLine);
        }
      }

      // Add Entry Marker (T)
      if (pos.dateStart) {
        const startT = findClosestTime(pos.dateStart, ohlcDataRef.current);
        markers.push({
          time: startT,
          position: 'belowBar',
          shape: 'circle',
          color: '#f59e0b',
          text: 'T',
          size: 1,
        });
      }

      // Add Tick Countdown Marker (e.g. 5/10) at latest price tick
      if (pos.durationUnit === 't' && pos.tickCount > 0 && ohlcDataRef.current.length > 0) {
        const lastBar = ohlcDataRef.current[ohlcDataRef.current.length - 1];
        markers.push({
          time: lastBar.time,
          position: 'aboveBar',
          shape: 'circle',
          color: '#2dd4bf',
          text: `${pos.tickCount}/${pos.durationValue}`,
          size: 1.5,
        });
      }
    });

    // Sort markers by time ascending (lightweight-charts API requirement)
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    try {
      series.setMarkers(markers);
    } catch (e) {
      console.warn('[TradeChart] Error setting markers:', e);
    }

  }, [positions, lastPrice, symbol]);

  // ── Init chart ──────────────────────────────────────────────────────────────
  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    // Destroy existing
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch (e) {}
      chartRef.current = null;
    }
    if (rsiChartRef.current) {
      try {
        rsiChartRef.current.remove();
      } catch (e) {}
      rsiChartRef.current = null;
    }

    const showRsi = indicators.has('rsi');

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.bg },
        textColor: CHART_COLORS.text,
        fontSize: 11,
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1a2332' },
        horzLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1a2332' },
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.border,
        scaleMargins: { top: 0.08, bottom: showRsi ? 0.28 : 0.08 },
      },
      timeScale: {
        borderColor: CHART_COLORS.border,
        timeVisible: true,
        secondsVisible: timeframe.granularity < 60,
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    // Main price series
    if (chartType === 'candlestick') {
      candleSeriesRef.current = chart.addCandlestickSeries({
        upColor:   CHART_COLORS.upColor,
        downColor: CHART_COLORS.downColor,
        borderUpColor:   CHART_COLORS.wickUp,
        borderDownColor: CHART_COLORS.wickDown,
        wickUpColor:     CHART_COLORS.wickUp,
        wickDownColor:   CHART_COLORS.wickDown,
      });
    } else if (chartType === 'line') {
      lineSeriesRef.current = chart.addLineSeries({
        color: CHART_COLORS.upColor,
        lineWidth: 2,
        priceLineVisible: false,
      });
    } else {
      areaSeriesRef.current = chart.addAreaSeries({
        topColor:    'rgba(45,212,191,0.3)',
        bottomColor: 'rgba(45,212,191,0.01)',
        lineColor:   CHART_COLORS.upColor,
        lineWidth:   2,
        priceLineVisible: false,
      });
    }

    // Volume
    if (indicators.has('volume') && timeframe.granularity > 0) {
      volumeSeriesRef.current = chart.addHistogramSeries({
        color: CHART_COLORS.volume,
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }

    // RSI sub-chart
    if (showRsi && rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: CHART_COLORS.bg },
          textColor: CHART_COLORS.text,
          fontSize: 10,
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: CHART_COLORS.grid },
          horzLines: { color: CHART_COLORS.grid },
        },
        rightPriceScale: {
          borderColor: CHART_COLORS.border,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: CHART_COLORS.border,
          timeVisible: true,
          secondsVisible: timeframe.granularity < 60,
          visible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1a2332' },
          horzLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1a2332' },
        },
        handleScroll: true,
        handleScale: true,
      });
      rsiChartRef.current = rsiChart;

      rsiSeriesRef.current = rsiChart.addLineSeries({
        color: CHART_COLORS.rsiLine,
        lineWidth: 1,
        priceLineVisible: false,
      });

      // Sync time scales
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) chart.timeScale().setVisibleLogicalRange(range);
      });
    }

    // Crosshair tooltip
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData) return;
      const candleSeries = candleSeriesRef.current;
      if (candleSeries && param.seriesData.has(candleSeries)) {
        const bar = param.seriesData.get(candleSeries) as any;
        if (bar) setCrosshairInfo({ time: param.time as UTCTimestamp, ...bar });
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
      if (rsiContainerRef.current && rsiChartRef.current) {
        rsiChartRef.current.applyOptions({ width: rsiContainerRef.current.clientWidth });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        try {
          chart.remove();
        } catch (e) {}
        chartRef.current = null;
      }
      if (rsiChartRef.current) {
        try {
          rsiChartRef.current.remove();
        } catch (e) {}
        rsiChartRef.current = null;
      }
    };
  }, [chartType, timeframe, indicators]);

  // ── Set data on chart ──────────────────────────────────────────────────────
  const applyDataToChart = useCallback((bars: OHLCBar[]) => {
    if (!bars.length) return;

    const sorted = [...bars].sort((a, b) => (a.time as number) - (b.time as number));

    // Main series
    if (candleSeriesRef.current) candleSeriesRef.current.setData(sorted);
    if (lineSeriesRef.current)   lineSeriesRef.current.setData(sorted.map(b => ({ time: b.time, value: b.close })));
    if (areaSeriesRef.current)   areaSeriesRef.current.setData(sorted.map(b => ({ time: b.time, value: b.close })));

    // Volume
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(sorted.map(b => ({
        time: b.time,
        value: b.volume ?? 0,
        color: b.close >= b.open ? 'rgba(45,212,191,0.3)' : 'rgba(248,113,113,0.3)',
      })));
    }

    // MA 20
    if (indicators.has('ma20') && chartRef.current) {
      if (!ma20Ref.current) {
        ma20Ref.current = chartRef.current.addLineSeries({
          color: CHART_COLORS.ma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        });
      }
      ma20Ref.current.setData(calcSMA(sorted, 20));
    }

    // MA 50
    if (indicators.has('ma50') && chartRef.current) {
      if (!ma50Ref.current) {
        ma50Ref.current = chartRef.current.addLineSeries({
          color: CHART_COLORS.ma50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        });
      }
      ma50Ref.current.setData(calcSMA(sorted, 50));
    }

    // Bollinger Bands
    if (indicators.has('bb') && chartRef.current) {
      const { upper, mid, lower } = calcBB(sorted);
      if (!bbUpperRef.current) {
        bbUpperRef.current = chartRef.current.addLineSeries({
          color: CHART_COLORS.bbUpper, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed,
        });
        bbMidRef.current = chartRef.current.addLineSeries({
          color: CHART_COLORS.bbMid, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed,
        });
        bbLowerRef.current = chartRef.current.addLineSeries({
          color: CHART_COLORS.bbLower, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed,
        });
      }
      bbUpperRef.current.setData(upper);
      bbMidRef.current?.setData(mid);
      bbLowerRef.current?.setData(lower);
    }

    // RSI
    if (indicators.has('rsi') && rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(calcRSI(sorted, 14));
      if (rsiChartRef.current) {
        rsiChartRef.current.timeScale().setVisibleLogicalRange(
          chartRef.current!.timeScale().getVisibleLogicalRange()!
        );
      }
    }

    // Price change
    const first = sorted[0].close;
    const last  = sorted[sorted.length - 1].close;
    setLastPrice(last);
    setPriceChange(((last - first) / first) * 100);

    // Auto-position: fit all content then zoom to show last 40% of history centered
    const timeScale = chartRef.current?.timeScale();
    if (timeScale) {
      // Step 1: fit all data so we know the full logical range
      timeScale.fitContent();

      // Step 2: after a microtask (chart needs one frame to compute range)
      requestAnimationFrame(() => {
        const full = timeScale.getVisibleLogicalRange();
        if (!full) return;
        const totalBars = full.to - full.from;
        // Show last 40% of history; keep 15% right-side buffer
        const windowSize = totalBars * 0.40;
        timeScale.setVisibleLogicalRange({
          from: full.to - windowSize,
          to:   full.to + windowSize * 0.15,
        });
      });
    }
    setIsLoading(false);
  }, [indicators]);

  // ── WebSocket: stable tick stream using isolated WebSocket connection ──────
  useEffect(() => {
    setIsLoading(true);
    setDigitsHistory([]);
    setLatestDigit(null);
    setRfHistory([]);
    priceHistoryRef.current = [];
    ohlcDataRef.current = [];
    pipSizeRef.current = null;

    let active = true;
    let ws: WebSocket | null = null;

    const connect = () => {
      try {
        if (!active) return;

        const socket = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
        ws = socket;
        wsRef.current = socket;

        socket.onopen = () => {
          if (!active) { socket.close(); return; }
          // Request ticks_history immediately — no auth needed for market data
          socket.send(JSON.stringify({
            ticks_history: symbol,
            style: 'ticks',
            end: 'latest',
            count: 5000,
            subscribe: 1,
          }));
        };

        socket.onmessage = (e) => {
          if (!active) return;
          let msg: any;
          try { msg = JSON.parse(e.data); } catch { return; }
          if (msg.error) { console.warn('[TradeChart WS] error:', msg.error); return; }

          if (msg.msg_type === 'history') {
            const prices: number[] = msg.history?.prices || [];
            const times:  number[] = msg.history?.times  || [];
            const rawPipSize = msg.pip_size;
            
            // Resolve exact decimals from history response
            const decimals = getDecimals(rawPipSize, symbol);
            pipSizeRef.current = decimals;

            const digits = prices.map(price => {
              const s = price.toFixed(decimals);
              return parseInt(s.charAt(s.length - 1), 10);
            }).filter(d => !isNaN(d));

            setDigitsHistory(digits);
            if (digits.length > 0) {
              const lastPriceVal = prices[prices.length - 1];
              setLatestDigit(digits[digits.length - 1]);
              setLastPrice(lastPriceVal);
              if (prices.length >= 2) {
                const first = prices[0], last = prices[prices.length - 1];
                setPriceChange(((last - first) / first) * 100);
              }
            }

            // Build R/F history from consecutive price comparisons
            priceHistoryRef.current = prices.slice(-5000);
            const rf: ('R' | 'F')[] = [];
            for (let i = 1; i < prices.length; i++) {
              rf.push(prices[i] > prices[i - 1] ? 'R' : 'F');
            }
            setRfHistory(rf.slice(-5000));

            // Also feed the chart if timeframe is 1 Tick
            if (timeframeRef.current.granularity === 0) {
              const bars: OHLCBar[] = prices.map((p, i) => ({
                time:  times[i] as UTCTimestamp,
                open: p, high: p, low: p, close: p,
              }));
              ohlcDataRef.current = bars;
              applyDataToChart(bars);
            }
            setIsLoading(false);
          }

          if (msg.msg_type === 'tick') {
            const { quote: price, epoch, pip_size: rawPipSize } = msg.tick;
            const t = epoch as UTCTimestamp;
            setLastPrice(price);

            // Update chart series if currently in '1 Tick' mode
            if (timeframeRef.current.granularity === 0) {
              if (lineSeriesRef.current)   lineSeriesRef.current.update({ time: t, value: price });
              if (areaSeriesRef.current)   areaSeriesRef.current.update({ time: t, value: price });
              if (candleSeriesRef.current) candleSeriesRef.current.update({ time: t, open: price, high: price, low: price, close: price });
            }

            // Update digit stream using cached precision
            const decimals = pipSizeRef.current ?? getDecimals(rawPipSize, symbol);
            const s = price.toFixed(decimals);
            const digit = parseInt(s.charAt(s.length - 1), 10);
            if (!isNaN(digit)) {
              setLatestDigit(digit);
              setDigitsHistory(prev => [...prev, digit].slice(-5000));
            }

            // Update R/F stream by comparing to previous price
            const prevPrices = priceHistoryRef.current;
            if (prevPrices.length > 0) {
              const prevPrice = prevPrices[prevPrices.length - 1];
              const signal: 'R' | 'F' = price > prevPrice ? 'R' : 'F';
              setRfHistory(prev => [...prev, signal].slice(-5000));
            }
            priceHistoryRef.current = [...prevPrices, price].slice(-5000);
          }
        };

        socket.onerror = () => {
          if (active) setIsLoading(false);
        };

        socket.onclose = () => {
          if (active) {
            console.log('[TradeChart WS] closed, reconnecting...');
            setTimeout(connect, 3000);
          }
        };

      } catch (err) {
        console.error('[TradeChart WS] connection error:', err);
        if (active) {
          setIsLoading(false);
          setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      active = false;
      if (ws) ws.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // ── Candle fetch: re-runs when timeframe / chartType changes ───────────────
  const fetchHistory = useCallback(() => {
    // For ticks granularity, fetch history using the chart WS
    if (timeframe.granularity === 0) {
      setIsLoading(true);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          ticks_history: symbol,
          style: 'ticks',
          end: 'latest',
          count: 1000,
        }));
      }
      return;
    }

    // Candle mode: open a SEPARATE short-lived WS for OHLC history
    let active = true;
    let ws: WebSocket | null = null;

    const connectCandle = () => {
      try {
        if (!active) return;

        const socket = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
        ws = socket;
        socket.onopen = () => {
          if (!active) { socket.close(); return; }
          socket.send(JSON.stringify({
            ticks_history: symbol,
            style: 'candles',
            granularity: timeframe.granularity,
            end: 'latest',
            count: timeframe.count,
            subscribe: 1,
          }));
        };

        socket.onmessage = (e) => {
          if (!active) return;
          let msg: any;
          try { msg = JSON.parse(e.data); } catch { return; }
          if (msg.error) { console.warn('[CandleWS] error:', msg.error); return; }

          if (msg.msg_type === 'candles') {
            const bars: OHLCBar[] = (msg.candles || []).map((c: any) => ({
              time:   c.epoch as UTCTimestamp,
              open:   parseFloat(c.open),
              high:   parseFloat(c.high),
              low:    parseFloat(c.low),
              close:  parseFloat(c.close),
              volume: c.volume ?? 0,
            }));
            ohlcDataRef.current = bars;
            applyDataToChart(bars);
            if (bars.length) {
              setLastPrice(bars[bars.length - 1].close);
              const first = bars[0].close, last = bars[bars.length - 1].close;
              setPriceChange(((last - first) / first) * 100);
            }
            setIsLoading(false);
          }

          if (msg.msg_type === 'ohlc') {
            const c = msg.ohlc;
            const bar: OHLCBar = {
              time:  c.open_time as UTCTimestamp,
              open:  parseFloat(c.open),
              high:  parseFloat(c.high),
              low:   parseFloat(c.low),
              close: parseFloat(c.close),
            };
            if (chartType === 'candlestick' && candleSeriesRef.current) {
              candleSeriesRef.current.update(bar);
            } else {
              const s = lineSeriesRef.current || areaSeriesRef.current;
              if (s) (s as any).update({ time: bar.time, value: bar.close });
            }
            setLastPrice(bar.close);
          }
        };

        socket.onerror = () => {
          if (active) setIsLoading(false);
        };
      } catch (err) {
        console.error('[CandleWS] error:', err);
        if (active) setIsLoading(false);
      }
    };

    connectCandle();

    return () => {
      active = false;
      if (ws) ws.close();
    };
  }, [symbol, timeframe, chartType, applyDataToChart]);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Reinit chart on type / indicators / timeframe change
  useEffect(() => {
    // Reset indicator series refs on rebuild
    ma20Ref.current = null; ma50Ref.current = null;
    bbUpperRef.current = null; bbMidRef.current = null; bbLowerRef.current = null;
    rsiSeriesRef.current = null;
    candleSeriesRef.current = null; lineSeriesRef.current = null; areaSeriesRef.current = null;
    volumeSeriesRef.current = null;

    const cleanup = initChart();

    // IMMEDIATELY feed the newly created series with cached data to avoid loading delay
    if (ohlcDataRef.current && ohlcDataRef.current.length > 0) {
      applyDataToChart(ohlcDataRef.current);
    }

    return cleanup;
  }, [initChart, applyDataToChart, isDigitMode]);

  // Fetch data after chart is ready
  useEffect(() => {
    const cleanup = fetchHistory();
    return () => {
      if (cleanup) cleanup();
    };
  }, [fetchHistory]);

  // ── Toggle indicator ───────────────────────────────────────────────────────
  const toggleIndicator = (id: IndicatorId) => {
    setIndicators(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── UI ─────────────────────────────────────────────────────────────────────

  // Digit statistics calculations
  const slicedHistory = digitsHistory.slice(-ticksWindow);
  const digitCounts = Array(10).fill(0);
  slicedHistory.forEach(d => {
    if (d >= 0 && d <= 9) digitCounts[d]++;
  });

  const totalDigits = slicedHistory.length || 1;
  const percentages = digitCounts.map(count => (count / totalDigits) * 100);

  // Find rank indices
  const sortedIndices = percentages
    .map((pct, idx) => ({ pct, idx }))
    .sort((a, b) => b.pct - a.pct);

  const highestIdx = sortedIndices[0]?.idx;
  const secondHighestIdx = sortedIndices[1]?.idx;
  const lowestIdx = sortedIndices[9]?.idx;
  const secondLowestIdx = sortedIndices[8]?.idx;

  const getDigitColorClass = (digit: number) => {
    if (digit === highestIdx) return 'bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]';
    if (digit === secondHighestIdx) return 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.2)]';
    if (digit === lowestIdx) return 'bg-rose-500/20 border-rose-500 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.2)]';
    if (digit === secondLowestIdx) return 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]';
    return 'bg-white/3 border-white/5 text-gray-400 hover:border-white/10 hover:text-white';
  };

  // Dynamic stats calculation
  const getDynamicStats = () => {
    const total = slicedHistory.length || 1;
    if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER') {
      const overCount = slicedHistory.filter(d => d > prediction).length;
      const underCount = slicedHistory.filter(d => d < prediction).length;
      const equalCount = slicedHistory.filter(d => d === prediction).length;
      return {
        labelLeft: `Over ${prediction}: ${Math.round((overCount / total) * 100)}%`,
        labelRight: `Under ${prediction}: ${Math.round((underCount / total) * 100)}%`,
        pctLeft: (overCount / total) * 100,
        pctRight: (underCount / total) * 100,
        pctMid: (equalCount / total) * 100,
        colorLeft: 'bg-emerald-500',
        colorRight: 'bg-rose-500',
        colorMid: 'bg-gray-600',
        colorTextLeft: 'text-emerald-400',
        colorTextRight: 'text-rose-400',
      };
    } else if (contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF') {
      const matchCount = slicedHistory.filter(d => d === prediction).length;
      const diffCount = total - matchCount;
      return {
        labelLeft: `Match ${prediction}: ${Math.round((matchCount / total) * 100)}%`,
        labelRight: `Diff ${prediction}: ${Math.round((diffCount / total) * 100)}%`,
        pctLeft: (matchCount / total) * 100,
        pctRight: (diffCount / total) * 100,
        pctMid: 0,
        colorLeft: 'bg-teal-500',
        colorRight: 'bg-amber-500',
        colorMid: 'bg-transparent',
        colorTextLeft: 'text-teal-400',
        colorTextRight: 'text-amber-400',
      };
    } else {
      // Default: Even / Odd
      const evenCount = slicedHistory.filter(d => d % 2 === 0).length;
      const oddCount = total - evenCount;
      return {
        labelLeft: `Even: ${Math.round((evenCount / total) * 100)}%`,
        labelRight: `Odd: ${Math.round((oddCount / total) * 100)}%`,
        pctLeft: (evenCount / total) * 100,
        pctRight: (oddCount / total) * 100,
        pctMid: 0,
        colorLeft: 'bg-teal-500',
        colorRight: 'bg-amber-500',
        colorMid: 'bg-transparent',
        colorTextLeft: 'text-teal-400',
        colorTextRight: 'text-amber-400',
      };
    }
  };

  const stats = getDynamicStats();

  // Rise/Fall stats computed from rfHistory
  const getRfStats = () => {
    const sliced = rfHistory.slice(-ticksWindow);
    const total = sliced.length || 1;
    const rCount = sliced.filter(s => s === 'R').length;
    const fCount = total - rCount;
    const rPct = Math.round((rCount / total) * 100);
    const fPct = 100 - rPct;
    // Winning side depends on contract type
    const rIsWin = contractType === 'CALL' || contractType === 'CALL_HIGHER';
    return {
      rPct, fPct,
      labelR: `Rise (R): ${rPct}%`,
      labelF: `Fall (F): ${fPct}%`,
      rColor: rIsWin ? 'bg-emerald-500' : 'bg-rose-500',
      fColor: rIsWin ? 'bg-rose-500' : 'bg-emerald-500',
      rTextColor: rIsWin ? 'text-emerald-400' : 'text-rose-400',
      fTextColor: rIsWin ? 'text-rose-400' : 'text-emerald-400',
    };
  };
  const rfStats = getRfStats();

  const handleSell = (contractId: number) => {
    derivWS.send({ sell: contractId, price: 0 });
    setPositions(prev => prev.map(p => p.contractId === contractId ? { ...p, isSold: true } : p));
  };

  const activePositions = positions.filter(p => !p.isSold);
  const showRsi = indicators.has('rsi') && !isDigitMode;

  const MARKET_GROUPS = [
    { group: 'Volatility', markets: [
      { symbol: 'R_10', label: 'Volatility 10' }, { symbol: 'R_25', label: 'Volatility 25' },
      { symbol: 'R_50', label: 'Volatility 50' }, { symbol: 'R_75', label: 'Volatility 75' },
      { symbol: 'R_100', label: 'Volatility 100' }, { symbol: '1HZ10V', label: 'Vol 10 (1s)' },
      { symbol: '1HZ25V', label: 'Vol 25 (1s)' }, { symbol: '1HZ50V', label: 'Vol 50 (1s)' },
      { symbol: '1HZ75V', label: 'Vol 75 (1s)' }, { symbol: '1HZ100V', label: 'Vol 100 (1s)' },
    ]},
    { group: 'Jump', markets: [
      { symbol: 'JD10', label: 'Jump 10' }, { symbol: 'JD25', label: 'Jump 25' },
      { symbol: 'JD50', label: 'Jump 50' }, { symbol: 'JD75', label: 'Jump 75' },
      { symbol: 'JD100', label: 'Jump 100' },
    ]},
    { group: 'Crash/Boom', markets: [
      { symbol: 'CRASH300', label: 'Crash 300' }, { symbol: 'CRASH500', label: 'Crash 500' },
      { symbol: 'CRASH1000', label: 'Crash 1000' }, { symbol: 'BOOM300', label: 'Boom 300' },
      { symbol: 'BOOM500', label: 'Boom 500' }, { symbol: 'BOOM1000', label: 'Boom 1000' },
    ]},
    { group: 'Forex', markets: [
      { symbol: 'frxEURUSD', label: 'EUR/USD' }, { symbol: 'frxGBPUSD', label: 'GBP/USD' },
      { symbol: 'frxUSDJPY', label: 'USD/JPY' }, { symbol: 'frxAUDUSD', label: 'AUD/USD' },
    ]},
  ];

  const activeMarketLabel = MARKET_GROUPS.flatMap(g => g.markets).find(m => m.symbol === symbol)?.label || symbol;

  return (
    <div className="flex flex-col h-full bg-[#0d1117] overflow-hidden">

      {/* ── Compact Top Bar: Market Dropdown + Active Trades ── */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-black/20 border-b border-white/5 flex-shrink-0 relative" ref={marketDropdownRef}>

        {/* Market dropdown button */}
        <button
          onClick={() => setShowMarketDropdown(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-teal-500/40 hover:bg-teal-500/5 transition-all text-xs font-bold text-white min-w-0 flex-shrink-0"
        >
          <span className="text-teal-400 text-[9px] uppercase tracking-widest font-black">MKT</span>
          <span className="truncate max-w-[90px]">{activeMarketLabel}</span>
          <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${showMarketDropdown ? 'rotate-180' : ''}`} />
        </button>

        {/* Market dropdown overlay */}
        {showMarketDropdown && (
          <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-y-auto max-h-72">
            {MARKET_GROUPS.map(({ group, markets }) => (
              <div key={group}>
                <p className="px-3 pt-2.5 pb-1 text-[9px] font-black uppercase tracking-widest text-gray-500">{group}</p>
                <div className="px-1.5 pb-1.5 grid grid-cols-2 gap-1">
                  {markets.map(m => (
                    <button
                      key={m.symbol}
                      onClick={() => { setMarket(m.symbol); setShowMarketDropdown(false); }}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-bold text-left transition-all border ${
                        symbol === m.symbol
                          ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                          : 'bg-white/2 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live price chip */}
        {lastPrice !== null && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-black text-white font-mono">{lastPrice.toFixed(isDigitMode ? ticksToDecimals(symbol) : 5)}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${priceChange >= 0 ? 'text-teal-400 bg-teal-400/10' : 'text-red-400 bg-red-400/10'}`}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Active trades toggle */}
        {activePositions.length > 0 && (
          <button
            onClick={() => setShowActiveTrades(v => !v)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all flex-shrink-0"
          >
            <span>{showActiveTrades ? 'Hide' : `Trades (${activePositions.length})`}</span>
          </button>
        )}
      </div>

      {/* Active trades horizontal ribbon */}
      {showActiveTrades && activePositions.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-500/5 border-b border-amber-500/10 overflow-x-auto no-scrollbar flex-shrink-0">
          {activePositions.map((pos: any) => {
            const isProfit = pos.currentProfit >= 0;
            return (
              <div key={pos.contractId} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-bold whitespace-nowrap flex-shrink-0 ${
                isProfit ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}>
                <span className="opacity-70 text-[9px]">{pos.type}</span>
                <span className="font-mono">${pos.buyPrice.toFixed(2)}</span>
                <span className="font-mono font-black">{isProfit ? '+' : ''}{pos.currentProfit.toFixed(2)}</span>
                <button onClick={() => handleSell(pos.contractId)}
                  className="text-[9px] font-black uppercase bg-white/10 hover:bg-white/20 text-white px-1.5 py-0.5 rounded border border-white/10 ml-0.5">
                  Sell
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Toolbar ── */}
      {!isDigitMode && (
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-white/5 flex-shrink-0 overflow-x-auto no-scrollbar">
          
          {/* Price info */}
          <div className="flex items-baseline gap-1.5 shrink-0">
            {lastPrice !== null && (
              <>
                <span className="text-sm font-black text-white font-mono">{lastPrice.toFixed(5)}</span>
                <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${priceChange >= 0 ? 'text-teal-400 bg-teal-400/10' : 'text-red-400 bg-red-400/10'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              </>
            )}
          </div>

          <div className="flex-1" />

        {!isDigitMode && (
          <>
            {/* Chart type */}
            <div className="flex bg-white/3 rounded-lg p-0.5 gap-0.5 shrink-0">
              {(['candlestick', 'line', 'area'] as ChartType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setChartType(t)}
                  className={`px-1.5 py-1 text-[10px] rounded-md font-semibold transition-all ${chartType === t ? 'bg-teal-500/20 text-teal-300' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  {t === 'candlestick' ? '🕯️' : t === 'line' ? '📈' : '〰️'}
                </button>
              ))}
            </div>

            {/* Timeframe selector dropdown */}
            <div className="relative" ref={timeframeDropdownRef}>
              <button
                onClick={() => { setShowTimeframeDropdown(v => !v); setShowIndicatorsDropdown(false); }}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-white/3 border border-white/5 hover:border-white/25 text-gray-300 hover:text-white transition-all flex items-center gap-1"
              >
                <span>{selectedTf.label}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {showTimeframeDropdown && (
                <div className="fixed z-[200] w-64 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl p-3 space-y-2.5"
                  style={{
                    bottom: 'auto',
                    right: '8px',
                    top: (() => {
                      const el = timeframeDropdownRef.current;
                      if (!el) return '60px';
                      const rect = el.getBoundingClientRect();
                      return `${rect.bottom + 6}px`;
                    })(),
                  }}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Interval</p>
                  <div className="grid grid-cols-4 gap-1">
                    {TIMEFRAMES.map(tf => (
                      <button
                        key={tf.label}
                        onClick={() => {
                          setSelectedTf(tf);
                          setCustomCount(tf.count);
                          setShowTimeframeDropdown(false);
                        }}
                        className={`px-1 py-1.5 rounded-lg text-[10px] font-bold text-center border transition-all ${
                          selectedTf.label === tf.label
                            ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                            : 'bg-white/2 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-white/5 pt-2 space-y-1.5">
                    <p className="text-[9px] font-black uppercase text-gray-500">Custom History Count (max 20,000)</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="50"
                        max="20000"
                        step="100"
                        value={customCount}
                        onChange={e => setCustomCount(Math.min(20000, Math.max(50, parseInt(e.target.value) || 1000)))}
                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-center text-xs text-white font-mono font-bold focus:outline-none focus:border-teal-500/50"
                      />
                      <button
                        onClick={() => setShowTimeframeDropdown(false)}
                        className="px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-[10px] font-black rounded-lg hover:bg-teal-500/30 transition-all"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Indicators dropdown */}
            <div className="relative" ref={indicatorsDropdownRef}>
              <button
                onClick={() => { setShowIndicatorsDropdown(v => !v); setShowTimeframeDropdown(false); }}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${
                  indicators.size > 0
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                    : 'bg-white/3 border-white/5 text-gray-300 hover:border-white/25 hover:text-white'
                }`}
              >
                <span>Indicators{indicators.size > 0 ? ` (${indicators.size})` : ''}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {showIndicatorsDropdown && (
                <div className="fixed z-[200] w-52 bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl p-3 space-y-1"
                  style={{
                    right: '8px',
                    top: (() => {
                      const el = indicatorsDropdownRef.current;
                      if (!el) return '60px';
                      const rect = el.getBoundingClientRect();
                      return `${rect.bottom + 6}px`;
                    })(),
                  }}
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 pb-1">Indicators</p>
                  {([
                    ['ma20',   'MA 20',   'Moving Average 20'],
                    ['ma50',   'MA 50',   'Moving Average 50'],
                    ['bb',     'Bollinger Bands', 'BB'],
                    ['rsi',    'RSI',     'Relative Strength Index'],
                    ['volume', 'Volume',  'Volume Histogram'],
                  ] as [IndicatorId, string, string][]).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => toggleIndicator(id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                        indicators.has(id)
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                          : 'bg-white/2 border border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span>{label}</span>
                      {indicators.has(id) && <span className="text-indigo-400 text-[10px]">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        </div>
      )}

      {/* OHLC crosshair info — slim secondary bar */}
      {crosshairInfo && chartType === 'candlestick' && !isDigitMode && (
        <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500 px-3 py-1 border-b border-white/5 flex-shrink-0 bg-white/1">
          <span>O <span className="text-white">{crosshairInfo.open?.toFixed(5)}</span></span>
          <span>H <span className="text-teal-400">{crosshairInfo.high?.toFixed(5)}</span></span>
          <span>L <span className="text-red-400">{crosshairInfo.low?.toFixed(5)}</span></span>
          <span>C <span className="text-white">{crosshairInfo.close?.toFixed(5)}</span></span>
        </div>
      )}

      {/* ── Main display area (Chart or Digit Stats Panel) ── */}
      <div className="flex flex-col flex-1 min-h-[380px] md:min-h-0 relative">
        
        {(isDigitMode || isRiseFallMode) ? (
          <div className="flex-1 flex flex-col bg-[#0a0d14] overflow-y-auto min-h-[380px] md:min-h-0" style={{ fontFamily: "'Inter', sans-serif" }}>

            {/* ── Compact header row: quote + ticks window ── */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Quote</span>
                <span className="text-base font-black font-mono text-white">
                  {(() => {
                    if (lastPrice === null) return '—';
                    const dec = pipSizeRef.current ?? getDecimals(undefined, symbol);
                    return lastPrice.toFixed(dec).slice(0, -1);
                  })()}
                </span>
                <span className="text-teal-400 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-lg text-base font-black">
                  {latestDigit !== null ? latestDigit : '?'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500 font-bold">Ticks:</span>
                <input
                  type="number" min="50" max="5000" step="50"
                  value={ticksWindow}
                  onChange={e => setTicksWindow(Math.min(5000, Math.max(50, parseInt(e.target.value) || 1000)))}
                  className="w-14 bg-black/40 border border-white/10 rounded-lg px-1.5 py-0.5 text-center text-xs text-white font-mono font-bold focus:outline-none focus:border-teal-500/50"
                />
              </div>
            </div>

            {/* ── Stream row: R/F or Digit depending on mode ── */}
            <div className="px-2 pt-2 pb-1 flex-shrink-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] text-gray-600 uppercase tracking-widest font-black">
                  {isRiseFallMode ? 'R/F Stream' : 'Stream'}
                </p>
                <div className="flex items-center gap-2 text-[8px] font-bold">
                  <span className="flex items-center gap-1 text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Win</span>
                  <span className="flex items-center gap-1 text-rose-400"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />Loss</span>
                </div>
              </div>
              <div ref={digitStreamRef} className="flex gap-1 overflow-x-auto no-scrollbar items-center py-0.5">
                {isRiseFallMode ? (
                  // ── Rise/Fall stream chips ──
                  rfHistory.slice(-30).map((rf, idx, arr) => {
                    const isLatest = idx === arr.length - 1;
                    const rIsWin = contractType === 'CALL' || contractType === 'CALL_HIGHER';
                    const isWin = rf === 'R' ? rIsWin : !rIsWin;
                    let colorClass = '';
                    if (isLatest) {
                      colorClass = isWin
                        ? 'bg-emerald-500/40 border-emerald-400 text-emerald-200 scale-125 shadow-md shadow-emerald-500/40 z-10'
                        : 'bg-rose-500/40 border-rose-400 text-rose-200 scale-125 shadow-md shadow-rose-500/40 z-10';
                    } else if (isWin) {
                      colorClass = 'bg-emerald-500/15 border-emerald-600/40 text-emerald-300';
                    } else {
                      colorClass = 'bg-rose-500/15 border-rose-600/40 text-rose-400';
                    }
                    return (
                      <div key={idx} className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center font-mono font-black text-[11px] border transition-all duration-200 ${colorClass}`}>
                        {rf}
                      </div>
                    );
                  })
                ) : (
                  // ── Digit stream chips ──
                  digitsHistory.slice(-25).map((d, idx, arr) => {
                    const isLatest = idx === arr.length - 1;
                    let isWin = false;
                    let isLoss = false;
                    if (isDigitMode) {
                      if (contractType === 'DIGITOVER')  { isWin = d > prediction;  isLoss = d <= prediction; }
                      else if (contractType === 'DIGITUNDER') { isWin = d < prediction;  isLoss = d >= prediction; }
                      else if (contractType === 'DIGITMATCH') { isWin = d === prediction; isLoss = d !== prediction; }
                      else if (contractType === 'DIGITDIFF')  { isWin = d !== prediction; isLoss = d === prediction; }
                      else if (contractType === 'DIGITEVEN')  { isWin = d % 2 === 0;      isLoss = d % 2 !== 0; }
                      else if (contractType === 'DIGITODD')   { isWin = d % 2 !== 0;      isLoss = d % 2 === 0; }
                    }
                    let colorClass = '';
                    if (isLatest) {
                      colorClass = isWin
                        ? 'bg-emerald-500/40 border-emerald-400 text-emerald-200 scale-125 shadow-md shadow-emerald-500/40 z-10'
                        : isLoss
                          ? 'bg-rose-500/40 border-rose-400 text-rose-200 scale-125 shadow-md shadow-rose-500/40 z-10'
                          : 'bg-teal-500/30 border-teal-400 text-teal-200 scale-125 shadow-md shadow-teal-500/30 z-10';
                    } else if (isWin)  { colorClass = 'bg-emerald-500/15 border-emerald-600/40 text-emerald-300'; }
                    else if (isLoss) { colorClass = 'bg-rose-500/15 border-rose-600/40 text-rose-400'; }
                    else              { colorClass = 'bg-white/3 border-white/5 text-gray-500'; }
                    return (
                      <div key={idx} className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center font-mono font-black text-xs border transition-all duration-200 ${colorClass}`}>
                        {d}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Stats Bar: R/F percentages or Digit Over/Under/Even/Odd ── */}
            <div className="px-2 pb-1.5 flex-shrink-0">
              {isRiseFallMode ? (
                <>
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-wider mb-0.5">
                    <span className={rfStats.rTextColor}>{rfStats.labelR}</span>
                    <span className={rfStats.fTextColor}>{rfStats.labelF}</span>
                  </div>
                  <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden flex">
                    <div className={`h-full ${rfStats.rColor} transition-all duration-300`} style={{ width: `${rfStats.rPct}%` }} />
                    <div className={`h-full ${rfStats.fColor} transition-all duration-300`} style={{ width: `${rfStats.fPct}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-wider mb-0.5">
                    <span className={stats.colorTextLeft}>{stats.labelLeft}</span>
                    <span className={stats.colorTextRight}>{stats.labelRight}</span>
                  </div>
                  <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden flex">
                    <div className={`h-full ${stats.colorLeft} transition-all duration-300`} style={{ width: `${stats.pctLeft}%` }} />
                    {stats.pctMid > 0 && (
                      <div className={`h-full ${stats.colorMid} transition-all duration-300`} style={{ width: `${stats.pctMid}%` }} />
                    )}
                    <div className={`h-full ${stats.colorRight} transition-all duration-300`} style={{ width: `${stats.pctRight}%` }} />
                  </div>
                </>
              )}
            </div>

            {/* ── Frequency grid OR R/F big bars ── */}
            <div className="flex flex-col gap-1.5 px-2 pb-2 md:flex-1 min-h-0">

              {/* Header row: label + auto-trade toggle */}
              <div className="flex items-center justify-between flex-shrink-0">
                <p className="text-[8px] text-gray-600 uppercase tracking-widest font-black">
                  Distribution — {ticksWindow}t
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: autoTradeEnabled ? '#2dd4bf' : '#4b5563' }}>Auto-Trade</span>
                  <button
                    onClick={() => setAutoTradeEnabled(p => !p)}
                    className={`relative w-8 h-4 rounded-full border transition-all duration-300 ${
                      autoTradeEnabled ? 'bg-teal-500/30 border-teal-400/60' : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all duration-300 ${
                      autoTradeEnabled ? 'left-4 bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.8)]' : 'left-0.5 bg-gray-500'
                    }`} />
                  </button>
                </div>
              </div>

              {isRiseFallMode ? (
                /* ── R/F Big Bar Visualisation ── */
                (() => {
                  const slicedRf = rfHistory.slice(-ticksWindow);
                  const total = slicedRf.length || 1;
                  const rCount = slicedRf.filter(x => x === 'R').length;
                  const fCount = total - rCount;
                  const rPct = (rCount / total) * 100;
                  const fPct = (fCount / total) * 100;
                  const rIsWin = contractType === 'CALL' || contractType === 'CALL_HIGHER';

                  // Current streak
                  let streak = 0;
                  let streakType: 'R' | 'F' | null = null;
                  if (rfHistory.length > 0) {
                    streakType = rfHistory[rfHistory.length - 1];
                    for (let i = rfHistory.length - 1; i >= 0 && rfHistory[i] === streakType; i--) streak++;
                  }

                  return (
                    <div className="flex flex-col gap-3 flex-1">
                      {/* Two large frequency bars */}
                      <div className="grid grid-cols-2 gap-2 flex-1">
                        {(['R', 'F'] as const).map(side => {
                          const count = side === 'R' ? rCount : fCount;
                          const pct  = side === 'R' ? rPct   : fPct;
                          const isWinSide = side === 'R' ? rIsWin : !rIsWin;
                          const isActive = streakType === side;
                          return (
                            <div key={side}
                              className={`relative flex flex-col rounded-xl border overflow-hidden transition-all duration-300 min-h-[100px]
                                ${isWinSide
                                  ? 'bg-emerald-500/10 border-emerald-500/30'
                                  : 'bg-rose-500/10 border-rose-500/30'}
                                ${isActive ? 'ring-2 ring-offset-1 ring-offset-black/80 ' + (isWinSide ? 'ring-emerald-400' : 'ring-rose-400') : ''}
                              `}
                            >
                              {/* Fill bar from bottom */}
                              <div
                                className={`absolute bottom-0 left-0 right-0 transition-all duration-700 rounded-b-xl ${isWinSide ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}
                                style={{ height: `${pct}%` }}
                              />
                              <div className="relative flex flex-col items-center justify-center flex-1 p-2 gap-1">
                                <span className={`text-3xl font-black ${isWinSide ? 'text-emerald-300' : 'text-rose-400'}`}>{side}</span>
                                <span className={`text-sm font-black font-mono ${isWinSide ? 'text-emerald-200' : 'text-rose-300'}`}>{pct.toFixed(1)}%</span>
                                <span className="text-[9px] text-gray-500 font-bold">{count} / {total}</span>
                                <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${isWinSide ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                  {isWinSide ? 'WIN' : 'LOSS'}
                                </span>
                                {isActive && streak > 1 && (
                                  <span className={`text-[9px] font-black mt-0.5 ${isWinSide ? 'text-emerald-300' : 'text-rose-300'}`}>
                                    🔥 {streak} streak
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Recent 20-tick mini history grid */}
                      <div className="flex-shrink-0">
                        <p className="text-[7px] text-gray-600 uppercase tracking-widest font-black mb-1">Recent 20 ticks</p>
                        <div className="grid grid-cols-10 gap-0.5">
                          {rfHistory.slice(-20).map((rf, i) => {
                            const isWinSide = rf === 'R' ? rIsWin : !rIsWin;
                            return (
                              <div key={i} className={`h-5 rounded flex items-center justify-center text-[9px] font-black
                                ${isWinSide ? 'bg-emerald-500/25 text-emerald-300' : 'bg-rose-500/25 text-rose-400'}`}>
                                {rf}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* R vs F horizontal comparison bar */}
                      <div className="flex-shrink-0">
                        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden flex">
                          <div className={`h-full transition-all duration-700 ${rIsWin ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${rPct}%` }} />
                          <div className={`h-full transition-all duration-700 ${rIsWin ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${fPct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <>
                  {/* Mode hint for digit contracts */}
                  {autoTradeEnabled && (
                    <div className="flex-shrink-0 px-1 py-0.5 rounded-lg bg-teal-500/8 border border-teal-500/20 text-[8px] text-teal-400 font-bold text-center">
                      {contractType === 'DIGITOVER' || contractType === 'DIGITUNDER'
                        ? '▲ tap TOP half = OVER · ▼ tap BOTTOM half = UNDER'
                        : contractType === 'DIGITMATCH'
                        ? '▲ tap TOP half = MATCH · ▼ tap BOTTOM half = DIFFERS'
                        : contractType === 'DIGITDIFF'
                        ? '▲ tap TOP half = DIFFERS · ▼ tap BOTTOM half = MATCH'
                        : contractType === 'DIGITEVEN'
                        ? 'tap any EVEN digit to trade EVEN'
                        : contractType === 'DIGITODD'
                        ? 'tap any ODD digit to trade ODD'
                        : 'tap digit = set prediction'}
                    </div>
                  )}

                  {/* 2×5 digit grid */}
                  {[0, 5].map(startDigit => (
                    <div key={startDigit} className="grid grid-cols-5 gap-1.5 md:flex-1">
                      {Array.from({ length: 5 }, (_, i) => {
                        const digit = startDigit + i;
                        const count = digitCounts[digit] || 0;
                        const pct = ((count / totalDigits) * 100);
                        const pctStr = pct.toFixed(1);
                        const colorClass = getDigitColorClass(digit);
                        const isLatest = latestDigit === digit;
                        const isEven = digit % 2 === 0;
                        const showEvenOdd = contractType === 'DIGITEVEN' || contractType === 'DIGITODD';
                        const isTargetEvenOdd = (contractType === 'DIGITEVEN' && isEven) || (contractType === 'DIGITODD' && !isEven);
                        const isOverUnder = contractType === 'DIGITOVER' || contractType === 'DIGITUNDER';
                        const isMatchDiff = contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF';
                        return (
                          <div key={digit}
                            className={`relative flex flex-col rounded-xl border overflow-hidden transition-all duration-200 touch-manipulation
                              h-14 md:h-auto md:min-h-[4rem] md:flex-1
                              ${colorClass}
                              ${isLatest ? 'ring-2 ring-cyan-400 border-cyan-300 scale-[1.04] z-30 shadow-[0_0_15px_rgba(34,211,238,0.45)]' : ''}
                              ${showEvenOdd && isTargetEvenOdd ? 'ring-1 ring-teal-400/60' : ''}
                            `}
                          >
                            <button
                              className="flex-1 flex flex-col items-center justify-center relative group"
                              onClick={() => {
                                setPrediction(digit);
                                if (!autoTradeEnabled) return;
                                if (isOverUnder) (window as any).__dtrader_quick_trade?.({ type: 'DIGITOVER', digit });
                                else if (isMatchDiff) { const t = contractType === 'DIGITMATCH' ? 'DIGITMATCH' : 'DIGITDIFF'; (window as any).__dtrader_quick_trade?.({ type: t, digit }); }
                                else if (showEvenOdd) (window as any).__dtrader_quick_trade?.({ type: contractType, digit });
                                else setPrediction(digit);
                              }}
                            >
                              {autoTradeEnabled && (isOverUnder || isMatchDiff) && (
                                <span className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[6px] font-black uppercase tracking-wider opacity-40 group-hover:opacity-80 transition-opacity">
                                  {isOverUnder ? 'OVR' : contractType === 'DIGITMATCH' ? 'MTH' : 'DIF'}
                                </span>
                              )}
                              <span className="text-base md:text-xl font-black font-mono leading-none">{digit}</span>
                              {showEvenOdd && (
                                <span className={`text-[6px] font-black uppercase tracking-wider mt-0.5 ${isEven ? 'text-teal-400' : 'text-amber-400'}`}>{isEven ? 'E' : 'O'}</span>
                              )}
                            </button>
                            <div className="flex-shrink-0 px-1 pb-0.5">
                              <div className="text-center text-[9px] font-bold font-mono opacity-75">{pctStr}%</div>
                              <div className="w-full h-0.5 bg-black/30 rounded-full overflow-hidden">
                                <div className="h-full bg-current transition-all duration-500" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            {autoTradeEnabled && (isOverUnder || isMatchDiff) && (
                              <button
                                className="h-5 md:h-6 flex items-center justify-center w-full border-t border-white/5 bg-black/20 hover:bg-white/5 transition-colors group"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPrediction(digit);
                                  if (isOverUnder) (window as any).__dtrader_quick_trade?.({ type: 'DIGITUNDER', digit });
                                  else { const t = contractType === 'DIGITMATCH' ? 'DIGITDIFF' : 'DIGITMATCH'; (window as any).__dtrader_quick_trade?.({ type: t, digit }); }
                                }}
                              >
                                <span className="text-[6px] font-black uppercase tracking-wider opacity-40 group-hover:opacity-90 transition-opacity">
                                  {isOverUnder ? 'UND' : contractType === 'DIGITMATCH' ? 'DIF' : 'MTH'}
                                </span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {/* Legend */}
                  <div className="flex gap-2 flex-wrap items-center justify-center text-[7px] font-bold uppercase tracking-wider text-gray-600 flex-shrink-0 pt-0.5">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/20 border border-emerald-500 rounded-full" />Max</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500/20 border border-blue-500 rounded-full" />2nd</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500/20 border border-amber-500 rounded-full" />2ndMin</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500/20 border border-rose-500 rounded-full" />Min</span>
                  </div>
                </>
              )}
            </div>

          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1117]/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-2 border-teal-500/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-t-teal-400 animate-spin" />
                  </div>
                  <p className="text-[10px] uppercase tracking-widest text-teal-500 font-bold animate-pulse">Loading chart…</p>
                </div>
              </div>
            )}

            <div className="relative flex-1 min-h-0">
              <div
                ref={containerRef}
                className="w-full h-full"
                style={{ minHeight: showRsi ? 'calc(100% - 120px)' : '100%' }}
              />

              {/* ── Active Contract Overlays ── */}
              {contractOverlays.length > 0 && (
                <div className="absolute top-2 right-2 z-20 flex flex-col gap-1.5 pointer-events-none">
                  {contractOverlays.map(overlay => {
                    const isTimeBased = overlay.expiryTime !== null;
                    const isTick = overlay.durationUnit === 't';

                    let countdown = '—';
                    let pct = 0;
                    if (isTimeBased && overlay.expiryTime) {
                      const totalSec = overlay.expiryTime - overlay.startTime;
                      const elapsed = nowSec - overlay.startTime;
                      const remaining = overlay.expiryTime - nowSec;
                      pct = Math.min(100, Math.max(0, (elapsed / (totalSec || 1)) * 100));
                      if (remaining > 0) {
                        if (remaining >= 3600) {
                          countdown = `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`;
                        } else if (remaining >= 60) {
                          countdown = `${Math.floor(remaining / 60)}m ${remaining % 60}s`;
                        } else {
                          countdown = `${remaining}s`;
                        }
                      } else {
                        countdown = 'Settling...';
                      }
                    } else if (isTick) {
                      countdown = `${overlay.durationValue}T`;
                    }

                    const colorMap: Record<string, string> = {
                      CALL:     'bg-gradient-to-br from-teal-900/80 to-teal-800/80 border-teal-500/40',
                      PUT:      'bg-gradient-to-br from-rose-900/80 to-rose-800/80 border-rose-500/40',
                      HIGHER:   'bg-gradient-to-br from-teal-900/80 to-teal-800/80 border-teal-500/40',
                      LOWER:    'bg-gradient-to-br from-rose-900/80 to-rose-800/80 border-rose-500/40',
                      ONETOUCH: 'bg-gradient-to-br from-amber-900/80 to-amber-800/80 border-amber-500/40',
                      NOTOUCH:  'bg-gradient-to-br from-purple-900/80 to-purple-800/80 border-purple-500/40',
                    };
                    const barColor: Record<string, string> = {
                      CALL: 'bg-teal-400', PUT: 'bg-rose-400',
                      HIGHER: 'bg-teal-400', LOWER: 'bg-rose-400',
                      ONETOUCH: 'bg-amber-400', NOTOUCH: 'bg-purple-400',
                    };
                    const colorClass = colorMap[overlay.type] || 'bg-gradient-to-br from-gray-900/80 to-gray-800/80 border-gray-500/40';
                    const barClass = barColor[overlay.type] || 'bg-gray-400';

                    return (
                      <div key={overlay.contractId}
                        className={`rounded-xl border ${colorClass} backdrop-blur-md px-3 py-2 min-w-[140px] shadow-2xl`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-white/90">{overlay.type}</span>
                          <span className="text-xs font-black font-mono text-white tabular-nums">{countdown}</span>
                        </div>
                        <div className="text-[9px] text-white/50 mb-1.5 space-y-0.5">
                          <div>Entry: <span className="text-white/80 font-mono">{overlay.entrySpot}</span></div>
                          {overlay.barrier && <div>Barrier: <span className="text-white/80 font-mono">{overlay.barrier}</span></div>}
                        </div>
                        {isTimeBased && (
                          <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${barClass} rounded-full transition-all duration-1000`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                        {isTick && (
                          <div className="text-[8px] text-white/40 uppercase tracking-widest">Tick-based</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {showRsi && (
              <div className="border-t border-white/5">
                <div className="px-2 py-0.5 flex items-center gap-2">
                  <span className="text-[9px] text-gray-600 uppercase font-bold tracking-widest">RSI (14)</span>
                  <span className="text-[9px] text-gray-700">— 70/30 levels</span>
                </div>
                <div ref={rsiContainerRef} style={{ height: 100 }} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
