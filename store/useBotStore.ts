/**
 * useBotStore — LaxPrime bot engine + persistence
 *
 * Settings (stake, strategies, markets, etc.) are persisted to localStorage via
 * Zustand's `persist` middleware.  The bot engine (runScan) registers a single
 * `onTick` listener at module level so execution continues even when the user
 * navigates to another page within the same SPA session.
 *
 * On hard-reload, `isRunning` starts as `false` (safe) but all settings are
 * restored automatically from localStorage.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useScannerStore } from './useScannerStore';
import { useDerivStore } from './useDerivStore';
import { tradeWS } from '../lib/deriv/trade-ws';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (exported so page.tsx can import them)
// ─────────────────────────────────────────────────────────────────────────────

export interface PatternTrigger {
  token: string;    // E | O | V | U | M | D | SE | SO | R | F
  barrier?: number; // Only for V (Over) and U (Under)
}

export interface PatternBox {
  triggers: PatternTrigger[];
}

export interface Condition {
  id: string;
  type: 'EVEN_PCT' | 'ODD_PCT' | 'LAST_DIGITS' | 'GREEN_BAR' | 'DIGIT_PATTERN';
  comparator: string;
  value: number;
  lastN: number;
  digitValue: string;
  barComparator: string;
  barValue: number;
  join: 'AND' | 'OR';
  period: number;
  pattern: string[];
  patternRetrigger: string;
  digitBarrier?: number;
  patternBoxes?: PatternBox[];         // Multi-Entry Sequence (OR across boxes, AND within)
  useCustomContracts?: boolean;        // DIGIT_PATTERN only: override trade contracts per loss step
  customContracts?: { type: string; barrier: number }[]; // Trade contract per loss step
}

export interface Strategy {
  id: string;
  conditions: Condition[];
  tradeType: string;
  prediction: number;
  ticks: number;
  enabled: boolean;
  tradePattern: boolean[];
  useTradePattern: boolean;
  noContradiction: boolean;
}

export interface TradeLog {
  id: string;
  time: number;
  symbol: string;
  strategyIndex: number;
  contract: string;
  stake: number;
  result: 'SENT' | 'BUYING...' | 'RUNNING...' | 'WON' | 'LOST' | 'ERROR' | 'RUNNING' | 'VIRTUAL' | 'VIRT WON' | 'VIRT LOST';
  profit: number;
  entrySpot: string;
  exitSpot: string;
  step: number;
}

interface PerStrategyState {
  currentStake: number;
  lossCount: number;
  totalProfit: number;
  won: number;
  lost: number;
  lastTriggerMarket: string;
  cooldown: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS (exported)
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_MARKETS = [
  { value: '1HZ10V',  label: 'V10(1s)'  },
  { value: '1HZ25V',  label: 'V25(1s)'  },
  { value: '1HZ50V',  label: 'V50(1s)'  },
  { value: '1HZ75V',  label: 'V75(1s)'  },
  { value: '1HZ100V', label: 'V100(1s)' },
  { value: 'R_10',    label: 'V10'      },
  { value: 'R_25',    label: 'V25'      },
  { value: 'R_50',    label: 'V50'      },
  { value: 'R_75',    label: 'V75'      },
  { value: 'R_100',   label: 'V100'     },
  { value: 'JD10',    label: 'Jump 10'  },
  { value: 'JD25',    label: 'Jump 25'  },
  { value: 'JD50',    label: 'Jump 50'  },
  { value: 'JD75',    label: 'Jump 75'  },
  { value: 'JD100',   label: 'Jump 100' },
];

export const TRADE_OPTIONS = [
  { value: 'DIGITEVEN',  label: 'EVEN'      },
  { value: 'DIGITODD',   label: 'ODD'       },
  { value: 'DIGITOVER',  label: '>(OVER)'   },
  { value: 'DIGITUNDER', label: '<(UNDER)'  },
  { value: 'DIGITMATCH', label: '=(MATCH)'  },
  { value: 'DIGITDIFF',  label: '≠(DIFF)'   },
  { value: 'CALL',       label: 'RISE'      },
  { value: 'PUT',        label: 'FALL'      },
];

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY HELPERS (exported)
// ─────────────────────────────────────────────────────────────────────────────

export function createCondition(): Condition {
  return {
    id: Math.random().toString(36).slice(2, 9),
    type: 'EVEN_PCT',
    comparator: '>',
    value: 60,
    lastN: 4,
    digitValue: 'EVEN',
    barComparator: '>=',
    barValue: 5,
    join: 'AND',
    period: 100,
    pattern: ['E', 'E', 'E', 'E'],
    patternRetrigger: 'any',
    patternBoxes: [
      { triggers: [{ token: 'U', barrier: 7 }, { token: 'E' }] }, // Box 1: last digit U7 AND before that E
      { triggers: [{ token: 'V', barrier: 2 }] },                  // Box 2: last digit V2
    ],
    useCustomContracts: false,
    customContracts: [
      { type: 'DIGITUNDER', barrier: 7 }, // Loss step 1
      { type: 'DIGITOVER',  barrier: 2 }, // Loss step 2
      { type: 'DIGITMATCH', barrier: 5 }, // Loss step 3
      { type: 'DIGITOVER',  barrier: 0 }, // Loss step 4
    ],
  };
}

export function createStrategy(_index: number): Strategy {
  return {
    id: Math.random().toString(36).slice(2, 9),
    conditions: [createCondition()],
    tradeType: 'DIGITEVEN',
    prediction: 4,
    ticks: 1,
    enabled: true,
    tradePattern: [true, true, true, true],
    useTradePattern: false,
    noContradiction: true,
  };
}

export function needsBarrier(contractType: string): boolean {
  return (
    contractType === 'DIGITOVER'  ||
    contractType === 'DIGITUNDER' ||
    contractType === 'DIGITMATCH' ||
    contractType === 'DIGITDIFF'
  );
}

export function checkIsOpposite(contractType: string, prediction: number, digit: number, quote: number, prevQuote: number): boolean {
  switch (contractType) {
    case 'DIGITEVEN':  return digit % 2 === 0;
    case 'DIGITODD':   return digit % 2 !== 0;
    case 'DIGITOVER':  return digit > prediction;
    case 'DIGITUNDER': return digit <= prediction;
    case 'DIGITMATCH': return digit === prediction;
    case 'DIGITDIFF':  return digit !== prediction;
    case 'CALL':       return quote > prevQuote;
    case 'PUT':        return quote < prevQuote;
    default:           return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE EVALUATORS (private)
// ─────────────────────────────────────────────────────────────────────────────

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>':  return a > b;
    case '<':  return a < b;
    case '=':  return a === b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default:   return false;
  }
}

function matchPatternToken(token: string, digits: number[], quotes: number[], idx: number): boolean {
  const d    = digits[idx];
  const prev = digits[idx - 1];
  const q    = quotes[idx];
  const pq   = quotes[idx - 1];
  switch (token) {
    case 'E':  return d % 2 === 0;
    case 'O':  return d % 2 !== 0;
    case 'D':  return idx > 0 && d !== prev;
    case 'M':  return idx > 0 && d === prev;
    case 'V':  return d > 4;
    case 'U':  return d <= 4;
    case 'SE': return d % 2 === 0 && idx > 0 && d === prev;
    case 'SO': return d % 2 !== 0 && idx > 0 && d === prev;
    case 'R':  return idx > 0 && q > pq;
    case 'F':  return idx > 0 && q < pq;
    default:   return false;
  }
}

/** Match a single PatternTrigger against the digit/quote at history position idx */
function matchTrigger(
  trig: PatternTrigger,
  dSlice: number[],
  qSlice: number[],
  idx: number
): boolean {
  const d  = dSlice[idx];
  const pd = dSlice[idx - 1];
  const q  = qSlice[idx];
  const pq = qSlice[idx - 1];
  const b  = trig.barrier ?? 4;
  switch (trig.token) {
    case 'E':  return d % 2 === 0;
    case 'O':  return d % 2 !== 0;
    case 'D':  return idx > 0 && d !== pd;
    case 'M':  return idx > 0 && d === pd;
    case 'V':  return d > b;
    case 'U':  return d <= b;
    case 'SE': return d % 2 === 0 && idx > 0 && d === pd;
    case 'SO': return d % 2 !== 0 && idx > 0 && d === pd;
    case 'R':  return idx > 0 && q > pq;
    case 'F':  return idx > 0 && q < pq;
    default:   return false;
  }
}

function evaluateDigitPattern(cond: Condition, digits: number[], quotes: number[]): boolean {
  const boxes = cond.patternBoxes;

  // ── Multi-Entry Sequence (new format) ──────────────────────────────────────
  if (boxes && boxes.length > 0) {
    // Each Box is an alternative sequence (OR across boxes)
    for (const box of boxes) {
      const triggers = box.triggers;
      if (!triggers || triggers.length === 0) continue;
      const n = triggers.length;
      // Need at least n+1 history points for idx-1 comparisons
      if (digits.length < n + 1) continue;

      // Take the last n digits (and n+1 quotes for direction comparisons)
      const dSlice = digits.slice(-(n + 1));   // length = n+1
      const qSlice = quotes.slice(-(n + 1));

      // triggers[0] matches dSlice[1] (most-recent - (n-1) positions back)
      // triggers[n-1] matches dSlice[n] (most recent digit)
      let allMatch = true;
      for (let i = 0; i < n; i++) {
        if (!matchTrigger(triggers[i], dSlice, qSlice, i + 1)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return true; // OR: any box matching fires the condition
    }
    return false;
  }

  // ── Legacy string-pattern fallback ────────────────────────────────────────
  const pat = cond.pattern;
  if (!pat || pat.length === 0) return false;
  const n = pat.length;
  if (digits.length < n + 1) return false;
  const dSlice = digits.slice(-(n + 1));
  const qSlice = quotes.slice(-(n + 1));
  for (let i = 0; i < n; i++) {
    if (!matchPatternToken(pat[i], dSlice, qSlice, i + 1)) return false;
  }
  return true;
}

function evaluateCondition(cond: Condition, digits: number[], quotes: number[]): boolean {
  const period = Math.max(1, cond.period || 100);
  switch (cond.type) {
    case 'EVEN_PCT': {
      const sub = digits.slice(-period);
      if (sub.length < period) return false;
      const pct = (sub.filter(d => d % 2 === 0).length / period) * 100;
      return compare(pct, cond.comparator, cond.value);
    }
    case 'ODD_PCT': {
      const sub = digits.slice(-period);
      if (sub.length < period) return false;
      const pct = (sub.filter(d => d % 2 !== 0).length / period) * 100;
      return compare(pct, cond.comparator, cond.value);
    }
    case 'LAST_DIGITS': {
      const n = Math.max(1, cond.lastN);
      const lastN = digits.slice(-n);
      if (lastN.length < n) return false;
      const lastQ = quotes.slice(-(n + 1));
      const moves: ('R' | 'F')[] = [];
      for (let i = 1; i < lastQ.length; i++) moves.push(lastQ[i] > lastQ[i - 1] ? 'R' : 'F');
      switch (cond.digitValue) {
        case 'EVEN':       return lastN.every(d => d % 2 === 0);
        case 'ODD':        return lastN.every(d => d % 2 !== 0);
        case 'OVER':       return lastN.every(d => d > (cond.digitBarrier ?? 4));
        case 'UNDER':      return lastN.every(d => d <= (cond.digitBarrier ?? 4));
        case 'EQUAL':      return lastN.every(d => d === (cond.digitBarrier ?? lastN[0]));
        case 'RISE':
        case 'ONLY_UPS':   return moves.length >= n && moves.slice(-n).every(m => m === 'R');
        case 'FALL':
        case 'ONLY_DOWNS': return moves.length >= n && moves.slice(-n).every(m => m === 'F');
        default:           return false;
      }
    }
    case 'GREEN_BAR': {
      const sub = digits.slice(-period);
      if (sub.length < period) return false;
      const freq = Array(10).fill(0);
      sub.forEach(d => { if (d >= 0 && d <= 9) freq[d]++; });
      let maxFreq = -1, greenBar = -1;
      for (let d = 0; d <= 9; d++) { if (freq[d] > maxFreq) { maxFreq = freq[d]; greenBar = d; } }
      if (greenBar !== cond.barValue) return false;
      return compare((maxFreq / period) * 100, cond.comparator, cond.value);
    }
    case 'DIGIT_PATTERN':
      return evaluateDigitPattern(cond, digits, quotes);
    default:
      return false;
  }
}

function evalStrategy(s: Strategy, digits: number[], quotes: number[]): boolean {
  if (digits.length < 5) return false;
  if (!s.conditions.length) return false;
  let result = evaluateCondition(s.conditions[0], digits, quotes);
  for (let i = 1; i < s.conditions.length; i++) {
    const c = s.conditions[i];
    const v = evaluateCondition(c, digits, quotes);
    result = c.join === 'AND' ? result && v : result || v;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-SCOPE MUTABLE ENGINE STATE
// These live outside React/Zustand so they survive page navigation.
// ─────────────────────────────────────────────────────────────────────────────

const eng = {
  strategyState: {} as Record<string, PerStrategyState>,
  cooldown:      {} as Record<string, number>,
  activeTrades:  new Map<string, { stratId: string; symbol: string; stake: number; startTime: number }>(),
  activeVirtual: [] as any[],
  patternPos:    {} as Record<string, number>,
  retrigger:     {} as Record<string, { lastWasTrue: boolean; waitingForOpposite: boolean }>,
  waitingForOpposite: {} as Record<string, any>,
  // Cross-market 1.5s gap: prevents 2 different markets firing at exactly the same time
  lastTradeTime: 0,
};

// Single onTick subscription handle — registered once, lives forever
let _onTickUnsub: (() => void) | null = null;

// ── Trade Retry Queue ─────────────────────────────────────────────────────────
interface QueuedTrade {
  params: any;
  stratId: string;
  symbol: string;
  si: number;
  tradeStake: number;
  contractType: string;
  barrier: number | undefined;
  label: string;
  mLabel: string;
  entryDigit: number;
  lossCount: number;
  retries: number;
}
const _tradeQueue: QueuedTrade[] = [];
let _tradeQueueTimer: ReturnType<typeof setInterval> | null = null;

// Exported set of requestIds placed by the bot — lets the UI read from Deriv store directly (instant)
export const botTradeIds = new Set<string>();

function _startTradeQueue() {
  if (_tradeQueueTimer) return;
  _tradeQueueTimer = setInterval(() => {
    if (_tradeQueue.length === 0) return;
    const item = _tradeQueue[0];
    // Only retry if bot is still running
    if (!useBotStore.getState().isRunning) { _tradeQueue.shift(); return; }
    const requestId = tradeWS.executeDirectTrade(item.params);
    if (requestId) {
      _tradeQueue.shift();
      const now = Date.now();
      botTradeIds.add(requestId);
      eng.activeTrades.set(requestId, { stratId: item.stratId, symbol: item.symbol, stake: item.tradeStake, startTime: now });
      eng.cooldown[`${item.stratId}_${item.symbol}`] = now;
      eng.lastTradeTime = now;
      useBotStore.getState().addLog({
        id: requestId, time: now, symbol: item.symbol, strategyIndex: item.si,
        contract: item.contractType, stake: item.tradeStake,
        result: 'SENT', profit: 0,
        entrySpot: String(item.entryDigit),
        exitSpot: '-',
        step: item.lossCount + 1,
      });
      useBotStore.getState().set_status(`✓ Sent: ${item.label} on ${item.mLabel}`);
    }
    // If socket not ready: silently wait (no drop, no counter — socket will reconnect automatically)
  }, 150); // 150ms — near-instant recovery once socket reopens
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

interface BotStoreState {
  // ── Persisted settings ─────────────────────────────────────────────────────
  stake:          string;
  targetProfit:   string;
  targetProfitMode: 'profit' | 'wins';
  stopLoss:       string;
  stopLossMode:   'loss' | 'losses';
  martingale:     string;
  tradingMode:    string;
  strategies:     Strategy[];
  selectedMarkets: string[];
  theme:          'dark' | 'light';

  // ── Session state (NOT persisted) ─────────────────────────────────────────
  isRunning:    boolean;
  botStatusMsg: string;
  lastSignal:   string;
  tradeLogs:    TradeLog[];
  globalStats:  { won: number; lost: number; totalProfit: number; totalTrades: number };
  signalFlash:  Record<string, number>;   // symbol → timestamp of last signal

  // ── Settings setters ───────────────────────────────────────────────────────
  setStake:           (v: string) => void;
  setTargetProfit:    (v: string) => void;
  setTargetProfitMode: (mode: 'profit' | 'wins') => void;
  setStopLoss:        (v: string) => void;
  setStopLossMode:    (mode: 'loss' | 'losses') => void;
  setMartingale:      (v: string) => void;
  setTradingMode:     (v: string) => void;
  setStrategies:      (s: Strategy[] | ((p: Strategy[]) => Strategy[])) => void;
  setSelectedMarkets: (m: string[] | ((p: string[]) => string[])) => void;
  setTheme:           (theme: 'dark' | 'light') => void;

  // ── Bot controls ───────────────────────────────────────────────────────────
  startBot:   () => void;
  stopBot:    (reason?: string) => void;
  resetAll:   () => void;
  set_status: (msg: string) => void;

  // ── Log helpers ────────────────────────────────────────────────────────────
  addLog:    (log: TradeLog) => void;
  updateLog: (id: string, patch: Partial<TradeLog>) => void;

  // ── Internal (called by engine / tradeWS listener) ─────────────────────────
  _runScan:           (symbol: string) => void;
  _handleTradeEvent:  (type: string, data: any) => void;
  _flashSignal:       (symbol: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const useBotStore = create<BotStoreState>()(
  persist(
    (set, get) => ({

      // ── Defaults ─────────────────────────────────────────────────────────────
      stake:           '1',
      targetProfit:    '100',
      targetProfitMode: 'profit',
      stopLoss:        '100',
      stopLossMode:    'loss',
      martingale:      '2.1',
      tradingMode:     'continuous',
      strategies:      [createStrategy(0)],
      selectedMarkets: ['1HZ10V', 'R_10', '1HZ25V', 'R_25', '1HZ50V', '1HZ75V'],
      theme:           'dark',

      isRunning:    false,
      botStatusMsg: 'Ready.',
      lastSignal:   '',
      tradeLogs:    [],
      globalStats:  { won: 0, lost: 0, totalProfit: 0, totalTrades: 0 },
      signalFlash:  {},

      // ── Setters ───────────────────────────────────────────────────────────────
      setStake:           (v) => set({ stake: v }),
      setTargetProfit:    (v) => set({ targetProfit: v }),
      setTargetProfitMode: (mode) => set({ targetProfitMode: mode }),
      setStopLoss:        (v) => set({ stopLoss: v }),
      setStopLossMode:    (mode) => set({ stopLossMode: mode }),
      setMartingale:      (v) => set({ martingale: v }),
      setTradingMode:     (v) => set({ tradingMode: v }),
      setStrategies: (s) => set(state => ({
        strategies: typeof s === 'function' ? s(state.strategies) : s,
      })),
      setSelectedMarkets: (m) => set(state => ({
        selectedMarkets: typeof m === 'function' ? m(state.selectedMarkets) : m,
      })),
      setTheme:           (theme) => set({ theme }),

      addLog: (log) => set(state => ({
        tradeLogs: [log, ...state.tradeLogs].slice(0, 50),
      })),
      updateLog: (id, patch) => set(state => ({
        tradeLogs: state.tradeLogs.map(l => l.id === id ? { ...l, ...patch } : l),
      })),

      _flashSignal: (symbol) => {
        const ts = Date.now();
        set(state => ({ signalFlash: { ...state.signalFlash, [symbol]: ts } }));
      },


      // ── Bot controls ─────────────────────────────────────────────────────────

      startBot: () => {
        // Reset mutable engine state on each start
        eng.strategyState = {};
        eng.cooldown      = {};
        eng.activeTrades.clear();
        eng.activeVirtual = [];
        eng.patternPos    = {};
        eng.retrigger     = {};
        eng.waitingForOpposite = {};
        botTradeIds.clear();

        // Proactively connect/ensure the trade socket is open
        if (typeof window !== 'undefined') {
          tradeWS.connect();
          _startTradeQueue();
          // Defensively ensure the socket event listener is bound to the latest store
          tradeWS.offEvent(onTradeWSEvent);
          tradeWS.onEvent(onTradeWSEvent);
        }

        set({ isRunning: true, botStatusMsg: 'Running. Waiting for conditions...', lastSignal: '' });

        // Register the onTick listener ONCE (idempotent across navigation)
        if (!_onTickUnsub) {
          _onTickUnsub = useScannerStore.getState().onTick((symbol) => {
            get()._runScan(symbol);
          });
        }
      },

      stopBot: (reason?: string) => {
        set({ isRunning: false, botStatusMsg: reason ? `Stopped: ${reason}` : 'Bot stopped.' });
        // NOTE: _onTickUnsub stays registered — _runScan's first guard checks isRunning.
        // This means the listener is cheap to keep alive: it just returns immediately.
      },

      resetAll: () => {
        get().stopBot();
        eng.strategyState = {};
        eng.cooldown      = {};
        eng.activeTrades.clear();
        eng.activeVirtual = [];
        eng.patternPos    = {};
        eng.retrigger     = {};
        eng.waitingForOpposite = {};
        eng.lastTradeTime = 0;
        _tradeQueue.length = 0;
        botTradeIds.clear();
        set({
          // Clear session data
          tradeLogs:   [],
          globalStats: { won: 0, lost: 0, totalProfit: 0, totalTrades: 0 },
          botStatusMsg: 'Ready.',
          lastSignal:   '',
          signalFlash:  {},
          // Reset all trading settings to defaults
          stake:            '1',
          targetProfit:     '100',
          targetProfitMode: 'profit',
          stopLoss:         '100',
          stopLossMode:     'loss',
          martingale:       '2.1',
          tradingMode:      'continuous',
        });
      },


      set_status: (msg: string) => set({ botStatusMsg: msg }),

      // ── Core scan engine ─────────────────────────────────────────────────────

      _runScan: (symbol: string) => {
        const state = get();
        if (!state.isRunning) return;
        if (!state.selectedMarkets.includes(symbol)) return;

        const derivState = useDerivStore.getState();
        const isVirtual  = derivState.virtualSettings.isVirtualMode;
        // For real mode: we allow scanning even if not yet authorized — trades queue up
        // and retry until the socket is ready. Only block if we have no token at all.
        if (!isVirtual && !derivState.account?.token && !derivState.token) return;

        const now      = Date.now();
        const baseStake = parseFloat(state.stake) || 0.35;
        const { strategies, martingale, tradingMode, targetProfit, stopLoss } = state;
        const account  = derivState.account;

        // ── Settle pending virtual trades for this symbol ─────────────────────
        const remaining: any[] = [];
        const resolved:  any[] = [];

        for (const vt of eng.activeVirtual) {
          if (vt.symbol !== symbol) { remaining.push(vt); continue; }
          const regime = useScannerStore.getState().marketRegimes[symbol];
          if (!regime) { remaining.push(vt); continue; }
          const lastEpoch = regime.lastEpoch || 0;
          if (lastEpoch <= vt.lastEpoch) { remaining.push(vt); continue; }

          vt.ticksCount++;
          vt.lastEpoch = lastEpoch;

          if (vt.ticksCount >= vt.duration) {
            const rDigits  = (regime.digits  || []) as number[];
            const rQuotes  = (regime.quotes  || []) as number[];
            const exitDigit = rDigits[rDigits.length - 1] ?? 0;
            const exitPrice = rQuotes[rQuotes.length - 1] ?? 0;
            let win = false;
            switch (vt.contractType) {
              case 'DIGITEVEN':  win = exitDigit % 2 === 0; break;
              case 'DIGITODD':   win = exitDigit % 2 !== 0; break;
              case 'DIGITOVER':  win = exitDigit > (vt.barrier ?? 4); break;
              case 'DIGITUNDER': win = exitDigit <= (vt.barrier ?? 4); break;
              case 'DIGITMATCH': win = exitDigit === (vt.barrier ?? 0); break;
              case 'DIGITDIFF':  win = exitDigit !== (vt.barrier ?? 0); break;
              case 'CALL':       win = exitPrice > vt.entryPrice; break;
              case 'PUT':        win = exitPrice < vt.entryPrice; break;
            }
            resolved.push({ ...vt, isWin: win, exitDigit, exitPrice });
          } else {
            remaining.push(vt);
          }
        }
        eng.activeVirtual = remaining;

        for (const rt of resolved) {
          const { requestId: vtId, stratId, symbol: vtSym, stake: vtStake, isWin, exitDigit, exitPrice } = rt;
          const ss = eng.strategyState[stratId];
          if (!ss) continue;

          const resultProfit = isWin ? vtStake * 0.95 : -vtStake;

          // Update virtual log with result — NOT counted in real globalStats
          get().updateLog(vtId, {
            result:   isWin ? 'VIRT WON' : 'VIRT LOST',
            profit:   resultProfit,
            exitSpot: String(exitDigit),
          });

          // ── Virtual-only stats (do NOT touch globalStats / real P/L) ────
          // NOTE: Virtual results do NOT affect martingale stake or lossCount.
          // Martingale only tracks real trade results so virtual testing
          // cannot distort the real betting progression.
          if (isWin) {
            ss.won++; ss.totalProfit += resultProfit;
            // Do NOT reset lossCount or currentStake — those belong to real martingale
            eng.patternPos[stratId] = 0;            // reset pipeline on virtual win
          } else {
            ss.lost++; ss.totalProfit += resultProfit;
            // Do NOT increment lossCount or double currentStake — virtual loss
            // must not affect real trade martingale progression
          }


          // Virtual streak tracking → auto-switch to real
          const vsV = derivState.virtualSettings;
          let { vConsecWins, vConsecLosses, virtualWins, virtualLosses } = vsV;
          if (isWin) { vConsecWins++; vConsecLosses = 0; virtualWins++; }
          else        { vConsecWins = 0; vConsecLosses++; virtualLosses++; }

          let newVirtMode = vsV.isVirtualMode;
          if (vsV.startVirtualToReal) {
            const streak = vsV.vTriggerType === 'losses' ? vConsecLosses : vConsecWins;
            if (streak >= vsV.vThreshold) {
              newVirtMode = false;
              set({ botStatusMsg: `Virtual threshold [${vsV.vThreshold}] hit! Switching to REAL.` });
            }
          }
          useDerivStore.getState().setVirtualSettings({
            isVirtualMode: newVirtMode, vConsecWins, vConsecLosses, virtualWins, virtualLosses,
          });

          // Stop if limits hit
          const live = get().globalStats;
          const tpMode = state.targetProfitMode || 'profit';
          const slMode = state.stopLossMode || 'loss';

          if (tpMode === 'wins') {
            if (live.won >= parseInt(targetProfit)) { get().stopBot('Target wins reached!'); return; }
          } else {
            if (live.totalProfit >= parseFloat(targetProfit)) { get().stopBot('Target profit reached!'); return; }
          }

          if (slMode === 'losses') {
            if (live.lost >= parseInt(stopLoss)) { get().stopBot('Stop losses reached!'); return; }
          } else {
            if (live.totalProfit <= -parseFloat(stopLoss)) { get().stopBot('Stop loss reached!'); return; }
          }

          eng.cooldown[`${stratId}_${vtSym}`] = now;
        }

        // ── Evaluate new triggers ─────────────────────────────────────────────
        const regime = useScannerStore.getState().marketRegimes[symbol];
        if (!regime || !regime.historyReady) return;

        const digits = (regime.digits || []) as number[];
        const quotes = (regime.quotes || []) as number[];
        // Each condition handles its own minimum (e.g. LAST_DIGITS needs lastN, EVEN_PCT needs period).
        // Only require 5 digits so that fast conditions (LAST_DIGITS n=4) fire immediately.
        if (digits.length < 5) return;

        for (let si = 0; si < strategies.length; si++) {
          const s = strategies[si];
          if (!s.enabled || !s.conditions.length) continue;

          const stratId = s.id;
          const ck      = `${stratId}_${symbol}`;

          if (!eng.strategyState[stratId]) {
            eng.strategyState[stratId] = {
              currentStake: baseStake, lossCount: 0, totalProfit: 0,
              won: 0, lost: 0, lastTriggerMarket: '', cooldown: false,
            };
          }
          const ss = eng.strategyState[stratId];

          // ── 1-second cooldown per strategy+market ─────────────────────────
          if (now - (eng.cooldown[ck] || 0) < 1000) continue;

          // ── No Contradiction (Wait for Opposite) guard ─────────────────────
          const lock = eng.waitingForOpposite[ck];
          if (s.noContradiction && lock) {
            const currentDigit = digits[digits.length - 1] ?? 0;
            const currentQuote = quotes[quotes.length - 1] ?? 0;
            const prevQuote    = quotes[quotes.length - 2] ?? 0;

            const lType = typeof lock === 'object' && lock !== null ? lock.contractType : s.tradeType;
            const lPred = typeof lock === 'object' && lock !== null ? lock.prediction : s.prediction;

            const isOpposite = checkIsOpposite(lType, lPred, currentDigit, currentQuote, prevQuote);
            if (isOpposite) {
              eng.waitingForOpposite[ck] = null;
              console.log(`[BotEngine] 🔄 Contradiction Cleared: Opposite digit/state detected (${currentDigit}) on ${symbol}. Resuming scanning.`);
            } else {
              // Still waiting for contradiction to clear
              continue;
            }
          }

          // ── Guard: skip only if there's a VERY recent live trade (within ticks+2 seconds) ─
          // This prevents double-firing on the same signal without blocking indefinitely.
          const guardWindowMs = (s.ticks + 2) * 1200; // generous per-tick window
          const hasRecentReal = [...eng.activeTrades.values()].some(
            t => t.stratId === stratId && t.symbol === symbol && now - t.startTime < guardWindowMs
          );
          const hasVirt = eng.activeVirtual.some(
            t => t.stratId === stratId && t.symbol === symbol
          );
          if (hasRecentReal || hasVirt) continue;
          // Digit pattern retrigger guard
          const dpCond = s.conditions.find(c => c.type === 'DIGIT_PATTERN');
          if (dpCond && dpCond.patternRetrigger !== 'any') {
            const rtKey = `${stratId}_${symbol}`;
            if (!eng.retrigger[rtKey]) {
              eng.retrigger[rtKey] = { lastWasTrue: false, waitingForOpposite: false };
            }
            const rts          = eng.retrigger[rtKey];
            const patNowTrue   = evaluateDigitPattern(dpCond, digits, quotes);

            if (dpCond.patternRetrigger === 'no_contra') {
              if (patNowTrue && rts.lastWasTrue) continue;   // already fired on this edge
              rts.lastWasTrue = patNowTrue;
              if (!patNowTrue) continue;
            } else if (dpCond.patternRetrigger === 'wait_opp') {
              if (patNowTrue) {
                if (rts.waitingForOpposite) continue;
                rts.waitingForOpposite = true;
              } else {
                rts.waitingForOpposite = false;
                continue;
              }
            }
          }

          if (!evalStrategy(s, digits, quotes)) {
            // Reset no_contra edge when pattern clears
            if (dpCond && dpCond.patternRetrigger === 'no_contra') {
              const rtKey = `${stratId}_${symbol}`;
              if (eng.retrigger[rtKey]) eng.retrigger[rtKey].lastWasTrue = false;
            }
            continue;
          }

          // Trade pattern pipeline check
          if (s.useTradePattern && s.tradePattern && s.tradePattern.length > 0) {
            if (eng.patternPos[stratId] === undefined) eng.patternPos[stratId] = 0;
            const pos = eng.patternPos[stratId] % s.tradePattern.length;
            const shouldTrade = s.tradePattern[pos];
            eng.patternPos[stratId] = (pos + 1) % s.tradePattern.length;
            if (!shouldTrade) {
              eng.cooldown[ck] = now;
              const mLabel = ALL_MARKETS.find(m => m.value === symbol)?.label || symbol;
              set({ botStatusMsg: `⏭ Pattern SKIP: Strategy ${si + 1} on ${mLabel} (pos ${pos + 1})` });
              continue;
            }
          }

          // ── TRIGGER FIRED ─────────────────────────────────────────────────
          get()._flashSignal(symbol);

          // Set contradiction lock if enabled - will be set below once contractType is resolved

          // Enforce 2 decimal places strictly on the stake
          const rawStake = Math.max(0.35, ss.currentStake);
          const tradeStake = Math.round(rawStake * 100) / 100;

          let contractType = s.tradeType;
          let barrier      = needsBarrier(contractType) ? s.prediction : undefined;

          // Use custom contracts from the DIGIT_PATTERN condition (if any)
          // dpCond is already declared above for retrigger logic
          const dpCondCC = s.conditions.find(c => c.type === 'DIGIT_PATTERN');
          if (dpCondCC?.useCustomContracts && dpCondCC.customContracts && dpCondCC.customContracts.length > 0) {
            const stepIndex = Math.min(ss.lossCount, dpCondCC.customContracts.length - 1);
            const box = dpCondCC.customContracts[stepIndex];
            if (box) {
              contractType = box.type;
              barrier      = needsBarrier(contractType) ? box.barrier : undefined;
            }
          }

          if (s.noContradiction) {
            eng.waitingForOpposite[ck] = { contractType, prediction: barrier ?? 0 };
          }

          const label        = TRADE_OPTIONS.find(t => t.value === contractType)?.label || contractType;
          const mLabel       = ALL_MARKETS.find(m => m.value === symbol)?.label || symbol;
          const currency     = account?.currency || 'USD';

          if (isVirtual) {
            // ── VIRTUAL ───────────────────────────────────────────────────
            const fakeId     = `VIRT_${now}_${si}_${Math.floor(Math.random() * 9999)}`;
            const entryPrice = quotes[quotes.length - 1] || 0;
            const entryDigit = digits[digits.length - 1] ?? 0;

            eng.activeVirtual.push({
              requestId: fakeId, stratId, symbol,
              stake: tradeStake, contractType, barrier,
              entryPrice, duration: s.ticks, ticksCount: 0,
              lastEpoch: regime.lastEpoch || 0,
            });

            get().addLog({
              id: fakeId, time: now, symbol, strategyIndex: si,
              contract: contractType, stake: tradeStake,
              result: 'VIRTUAL', profit: 0,
              entrySpot: String(entryDigit),   // show entry digit
              exitSpot:  '-',
              step: ss.lossCount + 1,
            });

            eng.cooldown[ck] = now;
            set({
              lastSignal:   `[VIRTUAL] Strategy ${si + 1} on ${mLabel} → ${label}`,
              botStatusMsg: `[VIRTUAL] ${label} on ${mLabel}`,
            });

          } else {
            // ── REAL ──────────────────────────────────────────────────────

            // 1.5 second cross-market gap: prevent two different markets firing simultaneously
            if (now - eng.lastTradeTime < 1500) continue;

            const entryDigit = digits[digits.length - 1] ?? 0;
            const tradeParams = {
              contract_type: contractType,
              stake: tradeStake, symbol, currency,
              duration: s.ticks, duration_unit: 't',
              barrier: barrier !== undefined ? barrier : undefined,
            };

            const requestId = tradeWS.executeDirectTrade(tradeParams);

            if (!requestId) {
              // Socket not ready — queue this trade for retry instead of dropping it
              set({ botStatusMsg: `⏳ Queued: ${label} on ${mLabel} (socket not ready)` });
              _startTradeQueue();
              _tradeQueue.push({
                params: tradeParams,
                stratId, symbol, si, tradeStake, contractType, barrier,
                label, mLabel, entryDigit, lossCount: ss.lossCount, retries: 0,
              });
              // Hold contradiction lock until trade actually fires
              eng.cooldown[ck] = now;
              eng.lastTradeTime = now;
            } else {
              eng.cooldown[ck] = now;
              eng.lastTradeTime = now;
              botTradeIds.add(requestId);
              eng.activeTrades.set(requestId, { stratId, symbol, stake: tradeStake, startTime: now });

              get().addLog({
                id: requestId, time: now, symbol, strategyIndex: si,
                contract: contractType, stake: tradeStake,
                result: 'SENT', profit: 0,
                entrySpot: String(entryDigit),
                exitSpot:  '-',
                step: ss.lossCount + 1,
              });
              set({
                lastSignal:   `Strategy ${si + 1} on ${mLabel} → ${label}`,
                botStatusMsg: `✓ Sent: ${label} on ${mLabel} — waiting for result`,
              });
            }
          }
        }
      },
      // ── Trade event handler (called from tradeWS listener below) ─────────────

      _handleTradeEvent: (type: string, data: any) => {
        if (type === 'TRADE_STARTED') {
          get().updateLog(data.requestId, { result: 'BUYING...' });
          return;
        }
        if (type === 'CONTRACT_UPDATE') {
          // Only update to RUNNING if still showing SENT or BUYING
          const log = get().tradeLogs.find(l => l.id === data.requestId);
          if (log && (log.result === 'SENT' || log.result === 'BUYING...')) {
            get().updateLog(data.requestId, { result: 'RUNNING...' });
          }
          return;
        }
        if (type === 'TRADE_ERROR') {
          eng.activeTrades.delete(data.requestId);
          get().updateLog(data.requestId, { result: 'ERROR', profit: 0 });
          set({ botStatusMsg: `⚠ Trade Error: ${data.error}` });
          return;
        }
        if (type !== 'TRADE_RESULT') return;

        const { requestId, profit: rawProfit, poc } = data;
        const trade = eng.activeTrades.get(requestId);
        if (!trade) return;

        const { stratId, symbol, stake: tradeStake } = trade;
        const ss = eng.strategyState[stratId];
        const state      = get();
        const derivState = useDerivStore.getState();
        const baseStake  = parseFloat(state.stake) || 0.35;

        // Determine win directly from the sign of the profit/loss returned by Deriv!
        // If profit is greater than 0, it has a '+' sign (win).
        // If profit is less than 0, it has a '-' sign (loss).
        const isWin = rawProfit > 0;
        const resultProfit = isWin ? rawProfit : -tradeStake;

        // ── Extract exit digit from POC ─────────────────────────────────────
        // trade-ws already calls store.updateTradeLog on the Deriv store (with `exit` field).
        // Here we write to the BOT store log using `exitSpot`.
        const pocData = poc || {};
        const isRiseFall = trade && (s => s === 'CALL' || s === 'PUT')(pocData.contract_type || '');

        // For digit contracts: last character of exit_tick_display_value = the digit
        // For rise/fall: full exit_tick_display_value
        const rawExitDisplay: string =
          pocData.exit_tick_display_value
          ?? (pocData.exit_tick != null ? String(pocData.exit_tick) : null)
          ?? (pocData.exit_spot != null ? String(pocData.exit_spot) : null)
          ?? '-';

        // For digit contracts show just the last digit; for rise/fall show full price
        const exitDisplay = isRiseFall
          ? rawExitDisplay
          : (rawExitDisplay !== '-' ? rawExitDisplay.charAt(rawExitDisplay.length - 1) : '-');

        const entryDisplay: string =
          pocData.entry_spot_display_value
          ?? (pocData.entry_spot != null ? String(pocData.entry_spot) : null)
          ?? '-';
        // Show just last digit for digit contracts
        const entryFinal = isRiseFall
          ? entryDisplay
          : (entryDisplay !== '-' ? entryDisplay.charAt(entryDisplay.length - 1) : '-');

        get().updateLog(requestId, {
          result:    isWin ? 'WON' : 'LOST',
          profit:    resultProfit,
          exitSpot:  exitDisplay,
          entrySpot: entryFinal,
        });

        // Global stats
        const cur = get().globalStats;
        const newStats = {
          won:         cur.won  + (isWin ? 1 : 0),
          lost:        cur.lost + (isWin ? 0 : 1),
          totalProfit: cur.totalProfit + resultProfit,
          totalTrades: cur.totalTrades + 1,
        };
        set({ globalStats: newStats });

        if (ss) {
          if (isWin) {
            ss.won++; ss.totalProfit += resultProfit; ss.lossCount = 0;
            ss.currentStake = Math.round(baseStake * 100) / 100;
            eng.patternPos[stratId] = 0;
          } else {
            ss.lost++; ss.totalProfit += resultProfit; ss.lossCount++;
            if (state.tradingMode === 'continuous') {
              const rawNextStake = ss.currentStake * parseFloat(state.martingale || '2.1');
              ss.currentStake = Math.round(Math.min(
                rawNextStake,
                baseStake * Math.pow(parseFloat(state.martingale || '2.1'), 10)
              ) * 100) / 100;
            }
          }
        }

        // Real streak tracking → auto-switch to virtual
        const vsState = derivState.virtualSettings;
        let { rConsecWins, rConsecLosses, realWins, realLosses } = vsState;
        if (isWin) { rConsecWins++; rConsecLosses = 0; realWins++; }
        else        { rConsecWins = 0; rConsecLosses++; realLosses++; }

        let newIsVirtual = vsState.isVirtualMode;
        if (vsState.startRealToVirtual) {
          const streak = vsState.rTriggerType === 'losses' ? rConsecLosses : rConsecWins;
          if (streak >= vsState.rThreshold) {
            newIsVirtual = true;
            set({ botStatusMsg: `Real threshold [${vsState.rThreshold}] hit! Switching to VIRTUAL.` });
          }
        }
        derivState.setVirtualSettings({
          isVirtualMode: newIsVirtual, rConsecWins, rConsecLosses, realWins, realLosses,
        });

        // Stop if limits hit
        const liveStats = get().globalStats;
        const tpMode = state.targetProfitMode || 'profit';
        const slMode = state.stopLossMode || 'loss';

        if (tpMode === 'wins') {
          if (liveStats.won >= parseInt(state.targetProfit)) { get().stopBot('Target wins reached!'); }
        } else {
          if (liveStats.totalProfit >= parseFloat(state.targetProfit)) { get().stopBot('Target profit reached!'); }
        }

        if (slMode === 'losses') {
          if (liveStats.lost >= parseInt(state.stopLoss)) { get().stopBot('Stop losses reached!'); }
        } else {
          if (liveStats.totalProfit <= -parseFloat(state.stopLoss)) { get().stopBot('Stop loss reached!'); }
        }

        eng.activeTrades.delete(requestId);
        eng.cooldown[`${stratId}_${symbol}`] = Date.now();
      },

    }),
    {
      name: 'laxprime-bot-v1',
      storage: createJSONStorage(() => {
        // SSR-safe
        if (typeof window === 'undefined') {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        return localStorage;
      }),
      // Only persist settings — NOT runtime state (isRunning, logs, stats)
      partialize: (state) => ({
        stake:           state.stake,
        targetProfit:    state.targetProfit,
        targetProfitMode: state.targetProfitMode,
        stopLoss:        state.stopLoss,
        stopLossMode:    state.stopLossMode,
        martingale:      state.martingale,
        tradingMode:     state.tradingMode,
        strategies:      state.strategies,
        selectedMarkets: state.selectedMarkets,
        theme:           state.theme,
      }),
    },
  ),
);

// Module-scope singleton callback to delegate to the current Zustand store instance
const onTradeWSEvent = (type: string, data: any) => {
  useBotStore.getState()._handleTradeEvent(type, data);
};

if (typeof window !== 'undefined') {
  // Use a property on the global window object as a cross-reload singleton flag
  const WIN = window as any;
  if (!WIN.__laxprime_bot_listener__) {
    WIN.__laxprime_bot_listener__ = true;

    // Remove any previously registered copies (defensive for HMR edge cases)
    tradeWS.offEvent(onTradeWSEvent);
    tradeWS.onEvent(onTradeWSEvent);

    console.log('[BotStore] tradeWS event listener registered (singleton).');
  }
}
