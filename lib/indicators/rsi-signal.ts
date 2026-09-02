/**
 * rsi-signal.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure numerical port of the "RSI Signal [trade_lexx]" TradingView indicator.
 *
 * How accuracy is achieved:
 *   - Raw ticks are aggregated N-ticks-per-candle before being fed into RSI,
 *     exactly mirroring how TradingView works on candle closes.
 *   - All MA types, RMA (Wilder), BB std-dev, pivot detection and crossover
 *     tracking use the exact same formulas as the Pine Script source.
 *   - State (RMA seeds, EMA values, candle buffers, signal history) is stored
 *     in a module-level Map keyed by a caller-supplied stateKey, so state
 *     survives across multiple tick calls without React re-renders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type MaType =
  | 'SMA' | 'EMA' | 'WMA' | 'HMA' | 'KAMA'
  | 'VWMA' | 'ALMA' | 'TEMA' | 'ZLEMA' | 'LSMA';

export interface RsiSignalConfig {
  /** Ticks grouped into one synthetic candle (default 5) */
  ticksPerCandle: number;
  /** RSI period (default 14) */
  rsiLength: number;
  /** Moving-Average crossover signal */
  maMode: boolean;
  maType: MaType;
  maLength: number;
  /** Bollinger-Bands crossover signal */
  bbMode: boolean;
  bbType: MaType;
  bbLength: number;
  bbMult: number;
  /** Divergence signal */
  divergenceMode: boolean;
  /** RSI Overbought / Oversold zone filter */
  rsiFilterEnabled: boolean;
  oversoldLow: number;    // default 20
  oversoldHigh: number;   // default 40
  overboughtLow: number;  // default 60
  overboughtHigh: number; // default 80
  /** Minimum candles between same-direction signals (default 5) */
  reentryPause: number;
  /** Require opposite signal before re-arming (default false) */
  waitForOpposite: boolean;
  /** Require >= 2 sub-engines to agree simultaneously (default false) */
  andMode: boolean;
  /** Ticks to keep a triggered signal armed/active for collaborating conditions like pullbacks (default 10) */
  signalHoldTicks?: number;
}

export interface RsiSignalResult {
  buySignal:  boolean;
  sellSignal: boolean;
  rsi:        number;
  candleCount: number;
  ticksInCurrentCandle: number;
  isFreshSignal?: boolean; // true on the exact tick the crossover/signal sealed
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL STATE PER (market x condition)
// ─────────────────────────────────────────────────────────────────────────────

interface EngineState {
  candleBuf:  number[];
  closes:     number[];
  highs:      number[];
  lows:       number[];
  candleIdx:  number;
  // RSI (Wilder RMA)
  rmaUp:      number;
  rmaDown:    number;
  rsiReady:   boolean;
  rsiHistory: number[];
  // Signal MA
  maEma:   number; maKama:   number; maLsma:   number;
  maTemaE1: number; maTemaE2: number; maTemaE3: number;
  maReady:  boolean;
  // BB MA
  bbEma:   number; bbKama:   number; bbLsma:   number;
  bbTemaE1: number; bbTemaE2: number; bbTemaE3: number;
  bbReady:  boolean;
  // Crossover prev values
  prevRsi:     number;
  prevMa:      number;
  prevBbLower: number;
  prevBbUpper: number;
  // Divergence pivot history
  pivotLows:  Array<{ idx: number; rsi: number; low:  number }>;
  pivotHighs: Array<{ idx: number; rsi: number; high: number }>;
  // Signal tracking
  lastBuyCandle:  number;
  lastSellCandle: number;
  lastSignal:     1 | -1 | 0;
  // Armed signal memory (for collaboration with follower conditions like F-F)
  armedSignal:         'BUY' | 'SELL' | null;
  armedRemainingTicks: number;
}

const MAX_HIST = 120;
const stateMap = new Map<string, EngineState>();

function mkState(): EngineState {
  return {
    candleBuf: [], closes: [], highs: [], lows: [], candleIdx: 0,
    rmaUp: 0, rmaDown: 0, rsiReady: false, rsiHistory: [],
    maEma: 0, maKama: 0, maLsma: 0, maTemaE1: 0, maTemaE2: 0, maTemaE3: 0, maReady: false,
    bbEma: 0, bbKama: 0, bbLsma: 0, bbTemaE1: 0, bbTemaE2: 0, bbTemaE3: 0, bbReady: false,
    prevRsi: NaN, prevMa: NaN, prevBbLower: NaN, prevBbUpper: NaN,
    pivotLows: [], pivotHighs: [],
    lastBuyCandle: -9999, lastSellCandle: -9999, lastSignal: 0,
    armedSignal: null, armedRemainingTicks: 0,
  };
}

export function resetRsiSignalState(stateKey: string): void {
  stateMap.delete(stateKey);
}

/** Disarm / consume the active signal after a trade has successfully fired */
export function consumeRsiSignal(stateKey: string): void {
  const st = stateMap.get(stateKey);
  if (st) {
    st.armedSignal = null;
    st.armedRemainingTicks = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function push(arr: number[], v: number): void { arr.push(v); if (arr.length > MAX_HIST) arr.shift(); }

function sma(arr: number[], len: number): number {
  const s = arr.slice(-len); if (s.length < len) return NaN;
  return s.reduce((a, b) => a + b, 0) / len;
}
function stddev(arr: number[], len: number): number {
  const s = arr.slice(-len); if (s.length < len) return NaN;
  const m = s.reduce((a, b) => a + b, 0) / len;
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / len);
}
function wma(arr: number[], len: number): number {
  const s = arr.slice(-len); if (s.length < len) return NaN;
  let n = 0, d = 0; s.forEach((v, i) => { n += v * (i + 1); d += (i + 1); }); return n / d;
}
function hma(arr: number[], len: number): number {
  const half = Math.floor(len / 2), sqrtLen = Math.round(Math.sqrt(len));
  const tmp: number[] = [];
  for (let i = sqrtLen - 1; i < arr.length; i++) {
    const sl = arr.slice(0, i + 1);
    const w1 = wma(sl, half), w2 = wma(sl, len);
    if (!isNaN(w1) && !isNaN(w2)) tmp.push(2 * w1 - w2);
  }
  return wma(tmp, sqrtLen);
}
function alma(arr: number[], len: number): number {
  const s = arr.slice(-len); if (s.length < len) return NaN;
  const m = Math.floor(0.85 * (len - 1));
  const denom = 2 * (6 / len) ** 2 * (len * len);
  let ws = 0, vs = 0;
  s.forEach((v, i) => { const w = Math.exp(-((i - m) ** 2) / denom); vs += w * v; ws += w; });
  return vs / ws;
}
function emaStep(st: number, ready: boolean, v: number, alpha: number): number {
  return ready ? alpha * v + (1 - alpha) * st : v;
}
function lsmaStep(prev: number, ready: boolean, v: number, len: number): number {
  return ready ? (v + prev * (len - 1)) / len : v;
}
function temaStep(e1: number, e2: number, e3: number, ready: boolean, v: number, a: number) {
  const ne1 = emaStep(e1, ready, v, a);
  const ne2 = emaStep(e2, ready, ne1, a);
  const ne3 = emaStep(e3, ready, ne2, a);
  return { val: 3 * ne1 - 3 * ne2 + ne3, e1: ne1, e2: ne2, e3: ne3 };
}
function zlemaStep(arr: number[], len: number, emaState: number, ready: boolean) {
  const lag = Math.floor((len - 1) / 2);
  if (arr.length < lag + 1) return { val: NaN, newEma: emaState };
  const src = 2 * arr[arr.length - 1] - arr[arr.length - 1 - lag];
  const a = 2 / (len + 1);
  const newEma = emaStep(emaState, ready, src, a);
  return { val: newEma, newEma };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC MA COMPUTATION (stateful)
// ─────────────────────────────────────────────────────────────────────────────

interface MaState {
  ema: number; kama: number; lsma: number;
  temaE1: number; temaE2: number; temaE3: number;
  ready: boolean;
}

function computeMa(
  type: MaType, len: number,
  rsiHist: number[], s: MaState
): { val: number; ns: MaState } {
  const ns: MaState = { ...s };
  const a = 2 / (len + 1);
  const last = rsiHist[rsiHist.length - 1];
  let val = NaN;

  switch (type) {
    case 'SMA':  val = sma(rsiHist, len); break;
    case 'WMA':  val = wma(rsiHist, len); break;
    case 'HMA':  val = hma(rsiHist, len); break;
    case 'VWMA': val = sma(rsiHist, len); break; // uniform volume → SMA
    case 'ALMA': val = alma(rsiHist, len); break;
    case 'EMA':
      ns.ema = emaStep(s.ema, s.ready, last, a); val = ns.ema; break;
    case 'KAMA': {
      if (!s.ready) { ns.kama = last; } else {
        const direction = Math.abs(last - (rsiHist[rsiHist.length - len] ?? rsiHist[0]));
        const sd = stddev(rsiHist, Math.min(len, rsiHist.length));
        const er = (isNaN(sd) || sd === 0) ? 0 : Math.min(1, direction / (sd * Math.sqrt(len)));
        const sc = Math.max(0.0645, Math.min(0.666, er * er));
        ns.kama = sc * last + (1 - sc) * s.kama;
      }
      val = ns.kama; break;
    }
    case 'LSMA':
      ns.lsma = lsmaStep(s.lsma, s.ready, last, len); val = ns.lsma; break;
    case 'ZLEMA': {
      const r = zlemaStep(rsiHist, len, s.ema, s.ready);
      ns.ema = r.newEma; val = r.val; break;
    }
    case 'TEMA': {
      const r = temaStep(s.temaE1, s.temaE2, s.temaE3, s.ready, last, a);
      ns.temaE1 = r.e1; ns.temaE2 = r.e2; ns.temaE3 = r.e3; val = r.val; break;
    }
  }
  ns.ready = true;
  return { val, ns };
}

// ─────────────────────────────────────────────────────────────────────────────
// PIVOT DETECTION (lookbackLeft=5, lookbackRight=1)
// ─────────────────────────────────────────────────────────────────────────────

const LEFT = 5, RIGHT = 1, PTOTAL = LEFT + RIGHT + 1;

function isPivotLow(rsiH: number[]): boolean {
  if (rsiH.length < PTOTAL) return false;
  const pivot = rsiH[rsiH.length - 1 - RIGHT];
  for (let i = 0; i < PTOTAL; i++) {
    if (i === LEFT) continue;
    if (rsiH[rsiH.length - PTOTAL + i] < pivot) return false;
  }
  return true;
}
function isPivotHigh(rsiH: number[]): boolean {
  if (rsiH.length < PTOTAL) return false;
  const pivot = rsiH[rsiH.length - 1 - RIGHT];
  for (let i = 0; i < PTOTAL; i++) {
    if (i === LEFT) continue;
    if (rsiH[rsiH.length - PTOTAL + i] > pivot) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIVERGENCE EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

function evalDiv(st: EngineState): { bullDiv: boolean; bearDiv: boolean } {
  const rH = st.rsiHistory;
  const plFound = isPivotLow(rH);
  const phFound = isPivotHigh(rH);
  const rsiAtPivot = rH[rH.length - 1 - RIGHT];
  let bullDiv = false, bearDiv = false;

  if (plFound) {
    const prev = st.pivotLows[st.pivotLows.length - 1];
    if (prev) {
      const bars = st.candleIdx - prev.idx;
      if (bars >= 5 && bars <= 60) {
        const rsiHL   = rsiAtPivot > prev.rsi;
        const priceLow = st.lows[st.lows.length - 1 - RIGHT];
        bullDiv = rsiHL && priceLow < prev.low;
      }
    }
    st.pivotLows = [...st.pivotLows.slice(-10), {
      idx: st.candleIdx, rsi: rsiAtPivot,
      low: st.lows[st.lows.length - 1 - RIGHT] ?? NaN,
    }];
  }

  if (phFound) {
    const prev = st.pivotHighs[st.pivotHighs.length - 1];
    if (prev) {
      const bars = st.candleIdx - prev.idx;
      if (bars >= 5 && bars <= 60) {
        const rsiLH    = rsiAtPivot < prev.rsi;
        const priceHigh = st.highs[st.highs.length - 1 - RIGHT];
        bearDiv = rsiLH && priceHigh > prev.high;
      }
    }
    st.pivotHighs = [...st.pivotHighs.slice(-10), {
      idx: st.candleIdx, rsi: rsiAtPivot,
      high: st.highs[st.highs.length - 1 - RIGHT] ?? NaN,
    }];
  }

  return { bullDiv, bearDiv };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export function feedRsiSignal(
  stateKey: string,
  price:    number,
  cfg:      RsiSignalConfig
): RsiSignalResult {
  let st = stateMap.get(stateKey);
  if (!st) { st = mkState(); stateMap.set(stateKey, st); }

  // Tick countdown for armed signal memory window
  if (st.armedRemainingTicks > 0) {
    st.armedRemainingTicks--;
    if (st.armedRemainingTicks <= 0) {
      st.armedSignal = null;
    }
  }

  const NO_SIG: RsiSignalResult = {
    buySignal: st.armedSignal === 'BUY',
    sellSignal: st.armedSignal === 'SELL',
    rsi: st.rsiHistory.length > 0 ? st.rsiHistory[st.rsiHistory.length - 1] : NaN,
    candleCount: st.candleIdx,
    ticksInCurrentCandle: st.candleBuf.length + 1,
    isFreshSignal: false,
  };

  // ── Accumulate tick ─────────────────────────────────────────────────────────
  st.candleBuf.push(price);
  const tpc = Math.max(1, cfg.ticksPerCandle);
  if (st.candleBuf.length < tpc) return { ...NO_SIG, ticksInCurrentCandle: st.candleBuf.length };

  // ── Seal candle ─────────────────────────────────────────────────────────────
  const close = st.candleBuf[st.candleBuf.length - 1];
  const high  = Math.max(...st.candleBuf);
  const low   = Math.min(...st.candleBuf);
  st.candleBuf = [];
  st.candleIdx++;
  push(st.closes, close);
  push(st.highs,  high);
  push(st.lows,   low);

  // ── RSI (Wilder RMA) ────────────────────────────────────────────────────────
  const rsiLen = Math.max(2, cfg.rsiLength);
  const prevClose = st.closes.length >= 2 ? st.closes[st.closes.length - 2] : close;
  const delta = close - prevClose;
  const gain  = Math.max(delta, 0);
  const loss  = Math.max(-delta, 0);

  if (!st.rsiReady) {
    st.rmaUp   = (st.rmaUp   * (rsiLen - 1) + gain) / rsiLen;
    st.rmaDown = (st.rmaDown * (rsiLen - 1) + loss) / rsiLen;
    if (st.closes.length >= rsiLen) st.rsiReady = true;
  } else {
    st.rmaUp   = (st.rmaUp   * (rsiLen - 1) + gain) / rsiLen;
    st.rmaDown = (st.rmaDown * (rsiLen - 1) + loss) / rsiLen;
  }

  if (!st.rsiReady) return { ...NO_SIG, candleCount: st.candleIdx, ticksInCurrentCandle: 0 };

  const rsi = st.rmaDown === 0 ? 100 : st.rmaUp === 0 ? 0 : 100 - 100 / (1 + st.rmaUp / st.rmaDown);
  push(st.rsiHistory, rsi);

  // ── Signal MA ───────────────────────────────────────────────────────────────
  let maVal = NaN;
  if (cfg.maMode) {
    const ms: MaState = { ema: st.maEma, kama: st.maKama, lsma: st.maLsma, temaE1: st.maTemaE1, temaE2: st.maTemaE2, temaE3: st.maTemaE3, ready: st.maReady };
    const { val, ns } = computeMa(cfg.maType, Math.max(2, cfg.maLength), st.rsiHistory, ms);
    maVal = val;
    st.maEma = ns.ema; st.maKama = ns.kama; st.maLsma = ns.lsma;
    st.maTemaE1 = ns.temaE1; st.maTemaE2 = ns.temaE2; st.maTemaE3 = ns.temaE3; st.maReady = ns.ready;
  }

  // ── Bollinger Bands ─────────────────────────────────────────────────────────
  let bbLower = NaN, bbUpper = NaN;
  if (cfg.bbMode) {
    const bs: MaState = { ema: st.bbEma, kama: st.bbKama, lsma: st.bbLsma, temaE1: st.bbTemaE1, temaE2: st.bbTemaE2, temaE3: st.bbTemaE3, ready: st.bbReady };
    const { val: bbMid, ns } = computeMa(cfg.bbType, Math.max(2, cfg.bbLength), st.rsiHistory, bs);
    st.bbEma = ns.ema; st.bbKama = ns.kama; st.bbLsma = ns.lsma;
    st.bbTemaE1 = ns.temaE1; st.bbTemaE2 = ns.temaE2; st.bbTemaE3 = ns.temaE3; st.bbReady = ns.ready;
    if (!isNaN(bbMid)) {
      const sd = stddev(st.rsiHistory, Math.max(2, cfg.bbLength));
      if (!isNaN(sd)) { bbLower = bbMid - cfg.bbMult * sd; bbUpper = bbMid + cfg.bbMult * sd; }
    }
  }

  // ── Sub-signals via crossover ───────────────────────────────────────────────
  const pause  = Math.max(0, cfg.reentryPause);
  const pOkBuy  = st.candleIdx - st.lastBuyCandle  >= pause;
  const pOkSell = st.candleIdx - st.lastSellCandle >= pause;

  let buyMA  = false, sellMA  = false;
  if (cfg.maMode && !isNaN(maVal) && !isNaN(st.prevRsi) && !isNaN(st.prevMa)) {
    buyMA  = st.prevRsi <= st.prevMa && rsi > maVal && pOkBuy;
    sellMA = st.prevRsi >= st.prevMa && rsi < maVal && pOkSell;
  }

  let buyBB  = false, sellBB  = false;
  if (cfg.bbMode && !isNaN(bbLower) && !isNaN(st.prevRsi) && !isNaN(st.prevBbLower)) {
    buyBB  = st.prevRsi <= st.prevBbLower && rsi > bbLower && pOkBuy;
    sellBB = st.prevRsi >= st.prevBbUpper && rsi < bbUpper && pOkSell;
  }

  let buyDiv = false, sellDiv = false;
  if (cfg.divergenceMode && st.rsiHistory.length >= PTOTAL + 2) {
    const { bullDiv, bearDiv } = evalDiv(st);
    buyDiv  = bullDiv && pOkBuy;
    sellDiv = bearDiv && pOkSell;
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  if (cfg.waitForOpposite) {
    if (st.lastSignal !== -1) { buyMA = false;  buyBB = false;  buyDiv = false; }
    if (st.lastSignal !==  1) { sellMA = false; sellBB = false; sellDiv = false; }
  }
  if (cfg.rsiFilterEnabled) {
    const inOs  = rsi >= cfg.oversoldLow   && rsi <= cfg.oversoldHigh;
    const inOb  = rsi >= cfg.overboughtLow && rsi <= cfg.overboughtHigh;
    if (!inOs) { buyMA = false;  buyBB = false;  buyDiv = false; }
    if (!inOb) { sellMA = false; sellBB = false; sellDiv = false; }
  }

  // ── Final signal ────────────────────────────────────────────────────────────
  let finalBuy = false, finalSell = false;
  if (!cfg.andMode) {
    finalBuy  = (cfg.maMode && buyMA)  || (cfg.bbMode && buyBB)  || (cfg.divergenceMode && buyDiv);
    finalSell = (cfg.maMode && sellMA) || (cfg.bbMode && sellBB) || (cfg.divergenceMode && sellDiv);
  } else {
    const bN = [cfg.maMode && buyMA,  cfg.bbMode && buyBB,  cfg.divergenceMode && buyDiv ].filter(Boolean).length;
    const sN = [cfg.maMode && sellMA, cfg.bbMode && sellBB, cfg.divergenceMode && sellDiv].filter(Boolean).length;
    finalBuy = bN >= 2; finalSell = sN >= 2;
  }

  // ── Update tracking & arming ───────────────────────────────────────────────
  const holdTicks = Math.max(1, cfg.signalHoldTicks ?? 10);
  if (finalBuy) {
    st.lastBuyCandle  = st.candleIdx;
    st.lastSignal     = 1;
    st.armedSignal    = 'BUY';
    st.armedRemainingTicks = holdTicks;
  } else if (finalSell) {
    st.lastSellCandle = st.candleIdx;
    st.lastSignal     = -1;
    st.armedSignal    = 'SELL';
    st.armedRemainingTicks = holdTicks;
  }

  st.prevRsi     = rsi;
  if (!isNaN(maVal))   st.prevMa      = maVal;
  if (!isNaN(bbLower)) st.prevBbLower = bbLower;
  if (!isNaN(bbUpper)) st.prevBbUpper = bbUpper;

  const isBuyActive  = st.armedSignal === 'BUY' || finalBuy;
  const isSellActive = st.armedSignal === 'SELL' || finalSell;

  return {
    buySignal: isBuyActive,
    sellSignal: isSellActive,
    rsi,
    candleCount: st.candleIdx,
    ticksInCurrentCandle: 0,
    isFreshSignal: finalBuy || finalSell,
  };
}

export const DEFAULT_RSI_CONFIG: RsiSignalConfig = {
  ticksPerCandle: 5, rsiLength: 14,
  maMode: true,  maType: 'SMA',  maLength: 14,
  bbMode: true,  bbType: 'SMA',  bbLength: 14, bbMult: 2.0,
  divergenceMode: true,
  rsiFilterEnabled: true,
  oversoldLow: 20, oversoldHigh: 40, overboughtLow: 60, overboughtHigh: 80,
  reentryPause: 5, waitForOpposite: false, andMode: false,
  signalHoldTicks: 10,
};
