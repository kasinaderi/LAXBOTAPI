'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Check, Plus, Trash2, Sliders, Settings2, ShieldAlert,
  Layers, Sparkles, Copy, RefreshCw, Zap, TrendingUp, TrendingDown,
  ArrowLeftRight, Clock, Target, ChevronDown, ChevronUp, AlertTriangle,
  Flame, CheckCircle2
} from 'lucide-react';
import {
  Strategy, Condition, PatternBox, PatternTrigger,
  AdaptiveSwitch, AdaptiveSwitchStep, SwitcherTradeConfig,
  ALL_MARKETS, TRADE_OPTIONS,
  createCondition, createStrategy, needsBarrier,
  useBotStore
} from '@/store/useBotStore';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export interface LaxPrimeStepConfig {
  selectedMarkets: string[];
  strategies: Strategy[];
  tradingMode?: string;
  crossMarketDelay?: string;
  martingale?: string;
  adaptiveSwitch?: AdaptiveSwitch;
  virtualSettings?: {
    isVirtualMode?: boolean;
    startVirtualToReal?: boolean;
    vTriggerType?: 'wins' | 'losses';
    vTriggerMode?: 'consec' | 'total';
    vThreshold?: number;
    isDoubleVirtual?: boolean;
    vDoubleStage?: 'A' | 'B';
    vTriggerTypeB?: 'wins' | 'losses';
    vTriggerModeB?: 'consec' | 'total';
    vThresholdB?: number;
    vStageBReps?: number;
    startRealToVirtual?: boolean;
    rTriggerType?: 'wins' | 'losses';
    rTriggerMode?: 'consec' | 'total';
    rThreshold?: number;
    smartSettings?: {
      enabled: boolean;
      type: 'sequence' | 'alternating';
      sequence?: {
        step1Type: 'Wins' | 'Losses';
        step1Qty: number;
        step1Mode: 'consecutive' | 'total';
        step2Type: 'Wins' | 'Losses';
        step2Qty: number;
        step2Mode: 'consecutive' | 'total';
      };
      alternating?: { count: number };
    };
  };
}

interface MiniLaxPrimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  stepIndex: number;
  stepLabel: string;
  currentConfig?: LaxPrimeStepConfig;
  onSave: (config: LaxPrimeStepConfig) => void;
  currentCompoundedStake: string;
  capitalPct: string;
  isCapitalCompound: boolean;
  isCompounding: boolean;
}

const CONDITION_TYPES = [
  { value: 'EVEN_PCT',      label: 'EVEN % IS' },
  { value: 'ODD_PCT',       label: 'ODD % IS' },
  { value: 'FALL_PCT',      label: 'FALL % IS' },
  { value: 'RISE_PCT',      label: 'RISE % IS' },
  { value: 'OVER_PCT',      label: 'OVER ( ) % IS' },
  { value: 'UNDER_PCT',     label: 'UNDER ( ) % IS' },
  { value: 'LAST_DIGITS',   label: 'LAST N DIGITS ARE' },
  { value: 'GREEN_BAR',     label: 'GREEN BAR IS ON DIGIT' },
  { value: 'DIGIT_PATTERN', label: 'DIGIT PATTERN' },
  { value: 'DIGIT_APPEARS', label: 'IF DIGIT ( ) APPEARS' },
  { value: 'RSI_SIGNAL',    label: 'RSI SIGNAL [trade_lexx]' },
];

const COMPARATORS = ['>', '<', '=', '>=', '<='];

const DIGIT_OPTIONS = [
  { value: 'EVEN',       label: 'EVEN' },
  { value: 'ODD',        label: 'ODD' },
  { value: 'OVER',       label: '>(OVER)' },
  { value: 'UNDER',      label: '<(UNDER)' },
  { value: 'EQUAL',      label: '=(EQUAL)' },
  { value: 'RISE',       label: 'RISE' },
  { value: 'FALL',       label: 'FALL' },
  { value: 'ONLY_UPS',   label: 'Only Ups' },
  { value: 'ONLY_DOWNS', label: 'Only Downs' },
];

const MA_TYPES = ['SMA', 'EMA', 'WMA', 'HMA', 'KAMA', 'VWMA', 'ALMA', 'TEMA', 'ZLEMA', 'LSMA'];

function tokenNeedsBarrier(token: string): boolean {
  return token === 'V' || token === 'U' || token === 'M' || token === 'D';
}

function getTokenBgColor(token: string): string {
  switch (token) {
    case 'U': return '#2563eb';
    case 'V': return '#059669';
    case 'E': return '#0d9488';
    case 'O': return '#ea580c';
    case 'D': return '#dc2626';
    case 'M': return '#7c3aed';
    default: return '#475569';
  }
}

function conditionSummaryText(c: Condition): string {
  switch (c.type) {
    case 'EVEN_PCT':      return `EVEN % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'ODD_PCT':       return `ODD % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'FALL_PCT':      return `FALL % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'RISE_PCT':      return `RISE % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'OVER_PCT':      return `OVER(${c.digitBarrier ?? 4}) % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'UNDER_PCT':     return `UNDER(${c.digitBarrier ?? 4}) % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'LAST_DIGITS':   return `last ${c.lastN} digits are ${c.digitValue}`;
    case 'GREEN_BAR':     return `GREEN BAR on ${c.barValue} with pct ${c.comparator} ${c.value}%`;
    case 'DIGIT_PATTERN': return `PATTERN [${(c.patternBoxes?.length || 0)} boxes]`;
    case 'DIGIT_APPEARS': return `DIGIT ${(c.targetDigits || [c.digitBarrier ?? 5]).join('&')} APPEARS ${c.comparator} ${c.value}x`;
    case 'RSI_SIGNAL':    return `RSI(${c.rsiLength || 14}) [${c.rsiSignalAction || 'AUTO'}]`;
    default:              return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function MiniLaxPrimeModal({
  isOpen,
  onClose,
  stepIndex,
  stepLabel,
  currentConfig,
  onSave,
  currentCompoundedStake,
  capitalPct,
  isCapitalCompound,
  isCompounding,
}: MiniLaxPrimeModalProps) {
  // Local state for the step
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [tradingMode, setTradingMode] = useState<string>('continuous');
  const [crossMarketDelay, setCrossMarketDelay] = useState<string>('1.5');
  const [martingale, setMartingale] = useState<string>('2.1');
  const [adaptiveSwitch, setAdaptiveSwitch] = useState<AdaptiveSwitch>({
    enabled: false,
    dualMode: false,
    steps: [
      { contractType: 'DIGITEVEN', reps: 2 },
      { contractType: 'DIGITODD',  reps: 2 },
    ],
  });
  const [virtualSettings, setVirtualSettings] = useState<any>({
    isVirtualMode: false,
    startVirtualToReal: false,
    vTriggerType: 'wins',
    vTriggerMode: 'consec',
    vThreshold: 2,
  });

  // UI accordion tabs
  const [showVirtualPanel, setShowVirtualPanel] = useState(false);
  const [showSwitcherPanel, setShowSwitcherPanel] = useState(false);
  const [showMarketsPanel, setShowMarketsPanel] = useState(true);

  // Initialize or re-sync when modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (currentConfig && currentConfig.strategies && currentConfig.strategies.length > 0) {
      setStrategies(JSON.parse(JSON.stringify(currentConfig.strategies)));
      setSelectedMarkets(currentConfig.selectedMarkets || ['1HZ10V', '1HZ100V']);
      setTradingMode(currentConfig.tradingMode || 'continuous');
      setCrossMarketDelay(currentConfig.crossMarketDelay || '1.5');
      setMartingale(currentConfig.martingale || '2.1');
      if (currentConfig.adaptiveSwitch) {
        setAdaptiveSwitch(JSON.parse(JSON.stringify(currentConfig.adaptiveSwitch)));
      }
      if (currentConfig.virtualSettings) {
        setVirtualSettings(JSON.parse(JSON.stringify(currentConfig.virtualSettings)));
      }
    } else {
      // Default: copy from current global LaxPrime state so user has a smart starting baseline
      const liveState = useBotStore.getState();
      setStrategies(liveState.strategies?.length ? JSON.parse(JSON.stringify(liveState.strategies)) : [createStrategy(0)]);
      setSelectedMarkets(liveState.selectedMarkets?.length ? [...liveState.selectedMarkets] : ['1HZ10V', '1HZ100V']);
      setTradingMode(liveState.tradingMode || 'continuous');
      setCrossMarketDelay(liveState.crossMarketDelay || '1.5');
      setMartingale(liveState.martingale || '2.1');
      setAdaptiveSwitch(liveState.adaptiveSwitch ? JSON.parse(JSON.stringify(liveState.adaptiveSwitch)) : {
        enabled: false,
        dualMode: false,
        steps: [
          { contractType: 'DIGITEVEN', reps: 2 },
          { contractType: 'DIGITODD',  reps: 2 },
        ],
      });
    }
  }, [isOpen, currentConfig]);

  if (!isOpen) return null;

  // ── Strategy helpers ────────────────────────────────────────────────────────
  const updateStrategy = (idx: number, patch: Partial<Strategy>) => {
    setStrategies(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const addStrategy = () => {
    if (strategies.length >= 5) return;
    setStrategies(prev => [...prev, createStrategy(prev.length)]);
  };

  const removeStrategy = (idx: number) => {
    setStrategies(prev => prev.filter((_, i) => i !== idx));
  };

  const addConditionToStrat = (stratIdx: number) => {
    setStrategies(prev => prev.map((s, i) => {
      if (i !== stratIdx) return s;
      return { ...s, conditions: [...s.conditions, createCondition()] };
    }));
  };

  const updateConditionInStrat = (stratIdx: number, condId: string, updated: Condition) => {
    setStrategies(prev => prev.map((s, i) => {
      if (i !== stratIdx) return s;
      return {
        ...s,
        conditions: s.conditions.map(c => c.id === condId ? updated : c),
      };
    }));
  };

  const removeConditionFromStrat = (stratIdx: number, condId: string) => {
    setStrategies(prev => prev.map((s, i) => {
      if (i !== stratIdx) return s;
      return { ...s, conditions: s.conditions.filter(c => c.id !== condId) };
    }));
  };

  // ── Quick Preset loader ───────────────────────────────────────────────────
  const applyQuickPreset = (presetKey: string) => {
    if (presetKey === 'copy_live') {
      const liveState = useBotStore.getState();
      setStrategies(JSON.parse(JSON.stringify(liveState.strategies || [createStrategy(0)])));
      setSelectedMarkets([...(liveState.selectedMarkets || ['1HZ10V', '1HZ100V'])]);
      setTradingMode(liveState.tradingMode || 'continuous');
      setCrossMarketDelay(liveState.crossMarketDelay || '1.5');
      setMartingale(liveState.martingale || '2.1');
      if (liveState.adaptiveSwitch) setAdaptiveSwitch(JSON.parse(JSON.stringify(liveState.adaptiveSwitch)));
    } else if (presetKey === 'even_only') {
      const s = createStrategy(0);
      s.tradeType = 'DIGITEVEN';
      s.ticks = 1;
      s.conditions = [{
        ...createCondition(),
        type: 'LAST_DIGITS',
        lastN: 4,
        digitValue: 'ODD',
      }];
      setStrategies([s]);
      setSelectedMarkets(['1HZ10V', '1HZ100V']);
    } else if (presetKey === 'over_under') {
      const s1 = createStrategy(0);
      s1.tradeType = 'DIGITOVER';
      s1.prediction = 4;
      s1.ticks = 1;
      s1.conditions = [{
        ...createCondition(),
        type: 'UNDER_PCT',
        digitBarrier: 4,
        comparator: '>',
        value: 65,
        period: 100,
      }];
      setStrategies([s1]);
      setSelectedMarkets(['1HZ100V', 'R_100']);
    } else if (presetKey === 'rsi_signal') {
      const s = createStrategy(0);
      s.tradeType = 'CALL';
      s.ticks = 2;
      s.conditions = [{
        ...createCondition(),
        type: 'RSI_SIGNAL',
        rsiLength: 14,
        rsiTicksPerCandle: 5,
        rsiSignalAction: 'AUTO',
        rsiSignalHoldTicks: 10,
        rsiMaMode: true,
        rsiBbMode: true,
        rsiDivergenceMode: true,
        rsiFilterEnabled: true,
      }];
      setStrategies([s]);
      setSelectedMarkets(['1HZ10V', '1HZ100V']);
    } else if (presetKey === 'only_ups') {
      const s = createStrategy(0);
      s.tradeType = 'RUNHIGH';
      s.ticks = 2;
      s.conditions = [{
        ...createCondition(),
        type: 'FALL_PCT',
        comparator: '>',
        value: 60,
        period: 100,
      }];
      setStrategies([s]);
      // Exclude jump indices for Only Ups
      setSelectedMarkets(['1HZ10V', '1HZ100V', 'R_100']);
    }
  };

  const handleSave = () => {
    const configToSave: LaxPrimeStepConfig = {
      selectedMarkets: selectedMarkets.length > 0 ? selectedMarkets : ['1HZ10V', '1HZ100V'],
      strategies: strategies.length > 0 ? strategies : [createStrategy(0)],
      tradingMode,
      crossMarketDelay,
      martingale,
      adaptiveSwitch,
      virtualSettings,
    };
    onSave(configToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-[#0b0f19] border border-indigo-500/30 rounded-2xl shadow-2xl shadow-indigo-950/50 overflow-hidden">

        {/* ── Header ── */}
        <div className="p-4 md:p-5 border-b border-white/10 bg-slate-900/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-black text-sm">
              LX
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white tracking-wide">
                  Mini LaxPrime Settings
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-[10px] font-black text-indigo-300">
                  {stepLabel || `Step ${stepIndex + 1}`}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/30 text-[10px] font-black text-teal-300">
                  INDEPENDENT OVERRIDE
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Configure dedicated strategies, conditions, markets, and execution rules for this specific step.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close without saving"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Compounded Stake Banner (User requirement: Stake controlled by AutoTrade) ── */}
        <div className="px-5 py-2.5 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-indigo-950/40 border-b border-emerald-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-white">Stake Managed by Auto-Trade:</span>
              <span className="text-emerald-300 font-mono font-bold ml-1.5">${currentCompoundedStake}</span>
              <span className="text-gray-400 ml-2 text-[11px]">
                {isCapitalCompound
                  ? `(${capitalPct}% capital compounding active)`
                  : isCompounding
                  ? `(compounding active across all steps)`
                  : `(base stake)`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-gray-300">
              Martingale: {martingale}x
            </span>
            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-gray-300">
              Mode: {tradingMode}
            </span>
          </div>
        </div>

        {/* ── Quick Templates Bar ── */}
        <div className="px-5 py-2.5 border-b border-white/5 bg-white/2 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-gray-400 font-bold shrink-0 text-[10px] uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" /> Templates:
          </span>
          <button
            onClick={() => applyQuickPreset('copy_live')}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 font-bold shrink-0 transition-all flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copy Current LaxPrime
          </button>
          <button
            onClick={() => applyQuickPreset('even_only')}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 shrink-0 transition-all"
          >
            Even Only (1 Tick)
          </button>
          <button
            onClick={() => applyQuickPreset('over_under')}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 shrink-0 transition-all"
          >
            Over 4 / Under 5
          </button>
          <button
            onClick={() => applyQuickPreset('rsi_signal')}
            className="px-2.5 py-1 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 text-teal-300 shrink-0 transition-all"
          >
            RSI Signal [trade_lexx]
          </button>
          <button
            onClick={() => applyQuickPreset('only_ups')}
            className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 shrink-0 transition-all"
          >
            ↑ Only Ups (2-5 Ticks)
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 custom-scrollbar">

          {/* ── Markets Selection Card ── */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-black text-white uppercase tracking-wider">Target Markets</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono text-[10px] font-bold">
                  {selectedMarkets.length} selected
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <button
                  onClick={() => setSelectedMarkets(ALL_MARKETS.map(m => m.value))}
                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                >
                  Select All
                </button>
                <button
                  onClick={() => setSelectedMarkets(['1HZ10V', '1HZ100V'])}
                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                >
                  Default (1HZ)
                </button>
                <button
                  onClick={() => setSelectedMarkets([])}
                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ALL_MARKETS.map(m => {
                const isSel = selectedMarkets.includes(m.value);
                return (
                  <button
                    key={m.value}
                    onClick={() => {
                      setSelectedMarkets(prev =>
                        prev.includes(m.value) ? prev.filter(x => x !== m.value) : [...prev, m.value]
                      );
                    }}
                    className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold transition-all ${
                      isSel
                        ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-500/20'
                        : 'bg-white/5 border border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Trading Mode & Martingale Multiplier ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                Trading Mode
              </label>
              <select
                value={tradingMode}
                onChange={e => setTradingMode(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="continuous">Trade continuously on loss</option>
                <option value="once">Trade once per signal</option>
                <option value="target">Trade until target profit</option>
              </select>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                Cross-Market Delay
              </label>
              <div className="flex gap-1.5">
                {['1.5', '2.0', '3.0'].map(sec => (
                  <button
                    key={sec}
                    onClick={() => setCrossMarketDelay(sec)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all ${
                      crossMarketDelay === sec
                        ? 'bg-teal-500/20 border-teal-500 text-teal-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                Martingale Multiplier
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="10"
                  value={martingale}
                  onChange={e => setMartingale(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none"
                />
                <span className="text-xs text-gray-500 font-bold">x</span>
              </div>
            </div>
          </div>

          {/* ── Switcher Panel Toggle ── */}
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-black text-white uppercase tracking-wider">
                  Switcher (Adaptive Contracts)
                </span>
                {adaptiveSwitch.enabled && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-black">
                    ACTIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adaptiveSwitch.enabled}
                    onChange={e => setAdaptiveSwitch(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="accent-indigo-500"
                  />
                  <span className="text-xs font-bold text-gray-300">Enable Switcher</span>
                </label>
                <button
                  onClick={() => setShowSwitcherPanel(v => !v)}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  {showSwitcherPanel ? '▲ Hide' : '▼ Configure'}
                </button>
              </div>
            </div>

            {showSwitcherPanel && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="adaptive_mode"
                      checked={(adaptiveSwitch.mode || 'sequence') === 'sequence'}
                      onChange={() => setAdaptiveSwitch(prev => ({ ...prev, mode: 'sequence' }))}
                    />
                    <span>Sequence Steps (Step 1 → Step 2)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="adaptive_mode"
                      checked={adaptiveSwitch.mode === 'adaptive'}
                      onChange={() => setAdaptiveSwitch(prev => ({ ...prev, mode: 'adaptive' }))}
                    />
                    <span>Auto-Switch on Loss (Contract A ⇌ B)</span>
                  </label>
                </div>

                {/* Steps configuration */}
                {(adaptiveSwitch.mode || 'sequence') === 'sequence' && (
                  <div className="space-y-2">
                    {adaptiveSwitch.steps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-white/5 text-xs">
                        <span className="font-bold text-gray-400 w-16">Step {idx + 1}:</span>
                        <select
                          value={step.contractType || 'DIGITEVEN'}
                          onChange={e => {
                            const newType = e.target.value;
                            setAdaptiveSwitch(prev => ({
                              ...prev,
                              steps: prev.steps.map((s, i) => i === idx ? { ...s, contractType: newType } : s),
                            }));
                          }}
                          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-xs"
                        >
                          {TRADE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className="text-gray-500 text-[10px]">Reps:</span>
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={step.reps}
                            onChange={e => {
                              const reps = Math.max(1, +e.target.value || 1);
                              setAdaptiveSwitch(prev => ({
                                ...prev,
                                steps: prev.steps.map((s, i) => i === idx ? { ...s, reps } : s),
                              }));
                            }}
                            className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-center text-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Strategy Builder Header ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">
                Strategies ({strategies.length}/5)
              </h3>
            </div>
            <button
              onClick={addStrategy}
              disabled={strategies.length >= 5}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1 shadow-md transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add Strategy
            </button>
          </div>

          {/* ── Strategies List ── */}
          <div className="space-y-4">
            {strategies.map((strat, sIdx) => {
              const hasBarrier = needsBarrier(strat.tradeType);
              const isOnlyUD = strat.tradeType === 'RUNHIGH' || strat.tradeType === 'RUNLOW';

              return (
                <div
                  key={strat.id}
                  className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-4 hover:border-indigo-500/30 transition-all shadow-lg"
                >
                  {/* Strategy Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center text-xs font-black font-mono">
                        {sIdx + 1}
                      </div>
                      <span className="text-xs font-black text-white">STRATEGY {sIdx + 1}</span>
                      <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] text-gray-400">
                        {strat.conditions.length} condition{strat.conditions.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={strat.enabled}
                          onChange={e => updateStrategy(sIdx, { enabled: e.target.checked })}
                          className="accent-indigo-500"
                        />
                        <span className={strat.enabled ? 'text-emerald-400 font-bold' : 'text-gray-500 font-bold'}>
                          {strat.enabled ? 'ON' : 'OFF'}
                        </span>
                      </label>
                      {strategies.length > 1 && (
                        <button
                          onClick={() => removeStrategy(sIdx)}
                          className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove strategy"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Conditions List */}
                  <div className="space-y-2.5">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      IF CONDITIONS:
                    </div>

                    {strat.conditions.map((cond, cIdx) => (
                      <div
                        key={cond.id}
                        className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {cIdx > 0 && (
                            <select
                              value={cond.join}
                              onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, join: e.target.value as any })}
                              className="bg-indigo-500/20 text-indigo-300 font-bold text-xs rounded px-2 py-1 border border-indigo-500/30"
                            >
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          )}

                          <select
                            value={cond.type}
                            onChange={e => {
                              const newType = e.target.value as Condition['type'];
                              const patch: Partial<Condition> = { type: newType };
                              if (newType === 'RSI_SIGNAL') {
                                patch.rsiTicksPerCandle = 5;
                                patch.rsiLength = 14;
                                patch.rsiSignalAction = 'AUTO';
                                patch.rsiSignalHoldTicks = 10;
                                patch.rsiMaMode = true;
                                patch.rsiBbMode = true;
                                patch.rsiDivergenceMode = true;
                              }
                              updateConditionInStrat(sIdx, cond.id, { ...cond, ...patch });
                            }}
                            className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white font-bold"
                          >
                            {CONDITION_TYPES.map(ct => (
                              <option key={ct.value} value={ct.value}>{ct.label}</option>
                            ))}
                          </select>

                          {/* Specific controls based on condition type */}
                          {(cond.type === 'EVEN_PCT' || cond.type === 'ODD_PCT' || cond.type === 'FALL_PCT' || cond.type === 'RISE_PCT') && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-300">
                              <select
                                value={cond.comparator}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, comparator: e.target.value })}
                                className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs text-white"
                              >
                                {COMPARATORS.map(c => <option key={c}>{c}</option>)}
                              </select>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={cond.value}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, value: +e.target.value })}
                                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                              />
                              <span>% in last</span>
                              <input
                                type="number"
                                min="1"
                                max="1000"
                                value={cond.period}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, period: +e.target.value })}
                                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                              />
                              <span>ticks</span>
                            </div>
                          )}

                          {(cond.type === 'OVER_PCT' || cond.type === 'UNDER_PCT') && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-300">
                              <span>(</span>
                              <input
                                type="number"
                                min="0"
                                max="9"
                                value={cond.digitBarrier ?? 4}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, digitBarrier: +e.target.value })}
                                className="w-10 bg-white/5 border border-white/10 rounded px-1 text-center text-white"
                              />
                              <span>)</span>
                              <select
                                value={cond.comparator}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, comparator: e.target.value })}
                                className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs text-white"
                              >
                                {COMPARATORS.map(c => <option key={c}>{c}</option>)}
                              </select>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={cond.value}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, value: +e.target.value })}
                                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                              />
                              <span>% in last</span>
                              <input
                                type="number"
                                min="1"
                                max="1000"
                                value={cond.period}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, period: +e.target.value })}
                                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                              />
                              <span>ticks</span>
                            </div>
                          )}

                          {cond.type === 'LAST_DIGITS' && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-300">
                              <span>last</span>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                value={cond.lastN}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, lastN: +e.target.value })}
                                className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                              />
                              <span>digits are</span>
                              <select
                                value={cond.digitValue}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, digitValue: e.target.value })}
                                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white"
                              >
                                {DIGIT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                              </select>
                            </div>
                          )}

                          {cond.type === 'RSI_SIGNAL' && (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                              <select
                                value={cond.rsiSignalAction || 'AUTO'}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, rsiSignalAction: e.target.value as any })}
                                className="bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 rounded px-2 py-1 text-xs font-bold"
                              >
                                <option value="AUTO">AUTO (Matches Trade Type)</option>
                                <option value="BUY">BUY Only</option>
                                <option value="SELL">SELL Only</option>
                              </select>
                              <span>Ticks/Bar:</span>
                              <input
                                type="number"
                                min="1"
                                max="60"
                                value={cond.rsiTicksPerCandle ?? 5}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, rsiTicksPerCandle: +e.target.value })}
                                className="w-12 bg-white/5 border border-white/10 rounded px-1 text-center text-white"
                              />
                              <span>RSI Len:</span>
                              <input
                                type="number"
                                min="2"
                                max="50"
                                value={cond.rsiLength ?? 14}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, rsiLength: +e.target.value })}
                                className="w-12 bg-white/5 border border-white/10 rounded px-1 text-center text-white"
                              />
                              <span className="text-indigo-400 font-bold">Hold Window:</span>
                              <input
                                type="number"
                                min="1"
                                max="50"
                                value={cond.rsiSignalHoldTicks ?? 10}
                                onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, rsiSignalHoldTicks: +e.target.value })}
                                className="w-12 bg-indigo-500/20 border border-indigo-500/40 rounded px-1 text-center text-indigo-300 font-bold"
                                title="Signal Armed Memory (Ticks)"
                              />
                            </div>
                          )}

                          {strat.conditions.length > 1 && (
                            <button
                              onClick={() => removeConditionFromStrat(sIdx, cond.id)}
                              className="ml-auto text-gray-500 hover:text-rose-400 text-xs px-2 py-1"
                              title="Delete condition"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={() => addConditionToStrat(sIdx)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Condition
                    </button>
                  </div>

                  {/* THEN TRADE Section */}
                  <div className="pt-3 border-t border-white/10 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-black text-cyan-400 uppercase tracking-wider">
                      THEN TRADE:
                    </span>

                    <select
                      value={strat.tradeType}
                      onChange={e => {
                        const newType = e.target.value;
                        const patch: any = { tradeType: newType };
                        if (newType === 'RUNHIGH' || newType === 'RUNLOW') {
                          patch.ticks = Math.max(2, Math.min(5, strat.ticks));
                        }
                        updateStrategy(sIdx, patch);
                      }}
                      className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
                    >
                      {TRADE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>

                    {hasBarrier && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-amber-400 font-bold">BARRIER:</span>
                        <input
                          type="number"
                          min="0"
                          max="9"
                          value={strat.prediction}
                          onChange={e => updateStrategy(sIdx, { prediction: +e.target.value })}
                          className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-center text-white font-bold"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-gray-400">FOR:</span>
                      <input
                        type="number"
                        min={isOnlyUD ? 2 : 1}
                        max={isOnlyUD ? 5 : 100}
                        value={strat.ticks}
                        onChange={e => {
                          let val = +e.target.value;
                          if (isOnlyUD) val = Math.max(2, Math.min(5, val));
                          updateStrategy(sIdx, { ticks: val });
                        }}
                        className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-center text-white font-mono font-bold"
                      />
                      <span className="text-gray-400 font-bold">
                        {isOnlyUD ? 'TICKS (2-5)' : 'TICKS'}
                      </span>
                    </div>

                    {/* Trade Pattern Toggle */}
                    <div className="ml-auto flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={strat.useTradePattern}
                          onChange={e => updateStrategy(sIdx, { useTradePattern: e.target.checked })}
                          className="accent-indigo-500"
                        />
                        <span className="text-indigo-300 font-bold">Trade Pattern (T/S)</span>
                      </label>
                    </div>
                  </div>

                  {/* Trade Pattern Sequence (if enabled) */}
                  {strat.useTradePattern && (
                    <div className="p-3 bg-black/40 border border-indigo-500/20 rounded-xl space-y-2">
                      <div className="text-[10px] text-gray-400">
                        Click cell to toggle: <span className="text-emerald-400 font-bold">T=TRADE</span> / <span className="text-amber-400 font-bold">S=SKIP</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(strat.tradePattern || [true]).map((isTrade, pIdx) => (
                          <button
                            key={pIdx}
                            onClick={() => {
                              const next = [...(strat.tradePattern || [true])];
                              next[pIdx] = !next[pIdx];
                              updateStrategy(sIdx, { tradePattern: next });
                            }}
                            className={`w-7 h-7 rounded-lg text-xs font-black font-mono flex items-center justify-center transition-all ${
                              isTrade
                                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            }`}
                          >
                            {isTrade ? 'T' : 'S'}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            updateStrategy(sIdx, { tradePattern: [...(strat.tradePattern || [true]), true] });
                          }}
                          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-xs font-bold"
                          title="Add step"
                        >
                          +
                        </button>
                        {(strat.tradePattern || []).length > 1 && (
                          <button
                            onClick={() => {
                              updateStrategy(sIdx, { tradePattern: (strat.tradePattern || []).slice(0, -1) });
                            }}
                            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 flex items-center justify-center text-xs font-bold"
                            title="Remove last step"
                          >
                            −
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="p-4 md:p-5 border-t border-white/10 bg-slate-900/80 flex items-center justify-between gap-4">
          <div className="text-xs text-gray-400 hidden sm:block">
            Step settings are preserved and isolated from the main LaxPrime page.
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Save & Apply to Step
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
