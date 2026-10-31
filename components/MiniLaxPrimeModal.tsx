'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Check, Plus, Trash2, Sliders, Settings2, ShieldAlert,
  Layers, Sparkles, Copy, RefreshCw, Zap, TrendingUp, TrendingDown,
  ArrowLeftRight, Clock, Target, ChevronDown, AlertTriangle,
  Flame, CheckCircle2, FlaskConical
} from 'lucide-react';
import {
  Strategy, Condition, PatternBox, PatternTrigger,
  AdaptiveSwitch, AdaptiveSwitchStep, SwitcherTradeConfig, getManualContractList, ManualContractItem, ManualContractsConfig,
  ALL_MARKETS, TRADE_OPTIONS, normalizeContractType,
  createCondition, createStrategy, needsBarrier,
  useBotStore,
  ContinuousLockConfig,
} from '@/store/useBotStore';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export type VirtualSettingsConfig = NonNullable<LaxPrimeStepConfig['virtualSettings']>;

export interface LaxPrimeStepConfig {
  selectedMarkets: string[];
  strategies: Strategy[];
  tradingMode?: string;           // 'target' | 'continuous' | 'once'
  crossMarketDelay?: string;       // '1.5' | '2.0' | '3.0'
  martingale?: string;            // '2.0'
  isMartingaleEnabled?: boolean;  // Martingale active inside this step
  compoundProfits?: boolean;      // Inner Compounding active inside this step
  compoundPct?: string;           // Inner Compounding %
  targetProfit?: string;          // Step TP
  targetProfitMode?: 'profit' | 'wins'; // USD vs Wins
  stopLoss?: string;              // Step SL
  stopLossMode?: 'loss' | 'losses';     // USD vs Losses
  adaptiveSwitch?: AdaptiveSwitch;
  continuousLock?: ContinuousLockConfig;
  virtualSettings?: {

    isVirtualMode: boolean;
    startVirtualToReal: boolean;
    vTriggerType: 'wins' | 'losses';
    vTriggerMode: 'consec' | 'total';
    vThreshold: number;
    vInEnabled?: boolean;
    vInTrades?: number;
    isDoubleVirtual?: boolean;
    vDoubleStage?: 'A' | 'B';
    vTriggerTypeB?: 'wins' | 'losses';
    vTriggerModeB?: 'consec' | 'total';
    vThresholdB?: number;
    vInEnabledB?: boolean;
    vInTradesB?: number;
    vStageBReps?: number;
    vStageBCompletedReps?: number;
    startRealToVirtual: boolean;
    rTriggerType: 'wins' | 'losses';
    rTriggerMode: 'consec' | 'total';
    rThreshold: number;
    smartSettings?: {
      enabled: boolean;
      type: 'sequence' | 'alternating';
      sequence: { step1Type: 'Wins' | 'Losses'; step1Qty: number; step1Mode: 'consecutive' | 'total'; step2Type: 'Wins' | 'Losses'; step2Qty: number; step2Mode: 'consecutive' | 'total'; };
      alternating: { count: number; };
    };
    patternSwitcher?: {
      enabled: boolean;
      patternBoxes: PatternBox[];
      patternBoxMode: 'OR' | 'THEN' | 'THENALL';
      thenTimeout?: number;
      thenTimeouts?: number[];
      thenMaxTrades?: number;
    };
    virtualWins?: number;
    virtualLosses?: number;
    vConsecWins?: number;
    vConsecLosses?: number;
    realWins?: number;
    realLosses?: number;
    rConsecWins?: number;
    rConsecLosses?: number;
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
  { value: 'GREEN_BAR',     label: 'TOP / LOWEST ( ) DIGITS ARE' },
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

const PATTERN_RETRIGGER = [
  { value: 'any',       label: 'Trigger anytime' },
  { value: 'no_contra', label: 'No Contradiction' },
  { value: 'wait_opp',  label: 'Wait for opposite before re-trigger' },
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
    case 'SE': return '#0891b2';
    case 'SO': return '#c026d3';
    case 'R': return '#16a34a';
    case 'F': return '#e11d48';
    case 'HE': return '#10b981'; // Emerald (Highest Even)
    case 'LE': return '#0284c7'; // Sky (Least Even)
    case 'HO': return '#f59e0b'; // Amber (Highest Odd)
    case 'LO': return '#db2777'; // Pink (Least Odd)
    default: return '#475569';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVANCED PATTERN BUILDER (Multi-Entry Sequence with OR / THEN / THENALL)
// ─────────────────────────────────────────────────────────────────────────────

function AdvancedPatternBuilder({ cond, onChange }: {
  cond: Condition;
  onChange: (updated: Condition) => void;
}) {
  const boxes: PatternBox[] = (cond.patternBoxes && cond.patternBoxes.length > 0)
    ? cond.patternBoxes
    : [{ triggers: [{ token: 'E' }] }];

  const setBoxes = (next: PatternBox[]) => onChange({ ...cond, patternBoxes: next });
  const addBox = () => {
    if (boxes.length >= 4) return;
    const nextBoxes = [...boxes, { triggers: [{ token: 'E' }] }];
    const nextTimeouts = [...(cond.thenTimeouts || [20, 20, 20, 20])];
    while (nextTimeouts.length <= boxes.length) {
      nextTimeouts.push(cond.thenTimeout ?? 20);
    }
    onChange({ ...cond, patternBoxes: nextBoxes, thenTimeouts: nextTimeouts });
  };
  const removeBox = (bi: number) => {
    const nextBoxes = boxes.filter((_, i) => i !== bi);
    const nextTimeouts = cond.thenTimeouts ? cond.thenTimeouts.filter((_, i) => i !== bi) : undefined;
    onChange({ ...cond, patternBoxes: nextBoxes, thenTimeouts: nextTimeouts });
  };

  const addTrigger = (bi: number) =>
    setBoxes(boxes.map((b, i) => i !== bi ? b : { triggers: [...b.triggers, { token: 'E' }] }));

  const removeTrigger = (bi: number, ti: number) =>
    setBoxes(boxes.map((b, i) => i !== bi ? b : { triggers: b.triggers.filter((_, j) => j !== ti) }));

  const updateTrigger = (bi: number, ti: number, patch: Partial<PatternTrigger>) =>
    setBoxes(boxes.map((b, i) => i !== bi ? b : {
      triggers: b.triggers.map((t, j) => j !== ti ? t : { ...t, ...patch }),
    }));

  const contracts = cond.customContracts || [
    { type: 'DIGITUNDER', barrier: 7 },
    { type: 'DIGITOVER',  barrier: 2 },
    { type: 'DIGITMATCH', barrier: 5 },
    { type: 'DIGITOVER',  barrier: 0 },
  ];

  const setContracts = (next: { type: string; barrier: number }[]) =>
    onChange({ ...cond, customContracts: next });

  const addContract = () => setContracts([...contracts, { type: 'DIGITEVEN', barrier: 0 }]);
  const removeContract = (ci: number) => setContracts(contracts.filter((_, i) => i !== ci));
  const updateContractType = (ci: number, type: string) =>
    setContracts(contracts.map((c, i) => i !== ci ? c : { ...c, type }));
  const updateContractBarrier = (ci: number, barrier: number) =>
    setContracts(contracts.map((c, i) => i !== ci ? c : { ...c, barrier }));

  return (
    <div className="w-full bg-slate-950/70 border border-indigo-500/30 rounded-xl p-3 space-y-3 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-indigo-300 uppercase tracking-wider">Multi-Entry Sequence</span>
          <div
            className={`w-7 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${
              (cond.patternBoxes && cond.patternBoxes.length > 0) ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
            onClick={() => {
              if (cond.patternBoxes && cond.patternBoxes.length > 0) {
                onChange({ ...cond, patternBoxes: [] });
              } else {
                onChange({ ...cond, patternBoxes: [{ triggers: [{ token: 'E' }] }] });
              }
            }}
          >
            <div
              className={`w-3 h-3 rounded-full bg-white transition-transform ${
                (cond.patternBoxes && cond.patternBoxes.length > 0) ? 'translate-x-3' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {(cond.patternBoxMode ?? 'OR') === 'OR' && boxes.length < 4 && (
          <button
            onClick={addBox}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[10px] font-bold text-indigo-200"
          >
            + Add Box
          </button>
        )}
        {(cond.patternBoxMode === 'THEN' || cond.patternBoxMode === 'THENALL') && boxes.length < 4 && (
          <button
            onClick={addBox}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[10px] font-bold text-indigo-200"
          >
            + Add Box {boxes.length + 1}
          </button>
        )}
      </div>

      {/* Orientation hint */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (() => {
        const mode = cond.patternBoxMode ?? 'OR';
        const numB = boxes.length;
        return (
          <p className="text-[10px] text-gray-400">
            {mode === 'OR'
              ? 'Each trigger = 1 tick · Left = oldest, Right = latest · Multiple boxes = OR alternatives'
              : mode === 'THEN'
              ? (numB > 2
                ? `Box 1 triggers → locks market → sequential boxes (Box 2 to Box ${numB}) must match within their timeouts`
                : 'Box 1 triggers → locks market → Box 2 must fire within timeout ticks')
              : (numB > 2
                ? `Box 1 triggers → scans markets for sequential boxes (up to Box ${numB}) → fires up to max trades`
                : 'Box 1 triggers → ALL markets scanned for Box 2 → fires up to max trades')}
          </p>
        );
      })()}

      {/* Boxes Grid */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {boxes.map((box, bi) => {
            const mode = cond.patternBoxMode ?? 'OR';
            if ((mode === 'THEN' || mode === 'THENALL') && bi >= 4) return null;

            return (
              <React.Fragment key={bi}>
                {bi > 0 && (
                  <div className="flex flex-col items-center gap-1.5 px-1">
                    {/* Mode cycle chip — click to cycle OR→THEN→THENALL (shown on first separator) */}
                    {bi === 1 && (() => {
                      const curMode = cond.patternBoxMode ?? 'OR';
                      const nextMode = curMode === 'OR' ? 'THEN' : curMode === 'THEN' ? 'THENALL' : 'OR';
                      const modeColors: Record<string, string> = {
                        OR: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                        THEN: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
                        THENALL: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
                      };
                      const box2Timeout = cond.thenTimeouts?.[1] ?? cond.thenTimeout ?? 20;

                      return (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={() => onChange({ ...cond, patternBoxMode: nextMode as 'OR' | 'THEN' | 'THENALL' })}
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${modeColors[curMode] || modeColors.OR} border shadow-sm transition-all`}
                            title={`Mode: ${curMode} — click to switch to ${nextMode}`}
                          >
                            {curMode} ▾
                          </button>
                          {(curMode === 'THEN' || curMode === 'THENALL') && (
                            <div className="flex items-center gap-1 text-[9px] text-gray-300">
                              <span>TIMEOUT:</span>
                              <input
                                type="number"
                                min={1}
                                max={500}
                                value={box2Timeout}
                                onChange={e => {
                                  const val = Math.max(1, +e.target.value || 20);
                                  const nextTimeouts = [...(cond.thenTimeouts || [20, val, 20, 20])];
                                  while (nextTimeouts.length <= 1) nextTimeouts.push(20);
                                  nextTimeouts[1] = val;
                                  onChange({ ...cond, thenTimeout: val, thenTimeouts: nextTimeouts });
                                }}
                                className="w-10 bg-black/60 border border-white/10 rounded px-1 text-center text-white text-[10px]"
                                title="Max ticks to wait for Box 2 before resetting"
                              />
                              <span>t</span>
                            </div>
                          )}
                          {curMode === 'THENALL' && (
                            <div className="flex items-center gap-1 text-[9px] text-gray-300">
                              <span>MAX:</span>
                              <input
                                type="number"
                                min={1}
                                max={50}
                                value={cond.thenMaxTrades ?? 3}
                                onChange={e => onChange({ ...cond, thenMaxTrades: Math.max(1, +e.target.value || 3) })}
                                className="w-10 bg-black/60 border border-white/10 rounded px-1 text-center text-white text-[10px]"
                                title="Max trades Box 2 fires per round before resetting to Box 1"
                              />
                              <span>×</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Separator for boxes beyond the first pair (Box 3, Box 4) */}
                    {bi > 1 && (() => {
                      const curMode = cond.patternBoxMode ?? 'OR';
                      if (curMode === 'OR') {
                        return (
                          <span className="text-[10px] font-bold text-amber-400">OR</span>
                        );
                      }
                      const modeColors: Record<string, string> = {
                        THEN: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
                        THENALL: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
                      };
                      const boxTimeout = cond.thenTimeouts?.[bi] ?? cond.thenTimeout ?? 20;

                      return (
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${modeColors[curMode] || modeColors.THEN} border shadow-sm`}>
                            {curMode}
                          </span>
                          <div className="flex items-center gap-1 text-[9px] text-gray-300">
                            <span>TIMEOUT:</span>
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={boxTimeout}
                              onChange={e => {
                                const val = Math.max(1, +e.target.value || 20);
                                const nextTimeouts = [...(cond.thenTimeouts || [20, 20, 20, 20])];
                                while (nextTimeouts.length <= bi) nextTimeouts.push(20);
                                nextTimeouts[bi] = val;
                                onChange({ ...cond, thenTimeouts: nextTimeouts });
                              }}
                              className="w-10 bg-black/60 border border-white/10 rounded px-1 text-center text-white text-[10px]"
                              title={`Max ticks to wait for Box ${bi + 1} before resetting`}
                            />
                            <span>t</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Box Card */}
                <div className="bg-slate-900/90 border border-white/10 rounded-xl p-2.5 space-y-2 min-w-[170px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-white">Box {bi + 1}</span>
                    <span className="text-[9px] text-gray-500">oldest→latest</span>
                    {boxes.length > 1 && (
                      <button onClick={() => removeBox(bi)} className="text-gray-500 hover:text-rose-400 text-xs">✕</button>
                    )}
                  </div>

                  {/* Triggers list */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {box.triggers.map((trig, ti) => {
                      const bNeedsBarrier = tokenNeedsBarrier(trig.token);
                      return (
                        <div
                          key={ti}
                          className="flex items-center rounded border border-white/20 overflow-hidden shadow-sm text-[11px]"
                          style={{ background: getTokenBgColor(trig.token) }}
                        >
                          <select
                            value={trig.token}
                            onChange={e => {
                              const token = e.target.value;
                              const barrier = tokenNeedsBarrier(token) ? (trig.barrier ?? 4) : undefined;
                              updateTrigger(bi, ti, { token, barrier });
                            }}
                            className="bg-transparent text-white font-black px-1.5 py-0.5 outline-none cursor-pointer text-xs"
                            style={{ background: getTokenBgColor(trig.token), color: '#ffffff' }}
                          >
                            <option value="E" style={{ background: '#0f172a', color: '#fff' }}>E</option>
                            <option value="O" style={{ background: '#0f172a', color: '#fff' }}>O</option>
                            <option value="U" style={{ background: '#0f172a', color: '#fff' }}>U</option>
                            <option value="V" style={{ background: '#0f172a', color: '#fff' }}>V</option>
                            <option value="M" style={{ background: '#0f172a', color: '#fff' }}>M</option>
                            <option value="D" style={{ background: '#0f172a', color: '#fff' }}>D</option>
                            <option value="SE" style={{ background: '#0f172a', color: '#fff' }}>SE</option>
                            <option value="SO" style={{ background: '#0f172a', color: '#fff' }}>SO</option>
                            <option value="R" style={{ background: '#0f172a', color: '#fff' }}>R</option>
                            <option value="F" style={{ background: '#0f172a', color: '#fff' }}>F</option>
                            <option value="HE" style={{ background: '#0f172a', color: '#fff' }} title="Highest Even in 1000 ticks">HE</option>
                            <option value="LE" style={{ background: '#0f172a', color: '#fff' }} title="Least Even in 1000 ticks">LE</option>
                            <option value="HO" style={{ background: '#0f172a', color: '#fff' }} title="Highest Odd in 1000 ticks">HO</option>
                            <option value="LO" style={{ background: '#0f172a', color: '#fff' }} title="Least Odd in 1000 ticks">LO</option>
                          </select>

                          {bNeedsBarrier && (
                            <select
                              value={trig.barrier ?? 4}
                              onChange={e => updateTrigger(bi, ti, { barrier: +e.target.value })}
                              className="bg-black/50 text-white font-bold px-1.5 py-0.5 outline-none cursor-pointer text-xs"
                              style={{ background: 'rgba(0,0,0,0.6)', color: '#ffffff' }}
                            >
                              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                <option key={d} value={d} style={{ background: '#0f172a', color: '#fff' }}>{d}</option>
                              ))}
                            </select>
                          )}

                          {box.triggers.length > 1 && (
                            <button
                              onClick={() => removeTrigger(bi, ti)}
                              className="px-1.5 py-0.5 text-white/60 hover:text-white bg-black/20 text-[10px]"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}

                    <button
                      onClick={() => addTrigger(bi)}
                      className="w-6 h-6 rounded border border-dashed border-white/30 hover:border-white text-gray-300 flex items-center justify-center text-xs font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Retrigger row */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/5 text-xs text-gray-300">
        <span className="text-[11px] text-gray-400 font-bold">Retrigger:</span>
        <select
          value={cond.patternRetrigger || 'any'}
          onChange={e => onChange({ ...cond, patternRetrigger: e.target.value })}
          className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
          style={{ background: '#0f172a', color: '#ffffff' }}
        >
          {PATTERN_RETRIGGER.map(r => (
            <option key={r.value} value={r.value} style={{ background: '#0f172a', color: '#fff' }}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* USE CUSTOM CONTRACTS */}
      <div className="pt-2 border-t border-white/5 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!cond.useCustomContracts}
            onChange={e => onChange({ ...cond, useCustomContracts: e.target.checked })}
            className="accent-amber-500"
          />
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-bold text-amber-300">USE CUSTOM CONTRACTS (Per Loss Step)</span>
        </label>

        {cond.useCustomContracts && (
          <div className="flex flex-wrap gap-2 pt-1">
            {contracts.map((box, ci) => {
              const bNeedsBarrier = needsBarrier(box.type);
              return (
                <div key={ci} className="bg-black/50 border border-amber-500/30 rounded-xl p-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-amber-300">Loss Step {ci + 1}</span>
                    {contracts.length > 1 && (
                      <button onClick={() => removeContract(ci)} className="text-gray-500 hover:text-rose-400 text-xs">✕</button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={box.type}
                      onChange={e => updateContractType(ci, e.target.value)}
                      className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white"
                      style={{ background: '#0f172a', color: '#ffffff' }}
                    >
                      <option value="DIGITUNDER" style={{ background: '#0f172a', color: '#fff' }}>U (Under)</option>
                      <option value="DIGITOVER" style={{ background: '#0f172a', color: '#fff' }}>V (Over)</option>
                      <option value="DIGITMATCH" style={{ background: '#0f172a', color: '#fff' }}>M (Match)</option>
                      <option value="DIGITDIFF" style={{ background: '#0f172a', color: '#fff' }}>D (Diff)</option>
                      <option value="DIGITEVEN" style={{ background: '#0f172a', color: '#fff' }}>E (Even)</option>
                      <option value="DIGITODD" style={{ background: '#0f172a', color: '#fff' }}>O (Odd)</option>
                      <option value="CALL" style={{ background: '#0f172a', color: '#fff' }}>R (Rise)</option>
                      <option value="PUT" style={{ background: '#0f172a', color: '#fff' }}>F (Fall)</option>
                    </select>
                    {bNeedsBarrier ? (
                      <input
                        type="number"
                        min={0}
                        max={9}
                        value={box.barrier}
                        onChange={e => updateContractBarrier(ci, +e.target.value)}
                        className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white"
                        style={{ background: '#0f172a', color: '#ffffff' }}
                      />
                    ) : (
                      <span className="text-gray-500 text-xs px-2">—</span>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              onClick={addContract}
              className="px-2.5 py-1 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold self-end"
            >
              + Add Box
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MINI VIRTUAL PATTERN BUILDER (Multi-Entry Sequence for Virtual -> Real Switcher)
// ─────────────────────────────────────────────────────────────────────────────

function MiniVirtualPatternBuilder({
  config,
  onChange,
}: {
  config: {
    patternBoxes: PatternBox[];
    patternBoxMode: 'OR' | 'THEN' | 'THENALL';
    thenTimeout?: number;
    thenTimeouts?: number[];
    thenMaxTrades?: number;
  };
  onChange: (updated: {
    patternBoxes: PatternBox[];
    patternBoxMode: 'OR' | 'THEN' | 'THENALL';
    thenTimeout?: number;
    thenTimeouts?: number[];
    thenMaxTrades?: number;
  }) => void;
}) {
  const boxes: PatternBox[] = (config.patternBoxes && config.patternBoxes.length > 0)
    ? config.patternBoxes
    : [{ triggers: [{ token: 'E' }, { token: 'E' }] }];

  const setBoxes = (next: PatternBox[]) => onChange({ ...config, patternBoxes: next });

  const addBox = () => {
    if (boxes.length >= 4) return;
    const nextBoxes = [...boxes, { triggers: [{ token: 'E' }, { token: 'E' }] }];
    const nextTimeouts = [...(config.thenTimeouts || [20, 20, 20, 20])];
    while (nextTimeouts.length <= boxes.length) {
      nextTimeouts.push(config.thenTimeout ?? 20);
    }
    onChange({ ...config, patternBoxes: nextBoxes, thenTimeouts: nextTimeouts });
  };

  const removeBox = (bi: number) => {
    const nextBoxes = boxes.filter((_, i) => i !== bi);
    const nextTimeouts = config.thenTimeouts ? config.thenTimeouts.filter((_, i) => i !== bi) : undefined;
    onChange({ ...config, patternBoxes: nextBoxes, thenTimeouts: nextTimeouts });
  };

  const addTrigger = (bi: number) =>
    setBoxes(boxes.map((b, i) => i !== bi ? b : { triggers: [...b.triggers, { token: 'E' }] }));

  const removeTrigger = (bi: number, ti: number) =>
    setBoxes(boxes.map((b, i) => i !== bi ? b : { triggers: b.triggers.filter((_, j) => j !== ti) }));

  const updateTrigger = (bi: number, ti: number, patch: Partial<PatternTrigger>) =>
    setBoxes(boxes.map((b, i) => i !== bi ? b : {
      triggers: b.triggers.map((t, j) => j !== ti ? t : { ...t, ...patch }),
    }));

  return (
    <div className="w-full bg-slate-950/70 border border-indigo-500/30 rounded-xl p-3 space-y-3 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-indigo-300 uppercase tracking-wider">Multi-Entry Sequence (V → Real)</span>
        </div>

        {(config.patternBoxMode ?? 'OR') === 'OR' && boxes.length < 4 && (
          <button
            type="button"
            onClick={addBox}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[10px] font-bold text-indigo-200"
          >
            + Add Box
          </button>
        )}
        {(config.patternBoxMode === 'THEN' || config.patternBoxMode === 'THENALL') && boxes.length < 4 && (
          <button
            type="button"
            onClick={addBox}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[10px] font-bold text-indigo-200"
          >
            + Add Box {boxes.length + 1}
          </button>
        )}
      </div>

      {/* Orientation hint */}
      {(() => {
        const mode = config.patternBoxMode ?? 'OR';
        const numB = boxes.length;
        return (
          <p className="text-[10px] text-gray-400">
            {mode === 'OR'
              ? 'When ANY box matches on active markets → Immediately switches to REAL mode'
              : mode === 'THEN'
              ? (numB > 2
                ? `Box 1 matches → locks market → sequential boxes (Box 2 to Box ${numB}) must match within timeout → switches to REAL`
                : 'Box 1 matches → locks market → Box 2 must fire within timeout ticks → switches to REAL')
              : (numB > 2
                ? `Box 1 matches → scans all markets for sequential boxes (up to Box ${numB}) → switches to REAL`
                : 'Box 1 matches on any market → ALL markets scanned for Box 2 → switches to REAL')}
          </p>
        );
      })()}

      {/* Boxes Grid */}
      <div className="flex flex-wrap items-center gap-2">
        {boxes.map((box, bi) => {
          const mode = config.patternBoxMode ?? 'OR';
          if ((mode === 'THEN' || mode === 'THENALL') && bi >= 4) return null;

          return (
            <React.Fragment key={bi}>
              {bi > 0 && (
                <div className="flex flex-col items-center gap-1.5 px-1">
                  {bi === 1 && (() => {
                    const curMode = config.patternBoxMode ?? 'OR';
                    const nextMode = curMode === 'OR' ? 'THEN' : curMode === 'THEN' ? 'THENALL' : 'OR';
                    const box2Timeout = config.thenTimeouts?.[1] ?? config.thenTimeout ?? 20;

                    return (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onChange({ ...config, patternBoxMode: nextMode as 'OR' | 'THEN' | 'THENALL' })}
                          title={`Mode: ${curMode} — click to switch to ${nextMode}`}
                          className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wider transition-all border ${
                            curMode === 'OR'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : curMode === 'THEN'
                              ? 'bg-teal-500/15 text-teal-300 border-teal-500/30 shadow-[0_0_8px_rgba(20,184,166,0.3)]'
                              : 'bg-purple-500/15 text-purple-300 border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                          }`}
                        >
                          {curMode} ▾
                        </button>

                        {(curMode === 'THEN' || curMode === 'THENALL') && (
                          <div className="flex flex-col gap-1 items-center min-w-[70px]">
                            <div className="flex items-center gap-1 text-[8px] text-gray-400">
                              <span>⏱ TIMEOUT</span>
                              <input
                                type="number" min={1} max={500}
                                value={box2Timeout}
                                onChange={e => {
                                  const val = Math.max(1, +e.target.value || 20);
                                  const nextTimeouts = [...(config.thenTimeouts || [20, val, 20, 20])];
                                  while (nextTimeouts.length <= 1) nextTimeouts.push(20);
                                  nextTimeouts[1] = val;
                                  onChange({ ...config, thenTimeout: val, thenTimeouts: nextTimeouts });
                                }}
                                className="w-9 bg-slate-900 border border-teal-500/40 rounded px-1 py-0.5 text-center text-[9px] text-white"
                                style={{ background: '#0f172a' }}
                                title="Max ticks to wait for Box 2 before resetting"
                              />
                              <span>t</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {bi > 1 && (() => {
                    const curMode = config.patternBoxMode ?? 'OR';
                    const boxTimeout = config.thenTimeouts?.[bi] ?? config.thenTimeout ?? 20;

                    if (curMode === 'OR') {
                      return (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[9px] font-black">
                          OR
                        </span>
                      );
                    }

                    return (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wider border ${
                          curMode === 'THEN'
                            ? 'bg-teal-500/15 text-teal-300 border-teal-500/30'
                            : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                        }`}>
                          {curMode}
                        </span>

                        <div className="flex items-center gap-1 text-[8px] text-gray-400">
                          <span>⏱ TIMEOUT</span>
                          <input
                            type="number" min={1} max={500}
                            value={boxTimeout}
                            onChange={e => {
                              const val = Math.max(1, +e.target.value || 20);
                              const nextTimeouts = [...(config.thenTimeouts || [20, 20, 20, 20])];
                              while (nextTimeouts.length <= bi) nextTimeouts.push(20);
                              nextTimeouts[bi] = val;
                              onChange({ ...config, thenTimeouts: nextTimeouts });
                            }}
                            className="w-9 bg-slate-900 border border-teal-500/40 rounded px-1 py-0.5 text-center text-[9px] text-white"
                            style={{ background: '#0f172a' }}
                            title={`Max ticks to wait for Box ${bi + 1} before resetting`}
                          />
                          <span>t</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Box Card */}
              <div className="bg-slate-900/90 border border-white/10 rounded-xl p-2.5 space-y-2 min-w-[170px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-white">Box {bi + 1}</span>
                  <span className="text-[9px] text-gray-500">oldest→latest</span>
                  {boxes.length > 1 && (
                    <button type="button" onClick={() => removeBox(bi)} className="text-gray-500 hover:text-rose-400 text-xs">✕</button>
                  )}
                </div>

                {/* Triggers list */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {box.triggers.map((trig, ti) => {
                    const bNeedsBarrier = tokenNeedsBarrier(trig.token);
                    return (
                      <div
                        key={ti}
                        className="flex items-center rounded border border-white/20 overflow-hidden shadow-sm text-[11px]"
                        style={{ background: getTokenBgColor(trig.token) }}
                      >
                        <select
                          value={trig.token}
                          onChange={e => {
                            const token = e.target.value;
                            const barrier = tokenNeedsBarrier(token) ? (trig.barrier ?? 4) : undefined;
                            updateTrigger(bi, ti, { token, barrier });
                          }}
                          className="bg-transparent text-white font-black px-1.5 py-0.5 outline-none cursor-pointer text-xs"
                          style={{ background: getTokenBgColor(trig.token), color: '#ffffff' }}
                        >
                          <option value="E" style={{ background: '#0f172a', color: '#fff' }}>E</option>
                          <option value="O" style={{ background: '#0f172a', color: '#fff' }}>O</option>
                          <option value="U" style={{ background: '#0f172a', color: '#fff' }}>U</option>
                          <option value="V" style={{ background: '#0f172a', color: '#fff' }}>V</option>
                          <option value="M" style={{ background: '#0f172a', color: '#fff' }}>M</option>
                          <option value="D" style={{ background: '#0f172a', color: '#fff' }}>D</option>
                          <option value="SE" style={{ background: '#0f172a', color: '#fff' }}>SE</option>
                          <option value="SO" style={{ background: '#0f172a', color: '#fff' }}>SO</option>
                          <option value="R" style={{ background: '#0f172a', color: '#fff' }}>R</option>
                          <option value="F" style={{ background: '#0f172a', color: '#fff' }}>F</option>
                          <option value="HE" style={{ background: '#0f172a', color: '#fff' }} title="Highest Even in 1000 ticks">HE</option>
                          <option value="LE" style={{ background: '#0f172a', color: '#fff' }} title="Least Even in 1000 ticks">LE</option>
                          <option value="HO" style={{ background: '#0f172a', color: '#fff' }} title="Highest Odd in 1000 ticks">HO</option>
                          <option value="LO" style={{ background: '#0f172a', color: '#fff' }} title="Least Odd in 1000 ticks">LO</option>
                        </select>

                        {bNeedsBarrier && (
                          <select
                            value={trig.barrier ?? 4}
                            onChange={e => updateTrigger(bi, ti, { barrier: +e.target.value })}
                            className="bg-black/50 text-white font-bold px-1.5 py-0.5 outline-none cursor-pointer text-xs"
                            style={{ background: 'rgba(0,0,0,0.6)', color: '#ffffff' }}
                          >
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                              <option key={d} value={d} style={{ background: '#0f172a', color: '#fff' }}>{d}</option>
                            ))}
                          </select>
                        )}

                        {box.triggers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeTrigger(bi, ti)}
                            className="px-1.5 py-0.5 text-white/60 hover:text-white bg-black/20 text-[10px]"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => addTrigger(bi)}
                    className="w-6 h-6 rounded border border-dashed border-white/30 hover:border-white text-gray-300 flex items-center justify-center text-xs font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI SIGNAL BUILDER (Full numerical TradingView indicator panel)
// ─────────────────────────────────────────────────────────────────────────────

function RsiSignalBuilder({ cond, onChange }: { cond: Condition; onChange: (c: Condition) => void }) {
  const u = (p: Partial<Condition>) => onChange({ ...cond, ...p });
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="w-full bg-slate-950/80 border border-indigo-500/40 rounded-xl p-3 space-y-3 mt-2 text-xs">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-black text-indigo-300">⚡ RSI Signal [trade_lexx]</span>
          <span className="text-[10px] text-gray-500">(Numerical Candle Engine)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400 text-[10px]">Action:</span>
          <select
            value={cond.rsiSignalAction || 'AUTO'}
            onChange={e => u({ rsiSignalAction: e.target.value as any })}
            className="bg-indigo-950/80 border border-indigo-500/40 rounded px-2 py-0.5 text-xs text-indigo-200 font-bold"
            style={{ background: '#1e1b4b', color: '#c7d2fe' }}
          >
            <option value="AUTO" style={{ background: '#0f172a', color: '#fff' }}>AUTO (Matches Trade Type)</option>
            <option value="BUY" style={{ background: '#0f172a', color: '#fff' }}>BUY (Rise/Call only)</option>
            <option value="SELL" style={{ background: '#0f172a', color: '#fff' }}>SELL (Fall/Put only)</option>
          </select>
        </div>
      </div>

      {/* Primary params */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400 text-[11px]">Ticks/Bar:</span>
          <input
            type="number"
            min={1}
            max={60}
            value={cond.rsiTicksPerCandle ?? 5}
            onChange={e => u({ rsiTicksPerCandle: Math.max(1, +e.target.value || 5) })}
            className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
            style={{ background: '#0f172a', color: '#ffffff' }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-gray-400 text-[11px]">RSI Length:</span>
          <input
            type="number"
            min={2}
            max={100}
            value={cond.rsiLength ?? 14}
            onChange={e => u({ rsiLength: Math.max(2, +e.target.value || 14) })}
            className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
            style={{ background: '#0f172a', color: '#ffffff' }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-gray-400 text-[11px]">Pause:</span>
          <input
            type="number"
            min={0}
            max={50}
            value={cond.rsiReentryPause ?? 5}
            onChange={e => u({ rsiReentryPause: Math.max(0, +e.target.value || 0) })}
            className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
            style={{ background: '#0f172a', color: '#ffffff' }}
          />
          <span className="text-gray-500 text-[10px]">bars</span>
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="ml-auto px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-indigo-300 text-[10px] font-bold"
        >
          {showAdvanced ? '▴ Less' : '▾ More Settings'}
        </button>
      </div>

      {/* Sub-signals */}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/5">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={cond.rsiMaMode ?? true}
            onChange={e => u({ rsiMaMode: e.target.checked })}
            className="accent-indigo-500"
          />
          <span className={`font-bold text-[11px] ${(cond.rsiMaMode ?? true) ? 'text-emerald-400' : 'text-gray-500'}`}>MA Cross</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={cond.rsiBbMode ?? true}
            onChange={e => u({ rsiBbMode: e.target.checked })}
            className="accent-indigo-500"
          />
          <span className={`font-bold text-[11px] ${(cond.rsiBbMode ?? true) ? 'text-emerald-400' : 'text-gray-500'}`}>BB Cross</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={cond.rsiDivergenceMode ?? true}
            onChange={e => u({ rsiDivergenceMode: e.target.checked })}
            className="accent-indigo-500"
          />
          <span className={`font-bold text-[11px] ${(cond.rsiDivergenceMode ?? true) ? 'text-emerald-400' : 'text-gray-500'}`}>Divergence</span>
        </label>
      </div>

      {/* Advanced expandable */}
      {showAdvanced && (
        <div className="pt-2 border-t border-dashed border-white/10 space-y-2">
          {/* Signal Hold Window */}
          <div className="flex items-center gap-2">
            <span className="text-indigo-300 font-bold text-[11px]">Signal Hold Window:</span>
            <input
              type="number"
              min={1}
              max={50}
              value={cond.rsiSignalHoldTicks ?? 10}
              onChange={e => u({ rsiSignalHoldTicks: Math.max(1, +e.target.value || 10) })}
              className="w-12 bg-slate-900 border border-indigo-500/40 rounded px-1.5 py-0.5 text-center text-indigo-200 font-bold"
              style={{ background: '#0f172a', color: '#c7d2fe' }}
            />
            <span className="text-gray-500 text-[10px]">ticks (for collaborating conditions like F-F pullbacks)</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cond.rsiWaitForOpposite ?? false}
                onChange={e => u({ rsiWaitForOpposite: e.target.checked })}
              />
              <span>Wait for Opposite Signal</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cond.rsiAndMode ?? false}
                onChange={e => u({ rsiAndMode: e.target.checked })}
              />
              <span>AND Mode (Multi-Signal Confluence)</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
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
  // Step-level settings state
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [tradingMode, setTradingMode] = useState<string>('target');
  const [crossMarketDelay, setCrossMarketDelay] = useState<string>('1.5');
  const [martingale, setMartingale] = useState<string>('2.0');
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState<boolean>(true);
  const [compoundProfits, setCompoundProfits] = useState<boolean>(false);
  const [compoundPct, setCompoundPct] = useState<string>('50');
  const [targetProfit, setTargetProfit] = useState<string>('5.00');
  const [targetProfitMode, setTargetProfitMode] = useState<'profit' | 'wins'>('wins');
  const [stopLoss, setStopLoss] = useState<string>('10.00');
  const [stopLossMode, setStopLossMode] = useState<'loss' | 'losses'>('losses');
  const [adaptiveSwitch, setAdaptiveSwitch] = useState<AdaptiveSwitch>({
    enabled: false,
    dualMode: false,
    steps: [
      { contractType: 'DIGITEVEN', reps: 2 },
      { contractType: 'DIGITODD',  reps: 2 },
    ],
  });

  // Continuous Lock state
  const [showContinuousLockPanel, setShowContinuousLockPanel] = useState(false);
  const [continuousLock, setContinuousLock] = useState<ContinuousLockConfig>({
    enabled: false,
    mode: 'no_recheck',
    tradePattern: [true, false, false, false, true, false, false, false],
    useTradePattern: true,
    lockTPEnabled: false,
    lockTPMode: 'wins',
    lockTP: 3,
    lockSLEnabled: false,
    lockSLMode: 'losses',
    lockSL: 3,
  });

  // Virtual System state
  const [showVirtualPanel, setShowVirtualPanel] = useState(false);
  const [showSwitcherPanel, setShowSwitcherPanel] = useState(false);
  const [virtualMode, setVirtualMode] = useState<VirtualSettingsConfig>({
    isVirtualMode: false,
    startVirtualToReal: false,
    vTriggerType: 'wins' as 'wins' | 'losses',
    vTriggerMode: 'consec' as 'consec' | 'total',
    vThreshold: 2,
    vInEnabled: false,
    vInTrades: 5,
    isDoubleVirtual: false,
    vDoubleStage: 'A' as 'A' | 'B',
    vTriggerTypeB: 'wins' as 'wins' | 'losses',
    vTriggerModeB: 'consec' as 'consec' | 'total',
    vThresholdB: 2,
    vInEnabledB: false,
    vInTradesB: 5,
    vStageBReps: 3,
    vStageBCompletedReps: 0,
    startRealToVirtual: false,
    rTriggerType: 'wins' as 'wins' | 'losses',
    rTriggerMode: 'consec' as 'consec' | 'total',
    rThreshold: 3,
    smartSettings: {
      enabled: false,
      type: 'sequence' as 'sequence' | 'alternating',
      sequence: { step1Type: 'Wins' as 'Wins' | 'Losses', step1Qty: 2, step1Mode: 'consecutive' as 'consecutive' | 'total', step2Type: 'Losses' as 'Wins' | 'Losses', step2Qty: 2, step2Mode: 'consecutive' as 'consecutive' | 'total' },
      alternating: { count: 2 },
    },
    patternSwitcher: {
      enabled: false,
      patternBoxes: [{ triggers: [{ token: 'E' }, { token: 'E' }] }] as PatternBox[],
      patternBoxMode: ('OR' as 'OR' | 'THEN' | 'THENALL'),
      thenTimeout: 20,
      thenTimeouts: [20, 20, 20, 20],
      thenMaxTrades: 3,
    },
    virtualWins: 0,
    virtualLosses: 0,
    vConsecWins: 0,
    vConsecLosses: 0,
    realWins: 0,
    realLosses: 0,
    rConsecWins: 0,
    rConsecLosses: 0,
  });
  const updateVS = (patch: Partial<VirtualSettingsConfig>) => setVirtualMode(prev => ({ ...prev, ...patch }));

  // Swipe detection refs for touch screens
  const stepTpTouchXRef = React.useRef<number | null>(null);
  const stepSlTouchXRef = React.useRef<number | null>(null);

  // Sync state when opened - isolated per-step with explicit clean defaults
  useEffect(() => {
    if (!isOpen) return;

    const defaultVirt: VirtualSettingsConfig = {
      isVirtualMode: false,
      startVirtualToReal: false,
      vTriggerType: 'wins' as const,
      vTriggerMode: 'consec' as const,
      vThreshold: 2,
      vInEnabled: false,
      vInTrades: 5,
      isDoubleVirtual: false,
      vDoubleStage: 'A' as const,
      vTriggerTypeB: 'wins' as const,
      vTriggerModeB: 'consec' as const,
      vThresholdB: 2,
      vInEnabledB: false,
      vInTradesB: 5,
      vStageBReps: 3,
      vStageBCompletedReps: 0,
      startRealToVirtual: false,
      rTriggerType: 'wins' as const,
      rTriggerMode: 'consec' as const,
      rThreshold: 3,
      smartSettings: {
        enabled: false,
        type: 'sequence' as const,
        sequence: { step1Type: 'Wins' as const, step1Qty: 2, step1Mode: 'consecutive' as const, step2Type: 'Losses' as const, step2Qty: 2, step2Mode: 'consecutive' as const },
        alternating: { count: 2 },
      },
      patternSwitcher: {
        enabled: false,
        patternBoxes: [{ triggers: [{ token: 'E' }, { token: 'E' }] }] as PatternBox[],
        patternBoxMode: ('OR' as 'OR' | 'THEN' | 'THENALL'),
        thenTimeout: 20,
        thenTimeouts: [20, 20, 20, 20],
        thenMaxTrades: 3,
      },
      virtualWins: 0, virtualLosses: 0,
      vConsecWins: 0, vConsecLosses: 0,
      realWins: 0, realLosses: 0,
      rConsecWins: 0, rConsecLosses: 0,
    };

    if (currentConfig && currentConfig.strategies && currentConfig.strategies.length > 0) {
      setStrategies(JSON.parse(JSON.stringify(currentConfig.strategies)));
      setSelectedMarkets(currentConfig.selectedMarkets || ['1HZ10V', '1HZ100V']);
      setTradingMode(currentConfig.tradingMode || 'target');
      setCrossMarketDelay(currentConfig.crossMarketDelay || '1.5');
      setMartingale(currentConfig.martingale || '2.0');
      setIsMartingaleEnabled(currentConfig.isMartingaleEnabled ?? true);
      setCompoundProfits(!!currentConfig.compoundProfits);
      setCompoundPct(currentConfig.compoundPct || '50');
      setTargetProfit(currentConfig.targetProfit || '2');
      setTargetProfitMode(currentConfig.targetProfitMode || 'wins');
      setStopLoss(currentConfig.stopLoss || '2');
      setStopLossMode(currentConfig.stopLossMode || 'losses');
      if (currentConfig.adaptiveSwitch) {
        setAdaptiveSwitch(JSON.parse(JSON.stringify(currentConfig.adaptiveSwitch)));
      } else {
        setAdaptiveSwitch({
          enabled: false,
          dualMode: false,
          steps: [
            { contractType: 'DIGITEVEN', reps: 2 },
            { contractType: 'DIGITODD',  reps: 2 },
          ],
        });
      }
      // Sync virtualSettings with full reset to prevent previous step values leaking
      if (currentConfig.virtualSettings) {
        setVirtualMode({ ...defaultVirt, ...currentConfig.virtualSettings });
      } else {
        setVirtualMode(defaultVirt);
      }
      // Sync continuousLock
      if (currentConfig.continuousLock) {
        setContinuousLock(JSON.parse(JSON.stringify(currentConfig.continuousLock)));
      } else {
        setContinuousLock({
          enabled: false,
          mode: 'no_recheck',
          tradePattern: [true, false, false, false, true, false, false, false],
          useTradePattern: true,
          lockTPEnabled: false,
          lockTPMode: 'wins',
          lockTP: 3,
          lockSLEnabled: false,
          lockSLMode: 'losses',
          lockSL: 3,
        });
      }
    } else {
      const liveState = useBotStore.getState();
      setStrategies(liveState.strategies?.length ? JSON.parse(JSON.stringify(liveState.strategies)) : [createStrategy(0)]);
      setSelectedMarkets(liveState.selectedMarkets?.length ? [...liveState.selectedMarkets] : ['1HZ10V', '1HZ100V']);
      setTradingMode('target');
      setCrossMarketDelay(liveState.crossMarketDelay || '1.5');
      setMartingale(liveState.martingale || '2.0');
      setIsMartingaleEnabled(true);
      setCompoundProfits(false);
      setCompoundPct('50');
      setTargetProfit('2');
      setTargetProfitMode('wins');
      setStopLoss('2');
      setStopLossMode('losses');
      setAdaptiveSwitch(liveState.adaptiveSwitch ? JSON.parse(JSON.stringify(liveState.adaptiveSwitch)) : {
        enabled: false,
        dualMode: false,
        steps: [
          { contractType: 'DIGITEVEN', reps: 2 },
          { contractType: 'DIGITODD',  reps: 2 },
        ],
      });
      setVirtualMode(defaultVirt);
      setContinuousLock({
        enabled: false,
        mode: 'no_recheck',
        tradePattern: [true, false, false, false, true, false, false, false],
        useTradePattern: true,
        lockTPEnabled: false,
        lockTPMode: 'wins',
        lockTP: 3,
        lockSLEnabled: false,
        lockSLMode: 'losses',
        lockSL: 3,
      });
    }
  }, [isOpen, currentConfig]);


  if (!isOpen) return null;

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
      return { ...s, conditions: s.conditions.map(c => c.id === condId ? updated : c) };
    }));
  };

  const removeConditionFromStrat = (stratIdx: number, condId: string) => {
    setStrategies(prev => prev.map((s, i) => {
      if (i !== stratIdx) return s;
      return { ...s, conditions: s.conditions.filter(c => c.id !== condId) };
    }));
  };

  const handleSave = () => {
    const isVS = Boolean(adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled);
    const configToSave: LaxPrimeStepConfig = {
      selectedMarkets: selectedMarkets.length > 0 ? selectedMarkets : ['1HZ10V', '1HZ100V'],
      strategies: strategies.length > 0 ? strategies : [createStrategy(0)],
      tradingMode,
      crossMarketDelay,
      martingale,
      isMartingaleEnabled,
      compoundProfits,
      compoundPct,
      targetProfit,
      targetProfitMode,
      stopLoss,
      stopLossMode,
      adaptiveSwitch: {
        ...adaptiveSwitch,
        enabled: isVS ? true : adaptiveSwitch.enabled,
        dualMode: isVS ? false : adaptiveSwitch.dualMode,
        virtualSwitcher: adaptiveSwitch.virtualSwitcher ? {
          ...adaptiveSwitch.virtualSwitcher,
          virtualContract: {
            ...adaptiveSwitch.virtualSwitcher.virtualContract,
            contractType: normalizeContractType(adaptiveSwitch.virtualSwitcher.virtualContract?.contractType || 'DIGITEVEN'),
          },
          onVirtualWins: {
            ...adaptiveSwitch.virtualSwitcher.onVirtualWins,
            contractType: normalizeContractType(adaptiveSwitch.virtualSwitcher.onVirtualWins?.contractType || 'DIGITUNDER'),
          },
          onVirtualLosses: {
            ...adaptiveSwitch.virtualSwitcher.onVirtualLosses,
            contractType: normalizeContractType(adaptiveSwitch.virtualSwitcher.onVirtualLosses?.contractType || 'DIGITOVER'),
          },
          returnToVirtual: {
            triggerType: (adaptiveSwitch.virtualSwitcher.returnToVirtual?.triggerType || 'wins') as 'wins' | 'losses' | 'trades',
            mode: (adaptiveSwitch.virtualSwitcher.returnToVirtual?.mode || 'consec') as 'consec' | 'total',
            threshold: Math.max(1, Number(adaptiveSwitch.virtualSwitcher.returnToVirtual?.threshold) || 3),
          },
          gateB: adaptiveSwitch.virtualSwitcher.gateB ? {
            enabled: !!adaptiveSwitch.virtualSwitcher.gateB.enabled,
            threshold: Math.max(1, Number(adaptiveSwitch.virtualSwitcher.gateB.threshold) || 2),
            mode: (adaptiveSwitch.virtualSwitcher.gateB.mode || 'consec') as 'consec' | 'total',
            triggerType: (adaptiveSwitch.virtualSwitcher.gateB.triggerType || 'losses') as 'wins' | 'losses' | 'trades',
          } : undefined,
        } : undefined,
      },
      virtualSettings: {
        ...virtualMode,
        isVirtualMode: isVS ? true : virtualMode.isVirtualMode,
        startVirtualToReal: isVS ? false : virtualMode.startVirtualToReal,
        startRealToVirtual: isVS ? false : virtualMode.startRealToVirtual,
        isDoubleVirtual: isVS ? false : virtualMode.isDoubleVirtual,
        smartSettings: isVS ? { ...(virtualMode.smartSettings || { enabled: false, type: 'sequence' as const, sequence: { step1Type: 'Wins' as const, step1Qty: 2, step1Mode: 'consecutive' as const, step2Type: 'Losses' as const, step2Qty: 2, step2Mode: 'consecutive' as const }, alternating: { count: 2 } }), enabled: false } : virtualMode.smartSettings,
      },
      continuousLock,
    };

    onSave(configToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      {/* Explicit dark style enforcement for Windows Chromium dropdown option lists */}
      <style>{`
        .mini-lp-root select,
        .mini-lp-root select option {
          background-color: #0f172a !important;
          color: #ffffff !important;
        }
        .mini-lp-root select:focus {
          outline: none !important;
          border-color: #6366f1 !important;
        }
      `}</style>

      <div className="mini-lp-root relative w-full max-w-5xl max-h-[96vh] flex flex-col bg-[#0b0f19] border border-indigo-500/30 rounded-2xl shadow-2xl shadow-indigo-950/50 overflow-hidden text-white">

        {/* ── Top Header ── */}
        <div className="p-3.5 sm:p-4 md:p-5 border-b border-white/10 bg-slate-900/80 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-black text-sm shrink-0">
              LX
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-white tracking-wide">
                  Mini LaxPrime Settings
                </h2>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-[9px] sm:text-[10px] font-black text-indigo-300">
                    {stepLabel || `Step ${stepIndex + 1}`}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/30 text-[9px] sm:text-[10px] font-black text-teal-300">
                    OVERRIDE
                  </span>
                </div>
              </div>
              <p className="text-[10px] sm:text-[11px] text-gray-400 mt-0.5">
                Configure dedicated strategies, conditions, TP/SL, inner compounding, and markets for this step.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors ml-auto"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── LaxPrime Full Parameter Row (Stake, TP, SL, Martingale/Compounding, Mode) ── */}
        <div className="p-3 sm:p-4 bg-slate-900/60 border-b border-white/10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {/* Stake Indicator (Controlled by AutoTrade Capital %) */}
          <div className="bg-black/40 border border-emerald-500/30 rounded-xl p-2.5">
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider block">
              BASE STAKE
            </span>
            <div className="text-sm font-mono font-bold text-white mt-0.5">
              ${currentCompoundedStake}
            </div>
            <span className="text-[9px] text-emerald-300/80 block mt-0.5 truncate">
              {isCapitalCompound ? `${capitalPct}% Capital Compounding` : isCompounding ? 'AutoTrade Compounded' : 'AutoTrade Base Stake'}
            </span>
          </div>

          {/* Step Target Profit (Dual-Mode: Profit ⇌ Total Wins with Swipe & Tap) */}
          <div
            className="bg-black/40 border border-white/10 rounded-xl p-2.5 select-none"
            onTouchStart={e => { stepTpTouchXRef.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              if (stepTpTouchXRef.current !== null) {
                const diffX = e.changedTouches[0].clientX - stepTpTouchXRef.current;
                if (Math.abs(diffX) > 20) setTargetProfitMode(m => m === 'profit' ? 'wins' : 'profit');
                stepTpTouchXRef.current = null;
              }
            }}
          >
            <div className="flex items-center justify-between mb-1 gap-1">
              <span
                className="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:underline truncate"
                onClick={() => setTargetProfitMode(m => m === 'profit' ? 'wins' : 'profit')}
                title="Tap or swipe to switch between USD Profit and Total Wins"
              >
                {targetProfitMode === 'wins' ? 'TARGET WINS' : 'TARGET PROFIT'}
              </span>
              <button
                type="button"
                onClick={() => setTargetProfitMode(m => m === 'profit' ? 'wins' : 'profit')}
                className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-bold shrink-0 cursor-pointer"
              >
                {targetProfitMode === 'wins' ? '🏆 Wins' : '💵 USD'}
              </button>
            </div>
            <input
              type="number"
              min="0.1"
              step={targetProfitMode === 'wins' ? '1' : '0.1'}
              value={targetProfit}
              onChange={e => setTargetProfit(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono font-bold text-white"
            />
          </div>

          {/* Step Stop Loss (Dual-Mode: Loss ⇌ Total Losses with Swipe & Tap) */}
          <div
            className="bg-black/40 border border-white/10 rounded-xl p-2.5 select-none"
            onTouchStart={e => { stepSlTouchXRef.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              if (stepSlTouchXRef.current !== null) {
                const diffX = e.changedTouches[0].clientX - stepSlTouchXRef.current;
                if (Math.abs(diffX) > 20) setStopLossMode(m => m === 'loss' ? 'losses' : 'loss');
                stepSlTouchXRef.current = null;
              }
            }}
          >
            <div className="flex items-center justify-between mb-1 gap-1">
              <span
                className="text-[10px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:underline truncate"
                onClick={() => setStopLossMode(m => m === 'loss' ? 'losses' : 'loss')}
                title="Tap or swipe to switch between USD Loss and Total Losses"
              >
                {stopLossMode === 'losses' ? 'STOP LOSSES' : 'STOP LOSS'}
              </span>
              <button
                type="button"
                onClick={() => setStopLossMode(m => m === 'loss' ? 'losses' : 'loss')}
                className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold shrink-0 cursor-pointer"
              >
                {stopLossMode === 'losses' ? '🔢 Count' : '💵 USD'}
              </button>
            </div>
            <input
              type="number"
              min="0.1"
              step={stopLossMode === 'losses' ? '1' : '0.1'}
              value={stopLoss}
              onChange={e => setStopLoss(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono font-bold text-white"
            />
          </div>

          {/* Martingale ⇌ Inner Compounding Toggle */}
          <div className="bg-black/40 border border-white/10 rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {compoundProfits ? 'COMPOUND' : 'MARTINGALE'}
              </span>
              <button
                type="button"
                onClick={() => setCompoundProfits(!compoundProfits)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  compoundProfits ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-indigo-500/20 text-indigo-300'
                }`}
                title="Toggle between Martingale multiplier and Inner Profit Compounding"
              >
                {compoundProfits ? '📈 Compound' : '⚡ Martingale'}
              </button>
            </div>
            {compoundProfits ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={compoundPct}
                  onChange={e => setCompoundPct(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono font-bold text-white"
                />
                <span className="text-xs text-gray-400 font-bold">%</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="10"
                  value={martingale}
                  onChange={e => setMartingale(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono font-bold text-white"
                />
                <span className="text-xs text-gray-400 font-bold">x</span>
              </div>
            )}
          </div>

          {/* Trading Mode (Full width on 2-column mobile screens) */}
          <div className="bg-black/40 border border-white/10 rounded-xl p-2.5 col-span-2 sm:col-span-1 lg:col-span-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
              STEP TRADING MODE
            </span>
            <select
              value={tradingMode}
              onChange={e => setTradingMode(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
            >
              <option value="target">Trade until Step Target (TP/SL)</option>
              <option value="continuous">Trade continuously on loss</option>
              <option value="once">Trade once per signal (1 trade)</option>
            </select>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">

          {/* ── Markets Selection ── */}
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
                  type="button"
                  onClick={() => setSelectedMarkets(ALL_MARKETS.map(m => m.value))}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMarkets(['1HZ10V', '1HZ100V'])}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                >
                  Default (1HZ)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMarkets([])}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300"
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
                    type="button"
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

          {/* ── Continuous Lock Panel ── */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">🔒</span>
                <span className="text-xs font-black text-white uppercase tracking-wider">Continuous Lock Trading</span>
                {continuousLock?.enabled && (
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-black animate-pulse">● LOCKED MODE ACTIVE</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={continuousLock?.enabled || false}
                    onChange={e => setContinuousLock(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="accent-amber-500"
                  />
                  <span className="text-xs font-bold text-gray-300">Enable Lock</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowContinuousLockPanel(v => !v)}
                  className="text-xs text-amber-400 hover:text-amber-300 font-bold"
                >
                  {showContinuousLockPanel ? '▲ Hide' : '▼ Configure'}
                </button>
              </div>
            </div>

            {showContinuousLockPanel && (
              <div className="space-y-3 mt-3 pt-3 border-t border-white/10">
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  When enabled, the bot scans all strategies across markets. As soon as a strategy triggers, it <strong className="text-amber-400">locks into that market &amp; strategy</strong> and executes continuously according to the Trade Pattern until Take Profit or Stop Loss is reached. All other strategies and markets are locked out.
                </p>

                {/* Mode Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div
                    onClick={() => setContinuousLock(prev => ({ ...prev, mode: 'no_recheck' }))}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      continuousLock?.mode === 'no_recheck'
                        ? 'border-amber-500/50 bg-amber-500/10 text-white shadow-sm'
                        : 'border-white/5 bg-black/40 text-gray-400 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-black text-amber-300">1. Trade after 1st entry (no re-check)</span>
                      {continuousLock?.mode === 'no_recheck' && (
                        <span className="text-[8px] font-black bg-amber-500 text-black px-1.5 py-0.5 rounded">ACTIVE</span>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 leading-snug">
                      Condition is initial trigger only. Once triggered, loops the trade pattern continuously without re-evaluating conditions.
                    </p>
                  </div>

                  <div
                    onClick={() => setContinuousLock(prev => ({ ...prev, mode: 'continuous_check' }))}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      continuousLock?.mode === 'continuous_check'
                        ? 'border-amber-500/50 bg-amber-500/10 text-white shadow-sm'
                        : 'border-white/5 bg-black/40 text-gray-400 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-black text-amber-300">2. Trade continuously + check entry</span>
                      {continuousLock?.mode === 'continuous_check' && (
                        <span className="text-[8px] font-black bg-amber-500 text-black px-1.5 py-0.5 rounded">ACTIVE</span>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 leading-snug">
                      Locks onto the triggering market &amp; strategy. Re-verifies entry conditions on the locked market before each trade in the pattern.
                    </p>
                  </div>
                </div>

                {/* Mode 2 Repeat Boxes selector — only visible when mode=continuous_check and a THEN/THENALL DIGIT_PATTERN with multiple boxes exists */}
                {continuousLock?.mode === 'continuous_check' && (() => {
                  const dpCond = strategies.flatMap((s: any) => s.conditions || []).find((c: any) =>
                    c.type === 'DIGIT_PATTERN' && (c.patternBoxMode === 'THEN' || c.patternBoxMode === 'THENALL')
                  );
                  const boxes: any[] = dpCond?.patternBoxes || [];
                  if (boxes.length < 2) return null;
                  return (
                    <div className="bg-teal-500/10 border border-teal-500/25 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-teal-300">🔄 Repeat Boxes (after 1st trigger)</span>
                        <span className="text-[9px] text-gray-400">
                          Box 1 = trigger only · tick boxes to repeat while locked
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {boxes.map((_: any, bi: number) => {
                          const isBox1 = bi === 0;
                          const curIndices: number[] = (continuousLock?.repeatBoxIndices ?? []) as number[];
                          const isSelected = !isBox1 && curIndices.includes(bi);
                          return (
                            <label key={bi} className={`flex items-center gap-1.5 ${isBox1 ? 'opacity-35 cursor-default' : 'cursor-pointer'}`}>
                              <input
                                type="checkbox"
                                disabled={isBox1}
                                checked={isBox1 ? false : isSelected}
                                onChange={() => {
                                  if (isBox1) return;
                                  const next = isSelected
                                    ? curIndices.filter((x: number) => x !== bi)
                                    : [...curIndices, bi].sort((a, b) => a - b);
                                  setContinuousLock(prev => ({ ...prev, repeatBoxIndices: next }));
                                }}
                                className="accent-teal-500 w-3.5 h-3.5"
                              />
                              <span className={`text-[10px] font-bold ${isBox1 ? 'text-gray-500' : isSelected ? 'text-teal-300' : 'text-gray-300'}`}>
                                Box {bi + 1}{isBox1 ? ' (trigger)' : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {((continuousLock?.repeatBoxIndices ?? []) as number[]).length === 0 && (
                        <p className="text-[9px] text-gray-500 italic m-0">
                          No boxes selected — bot will re-check full sequence each entry (Mode 2 default behavior)
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Trade Pattern Config */}
                <div className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">
                      Locked Trade Pattern Loop
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const cur = continuousLock?.tradePattern || [true, false];
                          if (cur.length < 16) {
                            setContinuousLock(prev => ({ ...prev, tradePattern: [...cur, true] }));
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[9px] font-bold text-gray-300 border border-white/10"
                      >
                        + Add Step
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const cur = continuousLock?.tradePattern || [true, false];
                          if (cur.length > 1) {
                            setContinuousLock(prev => ({ ...prev, tradePattern: cur.slice(0, -1) }));
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[9px] font-bold text-gray-300 border border-white/10"
                      >
                        − Remove Step
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setContinuousLock(prev => ({ ...prev, tradePattern: [true, false, false, false, true, false, false, false] }));
                        }}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[9px] font-bold text-gray-400 border border-white/10"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(continuousLock?.tradePattern || [true, false]).map((isTrade, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          const updated = [...(continuousLock?.tradePattern || [true, false])];
                          updated[idx] = !updated[idx];
                          setContinuousLock(prev => ({ ...prev, tradePattern: updated }));
                        }}
                        className={`w-9 h-10 rounded-lg flex flex-col items-center justify-center font-bold text-xs transition-all ${
                          isTrade
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 border border-emerald-500'
                            : 'bg-slate-800 text-gray-500 border border-white/5 hover:border-white/20'
                        }`}
                        title={`Step ${idx + 1}: ${isTrade ? 'TRADE' : 'SKIP'}`}
                      >
                        <span className="text-[8px] opacity-60 leading-none">{idx + 1}</span>
                        <span className="text-[11px] font-black leading-none mt-0.5">{isTrade ? 'T' : 'S'}</span>
                      </button>
                    ))}
                  </div>

                  <div className="text-[9px] text-gray-500 pt-1">
                    Loop: {(continuousLock?.tradePattern || [true, false]).map((t, i) => (
                      <span key={i}>
                        <span className={t ? 'text-emerald-400 font-bold' : 'text-gray-500'}>{t ? 'Trade' : 'Skip'}</span>
                        {i < (continuousLock?.tradePattern || []).length - 1 && ' → '}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Lock Session TP / SL Card ── */}
                <div className="bg-black/40 border border-amber-500/20 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                      🎯 Lock Session TP / SL
                    </span>
                    <span className="text-[9px] text-gray-500">
                      Unlocks &amp; rescans when hit (bot keeps running)
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Lock TP */}
                    <div className={`p-2.5 rounded-lg border transition-all ${
                      continuousLock?.lockTPEnabled
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-white/2 border-white/5'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-emerald-400">LOCK TAKE PROFIT</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={continuousLock?.lockTPEnabled || false}
                            onChange={e => setContinuousLock(prev => ({ ...prev, lockTPEnabled: e.target.checked }))}
                          />
                          <div className="w-7 h-3.5 bg-slate-700 peer-checked:bg-emerald-500 rounded-full transition-colors" />
                          <div className="absolute left-0.5 top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform peer-checked:translate-x-3.5" />
                        </label>
                      </div>
                      {continuousLock?.lockTPEnabled && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <select
                            value={continuousLock?.lockTPMode || 'wins'}
                            onChange={e => setContinuousLock(prev => ({ ...prev, lockTPMode: e.target.value as 'wins' | 'profit' }))}
                            className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[10px]"
                            style={{ background: '#0f172a', color: '#fff' }}
                          >
                            <option value="wins" style={{ background: '#0f172a' }}>Wins</option>
                            <option value="profit" style={{ background: '#0f172a' }}>$ Profit</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            step={continuousLock?.lockTPMode === 'profit' ? 0.1 : 1}
                            value={continuousLock?.lockTP ?? 3}
                            onChange={e => setContinuousLock(prev => ({ ...prev, lockTP: Math.max(0.01, parseFloat(e.target.value) || 1) }))}
                            className="w-12 bg-slate-900 border border-emerald-500/40 rounded px-1 py-0.5 text-center text-emerald-300 text-[10px] font-bold"
                            style={{ background: '#0f172a' }}
                          />
                          <span className="text-[9px] text-gray-500">
                            {continuousLock?.lockTPMode === 'profit' ? '$ → unlock' : 'wins → unlock'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Lock SL */}
                    <div className={`p-2.5 rounded-lg border transition-all ${
                      continuousLock?.lockSLEnabled
                        ? 'bg-rose-500/10 border-rose-500/30'
                        : 'bg-white/2 border-white/5'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-rose-400">LOCK STOP LOSS</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={continuousLock?.lockSLEnabled || false}
                            onChange={e => setContinuousLock(prev => ({ ...prev, lockSLEnabled: e.target.checked }))}
                          />
                          <div className="w-7 h-3.5 bg-slate-700 peer-checked:bg-rose-500 rounded-full transition-colors" />
                          <div className="absolute left-0.5 top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform peer-checked:translate-x-3.5" />
                        </label>
                      </div>
                      {continuousLock?.lockSLEnabled && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <select
                            value={continuousLock?.lockSLMode || 'losses'}
                            onChange={e => setContinuousLock(prev => ({ ...prev, lockSLMode: e.target.value as 'losses' | 'loss' }))}
                            className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[10px]"
                            style={{ background: '#0f172a', color: '#fff' }}
                          >
                            <option value="losses" style={{ background: '#0f172a' }}>Losses</option>
                            <option value="loss" style={{ background: '#0f172a' }}>$ Loss</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            step={continuousLock?.lockSLMode === 'loss' ? 0.1 : 1}
                            value={continuousLock?.lockSL ?? 3}
                            onChange={e => setContinuousLock(prev => ({ ...prev, lockSL: Math.max(0.01, parseFloat(e.target.value) || 1) }))}
                            className="w-12 bg-slate-900 border border-rose-500/40 rounded px-1 py-0.5 text-center text-rose-300 text-[10px] font-bold"
                            style={{ background: '#0f172a' }}
                          />
                          <span className="text-[9px] text-gray-500">
                            {continuousLock?.lockSLMode === 'loss' ? '$ → unlock' : 'losses → unlock'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* ── Virtual System Panel ── */}
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4">

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-black text-white uppercase tracking-wider">Virtual System</span>
                {virtualMode.isVirtualMode && (
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[9px] font-black animate-pulse">● VIRTUAL ACTIVE</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateVS({ isVirtualMode: !virtualMode.isVirtualMode })}
                  className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all ${
                    virtualMode.isVirtualMode
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  }`}
                >
                  {virtualMode.isVirtualMode ? '→ SWITCH TO REAL' : '→ SWITCH TO VIRTUAL'}
                </button>
                <button type="button" onClick={() => setShowVirtualPanel(v => !v)} className="text-xs text-purple-400 hover:text-purple-300">
                  {showVirtualPanel ? '▲ Hide' : '▼ Configure'}
                </button>
              </div>
            </div>

            {showVirtualPanel && (
              <div className="space-y-3 mt-3 pt-3 border-t border-white/10">
                {Boolean(adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled) && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    <span className="text-base">🔒</span>
                    <div>
                      <div className="text-[11px] font-bold text-amber-400">Virtual System Locked by Switcher</div>
                      <div className="text-[9px] text-gray-400">Virtual Trade Switcher is active in the Switcher settings. Standard virtual triggers and double virtual gates are locked to prevent collisions.</div>
                    </div>
                  </div>
                )}
                <div className={`space-y-3 ${Boolean(adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled) ? 'opacity-35 pointer-events-none' : ''}`}>
                {/* === Digit Pattern Switcher (Virtual → Real) Card === */}
                <div className="bg-black/40 border border-indigo-500/30 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-indigo-300">⚡ Digit Pattern Switcher (V → Real)</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">OR / THEN / THENALL</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={virtualMode.patternSwitcher?.enabled || false}
                        onChange={e => {
                          const enabled = e.target.checked;
                          const currentPS = virtualMode.patternSwitcher || {
                            enabled: false,
                            patternBoxes: [{ triggers: [{ token: 'E' }, { token: 'E' }] }],
                            patternBoxMode: ('OR' as 'OR' | 'THEN' | 'THENALL'),
                            thenTimeout: 20,
                            thenTimeouts: [20, 20, 20, 20],
                            thenMaxTrades: 3,
                          };
                          updateVS({
                            patternSwitcher: { ...currentPS, enabled }
                          });
                        }}
                      />
                      <div className="w-8 h-4 bg-slate-700 peer-checked:bg-indigo-500 rounded-full transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                    </label>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Bot always starts in Virtual. Once the digit pattern matches across markets, it automatically switches to Real mode and pauses until Start Real → Switch to Virtual returns to Virtual.
                  </p>
                  {virtualMode.patternSwitcher?.enabled && (
                    <MiniVirtualPatternBuilder
                      config={virtualMode.patternSwitcher}
                      onChange={updated => updateVS({ patternSwitcher: { ...virtualMode.patternSwitcher, ...updated, enabled: true } })}
                    />
                  )}
                </div>

                {/* === Virtual → Real Card === */}
                <div className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-purple-300">Start Virtual → Switch to Real</span>
                      {virtualMode.patternSwitcher?.enabled && (
                        <div className="flex items-center gap-1.5 text-[9px] text-amber-400 mt-0.5">
                          <span>🔒</span>
                          <span>Standard V → R triggers locked (Digit Pattern Switcher active)</span>
                        </div>
                      )}
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={virtualMode.startVirtualToReal} onChange={e => updateVS({ startVirtualToReal: e.target.checked })} />
                      <div className="w-8 h-4 bg-slate-700 peer-checked:bg-purple-500 rounded-full transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                    </label>
                  </div>

                  {virtualMode.startVirtualToReal && (
                    <div className="space-y-2" style={virtualMode.patternSwitcher?.enabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}>
                      {/* Double Virtual toggle */}
                      <div className="flex items-center justify-between bg-purple-500/10 border border-purple-500/20 rounded-lg p-2">
                        <span className="text-[10px] font-bold text-purple-300">⚡ Double Virtual (2-Stage)</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" className="sr-only peer" checked={!!virtualMode.isDoubleVirtual}
                            onChange={e => updateVS({ isDoubleVirtual: e.target.checked, vDoubleStage: 'A', vStageBCompletedReps: 0 })} />
                          <div className="w-8 h-4 bg-slate-700 peer-checked:bg-purple-600 rounded-full transition-colors" />
                          <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                        </label>
                      </div>

                      {/* Stage A Controls */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-gray-400 font-bold">{virtualMode.isDoubleVirtual ? 'Stage A Gate:' : 'Trigger on:'}</span>
                        <select value={virtualMode.vTriggerType} onChange={e => updateVS({ vTriggerType: e.target.value as 'wins' | 'losses' })}
                          className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                          <option value="wins" style={{ background: '#0f172a' }}>Wins</option>
                          <option value="losses" style={{ background: '#0f172a' }}>Losses</option>
                        </select>
                        <select value={virtualMode.vTriggerMode} onChange={e => updateVS({ vTriggerMode: e.target.value as 'consec' | 'total' })}
                          className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                          <option value="consec" style={{ background: '#0f172a' }}>Consecutive</option>
                          <option value="total" style={{ background: '#0f172a' }}>Total</option>
                        </select>
                        <span className="text-gray-400">Threshold:</span>
                        <input type="number" min={1} value={virtualMode.vThreshold} onChange={e => updateVS({ vThreshold: +e.target.value || 1 })}
                          className="w-12 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                        <button type="button" onClick={() => updateVS({ vInEnabled: !virtualMode.vInEnabled })}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black transition-all ${
                            virtualMode.vInEnabled ? 'bg-indigo-600 text-white border border-indigo-400' : 'bg-white/5 text-gray-400 border border-white/10'
                          }`} title="Evaluate threshold within last N virtual trades">
                          IN
                        </button>
                        {virtualMode.vInEnabled && (
                          <>
                            <input type="number" min={1} value={virtualMode.vInTrades ?? 5} onChange={e => updateVS({ vInTrades: Math.max(1, +e.target.value || 1) })}
                              className="w-12 bg-slate-900 border border-indigo-400/40 rounded px-1 py-1 text-center text-indigo-300 text-[10px]" style={{ background: '#0f172a' }} />
                            <span className="text-gray-500 text-[10px]">trades</span>
                          </>
                        )}
                      </div>

                      {/* Stage B (Double Virtual) */}
                      {virtualMode.isDoubleVirtual && (
                        <div className="bg-purple-500/8 border border-purple-500/25 rounded-lg p-2.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-bold text-purple-300">STAGE B (Gate 2 & Execution Cycle):</span>
                            <span className={`text-[9px] font-bold ${virtualMode.vDoubleStage === 'B' ? 'text-emerald-400' : 'text-gray-500'}`}>
                              {virtualMode.vDoubleStage === 'B' ? `ACTIVE [Rep ${(virtualMode.vStageBCompletedReps || 0) + 1}/${virtualMode.vStageBReps || 1}]` : 'WAITING FOR STAGE A'}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="text-gray-400">Gate B:</span>
                            <select value={virtualMode.vTriggerTypeB || 'wins'} onChange={e => updateVS({ vTriggerTypeB: e.target.value as 'wins' | 'losses' })}
                              className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                              <option value="wins" style={{ background: '#0f172a' }}>Wins</option>
                              <option value="losses" style={{ background: '#0f172a' }}>Losses</option>
                            </select>
                            <select value={virtualMode.vTriggerModeB || 'consec'} onChange={e => updateVS({ vTriggerModeB: e.target.value as 'consec' | 'total' })}
                              className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                              <option value="consec" style={{ background: '#0f172a' }}>Consecutive</option>
                              <option value="total" style={{ background: '#0f172a' }}>Total</option>
                            </select>
                            <span className="text-gray-400">Target:</span>
                            <input type="number" min={1} value={virtualMode.vThresholdB ?? 2} onChange={e => updateVS({ vThresholdB: +e.target.value || 1 })}
                              className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                            <button type="button" onClick={() => updateVS({ vInEnabledB: !virtualMode.vInEnabledB })}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-black transition-all ${
                                virtualMode.vInEnabledB ? 'bg-purple-600 text-white border border-purple-400' : 'bg-white/5 text-gray-400 border border-white/10'
                              }`}>IN</button>
                            {virtualMode.vInEnabledB && (
                              <input type="number" min={1} value={virtualMode.vInTradesB ?? 5} onChange={e => updateVS({ vInTradesB: Math.max(1, +e.target.value || 1) })}
                                className="w-10 bg-slate-900 border border-purple-400/40 rounded px-1 py-0.5 text-center text-purple-300 text-[10px]" style={{ background: '#0f172a' }} />
                            )}
                            <span className="text-gray-400">→ Real Reps:</span>
                            <input type="number" min={1} value={virtualMode.vStageBReps ?? 3} onChange={e => updateVS({ vStageBReps: +e.target.value || 1 })}
                              className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                          </div>
                        </div>
                      )}

                      {/* Smart Analysis Switch */}
                      <div className="bg-indigo-500/8 border border-indigo-500/25 rounded-lg p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-indigo-300">🧠 Smart Analysis Switch</span>
                            <p className="text-[9px] text-gray-500 mt-0.5">Switch to Real on strict result patterns</p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={virtualMode.smartSettings?.enabled || false}
                              onChange={e => updateVS({ smartSettings: { ...(virtualMode.smartSettings || { enabled: false, type: 'sequence' as const, sequence: { step1Type: 'Wins' as const, step1Qty: 2, step1Mode: 'consecutive' as const, step2Type: 'Losses' as const, step2Qty: 2, step2Mode: 'consecutive' as const }, alternating: { count: 2 } }), enabled: e.target.checked } })} />
                            <div className="w-8 h-4 bg-slate-700 peer-checked:bg-indigo-600 rounded-full transition-colors" />
                            <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                          </label>
                        </div>

                        {virtualMode.smartSettings?.enabled && (
                          <div className="space-y-2">
                            {/* Mode selector */}
                            <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/8">
                              <button type="button" onClick={() => updateVS({ smartSettings: { ...virtualMode.smartSettings!, type: 'sequence' } })}
                                className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${
                                  virtualMode.smartSettings?.type === 'sequence' ? 'bg-indigo-600 text-white' : 'text-gray-400'
                                }`}>STRICT SEQUENCE</button>
                              <button type="button" onClick={() => updateVS({ smartSettings: { ...virtualMode.smartSettings!, type: 'alternating' } })}
                                className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${
                                  virtualMode.smartSettings?.type === 'alternating' ? 'bg-indigo-600 text-white' : 'text-gray-400'
                                }`}>ALTERNATING</button>
                            </div>

                            {virtualMode.smartSettings?.type === 'sequence' ? (
                              <div className="grid grid-cols-2 gap-2">
                                {/* Step 1 Gate */}
                                <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase">Step 1 Gate</span>
                                  <div className="flex gap-1 mt-1">
                                    <select value={virtualMode.smartSettings?.sequence?.step1Type || 'Wins'}
                                      onChange={e => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step1Type: e.target.value as 'Wins' | 'Losses' } } })}
                                      className="bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-white text-[9px] flex-1" style={{ background: '#0f172a', color: '#fff' }}>
                                      <option value="Wins" style={{ background: '#0f172a' }}>Wins</option>
                                      <option value="Losses" style={{ background: '#0f172a' }}>Losses</option>
                                    </select>
                                    <input type="number" min={1} value={virtualMode.smartSettings?.sequence?.step1Qty || 2}
                                      onChange={e => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step1Qty: +e.target.value || 1 } } })}
                                      className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]" style={{ background: '#0f172a', color: '#fff' }} />
                                  </div>
                                  <div className="flex gap-1 mt-1">
                                    <button type="button" onClick={() => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step1Mode: 'consecutive' } } })}
                                      className={`flex-1 text-[8px] py-0.5 rounded border-none ${
                                        (virtualMode.smartSettings?.sequence?.step1Mode || 'consecutive') === 'consecutive' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white'
                                      } cursor-pointer`}>Consec</button>
                                    <button type="button" onClick={() => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step1Mode: 'total' } } })}
                                      className={`flex-1 text-[8px] py-0.5 rounded border-none ${
                                        virtualMode.smartSettings?.sequence?.step1Mode === 'total' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white'
                                      } cursor-pointer`}>Total</button>
                                  </div>
                                </div>
                                {/* Step 2 Gate */}
                                <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase">Step 2 Gate</span>
                                  <div className="flex gap-1 mt-1">
                                    <select value={virtualMode.smartSettings?.sequence?.step2Type || 'Losses'}
                                      onChange={e => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step2Type: e.target.value as 'Wins' | 'Losses' } } })}
                                      className="bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-white text-[9px] flex-1" style={{ background: '#0f172a', color: '#fff' }}>
                                      <option value="Wins" style={{ background: '#0f172a' }}>Wins</option>
                                      <option value="Losses" style={{ background: '#0f172a' }}>Losses</option>
                                    </select>
                                    <input type="number" min={1} value={virtualMode.smartSettings?.sequence?.step2Qty || 2}
                                      onChange={e => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step2Qty: +e.target.value || 1 } } })}
                                      className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]" style={{ background: '#0f172a', color: '#fff' }} />
                                  </div>
                                  <div className="flex gap-1 mt-1">
                                    <button type="button" onClick={() => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step2Mode: 'consecutive' } } })}
                                      className={`flex-1 text-[8px] py-0.5 rounded border-none ${
                                        (virtualMode.smartSettings?.sequence?.step2Mode || 'consecutive') === 'consecutive' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white'
                                      } cursor-pointer`}>Consec</button>
                                    <button type="button" onClick={() => updateVS({ smartSettings: { ...virtualMode.smartSettings!, sequence: { ...virtualMode.smartSettings!.sequence, step2Mode: 'total' } } })}
                                      className={`flex-1 text-[8px] py-0.5 rounded border-none ${
                                        virtualMode.smartSettings?.sequence?.step2Mode === 'total' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white'
                                      } cursor-pointer`}>Total</button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase">Required Alternating Patterns</span>
                                  <span className="text-[9px] font-bold text-indigo-300">{virtualMode.smartSettings?.alternating?.count || 2} CYCLES</span>
                                </div>
                                <input type="range" min={1} max={5} value={virtualMode.smartSettings?.alternating?.count || 2}
                                  onChange={e => updateVS({ smartSettings: { ...virtualMode.smartSettings!, alternating: { count: +e.target.value } } })}
                                  className="w-full accent-indigo-500" />
                                <div className="flex justify-between text-[8px] text-gray-600 font-bold mt-0.5">
                                  <span>W-L</span><span>W-L-W-L</span><span>W-L-W-L-W-L</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Streak tracker */}
                  <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-white/5">
                    <span className="text-emerald-400 font-bold">{virtualMode.virtualWins || 0}W</span>
                    <span className="text-rose-400 font-bold">{virtualMode.virtualLosses || 0}L</span>
                    <span className="text-gray-600">|</span>
                    <span className="text-gray-400">Streak {virtualMode.vConsecWins || 0}W / {virtualMode.vConsecLosses || 0}L</span>
                  </div>
                </div>

                {/* === Real → Virtual Card === */}
                <div className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-rose-300">Start Real → Switch to Virtual</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={virtualMode.startRealToVirtual} onChange={e => updateVS({ startRealToVirtual: e.target.checked })} />
                      <div className="w-8 h-4 bg-slate-700 peer-checked:bg-rose-500 rounded-full transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                    </label>
                  </div>
                  {virtualMode.startRealToVirtual && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-gray-400">Trigger on:</span>
                      <select value={virtualMode.rTriggerType} onChange={e => updateVS({ rTriggerType: e.target.value as 'wins' | 'losses' })}
                        className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                        <option value="wins" style={{ background: '#0f172a' }}>Wins</option>
                        <option value="losses" style={{ background: '#0f172a' }}>Losses</option>
                      </select>
                      <select value={virtualMode.rTriggerMode} onChange={e => updateVS({ rTriggerMode: e.target.value as 'consec' | 'total' })}
                        className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                        <option value="consec" style={{ background: '#0f172a' }}>Consecutive</option>
                        <option value="total" style={{ background: '#0f172a' }}>Total</option>
                      </select>
                      <span className="text-gray-400">Threshold:</span>
                      <input type="number" min={1} value={virtualMode.rThreshold} onChange={e => updateVS({ rThreshold: +e.target.value || 1 })}
                        className="w-12 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-white/5">
                    <span className="text-emerald-400 font-bold">{virtualMode.realWins || 0}W</span>
                    <span className="text-rose-400 font-bold">{virtualMode.realLosses || 0}L</span>
                    <span className="text-gray-600">|</span>
                    <span className="text-gray-400">Streak {virtualMode.rConsecWins || 0}W / {virtualMode.rConsecLosses || 0}L</span>
                  </div>
                </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Enhanced Switcher Panel ── */}
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
                  type="button"
                  onClick={() => setShowSwitcherPanel(v => !v)}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  {showSwitcherPanel ? '▲ Hide' : '▼ Configure'}
                </button>
              </div>
            </div>

            {showSwitcherPanel && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                {/* ── Virtual Trade Switcher ── */}
                {(() => {
                  const vs = adaptiveSwitch.virtualSwitcher || {
                    enabled: false,
                    virtualContract: { contractType: 'DIGITEVEN', ticks: 1 },
                    onVirtualWins:   { contractType: 'DIGITUNDER', barrier: 4, ticks: 1, threshold: 3, mode: 'consec' as const },
                    onVirtualLosses: { contractType: 'DIGITOVER',  barrier: 5, ticks: 1, threshold: 3, mode: 'consec' as const },
                    returnToVirtual: { triggerType: 'wins' as const, mode: 'consec' as const, threshold: 3 },
                    gateB: { enabled: false, threshold: 2, mode: 'consec' as const, triggerType: 'losses' as const },
                  };

                  const isLockMode1 = Boolean(continuousLock?.enabled && continuousLock?.mode === 'no_recheck');

                  const updateVS = (patch: Partial<typeof vs>) => {
                    setAdaptiveSwitch(prev => {
                      const nextVS = { ...vs, ...patch };
                      return {
                        ...prev,
                        enabled: nextVS.enabled ? true : prev.enabled,
                        virtualSwitcher: nextVS,
                      };
                    });
                  };
                  const updateVirtContract = (patch: Partial<typeof vs.virtualContract>) => {
                    const normPatch = patch.contractType ? { ...patch, contractType: normalizeContractType(patch.contractType) } : patch;
                    updateVS({ virtualContract: { ...vs.virtualContract, ...normPatch } });
                  };
                  const updateWinRule  = (patch: Partial<typeof vs.onVirtualWins>)   => {
                    const normPatch = patch.contractType ? { ...patch, contractType: normalizeContractType(patch.contractType) } : patch;
                    updateVS({ onVirtualWins:   { ...vs.onVirtualWins,   ...normPatch } as typeof vs.onVirtualWins });
                  };
                  const updateLossRule = (patch: Partial<typeof vs.onVirtualLosses>) => {
                    const normPatch = patch.contractType ? { ...patch, contractType: normalizeContractType(patch.contractType) } : patch;
                    updateVS({ onVirtualLosses: { ...vs.onVirtualLosses, ...normPatch } as typeof vs.onVirtualLosses });
                  };
                  const updateReturnRule = (patch: Partial<typeof vs.returnToVirtual>) => {
                    const currentRule = {
                      triggerType: (vs.returnToVirtual?.triggerType || 'wins') as 'wins' | 'losses' | 'trades',
                      mode: (vs.returnToVirtual?.mode || 'consec') as 'consec' | 'total',
                      threshold: Math.max(1, Number(vs.returnToVirtual?.threshold) || 3),
                    };
                    updateVS({ returnToVirtual: { ...currentRule, ...patch } });
                  };
                  const updateGateB = (patch: Partial<NonNullable<typeof vs.gateB>>) => {
                    const cur = {
                      enabled: vs.gateB?.enabled ?? false,
                      threshold: Math.max(1, Number(vs.gateB?.threshold) || 2),
                      mode: (vs.gateB?.mode || 'consec') as 'consec' | 'total',
                      triggerType: (vs.gateB?.triggerType || 'losses') as 'wins' | 'losses' | 'trades',
                    };
                    updateVS({ gateB: { ...cur, ...patch } });
                  };

                  const winNeedsBarrier  = needsBarrier(vs.onVirtualWins?.contractType  || 'DIGITUNDER');
                  const lossNeedsBarrier = needsBarrier(vs.onVirtualLosses?.contractType || 'DIGITOVER');
                  const virtNeedsBarrier = needsBarrier(vs.virtualContract?.contractType  || 'DIGITEVEN');

                  const phaseBadge = vs._phase === 'real'
                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">⚡ REAL TRADING</span>
                    : vs._phase === 'gate_b'
                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-orange-500/15 text-orange-400 border-orange-500/30">🔷 GATE B VIRTUAL</span>
                    : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-purple-500/15 text-purple-400 border-purple-500/30">🧪 VIRTUAL TESTING</span>;

                  return (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/4 p-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-black text-amber-400 tracking-wide">🎯 VIRTUAL TRADE SWITCHER</span>
                          {vs.enabled && phaseBadge}
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" className="sr-only peer" checked={!!vs.enabled}
                            onChange={e => updateVS({ enabled: e.target.checked })} />
                          <div className="w-8 h-4 bg-slate-700 peer-checked:bg-amber-500 rounded-full transition-colors" />
                          <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                        </label>
                      </div>

                      {vs.enabled && (
                        <div className="mt-3 space-y-3">
                          {/* Live telemetry */}
                          <div className="flex gap-3 text-[10px] pb-2 border-b border-white/5 flex-wrap">
                            <span className="text-purple-400 font-bold">Phase: {vs._phase || 'virtual'}</span>
                            <span className="text-emerald-400 font-bold">V-Wins: {vs._totalWins || 0} ({vs._consecWins || 0} consec)</span>
                            <span className="text-rose-400 font-bold">V-Loss: {vs._totalLosses || 0} ({vs._consecLosses || 0} consec)</span>
                            <span className="text-cyan-400 font-bold">Real: {vs._rTotalTrades || 0}</span>
                            {vs._phase === 'gate_b' && (
                              <span className="text-orange-400 font-bold">
                                🔷 Gate B: {vs.gateB?.triggerType === 'wins' ? (vs.gateB?.mode === 'consec' ? vs._gateBConsecWins || 0 : vs._gateBTotalWins || 0) : vs.gateB?.triggerType === 'losses' ? (vs.gateB?.mode === 'consec' ? vs._gateBConsecLosses || 0 : vs._gateBTotalLosses || 0) : vs._gateBTotalTrades || 0}/{vs.gateB?.threshold || 2} {vs.gateB?.triggerType}
                              </span>
                            )}
                          </div>

                          {/* ── Section 1: Virtual Test Contract ── */}
                          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-purple-300">1. Virtual Test Contract</span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <select value={vs.virtualContract?.contractType || 'DIGITEVEN'}
                                onChange={e => updateVirtContract({ contractType: e.target.value })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {virtNeedsBarrier && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-gray-400">Bar:</span>
                                  <input type="number" min={0} max={9}
                                    value={vs.virtualContract?.barrier ?? 4}
                                    onChange={e => updateVirtContract({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                    className="w-8 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                    style={{ background: '#0f172a', color: '#fff' }} />
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-purple-400 font-bold">Ticks:</span>
                                <input type="number" min={1} max={100}
                                  value={isLockMode1 ? 1 : (vs.virtualContract?.ticks ?? 1)}
                                  disabled={isLockMode1}
                                  onChange={e => updateVirtContract({ ticks: Math.max(1, +e.target.value || 1) })}
                                  className={`w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px] ${isLockMode1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  style={{ background: '#0f172a', color: '#fff' }} />
                                {isLockMode1 && <span className="text-[8px] text-amber-400 font-bold">Pattern</span>}
                              </div>
                            </div>
                          </div>

                          {/* ── Section 2: On Virtual Wins → Real ── */}
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-emerald-300">2. On Virtual Wins → Trade Real</span>
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                              <span className="text-gray-400">After</span>
                              <input type="number" min={1} max={99}
                                value={vs.onVirtualWins?.threshold ?? 3}
                                onChange={e => updateWinRule({ threshold: Math.max(1, +e.target.value || 1) })}
                                className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }} />
                              <span className="text-gray-400">wins</span>
                              {(['consec', 'total'] as const).map(m => (
                                <button key={m} type="button" onClick={() => updateWinRule({ mode: m })}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                    (vs.onVirtualWins?.mode || 'consec') === m ? 'bg-emerald-500 text-black' : 'bg-white/5 text-gray-400'
                                  }`}>
                                  {m === 'consec' ? 'Streak' : 'Total'}
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                              <span className="text-gray-400">Real Contract:</span>
                              <select value={vs.onVirtualWins?.contractType || 'DIGITUNDER'}
                                onChange={e => updateWinRule({ contractType: e.target.value })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {winNeedsBarrier && (
                                <input type="number" min={0} max={9}
                                  value={vs.onVirtualWins?.barrier ?? 4}
                                  onChange={e => updateWinRule({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                  className="w-8 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                  style={{ background: '#0f172a', color: '#fff' }} />
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-purple-400 font-bold">Ticks:</span>
                                <input type="number" min={1} max={100}
                                  value={isLockMode1 ? 1 : (vs.onVirtualWins?.ticks ?? 1)}
                                  disabled={isLockMode1}
                                  onChange={e => updateWinRule({ ticks: Math.max(1, +e.target.value || 1) })}
                                  className={`w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px] ${isLockMode1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  style={{ background: '#0f172a', color: '#fff' }} />
                                {isLockMode1 && <span className="text-[8px] text-amber-400 font-bold">Pattern</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-[9px]">
                              <span className="text-gray-500 shrink-0">Market:</span>
                              <select value={vs.onVirtualWins?.market || ''}
                                onChange={e => updateWinRule({ market: e.target.value || undefined })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                <option value="" style={{ background: '#0f172a' }}>— Same active market —</option>
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value} style={{ background: '#0f172a' }}>{m.label}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* ── Section 3: On Virtual Losses → Real ── */}
                          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-rose-300">3. On Virtual Losses → Trade Real</span>
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                              <span className="text-gray-400">After</span>
                              <input type="number" min={1} max={99}
                                value={vs.onVirtualLosses?.threshold ?? 3}
                                onChange={e => updateLossRule({ threshold: Math.max(1, +e.target.value || 1) })}
                                className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }} />
                              <span className="text-gray-400">losses</span>
                              {(['consec', 'total'] as const).map(m => (
                                <button key={m} type="button" onClick={() => updateLossRule({ mode: m })}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                    (vs.onVirtualLosses?.mode || 'consec') === m ? 'bg-rose-500 text-black' : 'bg-white/5 text-gray-400'
                                  }`}>
                                  {m === 'consec' ? 'Streak' : 'Total'}
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                              <span className="text-gray-400">Real Contract:</span>
                              <select value={vs.onVirtualLosses?.contractType || 'DIGITOVER'}
                                onChange={e => updateLossRule({ contractType: e.target.value })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {lossNeedsBarrier && (
                                <input type="number" min={0} max={9}
                                  value={vs.onVirtualLosses?.barrier ?? 5}
                                  onChange={e => updateLossRule({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                  className="w-8 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                  style={{ background: '#0f172a', color: '#fff' }} />
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-purple-400 font-bold">Ticks:</span>
                                <input type="number" min={1} max={100}
                                  value={isLockMode1 ? 1 : (vs.onVirtualLosses?.ticks ?? 1)}
                                  disabled={isLockMode1}
                                  onChange={e => updateLossRule({ ticks: Math.max(1, +e.target.value || 1) })}
                                  className={`w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px] ${isLockMode1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  style={{ background: '#0f172a', color: '#fff' }} />
                                {isLockMode1 && <span className="text-[8px] text-amber-400 font-bold">Pattern</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-[9px]">
                              <span className="text-gray-500 shrink-0">Market:</span>
                              <select value={vs.onVirtualLosses?.market || ''}
                                onChange={e => updateLossRule({ market: e.target.value || undefined })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                <option value="" style={{ background: '#0f172a' }}>— Same active market —</option>
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value} style={{ background: '#0f172a' }}>{m.label}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* ── Section 3.5: Gate B (Optional Virtual Confirmation) ── */}
                          <div className="rounded-lg border border-orange-500/25 bg-orange-500/5 p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-orange-400">🔷 Gate B (Optional Virtual Confirmation)</span>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={!!vs.gateB?.enabled}
                                  onChange={e => updateGateB({ enabled: e.target.checked })} />
                                <div className="w-8 h-4 bg-slate-700 peer-checked:bg-orange-500 rounded-full transition-colors" />
                                <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                              </label>
                            </div>
                            {vs.gateB?.enabled && (
                              <div className="space-y-1.5 pt-1 border-t border-white/5">
                                <p className="text-[9px] text-gray-400">
                                  Gate B tests the contract selected by Gate A <span className="text-orange-400 font-bold">virtually</span> before going to real. Contract stays locked.
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                                  <span className="text-gray-400">Go REAL after</span>
                                  <input type="number" min={1} max={99}
                                    value={vs.gateB?.threshold ?? 2}
                                    onChange={e => updateGateB({ threshold: Math.max(1, +e.target.value || 1) })}
                                    className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                    style={{ background: '#0f172a', color: '#fff' }} />
                                  {(['consec', 'total'] as const).map(m => (
                                    <button key={m} type="button" onClick={() => updateGateB({ mode: m })}
                                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                        (vs.gateB?.mode || 'consec') === m ? 'bg-orange-500 text-black' : 'bg-white/5 text-gray-400'
                                      }`}>
                                      {m === 'consec' ? 'Streak' : 'Total'}
                                    </button>
                                  ))}
                                  <select value={vs.gateB?.triggerType || 'losses'}
                                    onChange={e => updateGateB({ triggerType: e.target.value as any })}
                                    className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                    style={{ background: '#0f172a', color: '#fff' }}>
                                    <option value="wins" style={{ background: '#0f172a' }}>Wins</option>
                                    <option value="losses" style={{ background: '#0f172a' }}>Losses</option>
                                    <option value="trades" style={{ background: '#0f172a' }}>Trades</option>
                                  </select>
                                  <span className="text-gray-400">in virtual</span>
                                </div>
                                {vs._phase === 'gate_b' && (
                                  <div className="text-[9px] text-orange-400 font-bold p-1 bg-orange-500/10 rounded">
                                    🔷 ACTIVE: {vs._gateBConsecWins || 0}W streak / {vs._gateBConsecLosses || 0}L streak (total {vs._gateBTotalWins || 0}W / {vs._gateBTotalLosses || 0}L)
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* ── Section 4: Return to Virtual ── */}
                          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-cyan-300">4. Return to Virtual After</span>
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                              <input type="number" min={1} max={99}
                                value={vs.returnToVirtual?.threshold ?? 3}
                                onChange={e => updateReturnRule({ threshold: Math.max(1, +e.target.value || 1) })}
                                className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }} />
                              {(['consec', 'total'] as const).map(m => (
                                <button key={m} type="button" onClick={() => updateReturnRule({ mode: m })}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                    (vs.returnToVirtual?.mode || 'consec') === m ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-400'
                                  }`}>
                                  {m === 'consec' ? 'Streak' : 'Total'}
                                </button>
                              ))}
                              <select value={vs.returnToVirtual?.triggerType || 'wins'}
                                onChange={e => updateReturnRule({ triggerType: e.target.value as 'wins' | 'losses' | 'trades' })}
                                className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                <option value="wins" style={{ background: '#0f172a' }}>Wins</option>
                                <option value="losses" style={{ background: '#0f172a' }}>Losses</option>
                                <option value="trades" style={{ background: '#0f172a' }}>Trades</option>
                              </select>
                              <span className="text-gray-400">in real mode</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Standard Switcher Modes (Paused when Virtual Switcher is active) */}
                {(adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled) ? (
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-[10px] text-gray-400">
                    <span className="text-amber-400 font-bold">🔒 Standard Switcher Modes Paused: </span>
                    Adaptive Contracts and Sequence Steps are inactive while Virtual Trade Switcher is running.
                  </div>
                ) : (
                  <>
                    {/* Switcher Mode Tabs */}
                    <div className="flex bg-black/30 rounded-xl p-1 border border-white/8 gap-1">
                      <button type="button"
                        onClick={() => setAdaptiveSwitch(prev => ({ ...prev, mode: 'sequence' }))}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          (adaptiveSwitch.mode || 'sequence') === 'sequence' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                        }`}>📋 SEQUENCE STEPS</button>
                      <button type="button"
                        onClick={() => setAdaptiveSwitch(prev => ({ ...prev, mode: 'adaptive' }))}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          adaptiveSwitch.mode === 'adaptive' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'
                        }`}>⚡ ADAPTIVE CONTRACTS</button>
                      <button type="button"
                        onClick={() => setAdaptiveSwitch(prev => ({ ...prev, mode: 'manual' }))}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          adaptiveSwitch.mode === 'manual' ? 'bg-sky-600 text-white shadow' : 'text-gray-400 hover:text-white'
                        }`}>🎛️ MANUAL CONTRACTS</button>
                    </div>

                    {/* Dual Contracts System toggle */}
                    <div className="flex items-center justify-between bg-purple-500/8 border border-purple-500/20 rounded-xl p-2.5">
                      <div>
                        <span className="text-[10px] font-bold text-purple-300">⚡ DUAL CONTRACTS SYSTEM</span>
                        <p className="text-[9px] text-gray-500 mt-0.5">Fires exactly 2 contracts on the same tick. Martingale only acts on both-loss.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer ml-2">
                        <input type="checkbox" className="sr-only peer" checked={!!adaptiveSwitch.dualMode}
                          onChange={e => setAdaptiveSwitch(prev => ({ ...prev, dualMode: e.target.checked }))} />
                        <div className="w-8 h-4 bg-slate-700 peer-checked:bg-purple-600 rounded-full transition-colors" />
                        <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                      </label>
                    </div>

                    {/* ADAPTIVE CONTRACTS Panel */}
                    {adaptiveSwitch.mode === 'adaptive' && (() => {
                      const ac = adaptiveSwitch.adaptiveContracts || {
                        contractA: { type: 'DIGITEVEN', barrier: 4, ticks: 5 },
                        contractB: { type: 'DIGITODD', barrier: 4, ticks: 5 },
                        activeSide: 'A' as 'A' | 'B',
                        startSide: 'A' as 'A' | 'B',
                      };
                      const activeSide = ac.activeSide || ac.startSide || 'A';
                      const startSide = ac.startSide || 'A';
                      const updateAC = (patch: any) => setAdaptiveSwitch(prev => ({ ...prev, adaptiveContracts: { ...ac, ...patch } }));

                      return (
                        <div className="space-y-3 bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-bold text-purple-300">AUTO-SWITCH ON LOSS</span>
                              <p className="text-[9px] text-gray-500 mt-0.5">Switches instantly when a loss occurs</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                activeSide === 'A' ? 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30' : 'text-rose-300 bg-rose-500/20 border-rose-500/30'
                              }`}>● CONTRACT {activeSide}</span>
                              <button type="button" onClick={() => updateAC({ activeSide: activeSide === 'A' ? 'B' : 'A' })}
                                className="text-[9px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded cursor-pointer">⇌</button>
                            </div>
                          </div>

                          {/* Start Side */}
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-gray-400 font-bold">Start:</span>
                            <button type="button" onClick={() => updateAC({ startSide: 'A', activeSide: 'A' })}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border-none ${ startSide === 'A' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-400'} cursor-pointer`}>Contract A</button>
                            <button type="button" onClick={() => updateAC({ startSide: 'B', activeSide: 'B' })}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border-none ${ startSide === 'B' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-400'} cursor-pointer`}>Contract B</button>
                          </div>

                          {/* Contract A & B grid */}
                          <div className="grid grid-cols-2 gap-2">
                            {/* Contract A */}
                            <div className={`flex flex-col gap-1.5 p-2.5 rounded-xl border ${ activeSide === 'A' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/8 bg-white/2' }`}>
                              <span className="text-[10px] font-bold text-indigo-300">CONTRACT A{activeSide === 'A' ? ' ✓' : ''}</span>
                              <select value={ac.contractA?.type || 'DIGITEVEN'} onChange={e => updateAC({ contractA: { ...ac.contractA, type: e.target.value } })}
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {needsBarrier(ac.contractA?.type || 'DIGITEVEN') && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-gray-400">Barrier:</span>
                                  <input type="number" min={0} max={9} value={ac.contractA?.barrier ?? 4} onChange={e => updateAC({ contractA: { ...ac.contractA, barrier: Math.min(9, Math.max(0, +e.target.value || 0)) } })}
                                    className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-purple-400 font-bold">Ticks:</span>
                                <input type="number" min={1} max={100} value={ac.contractA?.ticks ?? 5} onChange={e => updateAC({ contractA: { ...ac.contractA, ticks: Math.max(1, +e.target.value || 1) } })}
                                  className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                              </div>
                            </div>
                            {/* Contract B */}
                            <div className={`flex flex-col gap-1.5 p-2.5 rounded-xl border ${ activeSide === 'B' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/8 bg-white/2' }`}>
                              <span className="text-[10px] font-bold text-indigo-300">CONTRACT B{activeSide === 'B' ? ' ✓' : ''}</span>
                              <select value={ac.contractB?.type || 'DIGITODD'} onChange={e => updateAC({ contractB: { ...ac.contractB, type: e.target.value } })}
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {needsBarrier(ac.contractB?.type || 'DIGITODD') && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-gray-400">Barrier:</span>
                                  <input type="number" min={0} max={9} value={ac.contractB?.barrier ?? 4} onChange={e => updateAC({ contractB: { ...ac.contractB, barrier: Math.min(9, Math.max(0, +e.target.value || 0)) } })}
                                    className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-purple-400 font-bold">Ticks:</span>
                                <input type="number" min={1} max={100} value={ac.contractB?.ticks ?? 5} onChange={e => updateAC({ contractB: { ...ac.contractB, ticks: Math.max(1, +e.target.value || 1) } })}
                                  className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* MANUAL CONTRACTS Panel */}
                    {adaptiveSwitch.mode === 'manual' && (() => {
                      const mc = adaptiveSwitch.manualContracts || {
                        contractA: { type: 'DIGITEVEN', barrier: 4, ticks: 1 },
                        contractB: { type: 'DIGITODD', barrier: 4, ticks: 1 },
                        activeSide: 'A',
                        startSide: 'A',
                        onSwitchVirtualBehavior: 'stay_virtual',
                      };
                      const activeSide = mc.activeSide || mc.startSide || 'A';
                      const startSide = mc.startSide || 'A';
                      const virtualBehavior = mc.onSwitchVirtualBehavior || 'stay_virtual';

                      const updateMC = (patch: any) => {
                        setAdaptiveSwitch(prev => ({
                          ...prev,
                          manualContracts: { ...mc, ...patch },
                        }));
                      };

                      const contractsList = getManualContractList(mc);

                      return (
                        <div className="space-y-3 bg-sky-500/5 border border-sky-500/20 rounded-xl p-3">
                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <div>
                              <span className="text-[10px] font-bold text-sky-300">🎛️ MANUAL HUD CONTRACTS</span>
                              <p className="text-[9px] text-gray-500 mt-0.5">Configure 2 (or more) contracts to switch on-the-fly via the Quick HUD.</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-sky-300 bg-sky-500/20 border-sky-500/30">
                                ● CONTRACT {activeSide}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateMC({ activeSide: activeSide === 'A' ? 'B' : 'A' })}
                                className="text-[9px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded cursor-pointer"
                              >
                                ⇌
                              </button>
                            </div>
                          </div>

                          {/* Virtual Switch Behavior */}
                          <div className="bg-black/30 border border-white/10 rounded-lg p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-gray-300">Virtual Switch Behavior:</span>
                              <span className="text-[9px] font-bold text-amber-300">
                                {virtualBehavior === 'switch_to_real' ? '⚡ Switch to Real on click' : '🧪 Stay in Virtual'}
                              </span>
                            </div>
                            <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5 gap-1">
                              <button
                                type="button"
                                onClick={() => updateMC({ onSwitchVirtualBehavior: 'stay_virtual' })}
                                className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${
                                  virtualBehavior === 'stay_virtual' ? 'bg-indigo-600 text-white' : 'text-gray-400'
                                }`}
                              >
                                STAY VIRTUAL
                              </button>
                              <button
                                type="button"
                                onClick={() => updateMC({ onSwitchVirtualBehavior: 'switch_to_real' })}
                                className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${
                                  virtualBehavior === 'switch_to_real' ? 'bg-amber-600 text-white' : 'text-gray-400'
                                }`}
                              >
                                SWITCH TO REAL
                              </button>
                            </div>
                          </div>

                          {/* Start Side */}
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-gray-400 font-bold">Start Side:</span>
                            {contractsList.map((c, idx) => (
                              <button
                                key={c.id || idx}
                                type="button"
                                onClick={() => updateMC({ startSide: c.id, activeSide: c.id })}
                                className={`px-2 py-0.5 rounded text-[9px] font-bold border-none ${
                                  startSide === c.id ? 'bg-sky-600 text-white' : 'bg-white/5 text-gray-400'
                                } cursor-pointer`}
                              >
                                {c.label || `Contract ${c.id}`}
                              </button>
                            ))}
                          </div>

                          {/* Contracts Grid */}
                          <div className="grid grid-cols-2 gap-2">
                            {contractsList.map((c, idx) => {
                              const isA = idx === 0;
                              const isB = idx === 1;
                              const isCurActive = (c.id === activeSide) || (isA && activeSide === 'A') || (isB && activeSide === 'B');

                              const updateThisContract = (patch: any) => {
                                if (isA) updateMC({ contractA: { ...mc.contractA, ...patch } });
                                else if (isB) updateMC({ contractB: { ...mc.contractB, ...patch } });
                                if (mc.contracts) {
                                  const nextC = [...mc.contracts];
                                  nextC[idx] = { ...nextC[idx], ...patch };
                                  updateMC({ contracts: nextC });
                                }
                              };

                              return (
                                <div
                                  key={c.id || idx}
                                  className={`flex flex-col gap-1.5 p-2.5 rounded-xl border ${
                                    isCurActive ? 'border-sky-500 bg-sky-500/10' : 'border-white/8 bg-white/2'
                                  }`}
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-sky-300">
                                      {c.label || `CONTRACT ${c.id}`} {isCurActive ? '✓' : ''}
                                    </span>
                                    {contractsList.length > 2 && idx >= 2 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const nextC = (mc.contracts || contractsList).filter((_, i) => i !== idx);
                                          updateMC({ contracts: nextC, activeSide: activeSide === c.id ? 'A' : activeSide });
                                        }}
                                        className="text-[9px] text-rose-400 hover:text-rose-300 font-bold"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                  <select
                                    value={c.type || 'DIGITEVEN'}
                                    onChange={e => updateThisContract({ type: e.target.value })}
                                    className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]"
                                    style={{ background: '#0f172a', color: '#fff' }}
                                  >
                                    {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                                  </select>
                                  {needsBarrier(c.type || 'DIGITEVEN') && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] text-gray-400">Barrier:</span>
                                      <input
                                        type="number" min={0} max={9}
                                        value={c.barrier ?? 4}
                                        onChange={e => updateThisContract({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                        className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]"
                                        style={{ background: '#0f172a', color: '#fff' }}
                                      />
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-sky-400 font-bold">Ticks:</span>
                                    <input
                                      type="number" min={1} max={100}
                                      value={c.ticks ?? 1}
                                      onChange={e => updateThisContract({ ticks: Math.max(1, +e.target.value || 1) })}
                                      className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]"
                                      style={{ background: '#0f172a', color: '#fff' }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {contractsList.length < 4 && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextId = String.fromCharCode(65 + contractsList.length);
                                const newC = { id: nextId, label: `Contract ${nextId}`, type: 'DIGITEVEN', barrier: 4, ticks: 1 };
                                updateMC({ contracts: [...contractsList, newC] });
                              }}
                              className="w-full py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[9px] font-bold border border-white/10"
                            >
                              + Add Contract ({String.fromCharCode(65 + contractsList.length)})
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* SEQUENCE STEPS Panel */}
                    {(adaptiveSwitch.mode || 'sequence') === 'sequence' && (
                      <div className="space-y-2">
                        {adaptiveSwitch.steps.map((step, idx) => {
                          const isDual = !!adaptiveSwitch.dualMode;
                          const stepTrades = step.trades && step.trades.length > 0
                            ? step.trades
                            : [
                                { contractType: step.contractType || 'DIGITEVEN', barrier: step.barrier ?? 4, count: 1, ticks: step.ticks ?? 1 },
                                { contractType: 'DIGITODD', barrier: 4, count: 1, ticks: 1 },
                              ];

                          const updateDualTrade = (sideIdx: 0 | 1, patch: any) => {
                            const newTrades = [...stepTrades];
                            newTrades[sideIdx] = { ...newTrades[sideIdx], ...patch };
                            setAdaptiveSwitch(prev => ({
                              ...prev,
                              steps: prev.steps.map((s, i) => i === idx ? {
                                ...s,
                                trades: newTrades,
                                contractType: newTrades[0]?.contractType,
                                barrier: newTrades[0]?.barrier,
                                ticks: newTrades[0]?.ticks,
                              } : s),
                            }));
                          };

                          if (isDual) {
                            return (
                              <div key={idx} className="bg-black/40 p-2.5 rounded-xl border border-purple-500/20 text-xs space-y-2">
                                <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                                  <span className="font-bold text-purple-300">Step {idx + 1} (Dual Contracts):</span>
                                  <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1">
                                      <span className="text-gray-500 text-[10px]">Reps:</span>
                                      <input
                                        type="number"
                                        min="1"
                                        max="50"
                                        value={step.reps}
                                        onChange={e => {
                                          const reps = Math.max(1, +e.target.value || 1);
                                          setAdaptiveSwitch(prev => ({
                                            ...prev,
                                            steps: prev.steps.map((s, i) => i === idx ? { ...s, reps } : s),
                                          }));
                                        }}
                                        className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-center text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                                      />
                                    </div>
                                    {adaptiveSwitch.steps.length > 1 && (
                                      <button type="button" onClick={() => setAdaptiveSwitch(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))}
                                        className="text-rose-400 hover:text-rose-300 text-xs font-bold">✕</button>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  {/* Contract A */}
                                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-white/2 border border-white/5">
                                    <span className="text-[9px] font-bold text-indigo-300">CONTRACT A</span>
                                    <select
                                      value={stepTrades[0]?.contractType || 'DIGITEVEN'}
                                      onChange={e => updateDualTrade(0, { contractType: e.target.value })}
                                      className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}
                                    >
                                      {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                                    </select>
                                    <div className="flex items-center gap-2">
                                      {needsBarrier(stepTrades[0]?.contractType || 'DIGITEVEN') && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-[9px] text-gray-400">Bar:</span>
                                          <input type="number" min={0} max={9} value={stepTrades[0]?.barrier ?? 4} onChange={e => updateDualTrade(0, { barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                            className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1 ml-auto">
                                        <span className="text-[9px] text-purple-400 font-bold">Ticks:</span>
                                        <input type="number" min={1} max={100} value={stepTrades[0]?.ticks ?? 1} onChange={e => updateDualTrade(0, { ticks: Math.max(1, +e.target.value || 1) })}
                                          className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Contract B */}
                                  <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-white/2 border border-white/5">
                                    <span className="text-[9px] font-bold text-indigo-300">CONTRACT B</span>
                                    <select
                                      value={stepTrades[1]?.contractType || 'DIGITODD'}
                                      onChange={e => updateDualTrade(1, { contractType: e.target.value })}
                                      className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }}
                                    >
                                      {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                                    </select>
                                    <div className="flex items-center gap-2">
                                      {needsBarrier(stepTrades[1]?.contractType || 'DIGITODD') && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-[9px] text-gray-400">Bar:</span>
                                          <input type="number" min={0} max={9} value={stepTrades[1]?.barrier ?? 4} onChange={e => updateDualTrade(1, { barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                            className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1 ml-auto">
                                        <span className="text-[9px] text-purple-400 font-bold">Ticks:</span>
                                        <input type="number" min={1} max={100} value={stepTrades[1]?.ticks ?? 1} onChange={e => updateDualTrade(1, { ticks: Math.max(1, +e.target.value || 1) })}
                                          className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]" style={{ background: '#0f172a', color: '#fff' }} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // Single Contract per step
                          const cType = step.contractType || 'DIGITEVEN';
                          const hasBar = needsBarrier(cType);
                          const isOU = cType === 'RUNHIGH' || cType === 'RUNLOW';
                          return (
                            <div key={idx} className="flex items-center gap-2 bg-black/40 p-2.5 rounded-xl border border-white/5 text-xs flex-wrap">
                              <span className="font-bold text-gray-400 w-12 shrink-0">Step {idx + 1}:</span>
                              <select
                                value={cType}
                                onChange={e => {
                                  const newType = e.target.value;
                                  let curTicks = step.ticks ?? 1;
                                  if (newType === 'RUNHIGH' || newType === 'RUNLOW') curTicks = Math.max(2, Math.min(5, curTicks));
                                  setAdaptiveSwitch(prev => ({
                                    ...prev,
                                    steps: prev.steps.map((s, i) => i === idx ? { ...s, contractType: newType, ticks: curTicks, trades: [{ contractType: newType, barrier: s.barrier ?? 4, count: 1, ticks: curTicks }] } : s),
                                  }));
                                }}
                                className="flex-1 min-w-[100px] bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                              >
                                {TRADE_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>
                                ))}
                              </select>

                              {hasBar && (
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-400 text-[10px]">Bar:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="9"
                                    value={step.barrier ?? 4}
                                    onChange={e => {
                                      const bar = Math.min(9, Math.max(0, +e.target.value || 0));
                                      setAdaptiveSwitch(prev => ({
                                        ...prev,
                                        steps: prev.steps.map((s, i) => i === idx ? { ...s, barrier: bar, trades: [{ contractType: s.contractType || 'DIGITEVEN', barrier: bar, count: 1, ticks: s.ticks ?? 1 }] } : s),
                                      }));
                                    }}
                                    className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                                  />
                                </div>
                              )}

                              <div className="flex items-center gap-1">
                                <span className="text-purple-400 font-bold text-[10px]">Ticks:</span>
                                <input
                                  type="number"
                                  min={isOU ? 2 : 1}
                                  max={isOU ? 5 : 100}
                                  value={step.ticks ?? 1}
                                  onChange={e => {
                                    let val = Math.max(1, Math.min(100, +e.target.value || 1));
                                    if (isOU) val = Math.max(2, Math.min(5, val));
                                    setAdaptiveSwitch(prev => ({
                                      ...prev,
                                      steps: prev.steps.map((s, i) => i === idx ? { ...s, ticks: val, trades: [{ contractType: s.contractType || 'DIGITEVEN', barrier: s.barrier ?? 4, count: 1, ticks: val }] } : s),
                                    }));
                                  }}
                                  className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                                />
                              </div>

                              <div className="flex items-center gap-1 ml-auto">
                                <span className="text-gray-500 text-[10px]">Reps:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="50"
                                  value={step.reps}
                                  onChange={e => {
                                    const reps = Math.max(1, +e.target.value || 1);
                                    setAdaptiveSwitch(prev => ({
                                      ...prev,
                                      steps: prev.steps.map((s, i) => i === idx ? { ...s, reps } : s),
                                    }));
                                  }}
                                  className="w-11 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                                />
                              </div>

                              {adaptiveSwitch.steps.length > 1 && (
                                <button type="button" onClick={() => setAdaptiveSwitch(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))}
                                  className="text-rose-400 hover:text-rose-300 text-xs font-bold px-1">✕</button>
                              )}
                            </div>
                          );
                        })}
                        <button type="button"
                          onClick={() => setAdaptiveSwitch(prev => ({ ...prev, steps: [...prev.steps, { contractType: 'DIGITEVEN', barrier: 4, ticks: 1, reps: 2 }] }))}
                          className="w-full py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-[10px] font-bold border border-white/10">
                          + Add Step
                        </button>
                      </div>
                    )}
                  </>
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
              type="button"
              onClick={addStrategy}
              disabled={strategies.length >= 5}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1 shadow-md transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add Strategy
            </button>
          </div>

          {/* ── Strategy Cards List ── */}
          <div className="space-y-4">
            {strategies.map((strat, sIdx) => {
              const hasBarrier = needsBarrier(strat.tradeType);
              const isOnlyUD = strat.tradeType === 'RUNHIGH' || strat.tradeType === 'RUNLOW';

              return (
                <div
                  key={strat.id}
                  className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-4 shadow-lg"
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
                          type="button"
                          onClick={() => removeStrategy(sIdx)}
                          className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
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
                        className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          {cIdx > 0 && (
                            <select
                              value={cond.join}
                              onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, join: e.target.value as any })}
                              className="bg-indigo-950/80 text-indigo-300 font-bold text-xs rounded-lg px-2 py-1.5 border border-indigo-500/30"
                              style={{ background: '#1e1b4b', color: '#c7d2fe' }}
                            >
                              <option value="AND" style={{ background: '#0f172a', color: '#fff' }}>AND</option>
                              <option value="OR" style={{ background: '#0f172a', color: '#fff' }}>OR</option>
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
                              } else if (newType === 'DIGIT_PATTERN') {
                                patch.patternBoxes = [{ triggers: [{ token: 'E' }] }];
                                patch.patternBoxMode = 'OR';
                                patch.patternRetrigger = 'any';
                              }
                              updateConditionInStrat(sIdx, cond.id, { ...cond, ...patch });
                            }}
                            className="flex-1 min-w-[130px] bg-slate-900 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                            style={{ background: '#0f172a', color: '#ffffff' }}
                          >
                            {CONDITION_TYPES.map(ct => (
                              <option key={ct.value} value={ct.value} style={{ background: '#0f172a', color: '#fff' }}>
                                {ct.label}
                              </option>
                            ))}
                          </select>

                          {strat.conditions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeConditionFromStrat(sIdx, cond.id)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 flex items-center justify-center text-xs transition-colors shrink-0"
                              title="Delete condition"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {/* Parameter Row (Clean responsive container for non-builder types) */}
                        {cond.type !== 'DIGIT_PATTERN' && cond.type !== 'RSI_SIGNAL' && (
                          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-white/5 border border-white/5 text-xs text-gray-300">
                            {(cond.type === 'EVEN_PCT' || cond.type === 'ODD_PCT' || cond.type === 'FALL_PCT' || cond.type === 'RISE_PCT') && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
                                <select
                                  value={cond.comparator}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, comparator: e.target.value })}
                                  className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-xs text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                >
                                  {COMPARATORS.map(c => <option key={c} value={c} style={{ background: '#0f172a', color: '#fff' }}>{c}</option>)}
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={cond.value}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, value: +e.target.value })}
                                  className="w-14 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>% in last</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="1000"
                                  value={cond.period}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, period: +e.target.value })}
                                  className="w-14 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>ticks</span>
                                {/* ── Eligible Window ── */}
                                <button
                                  type="button"
                                  title="Eligible Window: keep this market eligible for N seconds after the condition is met"
                                  onClick={() => updateConditionInStrat(sIdx, cond.id, { ...cond, eligibleWindow: { enabled: !(cond.eligibleWindow?.enabled), seconds: cond.eligibleWindow?.seconds ?? 90 } })}
                                  className="px-1.5 py-0.5 rounded text-[9px] font-black transition-all"
                                  style={{
                                    background: cond.eligibleWindow?.enabled ? '#6366f1' : 'rgba(255,255,255,0.07)',
                                    color: cond.eligibleWindow?.enabled ? '#fff' : '#94a3b8',
                                    border: cond.eligibleWindow?.enabled ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.12)',
                                  }}
                                >⏱</button>
                                {cond.eligibleWindow?.enabled && (
                                  <>
                                    <input
                                      type="number" min={1} max={3600}
                                      value={cond.eligibleWindow?.seconds ?? 90}
                                      onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, eligibleWindow: { enabled: true, seconds: Math.max(1, +e.target.value || 1) } })}
                                      className="w-12 bg-slate-900 border border-indigo-400/40 rounded px-1 py-1 text-center text-indigo-300"
                                      style={{ background: '#0f172a' }}
                                      title="Eligible window duration in seconds"
                                    />
                                    <span className="text-indigo-400">s</span>
                                  </>
                                )}
                              </div>
                            )}


                            {(cond.type === 'OVER_PCT' || cond.type === 'UNDER_PCT') && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
                                <span>(</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="9"
                                  value={cond.digitBarrier ?? 4}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, digitBarrier: +e.target.value })}
                                  className="w-10 bg-slate-900 border border-white/10 rounded px-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>)</span>
                                <select
                                  value={cond.comparator}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, comparator: e.target.value })}
                                  className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-xs text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                >
                                  {COMPARATORS.map(c => <option key={c} value={c} style={{ background: '#0f172a', color: '#fff' }}>{c}</option>)}
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={cond.value}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, value: +e.target.value })}
                                  className="w-14 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>% in last</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="1000"
                                  value={cond.period}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, period: +e.target.value })}
                                  className="w-14 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>ticks</span>
                                {/* ── Eligible Window ── */}
                                <button
                                  type="button"
                                  title="Eligible Window: keep this market eligible for N seconds after the condition is met"
                                  onClick={() => updateConditionInStrat(sIdx, cond.id, { ...cond, eligibleWindow: { enabled: !(cond.eligibleWindow?.enabled), seconds: cond.eligibleWindow?.seconds ?? 90 } })}
                                  className="px-1.5 py-0.5 rounded text-[9px] font-black transition-all"
                                  style={{
                                    background: cond.eligibleWindow?.enabled ? '#6366f1' : 'rgba(255,255,255,0.07)',
                                    color: cond.eligibleWindow?.enabled ? '#fff' : '#94a3b8',
                                    border: cond.eligibleWindow?.enabled ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.12)',
                                  }}
                                >⏱</button>
                                {cond.eligibleWindow?.enabled && (
                                  <>
                                    <input
                                      type="number" min={1} max={3600}
                                      value={cond.eligibleWindow?.seconds ?? 90}
                                      onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, eligibleWindow: { enabled: true, seconds: Math.max(1, +e.target.value || 1) } })}
                                      className="w-12 bg-slate-900 border border-indigo-400/40 rounded px-1 py-1 text-center text-indigo-300"
                                      style={{ background: '#0f172a' }}
                                      title="Eligible window duration in seconds"
                                    />
                                    <span className="text-indigo-400">s</span>
                                  </>
                                )}
                              </div>
                            )}

                            {cond.type === 'LAST_DIGITS' && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
                                <span>last</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="50"
                                  value={cond.lastN}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, lastN: +e.target.value })}
                                  className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>digits are</span>
                                <select
                                  value={cond.digitValue}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, digitValue: e.target.value })}
                                  className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                >
                                  {DIGIT_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a', color: '#fff' }}>{opt.label}</option>)}
                                </select>
                                {(cond.digitValue === 'OVER' || cond.digitValue === 'UNDER' || cond.digitValue === 'EQUAL') && (
                                  <input
                                    type="number"
                                    min={0}
                                    max={9}
                                    value={cond.digitBarrier ?? 4}
                                    onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, digitBarrier: +e.target.value })}
                                    className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white"
                                    style={{ background: '#0f172a', color: '#ffffff' }}
                                  />
                                )}
                              </div>
                            )}

                            {cond.type === 'GREEN_BAR' && (() => {
                              const topCount = Math.max(1, cond.topCount ?? 3);
                              const rankType = cond.rankType || 'TOP'; // 'TOP' | 'LOWEST'
                              const category = cond.digitValue || 'EVEN';
                              const isOverUnder = category === 'OVER' || category === 'UNDER';
                              const barrier = cond.digitBarrier ?? 4;
                              const allAbove = cond.allAboveMinPct ?? true;
                              const pctCompare = cond.pctCompare || (rankType === 'LOWEST' ? 'BELOW' : 'ABOVE');

                              let maxTop = 5;
                              if (category === 'OVER') maxTop = Math.max(1, 9 - barrier);
                              else if (category === 'UNDER') maxTop = Math.max(1, barrier + 1);

                              const overMaxBarrier = Math.max(0, 9 - topCount);
                              const underMinBarrier = Math.min(9, Math.max(0, topCount - 1));

                              const updateC = (patch: any) => updateConditionInStrat(sIdx, cond.id, { ...cond, ...patch });

                              return (
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
                                  <select
                                    value={rankType}
                                    onChange={e => {
                                      const newRank = e.target.value as 'TOP' | 'LOWEST';
                                      const newPctComp = newRank === 'LOWEST' ? 'BELOW' : 'ABOVE';
                                      updateC({ rankType: newRank, pctCompare: newPctComp });
                                    }}
                                    className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-xs font-bold"
                                    style={{ background: '#0f172a', color: rankType === 'LOWEST' ? '#fb7185' : '#34d399' }}
                                  >
                                    <option value="TOP" style={{ background: '#0f172a', color: '#34d399' }}>TOP</option>
                                    <option value="LOWEST" style={{ background: '#0f172a', color: '#fb7185' }}>LOWEST</option>
                                  </select>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={cond.topCount !== undefined ? cond.topCount : 3}
                                    onFocus={e => e.target.select()}
                                    onChange={e => {
                                      const raw = e.target.value.replace(/[^0-9]/g, '');
                                      if (raw === '') {
                                        updateC({ topCount: '' as any });
                                        return;
                                      }
                                      const n = parseInt(raw, 10);
                                      if (!isNaN(n)) {
                                        const clamped = Math.max(1, Math.min(maxTop, n));
                                        let b = barrier;
                                        if (category === 'OVER' && b > 9 - clamped) b = 9 - clamped;
                                        if (category === 'UNDER' && b < clamped - 1) b = clamped - 1;
                                        updateC({ topCount: clamped, digitBarrier: b });
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!cond.topCount || isNaN(+cond.topCount) || +cond.topCount < 1) {
                                        updateC({ topCount: Math.min(maxTop, 2) });
                                      }
                                    }}
                                    className="w-10 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white"
                                    style={{ background: '#0f172a', color: '#ffffff' }}
                                  />
                                  <span>DIGITS ARE</span>
                                  <select
                                    value={category}
                                    onChange={e => {
                                      const newCat = e.target.value;
                                      let newMax = 5;
                                      let b = barrier;
                                      const curTop = typeof cond.topCount === 'number' ? cond.topCount : 3;
                                      if (newCat === 'OVER') {
                                        if (b > 9 - curTop) b = Math.max(0, 9 - curTop);
                                        newMax = Math.max(1, 9 - b);
                                      } else if (newCat === 'UNDER') {
                                        if (b < curTop - 1) b = Math.min(9, Math.max(0, curTop - 1));
                                        newMax = Math.max(1, b + 1);
                                      }
                                      const clampedTop = Math.min(curTop, newMax);
                                      updateC({ digitValue: newCat, topCount: clampedTop, digitBarrier: b });
                                    }}
                                    className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white"
                                    style={{ background: '#0f172a', color: '#ffffff' }}
                                  >
                                    <option value="EVEN" style={{ background: '#0f172a', color: '#fff' }}>EVEN</option>
                                    <option value="ODD" style={{ background: '#0f172a', color: '#fff' }}>ODD</option>
                                    <option value="OVER" style={{ background: '#0f172a', color: '#fff' }}>OVER</option>
                                    <option value="UNDER" style={{ background: '#0f172a', color: '#fff' }}>UNDER</option>
                                  </select>

                                  {isOverUnder && (
                                    <>
                                      <span>{category}</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={cond.digitBarrier !== undefined ? cond.digitBarrier : 4}
                                        onFocus={e => e.target.select()}
                                        onChange={e => {
                                          const raw = e.target.value.replace(/[^0-9]/g, '');
                                          if (raw === '') {
                                            updateC({ digitBarrier: '' as any });
                                            return;
                                          }
                                          let b = parseInt(raw, 10);
                                          if (!isNaN(b)) {
                                            if (category === 'OVER') b = Math.max(0, Math.min(overMaxBarrier, b));
                                            if (category === 'UNDER') b = Math.max(underMinBarrier, Math.min(9, b));
                                            updateC({ digitBarrier: b });
                                          }
                                        }}
                                        onBlur={() => {
                                          if ((cond.digitBarrier as any) === '' || isNaN(+(cond.digitBarrier ?? 0))) {
                                            updateC({ digitBarrier: 4 });
                                          }
                                        }}
                                        className="w-10 bg-slate-900 border border-cyan-500/40 rounded px-1 py-1 text-center text-cyan-300 font-bold"
                                        style={{ background: '#0f172a' }}
                                        title={category === 'OVER'
                                          ? `Max barrier is ${overMaxBarrier} so that at least ${topCount} digits can be over ${overMaxBarrier}`
                                          : `Min barrier is ${underMinBarrier} so that at least ${topCount} digits can be under ${underMinBarrier}`}
                                      />
                                    </>
                                  )}

                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={allAbove}
                                      onChange={e => updateC({ allAboveMinPct: e.target.checked })}
                                      className="accent-emerald-500 cursor-pointer"
                                    />
                                    <span className={allAbove ? 'text-emerald-400 font-medium' : 'text-gray-500'}>
                                      and each
                                    </span>
                                  </label>

                                  {allAbove && (
                                    <>
                                      <select
                                        value={pctCompare}
                                        onChange={e => updateC({ pctCompare: e.target.value as 'ABOVE' | 'BELOW' })}
                                        className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-xs font-bold"
                                        style={{ background: '#0f172a', color: pctCompare === 'BELOW' ? '#fb7185' : '#34d399' }}
                                      >
                                        <option value="ABOVE" style={{ background: '#0f172a', color: '#34d399' }}>&gt;= (above)</option>
                                        <option value="BELOW" style={{ background: '#0f172a', color: '#fb7185' }}>&lt;= (below)</option>
                                      </select>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={cond.value !== undefined ? cond.value : 10}
                                        onFocus={e => e.target.select()}
                                        onChange={e => {
                                          const raw = e.target.value;
                                          if (raw === '' || raw === '.') {
                                            updateC({ value: raw as any });
                                            return;
                                          }
                                          const num = parseFloat(raw);
                                          if (!isNaN(num)) {
                                            updateC({ value: Math.max(0, Math.min(100, num)) });
                                          }
                                        }}
                                        onBlur={() => {
                                          if ((cond.value as any) === '' || isNaN(+(cond.value ?? 0))) {
                                            updateC({ value: 10 });
                                          }
                                        }}
                                        className="w-12 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white"
                                        style={{ background: '#0f172a', color: '#ffffff' }}
                                      />
                                      <span>%</span>
                                    </>
                                  )}

                                  <span>in last</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={cond.period !== undefined ? cond.period : 100}
                                    onFocus={e => e.target.select()}
                                    onChange={e => {
                                      const raw = e.target.value.replace(/[^0-9]/g, '');
                                      if (raw === '') {
                                        updateC({ period: '' as any });
                                        return;
                                      }
                                      const num = parseInt(raw, 10);
                                      if (!isNaN(num)) {
                                        updateC({ period: Math.max(1, Math.min(1000, num)) });
                                      }
                                    }}
                                    onBlur={() => {
                                      if ((cond.period as any) === '' || isNaN(+(cond.period ?? 0))) {
                                        updateC({ period: 100 });
                                      }
                                    }}
                                    className="w-14 bg-slate-900 border border-white/10 rounded px-1 py-1 text-center text-white"
                                    style={{ background: '#0f172a', color: '#ffffff' }}
                                  />
                                  <span>ticks</span>
                                </div>
                              );
                            })()}

                            {cond.type === 'DIGIT_APPEARS' && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
                                <span>DIGIT</span>
                                {(cond.targetDigits || [cond.digitBarrier ?? 5]).map((d, di) => (
                                  <span key={di} className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold font-mono">
                                    {d}
                                  </span>
                                ))}
                                <select
                                  value={cond.comparator}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, comparator: e.target.value })}
                                  className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                >
                                  {['>', '=', '<'].map(c => <option key={c} value={c} style={{ background: '#0f172a', color: '#fff' }}>{c}</option>)}
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={cond.value}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, value: +e.target.value })}
                                  className="w-12 bg-slate-900 border border-white/10 rounded px-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>times in last</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={1000}
                                  value={cond.period}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, period: +e.target.value })}
                                  className="w-14 bg-slate-900 border border-white/10 rounded px-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>ticks</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Full Sub-Builders */}
                        {cond.type === 'DIGIT_PATTERN' && (
                          <AdvancedPatternBuilder
                            cond={cond}
                            onChange={updated => updateConditionInStrat(sIdx, cond.id, updated)}
                          />
                        )}

                        {cond.type === 'RSI_SIGNAL' && (
                          <RsiSignalBuilder
                            cond={cond}
                            onChange={updated => updateConditionInStrat(sIdx, cond.id, updated)}
                          />
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => addConditionToStrat(sIdx)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Condition
                    </button>
                  </div>

                  {/* THEN TRADE Section */}
                  <div className="pt-3 border-t border-white/10 flex flex-wrap items-center gap-3">
                    {(adaptiveSwitch.enabled || adaptiveSwitch.virtualSwitcher?.enabled) ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-purple-400" />
                          SWITCHER ACTIVE
                        </span>
                        <span className="text-[10px] text-indigo-300 font-bold">
                          → contract determined by Switcher
                        </span>
                      </div>
                    ) : (
                      <>
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
                          className="bg-slate-900 border border-white/20 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
                          style={{ background: '#0f172a', color: '#ffffff' }}
                        >
                          {TRADE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value} style={{ background: '#0f172a', color: '#fff' }}>
                              {opt.label}
                            </option>
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
                              className="w-12 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-center text-white font-bold"
                              style={{ background: '#0f172a', color: '#ffffff' }}
                            />
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex items-center gap-1.5 text-xs ml-auto">
                      <span className="text-gray-400 font-bold">FOR:</span>
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
                        className="w-14 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-center text-white font-mono font-bold"
                        style={{ background: '#0f172a', color: '#ffffff' }}
                      />
                      <span className="text-gray-400 font-bold">
                        {isOnlyUD ? 'TICKS (2-5)' : 'TICKS'}
                      </span>
                    </div>

                    {/* Trade Pattern Toggle */}
                    {!adaptiveSwitch.enabled && !continuousLock?.enabled && (
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
                    )}
                    {continuousLock?.enabled && (
                      <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 font-bold">
                        <span>🔒 Continuous Lock Active</span>
                      </div>
                    )}
                  </div>

                  {/* Trade Pattern Sequence */}
                  {!adaptiveSwitch.enabled && !continuousLock?.enabled && strat.useTradePattern && (
                    <div className="p-3 bg-black/40 border border-indigo-500/20 rounded-xl space-y-2">
                      <div className="text-[10px] text-gray-400">
                        Click cell to toggle: <span className="text-emerald-400 font-bold">T=TRADE</span> / <span className="text-amber-400 font-bold">S=SKIP</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(strat.tradePattern || [true]).map((isTrade, pIdx) => (
                          <button
                            key={pIdx}
                            type="button"
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
                          type="button"
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
                            type="button"
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
        <div className="p-3 sm:p-4 md:p-5 border-t border-white/10 bg-slate-900/95 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-gray-400 hidden sm:block">
            Step settings are preserved and isolated from the main LaxPrime page.
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto ml-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial min-h-[38px] px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-xs transition-colors text-center flex items-center justify-center cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 sm:flex-initial min-h-[38px] px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" /> Save & Apply
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
