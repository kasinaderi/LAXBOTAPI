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
import { getActivePageId } from './usePageSettings';
import { tradeWS } from '../lib/deriv/trade-ws';
import { feedRsiSignal, RsiSignalConfig, MaType, resetRsiSignalState, consumeRsiSignal } from '../lib/indicators/rsi-signal';

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
  type: 'EVEN_PCT' | 'ODD_PCT' | 'LAST_DIGITS' | 'GREEN_BAR' | 'DIGIT_PATTERN' | 'FALL_PCT' | 'RISE_PCT' | 'OVER_PCT' | 'UNDER_PCT' | 'DIGIT_APPEARS' | 'RSI_SIGNAL';
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
  targetDigits?: number[];
  patternBoxes?: PatternBox[];         // Multi-Entry Sequence (OR across boxes, AND within)
  patternBoxMode?: 'OR' | 'THEN' | 'THENALL'; // How boxes relate: OR=any fires, THEN=Box1→lock→Box2, THENALL=Box1→all markets Box2
  thenTimeout?: number;               // THEN/THENALL: ticks to wait for Box2 before resetting (default 20)
  thenMaxTrades?: number;             // THENALL: max trades Box2 fires per round (default 3)
  useCustomContracts?: boolean;        // DIGIT_PATTERN only: override trade contracts per loss step
  customContracts?: { type: string; barrier: number }[]; // Trade contract per loss step

  // RSI_SIGNAL parameters (TradingView "RSI Signal [trade_lexx]")
  rsiTicksPerCandle?: number;   // default 5
  rsiLength?: number;           // default 14
  rsiSignalAction?: 'AUTO' | 'BUY' | 'SELL'; // default 'AUTO'
  rsiSignalHoldTicks?: number;  // default 10 (ticks to keep signal armed for collaborating conditions like F-F)
  rsiMaMode?: boolean;          // default true
  rsiMaType?: 'SMA' | 'EMA' | 'WMA' | 'HMA' | 'KAMA' | 'VWMA' | 'ALMA' | 'TEMA' | 'ZLEMA' | 'LSMA';
  rsiMaLength?: number;         // default 14
  rsiBbMode?: boolean;          // default true
  rsiBbType?: 'SMA' | 'EMA' | 'WMA' | 'HMA' | 'VWMA' | 'ALMA' | 'TEMA' | 'ZLEMA' | 'LSMA';
  rsiBbLength?: number;         // default 14
  rsiBbMult?: number;           // default 2.0
  rsiDivergenceMode?: boolean;  // default true
  rsiFilterEnabled?: boolean;   // default true
  rsiOversoldLow?: number;      // default 20
  rsiOversoldHigh?: number;     // default 40
  rsiOverboughtLow?: number;    // default 60
  rsiOverboughtHigh?: number;   // default 80
  rsiReentryPause?: number;     // default 5
  rsiWaitForOpposite?: boolean; // default false
  rsiAndMode?: boolean;         // default false
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

export interface SwitcherTradeConfig {
  contractType: string; // e.g. 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', etc.
  barrier: number;       // default prediction / barrier
  count: number;         // count of trades to send
  ticks?: number;        // custom tick duration for this contract (e.g. 2 to 5 ticks)
}

export interface AdaptiveSwitchStep {
  contractType?: string; // legacy fallback
  reps: number;         // how many trades to execute at this step
  ticks?: number;       // custom tick duration fallback for step
  trades?: SwitcherTradeConfig[]; // new config for bulk / different contract types
}

export interface AdaptiveContractConfig {
  type: string;
  barrier?: number;
  ticks?: number;
}

export interface VirtualSwitcherRule {
  contractType: string;  // e.g. 'DIGITUNDER', 'DIGITOVER', 'DIGITEVEN', 'CALL', etc.
  barrier?: number;      // barrier digit for OVER/UNDER contracts
  ticks: number;         // tick duration (1 to 100)
  market?: string;       // optional market symbol override (e.g. '1HZ100V')
  threshold: number;     // how many virtual wins/losses before switching to real
  mode: 'consec' | 'total'; // evaluate consecutive streak or total count
}

export interface VirtualSwitcherReturnRule {
  triggerType: 'wins' | 'losses' | 'trades'; // trigger on wins, losses, or total trades in real mode
  mode: 'consec' | 'total';                  // streak or total
  threshold: number;                         // e.g. 1 win, 2 losses, etc.
}

export interface VirtualSwitcherTestContract {
  contractType: string;
  barrier?: number;
  ticks: number;
}

export interface VirtualSwitcherConfig {
  enabled: boolean;
  virtualContract: VirtualSwitcherTestContract; // what contract to simulate while in virtual mode
  onVirtualWins: VirtualSwitcherRule;           // what to trade in real after N virtual wins
  onVirtualLosses: VirtualSwitcherRule;         // what to trade in real after N virtual losses
  returnToVirtual: VirtualSwitcherReturnRule;   // switch back to virtual after N real wins/losses/trades
  // Runtime counters & state (reset on bot start)
  _phase?: 'virtual' | 'real';
  _consecWins?: number;
  _consecLosses?: number;
  _totalWins?: number;
  _totalLosses?: number;
  _rConsecWins?: number;
  _rConsecLosses?: number;
  _rTotalWins?: number;
  _rTotalLosses?: number;
  _rTotalTrades?: number;
  _activeRule?: 'wins' | 'losses' | null;
  _activeContract?: { contractType: string; barrier?: number; ticks: number; market?: string } | null;
  _originalMarkets?: string[];
}

export interface AdaptiveSwitch {
  enabled: boolean;
  dualMode: boolean;  // Fire exactly 2 contracts per entry; martingale only on both-loss
  mode?: 'sequence' | 'adaptive'; // 'sequence' (Step sequence) vs 'adaptive' (Auto-switch on loss)
  adaptiveContracts?: {
    contractA: AdaptiveContractConfig;
    contractB: AdaptiveContractConfig;
    activeSide?: 'A' | 'B';
    startSide?: 'A' | 'B';
  };
  steps: AdaptiveSwitchStep[];
  virtualSwitcher?: VirtualSwitcherConfig;
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
  pageId?: string;
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
  { value: '1HZ15V',  label: 'V15(1s)'  },
  { value: '1HZ25V',  label: 'V25(1s)'  },
  { value: '1HZ30V',  label: 'V30(1s)'  },
  { value: '1HZ50V',  label: 'V50(1s)'  },
  { value: '1HZ75V',  label: 'V75(1s)'  },
  { value: '1HZ90V',  label: 'V90(1s)'  },
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
  { value: 'RUNHIGH',    label: '↑ ONLY UPS'  },
  { value: 'RUNLOW',     label: '↓ ONLY DOWNS' },
];

export function normalizeContractType(raw: string | undefined | null): string {
  if (!raw) return 'DIGITEVEN';
  const u = String(raw).toUpperCase().trim();
  if (u === 'EVEN' || u === 'DIGITEVEN') return 'DIGITEVEN';
  if (u === 'ODD' || u === 'DIGITODD') return 'DIGITODD';
  if (u === 'OVER' || u === 'DIGITOVER') return 'DIGITOVER';
  if (u === 'UNDER' || u === 'DIGITUNDER') return 'DIGITUNDER';
  if (u === 'MATCH' || u === 'MATCHES' || u === 'DIGITMATCH') return 'DIGITMATCH';
  if (u === 'DIFF' || u === 'DIFFERS' || u === 'DIGITDIFF') return 'DIGITDIFF';
  if (u === 'RISE' || u === 'CALL') return 'CALL';
  if (u === 'FALL' || u === 'PUT') return 'PUT';
  if (u === 'RUNHIGH' || u === 'ONLY UPS') return 'RUNHIGH';
  if (u === 'RUNLOW' || u === 'ONLY DOWNS') return 'RUNLOW';
  return u;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY HELPERS (exported)
// ─────────────────────────────────────────────────────────────────────────────

export function createCondition(): Condition {
  return {
    id: Math.random().toString(36).slice(2, 9),
    type: 'LAST_DIGITS',
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
      // Box 1: 2-tick sequence — tick before last = Under 7  AND  last tick = Even
      { triggers: [{ token: 'U', barrier: 7 }, { token: 'E' }] },
      // Box 2: single-tick — last digit = Over 2 (alternative trigger)
      { triggers: [{ token: 'V', barrier: 2 }] },
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
    // Digit contracts: wait for the OTHER digit outcome before retriggering
    case 'DIGITEVEN':  return digit % 2 !== 0;   // after EVEN → wait for ODD
    case 'DIGITODD':   return digit % 2 === 0;   // after ODD  → wait for EVEN
    case 'DIGITOVER':  return digit <= prediction; // after OVER → wait for UNDER
    case 'DIGITUNDER': return digit > prediction;  // after UNDER → wait for OVER
    case 'DIGITMATCH': return digit !== prediction; // after MATCH → wait for DIFF
    case 'DIGITDIFF':  return digit === prediction; // after DIFF  → wait for MATCH
    // Rise/Fall: wait for the OPPOSITE direction tick
    case 'CALL':
    case 'RUNHIGH':   return quote < prevQuote;  // after RISE → wait for a FALL tick
    case 'PUT':
    case 'RUNLOW':    return quote > prevQuote;  // after FALL → wait for a RISE tick
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
  digits: number[],
  quotes: number[],
  idx: number
): boolean {
  if (idx < 0 || idx >= digits.length) return false;

  const d  = digits[idx];
  const pd = idx > 0 ? digits[idx - 1] : d;
  const q  = quotes[idx];
  const pq = idx > 0 ? quotes[idx - 1] : q;
  const b  = trig.barrier ?? 4;

  switch (trig.token) {
    case 'E':  return d % 2 === 0;
    case 'O':  return d % 2 !== 0;
    case 'D':  return d !== b;   // Differs barrier
    case 'M':  return d === b;   // Match barrier
    case 'V':  return d > b;     // Over
    case 'U':  return d < b;     // Under
    case 'SE': return d % 2 === 0 && d === pd;
    case 'SO': return d % 2 !== 0 && d === pd;
    case 'R':  return q > pq;
    case 'F':  return q < pq;
    default:   return false;
  }
}

function evaluateDigitPattern(cond: Condition, digits: number[], quotes: number[]): boolean {
  const boxes = cond.patternBoxes;

  // ── Multi-Entry Sequence (box format) ──────────────────────────────────────
  //
  // Each BOX is an ALTERNATIVE SEQUENCE (OR across boxes — any single box
  // matching is enough to fire).
  //
  // Within a box, triggers are SEQUENTIAL:
  //   trigger[0] = oldest tick in the window
  //   trigger[1] = next tick
  //   ...
  //   trigger[N-1] = the LATEST (newest) tick
  //
  // Example: Box 1 with [O, O, O, E] means:
  //   digits[-3]=Odd  AND  digits[-2]=Odd  AND  digits[-1]=Odd  AND  digits[0]=Even
  //
  // Example: Box 1 with [U:7, E] AND Box 2 with [V:2]:
  //   Box 1: 2 ticks ago=Under7 AND latest=Even  → fires OR
  //   Box 2: latest=Over2                          → fires
  //
  if (boxes && boxes.length > 0) {
    // Try each box as an alternative; return true as soon as one box fully matches.
    for (const box of boxes) {
      const triggers = box.triggers;
      if (!triggers || triggers.length === 0) continue; // Empty box = skip

      const N = triggers.length; // Number of sequential ticks this box needs

      // Need at least N ticks in history (+ 1 extra for relative comparisons like SE/SO/R/F)
      if (digits.length < N + 1) continue;

      // Match each trigger against its assigned tick position.
      // trigger[0] → digits[last - (N-1)]  (oldest in the window)
      // trigger[N-1] → digits[last]         (newest tick)
      let boxMatches = true;
      // SE/SO use variable binding across a box sequence:
      //   First SE in the box captures the digit; subsequent SE tokens must equal it.
      //   This makes SE→E→SE mean "tick1 and tick3 are the SAME even digit".
      let capturedSE: number | null = null;
      let capturedSO: number | null = null;
      for (let ti = 0; ti < N; ti++) {
        const trig     = triggers[ti];
        const digitIdx = digits.length - N + ti; // oldest first, newest last
        if (digitIdx < 0 || digitIdx >= digits.length) { boxMatches = false; break; }
        const d = digits[digitIdx];

        if (trig.token === 'SE') {
          if (d % 2 !== 0) { boxMatches = false; break; }      // must be even
          if (capturedSE === null) { capturedSE = d; }         // first SE: capture value
          else if (d !== capturedSE) { boxMatches = false; break; } // subsequent SE: must match
          continue;
        }
        if (trig.token === 'SO') {
          if (d % 2 === 0) { boxMatches = false; break; }      // must be odd
          if (capturedSO === null) { capturedSO = d; }         // first SO: capture value
          else if (d !== capturedSO) { boxMatches = false; break; } // subsequent SO: must match
          continue;
        }

        if (!matchTrigger(trig, digits, quotes, digitIdx)) {
          boxMatches = false;
          break;
        }
      }

      if (boxMatches) return true; // OR across boxes — one match is enough
    }
    return false; // No box matched
  }

  // ── Legacy string-pattern fallback ────────────────────────────────────────
  const pat = cond.pattern;
  if (!pat || pat.length === 0) return false;
  const n = pat.length;
  if (digits.length < n + 1) return false;

  for (let i = 0; i < n; i++) {
    const token = pat[i];
    const digitIdx = digits.length - n + i;
    const tempTrig: PatternTrigger = { token };
    if (token === 'V') tempTrig.barrier = 4; // Over 4
    if (token === 'U') tempTrig.barrier = 4; // Under 5 (<= 4)
    if (!matchTrigger(tempTrig, digits, quotes, digitIdx)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluate a single box by index from a condition's patternBoxes array.
 * Returns false if index is out of bounds or box has no triggers.
 */
function evaluateOneBox(cond: Condition, boxIndex: number, digits: number[], quotes: number[]): boolean {
  const boxes = cond.patternBoxes;
  if (!boxes || boxIndex >= boxes.length) return false;
  const box = boxes[boxIndex];
  if (!box || !box.triggers || box.triggers.length === 0) return false;

  const N = box.triggers.length;
  if (digits.length < N + 1) return false;

  let capturedSE: number | null = null;
  let capturedSO: number | null = null;

  for (let ti = 0; ti < N; ti++) {
    const trig = box.triggers[ti];
    const digitIdx = digits.length - N + ti;
    if (digitIdx < 0 || digitIdx >= digits.length) return false;
    const d = digits[digitIdx];

    if (trig.token === 'SE') {
      if (d % 2 !== 0) return false;
      if (capturedSE === null) { capturedSE = d; }
      else if (d !== capturedSE) return false;
      continue;
    }
    if (trig.token === 'SO') {
      if (d % 2 === 0) return false;
      if (capturedSO === null) { capturedSO = d; }
      else if (d !== capturedSO) return false;
      continue;
    }
    if (!matchTrigger(trig, digits, quotes, digitIdx)) return false;
  }
  return true;
}


function evaluateCondition(
  cond: Condition,
  digits: number[],
  quotes: number[],
  symbol?: string,
  tradeType?: string
): boolean {
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
    case 'FALL_PCT': {
      const sub = quotes.slice(-(period + 1));
      if (sub.length < period + 1) return false;
      let falls = 0;
      for (let i = 1; i < sub.length; i++) if (sub[i] < sub[i - 1]) falls++;
      return compare((falls / period) * 100, cond.comparator, cond.value);
    }
    case 'RISE_PCT': {
      const sub = quotes.slice(-(period + 1));
      if (sub.length < period + 1) return false;
      let rises = 0;
      for (let i = 1; i < sub.length; i++) if (sub[i] > sub[i - 1]) rises++;
      return compare((rises / period) * 100, cond.comparator, cond.value);
    }
    case 'OVER_PCT': {
      const sub = digits.slice(-period);
      if (sub.length < period) return false;
      const pct = (sub.filter(d => d > (cond.digitBarrier ?? 4)).length / period) * 100;
      return compare(pct, cond.comparator, cond.value);
    }
    case 'UNDER_PCT': {
      const sub = digits.slice(-period);
      if (sub.length < period) return false;
      const pct = (sub.filter(d => d <= (cond.digitBarrier ?? 4)).length / period) * 100;
      return compare(pct, cond.comparator, cond.value);
    }
    case 'DIGIT_APPEARS': {
      const targetDigits = cond.targetDigits && cond.targetDigits.length > 0
        ? cond.targetDigits
        : [cond.digitBarrier ?? 5];
      const targetCount = cond.value ?? 4;
      const tickPeriod = cond.period ?? 10;
      const sub = digits.slice(-tickPeriod);
      if (sub.length < tickPeriod) return false;
      if (!targetDigits.includes(sub[0])) return false;
      const count = sub.filter(d => targetDigits.includes(d)).length;
      return compare(count, cond.comparator || '>', targetCount);
    }
    case 'RSI_SIGNAL': {
      if (quotes.length < 2) return false;
      const latestPrice = quotes[quotes.length - 1];
      const stateKey = `${symbol || 'default'}__${cond.id}`;
      const cfg: RsiSignalConfig = {
        ticksPerCandle: cond.rsiTicksPerCandle ?? 5,
        rsiLength: cond.rsiLength ?? 14,
        maMode: cond.rsiMaMode ?? true,
        maType: (cond.rsiMaType as MaType) ?? 'SMA',
        maLength: cond.rsiMaLength ?? 14,
        bbMode: cond.rsiBbMode ?? true,
        bbType: (cond.rsiBbType as MaType) ?? 'SMA',
        bbLength: cond.rsiBbLength ?? 14,
        bbMult: cond.rsiBbMult ?? 2.0,
        divergenceMode: cond.rsiDivergenceMode ?? true,
        rsiFilterEnabled: cond.rsiFilterEnabled ?? true,
        oversoldLow: cond.rsiOversoldLow ?? 20,
        oversoldHigh: cond.rsiOversoldHigh ?? 40,
        overboughtLow: cond.rsiOverboughtLow ?? 60,
        overboughtHigh: cond.rsiOverboughtHigh ?? 80,
        reentryPause: cond.rsiReentryPause ?? 5,
        waitForOpposite: cond.rsiWaitForOpposite ?? false,
        andMode: cond.rsiAndMode ?? false,
        signalHoldTicks: cond.rsiSignalHoldTicks ?? 10,
      };

      const result = feedRsiSignal(stateKey, latestPrice, cfg);
      const action = cond.rsiSignalAction || 'AUTO';
      if (action === 'BUY') return result.buySignal;
      if (action === 'SELL') return result.sellSignal;
      // AUTO mode: matches strategy trade direction (Rise / Only Ups vs Fall / Only Downs)
      if (tradeType === 'PUT' || tradeType === 'FALL' || tradeType === 'RUNLOW') {
        return result.sellSignal;
      }
      if (tradeType === 'CALL' || tradeType === 'RISE' || tradeType === 'RUNHIGH') {
        return result.buySignal;
      }
      return result.buySignal;
    }
    default:
      return false;
  }
}

function evalStrategy(s: Strategy, digits: number[], quotes: number[], symbol?: string): boolean {
  if (digits.length < 5) return false;
  if (!s.conditions.length) return false;
  let result = evaluateCondition(s.conditions[0], digits, quotes, symbol, s.tradeType);
  for (let i = 1; i < s.conditions.length; i++) {
    const c = s.conditions[i];
    const v = evaluateCondition(c, digits, quotes, symbol, s.tradeType);
    result = c.join === 'AND' ? result && v : result || v;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-SCOPE MUTABLE ENGINE STATE
// These live outside React/Zustand so they survive page navigation.
// ─────────────────────────────────────────────────────────────────────────────

// Per-strategy THEN/THENALL state (lives outside React so it persists across ticks)
interface ThenState {
  phase: 'scanning_box1' | 'locked_box2';
  lockedSymbol: string | null; // THEN: market where Box1 was found
  ticksWaited: number;         // ticks elapsed (real ticks, not per-market iterations)
  tradesThisRound: number;     // THENALL: trades fired this round
  lastTickEpoch: number;       // epoch of last tick where we incremented ticksWaited
}

const eng = {
  strategyState: {} as Record<string, PerStrategyState>,
  cooldown:      {} as Record<string, number>,
  activeTrades:  new Map<string, { stratId: string; symbol: string; stake: number; startTime: number; roundId?: string }>(),
  activeVirtual: [] as any[],
  patternPos:    {} as Record<string, number>,
  retrigger:     {} as Record<string, { lastWasTrue: boolean; waitingForOpposite: boolean }>,
  waitingForOpposite: {} as Record<string, any>,
  // Cross-market 1.5s gap: prevents 2 different markets firing at exactly the same time
  lastTradeTime: 0,
  // Adaptive switch live position tracker
  adaptivePos: { stepIndex: 0, repCount: 0 },
  // THEN / THENALL state per strategy
  thenState: {} as Record<string, ThenState>,
  // Round tracker for bulk / multi-contract execution rounds
  roundState: {} as Record<string, {
    totalCount: number;
    finishedCount: number;
    wonCount: number;
    lostCount: number;
    netProfit: number;
    baseStake: number;
    isVirtual: boolean;
    symbol: string;
    dualMode: boolean; // special split-martingale: only both-loss triggers martingale
  }>,
};

// Single onTick subscription handle — registered once, lives forever
let _onTickUnsub: (() => void) | null = null;

function processVirtualSwitcherResult(isWin: boolean, get: () => any, set: (state: any) => void) {
  const state = get();
  const aSw = state.adaptiveSwitch;
  if (!aSw?.virtualSwitcher?.enabled) return;

  const vs = aSw.virtualSwitcher;
  // Only process virtual outcome if in virtual phase
  if (vs._phase === 'real') return;

  let consecW = vs._consecWins || 0;
  let consecL = vs._consecLosses || 0;
  let totalW = vs._totalWins || 0;
  let totalL = vs._totalLosses || 0;

  if (isWin) {
    consecW++;
    consecL = 0;
    totalW++;
  } else {
    consecW = 0;
    consecL++;
    totalL++;
  }

  const winRule = vs.onVirtualWins;
  const lossRule = vs.onVirtualLosses;
  const winCount = winRule?.mode === 'consec' ? consecW : totalW;
  const lossCount = lossRule?.mode === 'consec' ? consecL : totalL;

  let triggeredRule: 'wins' | 'losses' | null = null;
  let activeContract: { contractType: string; barrier?: number; ticks: number; market?: string } | null = null;
  let newMarket = state.selectedMarkets;

  if (winRule && winCount >= winRule.threshold) {
    triggeredRule = 'wins';
    const normType = normalizeContractType(winRule.contractType || 'DIGITUNDER');
    activeContract = {
      contractType: normType,
      barrier: needsBarrier(normType) ? (winRule.barrier ?? 4) : undefined,
      ticks: Math.max(1, winRule.ticks || 1),
      market: winRule.market,
    };
    if (winRule.market) {
      newMarket = [winRule.market];
    }
  } else if (lossRule && lossCount >= lossRule.threshold) {
    triggeredRule = 'losses';
    const normType = normalizeContractType(lossRule.contractType || 'DIGITOVER');
    activeContract = {
      contractType: normType,
      barrier: needsBarrier(normType) ? (lossRule.barrier ?? 5) : undefined,
      ticks: Math.max(1, lossRule.ticks || 1),
      market: lossRule.market,
    };
    if (lossRule.market) {
      newMarket = [lossRule.market];
    }
  }

  if (triggeredRule && activeContract) {
    // 🚀 SWITCH TO REAL TRADING!
    useDerivStore.getState().setVirtualSettings({
      isVirtualMode: false,
      startVirtualToReal: false,
      startRealToVirtual: false,
      isDoubleVirtual: false,
    });
    const lbl = TRADE_OPTIONS.find(o => o.value === activeContract!.contractType)?.label || activeContract.contractType;
    const barText = activeContract.barrier !== undefined && needsBarrier(activeContract.contractType) ? ` ${activeContract.barrier}` : '';
    set({
      botStatusMsg: `⚡ Virtual Switcher: ${triggeredRule === 'wins' ? winRule.threshold + ' V-Wins' : lossRule.threshold + ' V-Losses'} met! Switched to REAL (${lbl}${barText})${activeContract.market ? ` on ${activeContract.market}` : ''}.`,
      adaptiveSwitch: {
        ...aSw,
        enabled: true,
        virtualSwitcher: {
          ...vs,
          _phase: 'real',
          _activeRule: triggeredRule,
          _activeContract: activeContract,
          _originalMarkets: (vs._originalMarkets && vs._originalMarkets.length > 0) ? vs._originalMarkets : [...state.selectedMarkets],
          _consecWins: 0,
          _consecLosses: 0,
          _totalWins: totalW,
          _totalLosses: totalL,
          _rConsecWins: 0,
          _rConsecLosses: 0,
          _rTotalWins: 0,
          _rTotalLosses: 0,
          _rTotalTrades: 0,
        },
      },
      selectedMarkets: newMarket,
    });
  } else {
    set({
      adaptiveSwitch: {
        ...aSw,
        virtualSwitcher: {
          ...vs,
          _phase: 'virtual',
          _consecWins: consecW,
          _consecLosses: consecL,
          _totalWins: totalW,
          _totalLosses: totalL,
        },
      },
    });
  }
}

function processVirtualSwitcherRealResult(isWin: boolean, get: () => any, set: (state: any) => void) {
  const state = get();
  const aSw = state.adaptiveSwitch;
  if (!aSw?.virtualSwitcher?.enabled) return;

  const vs = aSw.virtualSwitcher;
  if (vs._phase !== 'real') return;

  let rConsecW = vs._rConsecWins || 0;
  let rConsecL = vs._rConsecLosses || 0;
  let rTotalW = vs._rTotalWins || 0;
  let rTotalL = vs._rTotalLosses || 0;
  let rTotalTrades = (vs._rTotalTrades || 0) + 1;

  if (isWin) {
    rConsecW++;
    rConsecL = 0;
    rTotalW++;
  } else {
    rConsecW = 0;
    rConsecL++;
    rTotalL++;
  }

  const retRule = vs.returnToVirtual || { triggerType: 'wins', mode: 'consec', threshold: 1 };
  let count = 0;
  if (retRule.triggerType === 'wins') {
    count = retRule.mode === 'consec' ? rConsecW : rTotalW;
  } else if (retRule.triggerType === 'losses') {
    count = retRule.mode === 'consec' ? rConsecL : rTotalL;
  } else {
    count = rTotalTrades;
  }

  if (count >= retRule.threshold) {
    // 🔄 SWITCH BACK TO VIRTUAL TRADING!
    useDerivStore.getState().setVirtualSettings({
      isVirtualMode: true,
      startVirtualToReal: false,
      startRealToVirtual: false,
      isDoubleVirtual: false,
    });
    const originalMarkets = (vs._originalMarkets && vs._originalMarkets.length > 0) ? vs._originalMarkets : state.selectedMarkets;
    const vc = vs.virtualContract || { contractType: 'DIGITEVEN', ticks: 1 };
    const virtContract = normalizeContractType(vc.contractType || (vc as any).type || 'DIGITEVEN');
    const virtLabel = TRADE_OPTIONS.find(o => o.value === virtContract)?.label || virtContract;
    set({
      selectedMarkets: originalMarkets,
      botStatusMsg: `🎯 Virtual Switcher: Target (${retRule.threshold} ${retRule.mode === 'consec' ? 'consecutive ' : 'total '}${retRule.triggerType}) met! Switched BACK to VIRTUAL (${virtLabel}).`,
      adaptiveSwitch: {
        ...aSw,
        enabled: true,
        virtualSwitcher: {
          ...vs,
          _phase: 'virtual',
          _activeRule: null,
          _activeContract: null,
          _consecWins: 0,
          _consecLosses: 0,
          _totalWins: 0,
          _totalLosses: 0,
          _rConsecWins: 0,
          _rConsecLosses: 0,
          _rTotalWins: 0,
          _rTotalLosses: 0,
          _rTotalTrades: 0,
        },
      },
    });
  } else {
    set({
      adaptiveSwitch: {
        ...aSw,
        virtualSwitcher: {
          ...vs,
          _rConsecWins: rConsecW,
          _rConsecLosses: rConsecL,
          _rTotalWins: rTotalW,
          _rTotalLosses: rTotalL,
          _rTotalTrades: rTotalTrades,
        },
      },
    });
  }
}

function resolveRound(roundId: string, stratId: string, get: () => any, set: (state: any) => void) {
  const rs = eng.roundState[roundId];
  if (!rs) return;

  const { wonCount, lostCount, netProfit, baseStake, isVirtual, symbol, dualMode } = rs;

  // If no trades actually settled (e.g. all orders errored or rejected by Deriv),
  // DO NOT treat as a win and DO NOT reset the martingale ladder!
  if (wonCount === 0 && lostCount === 0) {
    delete eng.roundState[roundId];
    return;
  }

  const isRoundWin = netProfit >= 0;

  // ── Dual-mode split result ────────────────────────────────────────────────
  // In dual mode (2 contracts, same entry), only count as a loss when BOTH lose.
  // If exactly one wins and one loses it's a push — no martingale, no win/loss stat.
  const isDualPush = dualMode && wonCount > 0 && lostCount > 0;

  // 1. Martingale / Compounding update (only once per round!)
  const ss = eng.strategyState['__global__'];
  const isCompounding = useDerivStore.getState().compoundProfits;
  if (ss) {
    if (isDualPush) {
      // Push (1W+1L): one contract offset the other — treat as a win for martingale/compounding.
      ss.totalProfit += netProfit;
      if (!isVirtual) {
        ss.lossCount = 0;
        if (isCompounding) {
          // Compound: add profit to current stake
          const raw = ss.currentStake + netProfit;
          ss.currentStake = Math.max(baseStake, Math.round(raw * 100) / 100);
        } else {
          ss.currentStake = Math.round(baseStake * 100) / 100;
        }
      }
    } else if (isRoundWin) {
      if (!isVirtual) {
        ss.won++; ss.totalProfit += netProfit; ss.lossCount = 0;
        if (isCompounding) {
          // Compound: current stake + profit earned becomes next stake
          const raw = ss.currentStake + netProfit;
          ss.currentStake = Math.max(baseStake, Math.round(raw * 100) / 100);
        } else {
          ss.currentStake = Math.round(baseStake * 100) / 100;
        }
        get().strategies.forEach((strat: Strategy) => { eng.patternPos[strat.id] = 0; });
      } else {
        ss.won++; ss.totalProfit += netProfit;
        get().strategies.forEach((strat: Strategy) => { eng.patternPos[strat.id] = 0; });
      }
    } else {
      if (!isVirtual) {
        ss.lost++; ss.totalProfit += netProfit; ss.lossCount++;
        if (isCompounding) {
          // On loss in compounding mode: reset stake to baseStake and reset loss count
          ss.currentStake = Math.round(baseStake * 100) / 100;
          ss.lossCount = 0;
        } else if (get().isMartingaleEnabled !== false && (get().tradingMode === 'continuous' || get().tradingMode === 'target')) {
          const rawNextStake = ss.currentStake * parseFloat(get().martingale || '2.1');
          const maxMartingaleCap = baseStake * Math.pow(parseFloat(get().martingale || '2.1'), 10);
          const nextStake = Math.round(Math.min(rawNextStake, maxMartingaleCap) * 100) / 100;

          // Check if balance is available to support the next martingale stake
          const account = useDerivStore.getState().account;
          const balance = account?.balance;
          if (balance !== undefined && balance !== null && !isNaN(balance) && nextStake > balance) {
            ss.currentStake = nextStake; // Preserve accurate stake, DO NOT reset to base!
            delete eng.roundState[roundId];
            get().stopBot(
              `⛔ Max Martingale / Insufficient Balance: Next stake USD ${nextStake.toFixed(2)} exceeds account balance USD ${balance.toFixed(2)}. Bot stopped to protect remaining funds.`
            );
            return;
          }

          ss.currentStake = nextStake;
        } else {
          ss.currentStake = Math.round(baseStake * 100) / 100;
        }
      } else {
        ss.lost++; ss.totalProfit += netProfit;
      }
    }
  }

  // 2. Switcher position advancement (only once per round!)
  const aSwState = get().adaptiveSwitch;
  if (aSwState.enabled && !aSwState.virtualSwitcher?.enabled) {
    if (aSwState.mode === 'adaptive') {
      const ac = aSwState.adaptiveContracts || {
        contractA: { type: 'DIGITEVEN', barrier: 4, ticks: 5 },
        contractB: { type: 'DIGITODD', barrier: 4, ticks: 5 },
        activeSide: 'A',
        startSide: 'A',
      };
      let curSide = ac.activeSide || ac.startSide || 'A';

      if (isRoundWin || isDualPush) {
        // WIN or PUSH: Continue on current winning side!
      } else {
        // LOSS: Instantly inter-switch to opposite side!
        curSide = curSide === 'A' ? 'B' : 'A';
        useBotStore.getState().setAdaptiveSwitch({
          ...aSwState,
          adaptiveContracts: { ...ac, activeSide: curSide },
        });
      }

      const activeCfg = curSide === 'A' ? (ac.contractA || { type: 'DIGITEVEN' }) : (ac.contractB || { type: 'DIGITODD' });
      const lbl = TRADE_OPTIONS.find(o => o.value === activeCfg.type)?.label || activeCfg.type;
      const pushTag = isDualPush ? ' ⇌ PUSH' : '';
      set({ adaptiveLiveStatus: `⚡ ADAPTIVE: ${lbl} (Side ${curSide})${pushTag} [Auto-Switch on Loss]` });
    } else if (aSwState.steps.length > 0) {
      const pos = eng.adaptivePos;
      // Clamp index
      if (pos.stepIndex >= aSwState.steps.length) { pos.stepIndex = 0; pos.repCount = 0; }
      const curStepCfg = aSwState.steps[pos.stepIndex];
      if (curStepCfg) {
        // Advance on a clean win OR a dual-push (push resets to Step 1 like a win)
        if (isRoundWin || isDualPush) {
          if (isDualPush) {
            // Push: reset switcher back to Step 1 (stake already reset to base above)
            pos.stepIndex = 0;
            pos.repCount  = 0;
          } else {
            pos.repCount++;
            if (pos.repCount >= curStepCfg.reps) {
              pos.repCount  = 0;
              pos.stepIndex = (pos.stepIndex + 1) % aSwState.steps.length;
            }
          }
        }
        // On loss: retry same step/rep

        const nextStep  = aSwState.steps[pos.stepIndex] ?? aSwState.steps[0];
        const tradesList = nextStep.trades && nextStep.trades.length > 0 ? nextStep.trades : [{ contractType: nextStep.contractType || 'DIGITEVEN', count: 1 }];
        const nextLabel = tradesList.map((t: any) => {
          const lbl = TRADE_OPTIONS.find(o => o.value === t.contractType)?.label || t.contractType;
          return t.count > 1 ? `${lbl} (x${t.count})` : lbl;
        }).join(' + ');
        const pushTag = isDualPush ? ' ⇌ PUSH' : '';
        set({ adaptiveLiveStatus: `${nextLabel}${pushTag} [Step ${pos.stepIndex + 1}, ${pos.repCount + 1}/${nextStep.reps}]` });
      }
    }
  }

  // 3. Virtual Switcher Real Trade Result Processing
  if (!isVirtual) {
    processVirtualSwitcherRealResult(isRoundWin, get, set);
  }

  // 4. Double Virtual Mode: check real trade completion in Stage B
  const vsV = useDerivStore.getState().virtualSettings;
  if (!isVirtual && vsV.startVirtualToReal && vsV.isDoubleVirtual && vsV.vDoubleStage === 'B' && !aSwState.virtualSwitcher?.enabled) {
    const completedReps = (vsV.vStageBCompletedReps || 0) + 1;
    const targetReps = vsV.vStageBReps || 1;
    if (completedReps < targetReps) {
      useDerivStore.getState().setVirtualSettings({
        isVirtualMode: true,
        vStageBCompletedReps: completedReps,
        vConsecWinsB: 0,
        vConsecLossesB: 0,
        vVirtualWinsB: 0,
        vVirtualLossesB: 0,
        vResultHistoryB: [],
      });
      set({ botStatusMsg: `⚡ Double Virt: Real Trade (${completedReps}/${targetReps}) finished. Returning to Virtual for Stage B Gate.` });
    } else {
      useDerivStore.getState().setVirtualSettings({
        isVirtualMode: true,
        vDoubleStage: 'B', // Perpetual Stage B!
        vStageBCompletedReps: 0,
        vConsecWinsB: 0,
        vConsecLossesB: 0,
        vVirtualWinsB: 0,
        vVirtualLossesB: 0,
        vResultHistoryB: [],
      });
      set({ botStatusMsg: `⚡ Double Virt: Stage B Reps Completed (${completedReps}/${targetReps})! Remaining in Stage B execution cycle.` });
    }
  }

  // 4. Clear roundState
  delete eng.roundState[roundId];

  // If this was real mode, update the status message
  if (!isVirtual) {
    const mLabel = ALL_MARKETS.find(m => m.value === symbol)?.label || symbol;
    const resultLabel = isDualPush ? '⇌ PUSH (1W+1L)' : isRoundWin ? '✓ WON' : '✗ LOST';
    set({
      botStatusMsg: `Round done on ${mLabel}. ${resultLabel} (${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} USD)`,
    });
  }
}

// Exported set of requestIds placed by the bot — lets the UI read from Deriv store directly (instant)
export const botTradeIds = new Set<string>();

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
  isMartingaleEnabled?: boolean;
  tradingMode:    string;
  strategies:     Strategy[];
  selectedMarkets: string[];
  theme:          'dark' | 'light';
  crossMarketDelay: string;
  adaptiveSwitch: AdaptiveSwitch;
  adaptiveLiveStatus: string; // e.g. 'Even [Step 1, 1/2]'

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
  setIsMartingaleEnabled: (v: boolean) => void;
  setTradingMode:     (v: string) => void;
  setStrategies:      (s: Strategy[] | ((p: Strategy[]) => Strategy[])) => void;
  setSelectedMarkets: (m: string[] | ((p: string[]) => string[])) => void;
  setTheme:           (theme: 'dark' | 'light') => void;
  setCrossMarketDelay: (v: string) => void;
  setAdaptiveSwitch:  (v: AdaptiveSwitch) => void;

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
      isMartingaleEnabled: true,
      tradingMode:     'continuous',
      strategies:      [createStrategy(0)],
      selectedMarkets: ['1HZ10V', '1HZ100V'],
      theme:           'dark',
      crossMarketDelay: '1.5',
      adaptiveSwitch:  {
        enabled: false,
        dualMode: false,
        steps: [
          { contractType: 'DIGITEVEN', reps: 2 },
          { contractType: 'DIGITODD',  reps: 2 },
        ],
      },
      adaptiveLiveStatus: '',

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
      setIsMartingaleEnabled: (v) => set({ isMartingaleEnabled: v }),
      setTradingMode:     (v) => set({ tradingMode: v }),
      setStrategies: (s) => set(state => ({
        strategies: typeof s === 'function' ? s(state.strategies) : s,
      })),
      setSelectedMarkets: (m) => set(state => ({
        selectedMarkets: typeof m === 'function' ? m(state.selectedMarkets) : m,
      })),
      setTheme:           (theme) => set({ theme }),
      setCrossMarketDelay: (v) => set({ crossMarketDelay: v }),
      setAdaptiveSwitch:  (v) => set({ adaptiveSwitch: v }),

      addLog: (log) => {
        const pageId = log.pageId || getActivePageId();
        const logWithPage = { ...log, pageId };
        set(state => ({
          tradeLogs: [logWithPage, ...state.tradeLogs].slice(0, 50),
        }));
      },
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
        eng.adaptivePos   = { stepIndex: 0, repCount: 0 };
        eng.thenState     = {};
        eng.roundState    = {};
        eng.lastTradeTime = 0;
        botTradeIds.clear();
        set({ adaptiveLiveStatus: '' });

        // Reset Virtual Switcher runtime counters
        const curASw = get().adaptiveSwitch;
        const isVSActive = Boolean(curASw?.virtualSwitcher?.enabled);
        if (curASw?.virtualSwitcher) {
          set({
            adaptiveSwitch: {
              ...curASw,
              enabled: isVSActive ? true : curASw.enabled,
              virtualSwitcher: {
                ...curASw.virtualSwitcher,
                _phase: 'virtual',
                _consecWins: 0,
                _consecLosses: 0,
                _totalWins: 0,
                _totalLosses: 0,
                _rConsecWins: 0,
                _rConsecLosses: 0,
                _rTotalWins: 0,
                _rTotalLosses: 0,
                _rTotalTrades: 0,
                _activeRule: null,
                _activeContract: null,
                _originalMarkets: undefined,
              },
            },
          });
        }

        // Reset Double Virtual stage to A on bot start and initialize virtual mode if any virtual feature is active
        const vsCurrent = useDerivStore.getState().virtualSettings;
        const isVirtActive = isVSActive || vsCurrent.startVirtualToReal || vsCurrent.isDoubleVirtual || vsCurrent.smartSettings?.enabled;
        useDerivStore.getState().setVirtualSettings({
          isVirtualMode: isVirtActive ? true : vsCurrent.isVirtualMode,
          startVirtualToReal: isVSActive ? false : vsCurrent.startVirtualToReal,
          startRealToVirtual: isVSActive ? false : vsCurrent.startRealToVirtual,
          isDoubleVirtual: isVSActive ? false : vsCurrent.isDoubleVirtual,
          vDoubleStage: 'A',
          vStageBCompletedReps: 0,
          vConsecWinsB: 0,
          vConsecLossesB: 0,
          vVirtualWinsB: 0,
          vVirtualLossesB: 0,
          vSmartStage: 1,
          vSmartCount: 0,
        });

        // Proactively connect/ensure the trade socket is open
        if (typeof window !== 'undefined') {
          tradeWS.connect();
          // Defensively ensure the socket event listener is bound to the latest store
          tradeWS.offEvent(onTradeWSEvent);
          tradeWS.onEvent(onTradeWSEvent);
        }

        set({
          isRunning: true,
          botStatusMsg: 'Running. Waiting for conditions...',
          lastSignal: '',
          globalStats: { won: 0, lost: 0, totalProfit: 0, totalTrades: 0 },
        });

        // Reset trade pattern sequence position to step 1 on fresh start
        eng.patternPos = {};

        // Clear RSI Signal engine state so each bot run starts with fresh candle history
        const strats = get().strategies;
        strats.forEach(s => {
          s.conditions.forEach(c => {
            if (c.type === 'RSI_SIGNAL') {
              get().selectedMarkets.forEach((sym: string) => {
                resetRsiSignalState(`${sym}__${c.id}`);
              });
            }
          });
        });

        // Register the onTick listener ONCE (idempotent across navigation)
        if (!_onTickUnsub) {
          _onTickUnsub = useScannerStore.getState().onTick((symbol) => {
            get()._runScan(symbol);
          });
        }
      },

      stopBot: (reason?: string) => {
        set({ isRunning: false, botStatusMsg: reason ? `Stopped: ${reason}` : 'Bot stopped.' });
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
        botTradeIds.clear();
        useDerivStore.getState().setVirtualSettings({
          vDoubleStage: 'A',
          vStageBCompletedReps: 0,
          vConsecWinsB: 0,
          vConsecLossesB: 0,
          vVirtualWinsB: 0,
          vVirtualLossesB: 0,
          vSmartStage: 1,
          vSmartCount: 0,
        });
        eng.lastTradeTime = 0;
        botTradeIds.clear();
        // Only clear session data — stake, targetProfit, stopLoss, martingale
        // and tradingMode are intentionally preserved across resets.
        set({
          tradeLogs:    [],
          globalStats:  { won: 0, lost: 0, totalProfit: 0, totalTrades: 0 },
          botStatusMsg: 'Ready.',
          lastSignal:   '',
          signalFlash:  {},
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

          const rDigits  = (regime.digits  || []) as number[];
          const rQuotes  = (regime.quotes  || []) as number[];
          const exitDigit = rDigits[rDigits.length - 1] ?? 0;
          const exitPrice = rQuotes[rQuotes.length - 1] ?? 0;
          const prevPrice = rQuotes[rQuotes.length - 2] ?? vt.entryPrice;

          // Deriv Early Knockout: RUNHIGH loses immediately if tick <= prev; RUNLOW loses immediately if tick >= prev
          let isEarlyKnockout = false;
          if (vt.contractType === 'RUNHIGH' && exitPrice <= prevPrice) {
            isEarlyKnockout = true;
          } else if (vt.contractType === 'RUNLOW' && exitPrice >= prevPrice) {
            isEarlyKnockout = true;
          }

          if (isEarlyKnockout) {
            resolved.push({ ...vt, isWin: false, exitDigit, exitPrice });
            continue;
          }

          if (vt.ticksCount >= vt.duration) {
            let win = false;
            const cType = normalizeContractType(vt.contractType);
            switch (cType) {
              case 'DIGITEVEN':  win = exitDigit % 2 === 0; break;
              case 'DIGITODD':   win = exitDigit % 2 !== 0; break;
              case 'DIGITOVER':  win = exitDigit > (vt.barrier ?? 4); break;
              case 'DIGITUNDER': win = exitDigit <= (vt.barrier ?? 4); break;
              case 'DIGITMATCH': win = exitDigit === (vt.barrier ?? 0); break;
              case 'DIGITDIFF':  win = exitDigit !== (vt.barrier ?? 0); break;
              case 'CALL':       win = exitPrice > vt.entryPrice; break;
              case 'PUT':        win = exitPrice < vt.entryPrice; break;
              case 'RUNHIGH': {
                // Survived all ticks strictly rising
                const priceSlice = rQuotes.slice(-(vt.duration + 1));
                win = priceSlice.length >= vt.duration + 1 &&
                      priceSlice.every((q, i) => i === 0 || q > priceSlice[i - 1]);
                break;
              }
              case 'RUNLOW': {
                // Survived all ticks strictly falling
                const priceSlice = rQuotes.slice(-(vt.duration + 1));
                win = priceSlice.length >= vt.duration + 1 &&
                      priceSlice.every((q, i) => i === 0 || q < priceSlice[i - 1]);
                break;
              }
              default:
                win = exitDigit % 2 === 0;
                break;
            }
            resolved.push({ ...vt, isWin: win, exitDigit, exitPrice });
          } else {
            remaining.push(vt);
          }
        }
        eng.activeVirtual = remaining;

        for (const rt of resolved) {
          const { requestId: vtId, stratId, symbol: vtSym, stake: vtStake, isWin, exitDigit, exitPrice, contractType: vtContractType, roundId } = rt;
          const resultProfit = isWin ? vtStake * 0.95 : -vtStake;

          // For RUNHIGH/RUNLOW and CALL/PUT show full price as exit spot, for digits show last digit
          const isFullSpotVirt = vtContractType === 'RUNHIGH' || vtContractType === 'RUNLOW' ||
                                 vtContractType === 'CALL' || vtContractType === 'PUT';
          const exitSpotDisplay = isFullSpotVirt ? String(exitPrice) : String(exitDigit);

          // Update virtual log with exit spot and final result
          get().updateLog(vtId, {
            result:   isWin ? 'VIRT WON' : 'VIRT LOST',
            profit:   resultProfit,
            exitSpot: exitSpotDisplay,
          });

          if (roundId && eng.roundState[roundId]) {
            const rs = eng.roundState[roundId];
            rs.finishedCount++;
            rs.netProfit += resultProfit;
            if (isWin) rs.wonCount++; else rs.lostCount++;

            if (rs.finishedCount === rs.totalCount) {
              resolveRound(roundId, stratId, get, set);
            }
          } else {
            // Legacy / fallback if no roundId
            const ss = eng.strategyState['__global__'];
            if (ss) {
              if (isWin) {
                ss.won++; ss.totalProfit += resultProfit;
                get().strategies.forEach((strat: Strategy) => { eng.patternPos[strat.id] = 0; });
              } else {
                ss.lost++; ss.totalProfit += resultProfit;
              }
            }
          }

          eng.cooldown[`${stratId}_${vtSym}`] = now;
          eng.lastTradeTime = now;
        }

        // ── Virtual streak tracking & stop-limit checks (once per round) ────────
        // Run AFTER all contracts in each round settle so that dual-mode pushes
        // (1 win + 1 loss in the same round) don't corrupt the streak counters.
        const settledRoundIds = new Set<string>();
        for (const rt of resolved) {
          // A round is fully settled when resolveRound deleted it from eng.roundState
          if (rt.roundId && !eng.roundState[rt.roundId]) {
            settledRoundIds.add(rt.roundId);
          }
        }

        for (const roundId of settledRoundIds) {
          const roundContracts = resolved.filter((r: any) => r.roundId === roundId);
          const roundWon  = roundContracts.filter((r: any) =>  r.isWin).length;
          const roundLost = roundContracts.filter((r: any) => !r.isWin).length;
          // Dual push (1W+1L): treat as a WIN — reset loss streak (mirrors real mode)
          const isDualRoundPush = roundContracts.length >= 2 && roundWon > 0 && roundLost > 0;
          // Dual both-loss: counts as exactly 1 loss, not 2
          const isDualBothLoss  = roundContracts.length >= 2 && roundLost === roundContracts.length;

          const vsV = useDerivStore.getState().virtualSettings;
          let { vConsecWins, vConsecLosses, virtualWins, virtualLosses, vConsecWinsB = 0, vConsecLossesB = 0, vVirtualWinsB = 0, vVirtualLossesB = 0 } = vsV;

          if (isDualRoundPush) {
            vConsecWins++; vConsecLosses = 0; virtualWins++;
          } else if (isDualBothLoss) {
            vConsecWins = 0; vConsecLosses++; virtualLosses++;
          } else if (roundWon >= roundLost) {
            vConsecWins++; vConsecLosses = 0; virtualWins += roundWon;
          } else {
            vConsecWins = 0; vConsecLosses++; virtualLosses += roundLost;
          }

          // Evaluate Smart Analysis Pattern
          let smartMatched = false;
          const smart = vsV.smartSettings;
          const isRoundWinB = isDualRoundPush || roundWon >= roundLost;
          processVirtualSwitcherResult(isRoundWinB, get, set);
          const currentRes: 'W' | 'L' = isRoundWinB ? 'W' : 'L';
          const newHistory: ('W' | 'L')[] = [...(vsV.vResultHistory || []), currentRes].slice(-50);

          if (smart?.enabled) {
            if (smart.type === 'sequence' && smart.sequence) {
              const seq = smart.sequence;
              const step1Req = seq.step1Type === 'Wins' ? 'W' : 'L';
              const step2Req = seq.step2Type === 'Wins' ? 'W' : 'L';
              let vSmartStage = vsV.vSmartStage || 1;
              let vSmartCount = vsV.vSmartCount || 0;

              if (vSmartStage === 1) {
                let step1Met = false;
                if (seq.step1Mode === 'consecutive') {
                  const streak = step1Req === 'W' ? vConsecWins : vConsecLosses;
                  if (streak >= seq.step1Qty) step1Met = true;
                } else {
                  if (currentRes === step1Req) vSmartCount++;
                  if (vSmartCount >= seq.step1Qty) step1Met = true;
                }
                if (step1Met) { vSmartStage = 2; vSmartCount = 0; }
              } else {
                let step2Met = false; let step2Failed = false;
                if (seq.step2Mode === 'consecutive') {
                  if (currentRes === step2Req) {
                    vSmartCount++;
                    if (vSmartCount >= seq.step2Qty) step2Met = true;
                  } else { step2Failed = true; }
                } else {
                  if (currentRes === step2Req) vSmartCount++;
                  if (vSmartCount >= seq.step2Qty) step2Met = true;
                  if (currentRes === step1Req) step2Failed = true;
                }
                if (step2Met) {
                  smartMatched = true;
                  vSmartStage = 1;
                  vSmartCount = 0;
                } else if (step2Failed) {
                  vSmartStage = 1;
                  if (seq.step1Mode === 'consecutive') {
                    const streak = step1Req === 'W' ? vConsecWins : vConsecLosses;
                    if (streak >= seq.step1Qty) {
                      vSmartStage = 2;
                      vSmartCount = 0;
                    } else {
                      vSmartCount = 0;
                    }
                  } else {
                    vSmartCount = (currentRes === step1Req) ? 1 : 0;
                  }
                }
              }
              useDerivStore.getState().setVirtualSettings({ vSmartStage, vSmartCount });
            } else if (smart.type === 'alternating' && smart.alternating) {
              const count = smart.alternating.count || 2;
              const reqLength = count * 2;
              if (newHistory.length >= reqLength) {
                const pattern = newHistory.slice(-reqLength);
                let isAlt = true;
                for (let i = 0; i < pattern.length - 1; i++) {
                  if (pattern[i] === pattern[i + 1]) { isAlt = false; break; }
                }
                if (isAlt) smartMatched = true;
              }
            }
          }

          let newVirtMode = vsV.isVirtualMode;
          let vDoubleStage = vsV.vDoubleStage || 'A';
          let vStageBCompletedReps = vsV.vStageBCompletedReps || 0;

          const isVirtSystemActive = (vsV.startVirtualToReal || vsV.isDoubleVirtual || vsV.smartSettings?.enabled) && !(get().adaptiveSwitch?.enabled && get().adaptiveSwitch?.virtualSwitcher?.enabled);
          if (isVirtSystemActive) {
            if (!vsV.isDoubleVirtual) {
              let thresholdPassed = false;
              if (vsV.startVirtualToReal) {
                const threshold = Math.max(1, Number(vsV.vThreshold) || 1);
                const mode = vsV.vTriggerMode ?? 'consec';
                const type = vsV.vTriggerType ?? 'losses';
                const isWindowEnabled = Boolean(vsV.vInEnabled);
                if (isWindowEnabled) {
                  const windowSize = Math.max(1, Number(vsV.vInTrades) || 5);
                  const windowHistory = newHistory.slice(-windowSize);
                  if (mode === 'total') {
                    const matchCount = windowHistory.filter(r => (type === 'losses' ? r === 'L' : r === 'W')).length;
                    if (matchCount >= threshold) thresholdPassed = true;
                  } else {
                    let maxConsec = 0;
                    let curConsec = 0;
                    for (const res of windowHistory) {
                      if ((type === 'losses' && res === 'L') || (type === 'wins' && res === 'W')) {
                        curConsec++;
                        if (curConsec > maxConsec) maxConsec = curConsec;
                      } else {
                        curConsec = 0;
                      }
                    }
                    if (maxConsec >= threshold) thresholdPassed = true;
                  }
                } else {
                  const streak = type === 'losses' ? vConsecLosses : vConsecWins;
                  const val = mode === 'total' ? (type === 'losses' ? virtualLosses : virtualWins) : streak;
                  if (val >= threshold) thresholdPassed = true;
                }
              }

              if (smartMatched || thresholdPassed) {
                newVirtMode = false;
                set({ botStatusMsg: `Virtual condition met (${smartMatched ? 'Smart Pattern' : `Threshold [${vsV.vThreshold}]`})! Switching to REAL.` });
              }
            } else {
              // ── Double Virtual Mode (2-Stage Cascade) ─────────────────────
              if (vDoubleStage === 'A') {
                let thresholdPassedA = false;
                if (vsV.startVirtualToReal) {
                  const thresholdA = Math.max(1, Number(vsV.vThreshold) || 1);
                  const modeA = vsV.vTriggerMode ?? 'consec';
                  const typeA = vsV.vTriggerType ?? 'losses';
                  const isWindowEnabledA = Boolean(vsV.vInEnabled);
                  if (isWindowEnabledA) {
                    const windowSize = Math.max(1, Number(vsV.vInTrades) || 5);
                    const windowHistory = newHistory.slice(-windowSize);
                    if (modeA === 'total') {
                      const matchCount = windowHistory.filter(r => (typeA === 'losses' ? r === 'L' : r === 'W')).length;
                      if (matchCount >= thresholdA) thresholdPassedA = true;
                    } else {
                      let maxConsec = 0;
                      let curConsec = 0;
                      for (const res of windowHistory) {
                        if ((typeA === 'losses' && res === 'L') || (typeA === 'wins' && res === 'W')) {
                          curConsec++;
                          if (curConsec > maxConsec) maxConsec = curConsec;
                        } else {
                          curConsec = 0;
                        }
                      }
                      if (maxConsec >= thresholdA) thresholdPassedA = true;
                    }
                  } else {
                    const streak = typeA === 'losses' ? vConsecLosses : vConsecWins;
                    const valA = modeA === 'total' ? (typeA === 'losses' ? virtualLosses : virtualWins) : streak;
                    if (valA >= thresholdA) thresholdPassedA = true;
                  }
                }

                if (smartMatched || thresholdPassedA) {
                  vDoubleStage = 'B';
                  vConsecWinsB = 0; vConsecLossesB = 0; vVirtualWinsB = 0; vVirtualLossesB = 0;
                  vStageBCompletedReps = 0;
                  newVirtMode = true; // Stay in virtual for Stage B gate
                  set({ botStatusMsg: `⚡ Double Virt: Stage A Gate Passed ${smartMatched ? '(Smart Pattern)' : `[Stage A Gate]`}! Advanced to Stage B.` });
                }
              } else if (vDoubleStage === 'B') {
                if (isRoundWinB) {
                  vConsecWinsB++; vConsecLossesB = 0; vVirtualWinsB++;
                } else {
                  vConsecWinsB = 0; vConsecLossesB++; vVirtualLossesB++;
                }
                const newHistoryB: ('W' | 'L')[] = [...(vsV.vResultHistoryB || []), currentRes].slice(-50);
                const targetTypeB = vsV.vTriggerTypeB || 'wins';
                const targetModeB = vsV.vTriggerModeB || 'consec';
                const targetB = Math.max(1, Number(vsV.vThresholdB) || 1);
                const isWindowEnabledB = Boolean(vsV.vInEnabledB);

                let stageBPassed = false;
                if (isWindowEnabledB) {
                  const windowSizeB = Math.max(1, Number(vsV.vInTradesB) || 5);
                  const windowHistoryB = newHistoryB.slice(-windowSizeB);
                  if (targetModeB === 'total') {
                    const matchCountB = windowHistoryB.filter(r => (targetTypeB === 'wins' ? r === 'W' : r === 'L')).length;
                    if (matchCountB >= targetB) stageBPassed = true;
                  } else {
                    let maxConsecB = 0;
                    let curConsecB = 0;
                    for (const res of windowHistoryB) {
                      if ((targetTypeB === 'wins' && res === 'W') || (targetTypeB === 'losses' && res === 'L')) {
                        curConsecB++;
                        if (curConsecB > maxConsecB) maxConsecB = curConsecB;
                      } else {
                        curConsecB = 0;
                      }
                    }
                    if (maxConsecB >= targetB) stageBPassed = true;
                  }
                } else {
                  const valB = targetTypeB === 'wins'
                    ? (targetModeB === 'consec' ? vConsecWinsB : vVirtualWinsB)
                    : (targetModeB === 'consec' ? vConsecLossesB : vVirtualLossesB);
                  if (valB >= targetB) stageBPassed = true;
                }

                if (stageBPassed) {
                  newVirtMode = false; // Trigger REAL trade for Stage B
                  set({ botStatusMsg: `⚡ Double Virt: Stage B Gate Passed [Stage B Gate]! Switching to REAL.` });
                }
                useDerivStore.getState().setVirtualSettings({ vResultHistoryB: newHistoryB });
              }
            }
          }
          const isVsActiveSettlement = Boolean(get().adaptiveSwitch?.virtualSwitcher?.enabled);
          useDerivStore.getState().setVirtualSettings({
            isVirtualMode: isVsActiveSettlement ? useDerivStore.getState().virtualSettings.isVirtualMode : newVirtMode,
            startVirtualToReal: isVsActiveSettlement ? false : vsV.startVirtualToReal,
            startRealToVirtual: isVsActiveSettlement ? false : vsV.startRealToVirtual,
            isDoubleVirtual: isVsActiveSettlement ? false : vsV.isDoubleVirtual,
            vConsecWins, vConsecLosses, virtualWins, virtualLosses,
            vDoubleStage, vConsecWinsB, vConsecLossesB, vVirtualWinsB, vVirtualLossesB, vStageBCompletedReps,
            vResultHistory: newHistory,
          });
        }

        // Legacy (no roundId) streak tracking — one per unsettled contract
        for (const rt of resolved) {
          if (!rt.roundId) {
            processVirtualSwitcherResult(rt.isWin, get, set);
            const vsV = useDerivStore.getState().virtualSettings;
            let { vConsecWins, vConsecLosses, virtualWins, virtualLosses } = vsV;
            if (rt.isWin) { vConsecWins++; vConsecLosses = 0; virtualWins++; }
            else          { vConsecWins = 0; vConsecLosses++; virtualLosses++; }
            const isVsSingle = Boolean(get().adaptiveSwitch?.virtualSwitcher?.enabled);
            let newVirtMode = isVsSingle ? useDerivStore.getState().virtualSettings.isVirtualMode : vsV.isVirtualMode;
            if (vsV.startVirtualToReal && !isVsSingle) {
              const streak = vsV.vTriggerType === 'losses' ? vConsecLosses : vConsecWins;
              if (streak >= vsV.vThreshold) {
                newVirtMode = false;
                set({ botStatusMsg: `Virtual threshold [${vsV.vThreshold}] hit! Switching to REAL.` });
              }
            }
            useDerivStore.getState().setVirtualSettings({
              isVirtualMode: isVsSingle ? useDerivStore.getState().virtualSettings.isVirtualMode : newVirtMode,
              startVirtualToReal: isVsSingle ? false : vsV.startVirtualToReal,
              startRealToVirtual: isVsSingle ? false : vsV.startRealToVirtual,
              isDoubleVirtual: isVsSingle ? false : vsV.isDoubleVirtual,
              vConsecWins, vConsecLosses, virtualWins, virtualLosses,
            });
          }
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

          // ── GLOBAL shared martingale state (across ALL strategies and ALL markets) ─
          // Every strategy and every market share ONE stake ladder. A loss on ANY
          // strategy/market advances the global martingale for the NEXT trade,
          // regardless of which strategy fires next. A win resets it for all.
          const GLOBAL_KEY = '__global__';
          if (!eng.strategyState[GLOBAL_KEY]) {
            eng.strategyState[GLOBAL_KEY] = {
              currentStake: baseStake, lossCount: 0, totalProfit: 0,
              won: 0, lost: 0, lastTriggerMarket: '', cooldown: false,
            };
          }
          const ss = eng.strategyState[GLOBAL_KEY];

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
            } else {
              continue;
            }
          }

          // ── ONE TRADE AT A TIME GLOBALLY (critical for martingale accuracy) ─
          //
          // All strategies share ONE stake ladder, so if ANY strategy/market
          // has an in-flight trade, we block ALL others. This guarantees:
          //   1. The global martingale state (currentStake / lossCount) is always
          //      fully updated before ANY next trade fires.
          //   2. No two strategies can race to update the ladder with stale stakes.
          const hasAnyActiveGlobally = eng.activeTrades.size > 0;
          const hasVirt = eng.activeVirtual.length > 0;
          if (hasAnyActiveGlobally || hasVirt) continue;

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
              if (patNowTrue && rts.lastWasTrue) {
                // already fired on this edge
                continue;
              }
              rts.lastWasTrue = patNowTrue;
              if (!patNowTrue) continue;
            } else if (dpCond.patternRetrigger === 'wait_opp') {
              if (patNowTrue) {
                if (rts.waitingForOpposite) {
                  continue;
                }
                rts.waitingForOpposite = true;
              } else {
                rts.waitingForOpposite = false;
                continue;
              }
            }
          }

          // ── THEN / THENALL sequential box gate ────────────────────────────
          // Only applies when a DIGIT_PATTERN condition has patternBoxMode set to
          // THEN or THENALL. In these modes we bypass normal OR-box evaluation
          // and instead run a two-phase state machine per strategy.
          const dpCondForMode = s.conditions.find(c => c.type === 'DIGIT_PATTERN');
          const boxMode = dpCondForMode?.patternBoxMode ?? 'OR';

          if (dpCondForMode && (boxMode === 'THEN' || boxMode === 'THENALL')) {
            const timeout   = dpCondForMode.thenTimeout   ?? 20;
            const maxTrades = dpCondForMode.thenMaxTrades ?? 3;

            // Initialise thenState for this strategy if needed
            if (!eng.thenState[stratId]) {
              eng.thenState[stratId] = {
                phase: 'scanning_box1', lockedSymbol: null,
                ticksWaited: 0, tradesThisRound: 0, lastTickEpoch: 0,
              };
            }
            const ts = eng.thenState[stratId];

            if (ts.phase === 'scanning_box1') {
              // ── Phase 1: scan all markets for Box 1 ──────────────────────
              // Only evaluate other (non-DIGIT_PATTERN) conditions AND Box 1
              const otherCondsPass = s.conditions
                .filter(c => c.type !== 'DIGIT_PATTERN')
                .every(c => evaluateCondition(c, digits, quotes, symbol, s.tradeType));

              const box1Pass = otherCondsPass && evaluateOneBox(dpCondForMode, 0, digits, quotes);

              if (box1Pass) {
                // Box 1 matched — lock and switch to phase 2
                ts.phase = 'locked_box2';
                ts.lockedSymbol = symbol;
                ts.ticksWaited = 0;
                ts.tradesThisRound = 0;
                ts.lastTickEpoch = 0;
                const mLabel = ALL_MARKETS.find(m => m.value === symbol)?.label || symbol;
                set({ botStatusMsg: `⏳ THEN: Box 1 matched on ${mLabel} — waiting for Box 2` });
              }
              // Either way: no trade fires in phase 1
              continue;

            } else {
              // ── Phase 2: locked_box2 ──────────────────────────────────────

              if (boxMode === 'THEN') {
                // ── THEN: only operate on the locked market ─────────────────
                // Skip all other markets entirely — no tick counting, no evaluation
                if (symbol !== ts.lockedSymbol) continue;

                // Count one real tick on the locked market only.
                // Use the market's latest epoch to deduplicate in case the scan
                // loop calls this symbol more than once in the same tick.
                const thisEpoch = regime?.lastEpoch ?? now;
                if (thisEpoch !== ts.lastTickEpoch) {
                  ts.ticksWaited++;
                  ts.lastTickEpoch = thisEpoch;
                }

                // Check timeout on the locked market's ticks
                if (ts.ticksWaited > timeout) {
                  ts.phase = 'scanning_box1';
                  ts.lockedSymbol = null;
                  set({ botStatusMsg: `⌛ THEN timeout after ${timeout} ticks — rescanning Box 1` });
                  continue;
                }

                // Evaluate Box 2 on the locked market
                const box2Pass = evaluateOneBox(dpCondForMode, 1, digits, quotes);
                if (!box2Pass) {
                  const rem = timeout - ts.ticksWaited;
                  set({ botStatusMsg: `⏳ THEN: waiting for Box 2 on ${ts.lockedSymbol} (${rem} ticks left)` });
                  continue;
                }

                // ✅ Box 2 matched — fire trade, reset state
                ts.phase = 'scanning_box1';
                ts.lockedSymbol = null;
                // Fall through to trade-firing code below

              } else {
                // ── THENALL: watch ALL markets for Box 2 ────────────────────
                // Increment the shared tick counter once per unique tick epoch
                // across all markets (first market in the scan that sees a new epoch wins)
                const thisEpoch = regime?.lastEpoch ?? now;
                if (thisEpoch !== ts.lastTickEpoch) {
                  ts.ticksWaited++;
                  ts.lastTickEpoch = thisEpoch;
                }

                // Timeout check
                if (ts.ticksWaited > timeout) {
                  ts.phase = 'scanning_box1';
                  ts.lockedSymbol = null;
                  set({ botStatusMsg: `⌛ THENALL timeout after ${timeout} ticks — rescanning Box 1` });
                  continue;
                }

                // Evaluate Box 2 on this market
                const box2Pass = evaluateOneBox(dpCondForMode, 1, digits, quotes);
                if (!box2Pass) continue;

                // ✅ Box 2 matched on this market — fire trade
                ts.tradesThisRound++;
                if (ts.tradesThisRound >= maxTrades) {
                  ts.phase = 'scanning_box1';
                  ts.lockedSymbol = null;
                }
                // Fall through to trade-firing code below
              }
            }

          } else {
            // ── Normal OR mode ─────────────────────────────────────────────
            if (!evalStrategy(s, digits, quotes, symbol)) {
              // Reset no_contra edge when pattern clears
              if (dpCond && dpCond.patternRetrigger === 'no_contra') {
                const rtKey = `${stratId}_${symbol}`;
                if (eng.retrigger[rtKey]) eng.retrigger[rtKey].lastWasTrue = false;
              }
              continue;
            }
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

          // Disarm/consume any RSI_SIGNAL conditions for this strategy & symbol so it trades once per signal
          s.conditions.forEach(c => {
            if (c.type === 'RSI_SIGNAL') {
              consumeRsiSignal(`${symbol}__${c.id}`);
            }
          });



          // Enforce 2 decimal places strictly on the stake (Virtual strictly uses baseStake; Real uses ss.currentStake)
          const rawStake = isVirtual ? baseStake : Math.max(0.35, ss.currentStake);
          const tradeStake = Math.round(rawStake * 100) / 100;



          const aSwitch = state.adaptiveSwitch;
          let tradesToPlace: { contractType: string; barrier?: number; count: number; ticks?: number }[] = [];

          const isVSActive = Boolean(aSwitch.virtualSwitcher?.enabled);
          if (isVSActive) {
            const vs = aSwitch.virtualSwitcher!;
            if (isVirtual) {
              const vc = vs.virtualContract || { contractType: 'DIGITEVEN', ticks: 1 };
              const targetContract = normalizeContractType(vc.contractType || (vc as any).type || 'DIGITEVEN');
              const targetTicks = Math.max(1, vc.ticks || s.ticks || 1);
              tradesToPlace = [{
                contractType: targetContract,
                barrier: needsBarrier(targetContract) ? (vc.barrier ?? 4) : undefined,
                count: 1,
                ticks: targetTicks,
              }];
              const lbl = TRADE_OPTIONS.find(o => o.value === targetContract)?.label || targetContract;
              const barText = vc.barrier !== undefined && needsBarrier(targetContract) ? ` ${vc.barrier}` : '';
              const mMode = vs.onVirtualWins?.mode === 'consec' ? 'Streak' : 'Total';
              set({ adaptiveLiveStatus: `🧪 V-SWITCHER [Virtual]: Testing ${lbl}${barText} (${mMode}: ${vs._consecWins || 0}W / ${vs._consecLosses || 0}L)` });
            } else {
              const ac = vs._activeContract || { contractType: vs.onVirtualWins?.contractType || 'DIGITUNDER', barrier: vs.onVirtualWins?.barrier, ticks: vs.onVirtualWins?.ticks || 1 };
              const targetContract = normalizeContractType(ac.contractType || (ac as any).type || 'DIGITUNDER');
              const targetTicks = Math.max(1, ac.ticks || s.ticks || 1);
              tradesToPlace = [{
                contractType: targetContract,
                barrier: needsBarrier(targetContract) ? (ac.barrier ?? 4) : undefined,
                count: 1,
                ticks: targetTicks,
              }];
              const lbl = TRADE_OPTIONS.find(o => o.value === targetContract)?.label || targetContract;
              const barText = ac.barrier !== undefined && needsBarrier(targetContract) ? ` ${ac.barrier}` : '';
              const rRule = vs.returnToVirtual || { triggerType: 'wins', mode: 'consec', threshold: 1 };
              const rCount = rRule.triggerType === 'wins' ? (rRule.mode === 'consec' ? vs._rConsecWins || 0 : vs._rTotalWins || 0)
                : rRule.triggerType === 'losses' ? (rRule.mode === 'consec' ? vs._rConsecLosses || 0 : vs._rTotalLosses || 0)
                : (vs._rTotalTrades || 0);
              set({ adaptiveLiveStatus: `⚡ V-SWITCHER [REAL]: Trading ${lbl}${barText} (${rCount}/${rRule.threshold} ${rRule.triggerType} to Virtual)` });
            }
          } else if (aSwitch.enabled) {
            const isAdaptiveMode = aSwitch.mode === 'adaptive';
            if (isAdaptiveMode) {
              const ac = aSwitch.adaptiveContracts || {
                contractA: { type: 'DIGITEVEN', barrier: 4, ticks: 5 },
                contractB: { type: 'DIGITODD', barrier: 4, ticks: 5 },
                activeSide: 'A',
                startSide: 'A',
              };
              const activeSide = ac.activeSide || ac.startSide || 'A';
              const activeContract = activeSide === 'A' ? (ac.contractA || { type: 'DIGITEVEN', barrier: 4, ticks: 5 }) : (ac.contractB || { type: 'DIGITODD', barrier: 4, ticks: 5 });

              if (aSwitch.dualMode) {
                const altContract = activeSide === 'A' ? (ac.contractB || { type: 'DIGITODD', barrier: 4, ticks: 5 }) : (ac.contractA || { type: 'DIGITEVEN', barrier: 4, ticks: 5 });
                tradesToPlace = [
                  { contractType: activeContract.type || 'DIGITEVEN', barrier: needsBarrier(activeContract.type || 'DIGITEVEN') ? (activeContract.barrier ?? s.prediction ?? 4) : undefined, count: 1, ticks: activeContract.ticks || s.ticks },
                  { contractType: altContract.type || 'DIGITODD', barrier: needsBarrier(altContract.type || 'DIGITODD') ? (altContract.barrier ?? s.prediction ?? 4) : undefined, count: 1, ticks: altContract.ticks || s.ticks },
                ];
              } else {
                tradesToPlace = [{
                  contractType: activeContract.type || 'DIGITEVEN',
                  barrier: needsBarrier(activeContract.type || 'DIGITEVEN') ? (activeContract.barrier ?? s.prediction ?? 4) : undefined,
                  count: 1,
                  ticks: activeContract.ticks || s.ticks,
                }];
              }

              const lblA = TRADE_OPTIONS.find(o => o.value === (activeContract.type || 'DIGITEVEN'))?.label || activeContract.type;
              set({ adaptiveLiveStatus: `⚡ ADAPTIVE: ${lblA} (Side ${activeSide}) [Auto-Switch on Loss]` });
            } else if (aSwitch.steps.length > 0) {
              const pos = eng.adaptivePos;
              if (pos.stepIndex >= aSwitch.steps.length) {
                pos.stepIndex = 0; pos.repCount = 0;
              }
              const curStep = aSwitch.steps[pos.stepIndex];
              if (curStep.trades && curStep.trades.length > 0) {
                tradesToPlace = curStep.trades.map((t: any) => ({
                  contractType: t.contractType,
                  barrier: needsBarrier(t.contractType) ? (t.barrier ?? s.prediction ?? 4) : undefined,
                  count: t.count || 1,
                  ticks: t.ticks || curStep.ticks || s.ticks,
                }));
              } else {
                tradesToPlace = [{
                  contractType: curStep.contractType || 'DIGITEVEN',
                  barrier: needsBarrier(curStep.contractType || 'DIGITEVEN') ? (s.prediction ?? 4) : undefined,
                  count: 1,
                  ticks: curStep.ticks || s.ticks,
                }];
              }

              const stepLabel = tradesToPlace.map(t => {
                const lbl = TRADE_OPTIONS.find(o => o.value === t.contractType)?.label || t.contractType;
                return t.count > 1 ? `${lbl} (x${t.count})` : lbl;
              }).join(' + ');
              const liveStatus = `${stepLabel} [Step ${pos.stepIndex + 1}, ${pos.repCount + 1}/${curStep.reps}]`;
              set({ adaptiveLiveStatus: liveStatus });
            }
          } else {
            tradesToPlace = [{
              contractType: s.tradeType,
              barrier: needsBarrier(s.tradeType) ? s.prediction : undefined,
              count: 1,
              ticks: s.ticks,
            }];
          }

          const dpCondCC = s.conditions.find(c => c.type === 'DIGIT_PATTERN');
          if (!aSwitch.enabled && dpCondCC?.useCustomContracts && dpCondCC.customContracts && dpCondCC.customContracts.length > 0) {
            const stepIndex = Math.min(ss.lossCount, dpCondCC.customContracts.length - 1);
            const box = dpCondCC.customContracts[stepIndex];
            if (box) {
              tradesToPlace = [{
                contractType: box.type,
                barrier: needsBarrier(box.type) ? box.barrier : undefined,
                count: 1,
                ticks: s.ticks,
              }];
            }
          }

          // ── Dual-mode override: exactly 2 trades, count = 1 each ─────────────
          const isDualMode = aSwitch.enabled && aSwitch.dualMode && !aSwitch.virtualSwitcher?.enabled;
          if (isDualMode) {
            const slotA = tradesToPlace[0] ?? { contractType: 'DIGITEVEN', count: 1, ticks: s.ticks };
            const slotB = tradesToPlace[1] ?? slotA;
            tradesToPlace = [
              { contractType: slotA.contractType, barrier: slotA.barrier, count: 1, ticks: slotA.ticks || s.ticks },
              { contractType: slotB.contractType, barrier: slotB.barrier, count: 1, ticks: slotB.ticks || s.ticks },
            ];
          }

          if (s.noContradiction) {
            const firstT = tradesToPlace[0] || { contractType: s.tradeType, barrier: s.prediction };
            eng.waitingForOpposite[ck] = { contractType: firstT.contractType, prediction: firstT.barrier ?? 0 };
          }

          const mLabel   = ALL_MARKETS.find(m => m.value === symbol)?.label || symbol;
          const currency = account?.currency || 'USD';

          // Flatten list of orders to send
          const orders: { contractType: string; barrier?: number; ticks: number }[] = [];
          for (const item of tradesToPlace) {
            const cnt = Math.max(1, Math.min(20, item.count || 1));
            const itemTicks = item.ticks || s.ticks || 1;
            const normC = normalizeContractType(item.contractType);
            for (let i = 0; i < cnt; i++) {
              orders.push({ contractType: normC, barrier: item.barrier, ticks: itemTicks });
            }
          }

          // ── Cross-market delay guard (strictly applies to both Real and Virtual trades) ──
          const delayMs = parseFloat(state.crossMarketDelay || '1.5') * 1000;
          if (now - eng.lastTradeTime < delayMs) {
            continue;
          }

          const roundId = `round_${stratId}_${now}_${Math.floor(Math.random() * 9999)}`;
          eng.roundState[roundId] = {
            totalCount: orders.length,
            finishedCount: 0,
            wonCount: 0,
            lostCount: 0,
            netProfit: 0,
            baseStake: baseStake,
            isVirtual: isVirtual,
            symbol: symbol,
            dualMode: isDualMode,
          };

          if (isVirtual) {
            orders.forEach((order, idx) => {
              const fakeId = `VIRT_${now}_${si}_${idx}_${Math.floor(Math.random() * 9999)}`;
              const entryPrice = quotes[quotes.length - 1] || 0;
              const entryDigit = digits[digits.length - 1] ?? 0;
              const normC = normalizeContractType(order.contractType);

              eng.activeVirtual.push({
                requestId: fakeId, stratId, symbol,
                stake: tradeStake, contractType: normC, barrier: order.barrier,
                entryPrice, duration: order.ticks, ticksCount: 0,
                lastEpoch: regime.lastEpoch || 0,
                roundId,
              });

              const isFullSpotVirt = normC === 'CALL' || normC === 'PUT' ||
                                     normC === 'RUNHIGH' || normC === 'RUNLOW';
              const entrySpotDisplay = isFullSpotVirt ? String(entryPrice) : String(entryDigit);

              get().addLog({
                id: fakeId, time: now, symbol, strategyIndex: si,
                contract: normC, stake: tradeStake,
                result: 'VIRTUAL', profit: 0,
                entrySpot: entrySpotDisplay,
                exitSpot:  '-',
                step: ss.lossCount + 1,
              });
            });

            eng.cooldown[ck] = now;
            eng.lastTradeTime = now;
            const labels = tradesToPlace.map(t => {
              const l = TRADE_OPTIONS.find(o => o.value === t.contractType)?.label || t.contractType;
              return t.count > 1 ? `${l} (x${t.count})` : l;
            }).join(' + ');
            set({
              lastSignal:   `[VIRTUAL] Strategy ${si + 1} on ${mLabel} → ${labels}`,
              botStatusMsg: `[VIRTUAL] ${labels} on ${mLabel}`,
            });

          } else {
            // Guard: check account balance before attempting to place any real trade
            const account = useDerivStore.getState().account;
            const balance = account?.balance;
            const totalRequiredStake = orders.length * tradeStake;
            if (balance !== undefined && balance !== null && !isNaN(balance) && (totalRequiredStake > balance || tradeStake > balance)) {
              delete eng.roundState[roundId];
              get().stopBot(
                `⛔ Insufficient Balance: Required stake USD ${tradeStake.toFixed(2)} exceeds account balance USD ${balance.toFixed(2)}. Bot stopped to protect remaining funds.`
              );
              return;
            }

            const entryDigit = digits[digits.length - 1] ?? 0;
            let firstRequestSuccess = false;

            const batchPayloads = orders.map(order => ({
              contract_type: order.contractType,
              stake: tradeStake,
              symbol,
              currency,
              duration: order.ticks,
              duration_unit: 't',
              barrier: order.barrier !== undefined ? order.barrier : undefined,
            }));

            const requestIds = tradeWS.executeBatchTrades(batchPayloads);

            requestIds.forEach((requestId, idx) => {
              const order = orders[idx];
              if (requestId) {
                firstRequestSuccess = true;
                botTradeIds.add(requestId);
                eng.activeTrades.set(requestId, {
                  stratId, symbol, stake: tradeStake, startTime: now, roundId
                });

                get().addLog({
                  id: requestId, time: now, symbol, strategyIndex: si,
                  contract: order.contractType, stake: tradeStake,
                  result: 'SENT', profit: 0,
                  entrySpot: String(entryDigit),
                  exitSpot:  '-',
                  step: ss.lossCount + 1,
                });
              } else {
                const rs = eng.roundState[roundId];
                if (rs) rs.finishedCount++;
              }
            });

            if (firstRequestSuccess) {
              eng.cooldown[ck] = now;
              eng.lastTradeTime = now;
              const labels = tradesToPlace.map(t => {
                const l = TRADE_OPTIONS.find(o => o.value === t.contractType)?.label || t.contractType;
                return t.count > 1 ? `${l} (x${t.count})` : l;
              }).join(' + ');
              set({
                lastSignal:   `Strategy ${si + 1} on ${mLabel} → ${labels}`,
                botStatusMsg: `✓ Sent: ${labels} on ${mLabel} — waiting for result`,
              });
            } else {
              delete eng.roundState[roundId];
              continue;
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
          const errTrade = eng.activeTrades.get(data.requestId);
          eng.activeTrades.delete(data.requestId);
          get().updateLog(data.requestId, { result: 'ERROR', profit: 0 });

          const errMsg = String(data?.error || data?.message || '');
          const isBalanceError = /insufficient|balance|too low|not enough/i.test(errMsg);

          if (isBalanceError) {
            if (errTrade?.roundId) delete eng.roundState[errTrade.roundId];
            get().stopBot(`⛔ Insufficient Balance: Deriv rejected trade (${errMsg}). Bot stopped to protect remaining funds.`);
            return;
          }

          // Clear cooldown for this strategy+market so next signal fires immediately
          if (errTrade) {
            const ck = `${errTrade.stratId}_${errTrade.symbol}`;
            delete eng.cooldown[ck];
            eng.lastTradeTime = 0;

            if (errTrade.roundId && eng.roundState[errTrade.roundId]) {
              const rs = eng.roundState[errTrade.roundId];
              rs.finishedCount++;
              if (rs.finishedCount === rs.totalCount) {
                // Only resolve if at least one contract actually won or lost
                if (rs.wonCount > 0 || rs.lostCount > 0) {
                  resolveRound(errTrade.roundId, errTrade.stratId, get, set);
                } else {
                  delete eng.roundState[errTrade.roundId];
                }
              }
            }
          }
          // Force tradeWS to reconnect immediately (resets backoff to 0ms) so re-auth happens ASAP
          if (typeof window !== 'undefined') tradeWS.forceReconnect();
          // Don't block with an error status — just stay ready
          set({ botStatusMsg: 'Running. Waiting for conditions...' });
          return;
        }
        if (type !== 'TRADE_RESULT') return;

        const { requestId, profit: rawProfit, poc } = data;
        const trade = eng.activeTrades.get(requestId);
        if (!trade) return;

        const { stratId, symbol, stake: tradeStake, roundId } = trade;
        // Global martingale state — one ladder shared by ALL strategies and markets
        const ss = eng.strategyState['__global__'];
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

        // Update roundState if it exists, otherwise use fallback legacy single-trade logic
        // Capture round outcome BEFORE resolveRound deletes it (needed for streak tracking)
        let roundFinalWon  = -1;  // -1 = not a round trade
        let roundFinalLost = -1;
        if (roundId && eng.roundState[roundId]) {
          const rs = eng.roundState[roundId];
          rs.finishedCount++;
          rs.netProfit += resultProfit;
          if (isWin) rs.wonCount++; else rs.lostCount++;

          if (rs.finishedCount === rs.totalCount) {
            // Capture before deletion
            roundFinalWon  = rs.wonCount;
            roundFinalLost = rs.lostCount;
            resolveRound(roundId, stratId, get, set);
          }
        } else if (!roundId) {
          // Fallback legacy resolution logic (runs if no roundId is present)
          // ── Adaptive Switch position advancement ───────────────────────────
          const aSwState = get().adaptiveSwitch;
          if (aSwState.enabled && aSwState.steps.length > 0) {
            const pos = eng.adaptivePos;
            if (pos.stepIndex >= aSwState.steps.length) { pos.stepIndex = 0; pos.repCount = 0; }
            const curStepCfg = aSwState.steps[pos.stepIndex];
            if (isWin) {
              pos.repCount++;
              if (pos.repCount >= curStepCfg.reps) {
                pos.repCount  = 0;
                pos.stepIndex = (pos.stepIndex + 1) % aSwState.steps.length;
              }
            }
            const nextStep  = aSwState.steps[pos.stepIndex] ?? aSwState.steps[0];
            const nextLabel = TRADE_OPTIONS.find(t => t.value === nextStep.contractType)?.label || nextStep.contractType;
            set({ adaptiveLiveStatus: `${nextLabel} [Step ${pos.stepIndex + 1}, ${pos.repCount + 1}/${nextStep.reps}]` });
          }

          if (ss) {
            const isCompounding = useDerivStore.getState().compoundProfits;
            if (isWin) {
              ss.won++; ss.totalProfit += resultProfit; ss.lossCount = 0;
              if (isCompounding) {
                const raw = ss.currentStake + resultProfit;
                ss.currentStake = Math.max(baseStake, Math.round(raw * 100) / 100);
              } else {
                ss.currentStake = Math.round(baseStake * 100) / 100;
              }
              state.strategies.forEach(strat => { eng.patternPos[strat.id] = 0; });
            } else {
              ss.lost++; ss.totalProfit += resultProfit; ss.lossCount++;
              if (isCompounding) {
                ss.currentStake = Math.round(baseStake * 100) / 100;
                ss.lossCount = 0;
              } else if (state.isMartingaleEnabled !== false && (state.tradingMode === 'continuous' || state.tradingMode === 'target')) {
                const rawNextStake = ss.currentStake * parseFloat(state.martingale || '2.1');
                const maxMartingaleCap = baseStake * Math.pow(parseFloat(state.martingale || '2.1'), 10);
                const nextStake = Math.round(Math.min(rawNextStake, maxMartingaleCap) * 100) / 100;

                const account = derivState.account;
                const balance = account?.balance;
                if (balance !== undefined && balance !== null && !isNaN(balance) && nextStake > balance) {
                  ss.currentStake = nextStake; // Preserve accurate stake, DO NOT reset to base!
                  get().stopBot(
                    `⛔ Max Martingale / Insufficient Balance: Next stake USD ${nextStake.toFixed(2)} exceeds account balance USD ${balance.toFixed(2)}. Bot stopped to protect remaining funds.`
                  );
                  return;
                }

                ss.currentStake = nextStake;
              } else {
                ss.currentStake = Math.round(baseStake * 100) / 100;
              }
            }
          }
        }

        // Real streak tracking → auto-switch to virtual
        // Only runs when a round fully settles (roundFinalWon >= 0) or for
        // legacy single-trade cases (no roundId). Dual pushes (1W+1L) skip
        // streak updates so they don't corrupt rConsecWins/rConsecLosses.
        const roundJustSettled = roundFinalWon >= 0; // true only when resolveRound just fired
        const isRoundPush = roundJustSettled && roundFinalWon > 0 && roundFinalLost > 0;
        const shouldUpdateStreak = !isRoundPush && (roundJustSettled || !roundId);

        if (shouldUpdateStreak) {
          const vsState = derivState.virtualSettings;
          let { rConsecWins, rConsecLosses, realWins, realLosses } = vsState;

          // Determine round outcome: for round trades use final tally, for single use isWin
          const roundIsWin = roundJustSettled ? roundFinalWon > roundFinalLost : isWin;
          if (roundIsWin) { rConsecWins++; rConsecLosses = 0; realWins++; }
          else            { rConsecWins = 0; rConsecLosses++; realLosses++; }

          const isVsActive = Boolean(get().adaptiveSwitch?.virtualSwitcher?.enabled);
          if (isVsActive && !roundJustSettled) {
            processVirtualSwitcherRealResult(roundIsWin, get, set);
          }

          let newIsVirtual = isVsActive ? useDerivStore.getState().virtualSettings.isVirtualMode : vsState.isVirtualMode;
          if (!isVsActive && vsState.startRealToVirtual) {
            const streak = vsState.rTriggerType === 'losses' ? rConsecLosses : rConsecWins;
            if (streak >= vsState.rThreshold) {
              newIsVirtual = true;
              set({ botStatusMsg: `Real threshold [${vsState.rThreshold}] hit! Switching to VIRTUAL.` });
            }
          }
          derivState.setVirtualSettings({
            isVirtualMode: isVsActive ? useDerivStore.getState().virtualSettings.isVirtualMode : newIsVirtual,
            startVirtualToReal: isVsActive ? false : vsState.startVirtualToReal,
            startRealToVirtual: isVsActive ? false : vsState.startRealToVirtual,
            isDoubleVirtual: isVsActive ? false : vsState.isDoubleVirtual,
            rConsecWins, rConsecLosses, realWins, realLosses,
          });
        }

        // Stop if limits hit — only check once the full round has settled,
        // or for legacy single-contract trades (no roundId).
        // Running this per-contract causes premature stops in dual mode when
        // one winning leg tips the profit target before the second contract resolves.
        const shouldCheckLimits = roundJustSettled || !roundId;
        if (shouldCheckLimits) {
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
        }

        eng.activeTrades.delete(requestId);
        eng.cooldown[`${stratId}_${symbol}`] = Date.now();
        eng.lastTradeTime = Date.now();
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
        isMartingaleEnabled: state.isMartingaleEnabled,
        tradingMode:     state.tradingMode,
        strategies:      state.strategies,
        selectedMarkets: state.selectedMarkets,
        theme:           state.theme,
        crossMarketDelay: state.crossMarketDelay,
        adaptiveSwitch:  state.adaptiveSwitch,
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
  }
}
