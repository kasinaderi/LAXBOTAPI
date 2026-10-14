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
  const addBox = () => setBoxes([...boxes, { triggers: [{ token: 'E' }] }]);
  const removeBox = (bi: number) => setBoxes(boxes.filter((_, i) => i !== bi));

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

        {(cond.patternBoxMode ?? 'OR') === 'OR' && (
          <button
            onClick={addBox}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[10px] font-bold text-indigo-200"
          >
            + Add Box
          </button>
        )}
        {(cond.patternBoxMode === 'THEN' || cond.patternBoxMode === 'THENALL') && boxes.length < 2 && (
          <button
            onClick={addBox}
            className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-[10px] font-bold text-indigo-200"
          >
            + Add Box 2
          </button>
        )}
      </div>

      {/* Orientation hint */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (
        <p className="text-[10px] text-gray-400">
          {(cond.patternBoxMode ?? 'OR') === 'OR'
            ? 'Each trigger = 1 tick · Left = oldest, Right = latest · Multiple boxes = OR alternatives'
            : cond.patternBoxMode === 'THEN'
            ? 'Box 1 triggers → locks market → Box 2 must fire within timeout ticks'
            : 'Box 1 triggers → ALL markets scanned for Box 2 → fires up to max trades'}
        </p>
      )}

      {/* Boxes Grid */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {boxes.map((box, bi) => {
            const mode = cond.patternBoxMode ?? 'OR';
            if ((mode === 'THEN' || mode === 'THENALL') && bi >= 2) return null;

            return (
              <React.Fragment key={bi}>
                {bi > 0 && (
                  <div className="flex flex-col items-center gap-1.5 px-1">
                    {bi === 1 && (() => {
                      const curMode = cond.patternBoxMode ?? 'OR';
                      const nextMode = curMode === 'OR' ? 'THEN' : curMode === 'THEN' ? 'THENALL' : 'OR';
                      return (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={() => onChange({ ...cond, patternBoxMode: nextMode as 'OR' | 'THEN' | 'THENALL' })}
                            className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
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
                                value={cond.thenTimeout ?? 20}
                                onChange={e => onChange({ ...cond, thenTimeout: Math.max(1, +e.target.value || 20) })}
                                className="w-10 bg-black/60 border border-white/10 rounded px-1 text-center text-white text-[10px]"
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
                              />
                              <span>×</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {bi > 1 && (
                      <span className="text-[10px] font-bold text-amber-400">OR</span>
                    )}
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

  // Virtual System state
  const [showVirtualPanel, setShowVirtualPanel] = useState(false);
  const [showSwitcherPanel, setShowSwitcherPanel] = useState(false);
  const [virtualMode, setVirtualMode] = useState({
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
    virtualWins: 0,
    virtualLosses: 0,
    vConsecWins: 0,
    vConsecLosses: 0,
    realWins: 0,
    realLosses: 0,
    rConsecWins: 0,
    rConsecLosses: 0,
  });
  const updateVS = (patch: Partial<typeof virtualMode>) => setVirtualMode(prev => ({ ...prev, ...patch }));

  // Swipe detection refs for touch screens
  const stepTpTouchXRef = React.useRef<number | null>(null);
  const stepSlTouchXRef = React.useRef<number | null>(null);

  // Sync state when opened
  useEffect(() => {
    if (!isOpen) return;

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
      }
      // Sync virtualSettings
      if (currentConfig.virtualSettings) {
        setVirtualMode(prev => ({ ...prev, ...currentConfig.virtualSettings }));
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
      setVirtualMode({
        isVirtualMode: false,
        startVirtualToReal: false,
        vTriggerType: 'wins',
        vTriggerMode: 'consec',
        vThreshold: 2,
        vInEnabled: false,
        vInTrades: 5,
        isDoubleVirtual: false,
        vDoubleStage: 'A',
        vTriggerTypeB: 'wins',
        vTriggerModeB: 'consec',
        vThresholdB: 2,
        vInEnabledB: false,
        vInTradesB: 5,
        vStageBReps: 3,
        vStageBCompletedReps: 0,
        startRealToVirtual: false,
        rTriggerType: 'wins',
        rTriggerMode: 'consec',
        rThreshold: 3,
        smartSettings: {
          enabled: false,
          type: 'sequence',
          sequence: { step1Type: 'Wins', step1Qty: 2, step1Mode: 'consecutive', step2Type: 'Losses', step2Qty: 2, step2Mode: 'consecutive' },
          alternating: { count: 2 },
        },
        virtualWins: 0, virtualLosses: 0,
        vConsecWins: 0, vConsecLosses: 0,
        realWins: 0, realLosses: 0,
        rConsecWins: 0, rConsecLosses: 0,
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
      adaptiveSwitch,
      virtualSettings: virtualMode,
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
                {/* === Virtual → Real Card === */}
                <div className="bg-black/40 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-purple-300">Start Virtual → Switch to Real</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={virtualMode.startVirtualToReal} onChange={e => updateVS({ startVirtualToReal: e.target.checked })} />
                      <div className="w-8 h-4 bg-slate-700 peer-checked:bg-purple-500 rounded-full transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                    </label>
                  </div>

                  {virtualMode.startVirtualToReal && (
                    <div className="space-y-2">
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

                {/* SEQUENCE STEPS Panel */}
                {(adaptiveSwitch.mode || 'sequence') === 'sequence' && (
                  <div className="space-y-2">
                    {adaptiveSwitch.steps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-white/5 text-xs">
                        <span className="font-bold text-gray-400 w-14 shrink-0">Step {idx + 1}:</span>
                        <select
                          value={step.contractType || 'DIGITEVEN'}
                          onChange={e => {
                            const newType = e.target.value;
                            setAdaptiveSwitch(prev => ({
                              ...prev,
                              steps: prev.steps.map((s, i) => i === idx ? { ...s, contractType: newType } : s),
                            }));
                          }}
                          className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                        >
                          {TRADE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>
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
                            className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-center text-white text-xs" style={{ background: '#0f172a', color: '#fff' }}
                          />
                        </div>
                        {adaptiveSwitch.steps.length > 1 && (
                          <button type="button" onClick={() => setAdaptiveSwitch(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))}
                            className="text-rose-400 hover:text-rose-300 text-xs font-bold">✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button"
                      onClick={() => setAdaptiveSwitch(prev => ({ ...prev, steps: [...prev.steps, { contractType: 'DIGITEVEN', reps: 2 }] }))}
                      className="w-full py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-[10px] font-bold border border-white/10">
                      + Add Step
                    </button>
                  </div>
                )}

                {/* ── Virtual Trade Switcher ── */}
                {(() => {
                  const vs = adaptiveSwitch.virtualSwitcher || {
                    enabled: false,
                    onVirtualWins: { contractType: 'DIGITEVEN', threshold: 3, mode: 'consec' as const },
                    onVirtualLosses: { contractType: 'DIGITODD', threshold: 3, mode: 'consec' as const },
                  };
                  const updateVS = (patch: Partial<typeof vs>) =>
                    setAdaptiveSwitch(prev => ({ ...prev, virtualSwitcher: { ...vs, ...patch } }));
                  const updateWinRule = (patch: Partial<typeof vs.onVirtualWins>) =>
                    updateVS({ onVirtualWins: { ...vs.onVirtualWins, ...patch } });
                  const updateLossRule = (patch: Partial<typeof vs.onVirtualLosses>) =>
                    updateVS({ onVirtualLosses: { ...vs.onVirtualLosses, ...patch } });

                  return (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/4 p-3 mt-1">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-black text-amber-400 tracking-wide">🎯 VIRTUAL TRADE SWITCHER</span>
                          {vs.enabled && vs._activeRule && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                              vs._activeRule === 'wins'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                            }`}>
                              ● {vs._activeRule === 'wins' ? 'WIN RULE' : 'LOSS RULE'} ACTIVE
                            </span>
                          )}
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
                          <p className="text-[9px] text-gray-500 leading-relaxed">
                            After N virtual wins/losses, switch what real contract or market is traded next.
                          </p>

                          {/* Counters */}
                          <div className="flex gap-4 text-[10px] pb-2 border-b border-white/5">
                            <span className="text-emerald-400 font-bold">✓ Wins: {vs._totalWins || 0} (streak: {vs._consecWins || 0})</span>
                            <span className="text-rose-400 font-bold">✗ Losses: {vs._totalLosses || 0} (streak: {vs._consecLosses || 0})</span>
                          </div>

                          {/* WIN rule card */}
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-emerald-400">After Virtual Wins → Trade:</span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <select value={vs.onVirtualWins.contractType}
                                onChange={e => updateWinRule({ contractType: e.target.value })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]"
                                style={{ background: '#0f172a', color: '#fff', minWidth: '90px' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {needsBarrier(vs.onVirtualWins.contractType) && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-gray-400">Bar:</span>
                                  <input type="number" min={0} max={9} value={vs.onVirtualWins.barrier ?? 4}
                                    onChange={e => updateWinRule({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                    className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]"
                                    style={{ background: '#0f172a', color: '#fff' }} />
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-gray-400">After:</span>
                                <input type="number" min={1} max={99} value={vs.onVirtualWins.threshold}
                                  onChange={e => updateWinRule({ threshold: Math.max(1, +e.target.value || 1) })}
                                  className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]"
                                  style={{ background: '#0f172a', color: '#fff' }} />
                                <span className="text-[9px] text-gray-500">wins</span>
                              </div>
                              <div className="flex gap-1">
                                {(['consec', 'total'] as const).map(m => (
                                  <button key={m} type="button" onClick={() => updateWinRule({ mode: m })}
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                      vs.onVirtualWins.mode === m
                                        ? 'bg-emerald-500 text-black'
                                        : 'bg-white/5 text-gray-400'
                                    }`}>
                                    {m === 'consec' ? 'Streak' : 'Total'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] text-gray-500 shrink-0">Market:</span>
                              <select value={vs.onVirtualWins.market || ''}
                                onChange={e => updateWinRule({ market: e.target.value || undefined })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                <option value="" style={{ background: '#0f172a' }}>— Same active market —</option>
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value} style={{ background: '#0f172a' }}>{m.label}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* LOSS rule card */}
                          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-rose-400">After Virtual Losses → Trade:</span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <select value={vs.onVirtualLosses.contractType}
                                onChange={e => updateLossRule({ contractType: e.target.value })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white text-[10px]"
                                style={{ background: '#0f172a', color: '#fff', minWidth: '90px' }}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value} style={{ background: '#0f172a' }}>{opt.label}</option>)}
                              </select>
                              {needsBarrier(vs.onVirtualLosses.contractType) && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-gray-400">Bar:</span>
                                  <input type="number" min={0} max={9} value={vs.onVirtualLosses.barrier ?? 4}
                                    onChange={e => updateLossRule({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                    className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]"
                                    style={{ background: '#0f172a', color: '#fff' }} />
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-gray-400">After:</span>
                                <input type="number" min={1} max={99} value={vs.onVirtualLosses.threshold}
                                  onChange={e => updateLossRule({ threshold: Math.max(1, +e.target.value || 1) })}
                                  className="w-9 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-center text-white text-[10px]"
                                  style={{ background: '#0f172a', color: '#fff' }} />
                                <span className="text-[9px] text-gray-500">losses</span>
                              </div>
                              <div className="flex gap-1">
                                {(['consec', 'total'] as const).map(m => (
                                  <button key={m} type="button" onClick={() => updateLossRule({ mode: m })}
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                      vs.onVirtualLosses.mode === m
                                        ? 'bg-rose-500 text-black'
                                        : 'bg-white/5 text-gray-400'
                                    }`}>
                                    {m === 'consec' ? 'Streak' : 'Total'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] text-gray-500 shrink-0">Market:</span>
                              <select value={vs.onVirtualLosses.market || ''}
                                onChange={e => updateLossRule({ market: e.target.value || undefined })}
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-white text-[9px]"
                                style={{ background: '#0f172a', color: '#fff' }}>
                                <option value="" style={{ background: '#0f172a' }}>— Same active market —</option>
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value} style={{ background: '#0f172a' }}>{m.label}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

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

                            {cond.type === 'GREEN_BAR' && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-300">
                                <span>IS ON DIGIT</span>
                                <select
                                  value={cond.barValue}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, barValue: +e.target.value })}
                                  className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                >
                                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => <option key={d} value={d} style={{ background: '#0f172a', color: '#fff' }}>{d}</option>)}
                                </select>
                                <span>WITH PCT</span>
                                <select
                                  value={cond.comparator}
                                  onChange={e => updateConditionInStrat(sIdx, cond.id, { ...cond, comparator: e.target.value })}
                                  className="bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-white"
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
                                  className="w-12 bg-slate-900 border border-white/10 rounded px-1 text-center text-white"
                                  style={{ background: '#0f172a', color: '#ffffff' }}
                                />
                                <span>% in last</span>
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
                        className="w-14 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-center text-white font-mono font-bold"
                        style={{ background: '#0f172a', color: '#ffffff' }}
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

                  {/* Trade Pattern Sequence */}
                  {strat.useTradePattern && (
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
