'use client';

import React, { useState } from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import {
  Play, Square, ChevronDown, ChevronUp, Zap, Sparkles,
  ArrowRightLeft, GitMerge, FileDigit, Activity, FastForward,
  RotateCcw, DollarSign, Target, AlertTriangle, RefreshCw,
  ArrowUp, ArrowDown, Plus, Minus, X, RefreshCwIcon,
  Settings, ArrowRight, ClipboardList, Trash2, Download,
  Badge as BadgeIcon
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACT_OPTIONS = [
  { value: 'DIGITEVEN',  label: 'Even'    },
  { value: 'DIGITODD',   label: 'Odd'     },
  { value: 'DIGITOVER',  label: 'Over'    },
  { value: 'DIGITUNDER', label: 'Under'   },
  { value: 'DIGITMATCH', label: 'Matches' },
  { value: 'DIGITDIFF',  label: 'Differs' },
];

const NEEDS_PREDICTION = (t: string) =>
  ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(t || '');

const PATTERN_COLORS: Record<string, string> = {
  E: 'bg-teal-500', O: 'bg-amber-500', D: 'bg-red-500', M: 'bg-green-500',
  V: 'bg-teal-600', U: 'bg-blue-600', SE: 'bg-cyan-600', SO: 'bg-purple-600',
  R: 'bg-emerald-600', F: 'bg-rose-600',
};
const PATTERN_TYPES_LIST = ['E','O','D','M','V','U','SE','SO','R','F'];

// ─── Tiny UI primitives ───────────────────────────────────────────────────────

function Section({
  title, icon, children, defaultOpen = true, badge,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
  defaultOpen?: boolean; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{icon}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{title}</span>
          {badge}
        </div>
        {open
          ? <ChevronUp className="w-3 h-3 text-gray-600" />
          : <ChevronDown className="w-3 h-3 text-gray-600" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] text-gray-500 font-medium">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function Tog({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-8 h-4 rounded-full transition-all duration-300 flex-shrink-0 ${enabled ? 'bg-teal-500' : 'bg-white/10'}`}
    >
      <span
        className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-300"
        style={{ left: enabled ? '18px' : '2px' }}
      />
    </button>
  );
}

function Sel({
  value, onChange, options, className = '',
}: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-white outline-none focus:border-indigo-500/40 transition-all ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── Bot Control Bar ──────────────────────────────────────────────────────────

function BotControlBar() {
  const {
    isRunning, status, startBot, stopBot, account,
    triggerStatus, isBackendAuthorized, isTradeAuthorized,
    executionMode, virtualSettings, toggleManualMode, stats,
  } = useDerivStore();

  const isConnected = status === 'connected';
  const isVirtualMode = virtualSettings?.isVirtualMode;
  const isTradeReady = isTradeAuthorized;
  const canStart = isConnected && !!account && (isVirtualMode || isTradeReady);

  return (
    <div className="px-3 py-2.5 border-b border-white/5 bg-black/20 flex-shrink-0">
      {/* Status label */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-teal-400 animate-pulse' : isConnected ? 'bg-emerald-500' : 'bg-gray-600'}`} />
          <span className={`text-[9px] font-black uppercase tracking-widest ${isRunning ? 'text-teal-400' : isConnected ? 'text-emerald-400' : 'text-gray-500'}`}>
            {isRunning ? (triggerStatus || 'Running…') : isConnected ? 'Ready' : 'Offline'}
          </span>
        </div>
        {/* Quick stats when running */}
        {isRunning && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-emerald-400 font-mono font-bold">{stats.won}W</span>
            <span className="text-[9px] text-rose-400 font-mono font-bold">{stats.lost}L</span>
            <span className={`text-[9px] font-mono font-bold ${stats.totalProfit >= 0 ? 'text-teal-400' : 'text-rose-400'}`}>
              {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* START / STOP  +  Virtual/Real — side by side */}
      <div className="flex gap-1.5">
        <button
          onClick={isRunning ? stopBot : startBot}
          disabled={!isRunning && !canStart}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-black text-xs uppercase tracking-widest transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
            isRunning
              ? 'bg-rose-500/20 border border-rose-500/40 text-rose-400 hover:bg-rose-500/30'
              : 'bg-teal-500/20 border border-teal-500/40 text-teal-400 hover:bg-teal-500/30'
          }`}
        >
          {isRunning
            ? <><Square className="w-3 h-3 fill-current" />STOP</>
            : <><Play className="w-3 h-3 fill-current" />START</>}
        </button>

        <button
          onClick={toggleManualMode}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all active:scale-[0.97] border ${
            isVirtualMode
              ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/25'
              : 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25'
          }`}
        >
          {isVirtualMode
            ? <><Zap className="w-3 h-3" />Virtual</>
            : <><Sparkles className="w-3 h-3" />Real</>}
        </button>
      </div>
    </div>
  );
}

// ─── Pipeline Sequence ────────────────────────────────────────────────────────

function PipelineSection() {
  const { triggerSequence, setTriggerSequence, triggerMode, setTriggerMode, triggers, virtualSettings } = useDerivStore();

  const modLabel: Record<string, string> = { virtual: 'Virtual', entry: 'Entry Digit', pattern: 'Digit Pattern' };
  const modEnabled: Record<string, boolean> = {
    virtual: virtualSettings.isVirtualMode,
    entry: triggers.entryDigit.enabled,
    pattern: triggers.digitPattern.enabled,
  };
  const modColor: Record<string, string> = { virtual: 'text-indigo-400', entry: 'text-purple-400', pattern: 'text-amber-400' };
  const modIcon: Record<string, React.ReactNode> = {
    virtual: <FastForward className="w-3 h-3" />,
    entry: <FileDigit className="w-3 h-3" />,
    pattern: <Activity className="w-3 h-3" />,
  };

  const move = (i: number, dir: 'up' | 'down') => {
    const s = [...triggerSequence];
    const t = dir === 'up' ? i - 1 : i + 1;
    [s[i], s[t]] = [s[t], s[i]];
    setTriggerSequence(s);
  };

  const activeCount = Object.values(modEnabled).filter(Boolean).length;

  return (
    <Section
      title="Pipeline"
      icon={<GitMerge className="w-3.5 h-3.5" />}
      defaultOpen
      badge={activeCount > 0 && (
        <span className="text-[8px] font-black text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-full ml-1">
          {activeCount} active
        </span>
      )}
    >
      <div className="flex bg-black/30 rounded-lg p-0.5 mb-2">
        {(['sequential','simultaneous'] as const).map(m => (
          <button
            key={m}
            onClick={() => setTriggerMode(m)}
            className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all ${
              triggerMode === m ? (m === 'sequential' ? 'bg-teal-500 text-white' : 'bg-amber-500 text-white') : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {m === 'sequential' ? 'Sequential' : 'AND'}
          </button>
        ))}
      </div>

      {triggerMode === 'sequential' && (
        <div className="space-y-1">
          {triggerSequence.map((mod, i) => {
            const en = modEnabled[mod];
            return (
              <div key={mod} className={`flex items-center justify-between p-1.5 rounded border transition-all ${en ? 'border-white/10 bg-white/3' : 'border-white/5 opacity-40'}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-gray-600 w-3">{i + 1}</span>
                  <span className={modColor[mod]}>{modIcon[mod]}</span>
                  <span className={`text-[9px] font-bold ${en ? 'text-gray-300' : 'text-gray-600'}`}>{modLabel[mod]}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(i, 'up')} disabled={i === 0} className="p-0.5 text-gray-600 hover:text-teal-400 disabled:opacity-20">
                    <ArrowUp className="w-2.5 h-2.5" />
                  </button>
                  <button onClick={() => move(i, 'down')} disabled={i === triggerSequence.length - 1} className="p-0.5 text-gray-600 hover:text-teal-400 disabled:opacity-20">
                    <ArrowDown className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ─── Adaptive Switch (Full Advanced) ─────────────────────────────────────────

function AdaptiveSection() {
  const { triggers, updateTriggers, contractType, toggleAdaptiveSide, getActiveAdaptiveContract } = useDerivStore();
  const cfg = triggers?.adaptiveEvenOdd || {
    enabled: false, currentSide: 'Over' as const, initialSide: 'Over' as const,
    showAdvancedSettings: false, advancedEnabled: false, mode: 'adaptive_contracts',
    adaptiveContracts: { contractA: { type: 'DIGITUNDER', prediction: 4 }, contractB: { type: 'DIGITOVER', prediction: 5 }, activeSide: 'A', startSide: 'A' },
    customPattern: { steps: [{ type: 'DIGITEVEN', prediction: 0, repeats: 1 }], currentStepIndex: 0, currentRepeatCount: 0 },
  };

  const isOverUnder = ['DIGITOVER','DIGITUNDER'].includes(contractType || '');
  const sides = isOverUnder
    ? [{ l: 'OVER', v: 'Over', color: 'bg-indigo-500' }, { l: 'UNDER', v: 'Under', color: 'bg-orange-500' }]
    : [{ l: 'EVEN', v: 'Even', color: 'bg-indigo-500' }, { l: 'ODD',   v: 'Odd',   color: 'bg-orange-500' }];

  const patch = (partial: any) => updateTriggers({ adaptiveEvenOdd: { ...cfg, ...partial } });
  const patchContracts = (partial: any) => patch({ adaptiveContracts: { ...cfg.adaptiveContracts, ...partial } });
  const patchPattern = (partial: any) => patch({ customPattern: { ...cfg.customPattern, ...partial } });

  const patchStep = (idx: number, partial: any) => {
    const steps = [...(cfg.customPattern?.steps || [])];
    steps[idx] = { ...steps[idx], ...partial };
    patchPattern({ steps });
  };

  const addStep = () => {
    const steps = cfg.customPattern?.steps || [];
    if (steps.length < 5) patchPattern({ steps: [...steps, { type: 'DIGITEVEN', prediction: 0, repeats: 1 }] });
  };

  const removeStep = () => {
    const steps = cfg.customPattern?.steps || [];
    if (steps.length > 1) patchPattern({ steps: steps.slice(0, -1) });
  };

  // Live label helper
  const getLiveLabel = () => {
    const contract = getActiveAdaptiveContract();
    const label = CONTRACT_OPTIONS.find(o => o.value === contract.type)?.label || contract.type;
    const pred = NEEDS_PREDICTION(contract.type) ? ` ${contract.prediction}` : '';
    if (!cfg.advancedEnabled) return null;
    if (cfg.mode === 'adaptive_contracts') {
      return `${label}${pred} (Contract ${cfg.adaptiveContracts?.activeSide || 'A'})`;
    }
    const si = cfg.customPattern?.currentStepIndex || 0;
    const step = cfg.customPattern?.steps?.[si];
    const rc = cfg.customPattern?.currentRepeatCount || 0;
    return `${label}${pred} [Step ${si + 1}, ${rc + 1}/${step?.repeats || 1}]`;
  };

  return (
    <Section
      title="Adaptive Switch"
      icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
      defaultOpen={cfg.enabled}
      badge={cfg.enabled && <span className="text-[8px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full ml-1">ACTIVE</span>}
    >
      {/* Main enable row */}
      <Row label="Auto switch on loss"><Tog enabled={cfg.enabled} onChange={v => patch({ enabled: v })} /></Row>

      {cfg.enabled && (
        <div className="mt-2 space-y-2">
          <p className="text-[9px] text-gray-500 leading-snug">
            Automatically switches between {isOverUnder ? 'Over/Under' : 'Even/Odd'} on loss to target the winning side.
          </p>

          {/* Advanced settings toggle row */}
          <div className="flex items-center justify-between p-2 bg-indigo-500/8 border border-indigo-500/20 rounded-lg">
            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Advanced Strategy</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => patch({ showAdvancedSettings: !cfg.showAdvancedSettings })}
                className={`p-1 rounded transition-all ${cfg.showAdvancedSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-600 hover:text-gray-300'}`}
              >
                <Settings className="w-3 h-3" />
              </button>
              <Tog enabled={cfg.advancedEnabled} onChange={v => patch({ advancedEnabled: v })} />
            </div>
          </div>

          {/* Advanced settings panel */}
          {cfg.showAdvancedSettings && cfg.advancedEnabled && (
            <div className="p-2 bg-black/30 rounded-lg border border-indigo-500/20 space-y-3">
              {/* Mode selector */}
              <div className="flex bg-black/40 rounded-lg p-0.5">
                <button
                  onClick={() => patch({ mode: 'adaptive_contracts' })}
                  className={`flex-1 py-1 text-[9px] font-black uppercase rounded transition-all ${cfg.mode === 'adaptive_contracts' ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Adaptive Contracts
                </button>
                <button
                  onClick={() => patch({ mode: 'custom_pattern' })}
                  className={`flex-1 py-1 text-[9px] font-black uppercase rounded transition-all ${cfg.mode === 'custom_pattern' ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Custom Pattern
                </button>
              </div>

              {/* ADAPTIVE CONTRACTS mode */}
              {cfg.mode === 'adaptive_contracts' && (
                <div className="space-y-2">
                  {/* Contract A */}
                  <div className={`p-2 rounded-lg border ${cfg.adaptiveContracts?.activeSide === 'A' ? 'border-teal-500/50 bg-teal-500/5' : 'border-white/8 bg-white/3'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-black text-teal-400 uppercase">Contract A</span>
                      {cfg.adaptiveContracts?.activeSide === 'A' && (
                        <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">LIVE</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Sel
                        value={cfg.adaptiveContracts?.contractA?.type || 'DIGITUNDER'}
                        onChange={v => patchContracts({ contractA: { ...cfg.adaptiveContracts?.contractA, type: v } })}
                        options={CONTRACT_OPTIONS}
                      />
                      {NEEDS_PREDICTION(cfg.adaptiveContracts?.contractA?.type || '') ? (
                        <Sel
                          value={String(cfg.adaptiveContracts?.contractA?.prediction ?? 4)}
                          onChange={v => patchContracts({ contractA: { ...cfg.adaptiveContracts?.contractA, prediction: parseInt(v) } })}
                          options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
                        />
                      ) : (
                        <div className="bg-black/20 border border-white/5 rounded px-2 py-1 text-[9px] text-gray-600 text-center">N/A</div>
                      )}
                    </div>
                  </div>

                  {/* Contract B */}
                  <div className={`p-2 rounded-lg border ${cfg.adaptiveContracts?.activeSide === 'B' ? 'border-orange-500/50 bg-orange-500/5' : 'border-white/8 bg-white/3'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-black text-orange-400 uppercase">Contract B</span>
                      {cfg.adaptiveContracts?.activeSide === 'B' && (
                        <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">LIVE</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Sel
                        value={cfg.adaptiveContracts?.contractB?.type || 'DIGITOVER'}
                        onChange={v => patchContracts({ contractB: { ...cfg.adaptiveContracts?.contractB, type: v } })}
                        options={CONTRACT_OPTIONS}
                      />
                      {NEEDS_PREDICTION(cfg.adaptiveContracts?.contractB?.type || '') ? (
                        <Sel
                          value={String(cfg.adaptiveContracts?.contractB?.prediction ?? 5)}
                          onChange={v => patchContracts({ contractB: { ...cfg.adaptiveContracts?.contractB, prediction: parseInt(v) } })}
                          options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
                        />
                      ) : (
                        <div className="bg-black/20 border border-white/5 rounded px-2 py-1 text-[9px] text-gray-600 text-center">N/A</div>
                      )}
                    </div>
                  </div>

                  {/* Start side */}
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-500 uppercase font-bold">Start With</span>
                    <div className="flex gap-1">
                      {(['A','B'] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => patchContracts({ startSide: s, activeSide: s })}
                          className={`px-2.5 py-1 text-[9px] rounded font-bold transition-all ${cfg.adaptiveContracts?.startSide === s ? 'bg-indigo-500 text-white' : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                        >
                          Contract {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* CUSTOM PATTERN mode */}
              {cfg.mode === 'custom_pattern' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-500 uppercase font-black tracking-widest">Sequence Steps</span>
                    <div className="flex gap-1">
                      <button
                        onClick={removeStep}
                        className="px-2 py-0.5 bg-white/5 hover:bg-rose-500/20 text-[9px] font-black text-gray-400 hover:text-rose-400 rounded transition-all"
                      >
                        - Remove
                      </button>
                      <button
                        onClick={addStep}
                        className="px-2 py-0.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-[9px] font-black text-indigo-400 rounded transition-all"
                      >
                        + Add Step
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto auto-panel-scroll pr-1">
                    {(cfg.customPattern?.steps || []).map((step: any, idx: number) => {
                      const isLive = cfg.customPattern?.currentStepIndex === idx;
                      return (
                        <div key={idx} className={`p-2 rounded-lg border transition-all ${isLive ? 'border-indigo-500/60 bg-indigo-500/8' : 'border-white/8 bg-white/3'}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[8px] font-black text-gray-500 uppercase">Step {idx + 1}</span>
                            {isLive && (
                              <span className="text-[8px] font-black text-indigo-400 animate-pulse">
                                LIVE (Trade {(cfg.customPattern?.currentRepeatCount || 0) + 1}/{step.repeats || 1})
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            <Sel
                              value={step.type}
                              onChange={v => patchStep(idx, { type: v })}
                              options={CONTRACT_OPTIONS}
                            />
                            {NEEDS_PREDICTION(step.type) ? (
                              <Sel
                                value={String(step.prediction ?? 0)}
                                onChange={v => patchStep(idx, { prediction: parseInt(v) })}
                                options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
                              />
                            ) : (
                              <div className="bg-black/20 border border-white/5 rounded text-[9px] text-gray-600 text-center flex items-center justify-center">N/A</div>
                            )}
                            <div className="flex items-center bg-black/40 border border-white/10 rounded overflow-hidden">
                              <span className="text-[7px] text-gray-500 font-bold uppercase px-1">Reps</span>
                              <input
                                type="number" min="1"
                                value={step.repeats || 1}
                                onChange={e => patchStep(idx, { repeats: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="w-full bg-transparent text-[10px] font-bold text-white outline-none text-center"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live status + manual toggle */}
          <div className="pt-1 border-t border-white/5 flex items-center justify-between gap-2">
            {cfg.advancedEnabled ? (
              <>
                <div>
                  <span className="text-[8px] text-gray-500 uppercase font-bold mr-1">Live:</span>
                  <span className="text-[9px] font-black text-indigo-400">{getLiveLabel()}</span>
                </div>
                <button
                  onClick={toggleAdaptiveSide}
                  className="p-1.5 hover:bg-white/8 rounded text-gray-500 hover:text-amber-400 transition-colors"
                  title="Manual Toggle/Advance"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-gray-500 uppercase font-bold">Start:</span>
                  <div className="flex gap-1">
                    {sides.map(s => (
                      <button
                        key={s.v}
                        onClick={() => patch({ initialSide: s.v as any, currentSide: s.v as any })}
                        className={`px-2 py-0.5 text-[9px] rounded font-bold transition-all ${cfg.initialSide === s.v ? `${s.color} text-white` : 'bg-white/5 text-gray-500'}`}
                      >
                        {s.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-gray-500 uppercase font-bold">Live:</span>
                  <div className="flex gap-1">
                    {sides.map(s => (
                      <button
                        key={s.v}
                        onClick={() => patch({ currentSide: s.v as any })}
                        className={`px-2 py-0.5 text-[9px] rounded font-bold transition-all ${cfg.currentSide === s.v ? `${s.color} text-white` : 'bg-white/5 text-gray-400 opacity-50'}`}
                      >
                        {s.l}
                      </button>
                    ))}
                  </div>
                  <button onClick={toggleAdaptiveSide} className="p-1 text-gray-600 hover:text-amber-400 transition-colors">
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Entry Digit Detection ────────────────────────────────────────────────────

function EntryDigitSection() {
  const { triggers, setTrigger } = useDerivStore();
  const cfg = triggers.entryDigit;
  const upd = (f: any) => setTrigger('entryDigit', f);

  return (
    <Section
      title="Entry Digit"
      icon={<FileDigit className="w-3.5 h-3.5" />}
      defaultOpen
      badge={cfg.enabled && <span className="text-[8px] font-black text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full ml-1">ON</span>}
    >
      <Row label="Entry Digit Detection"><Tog enabled={cfg.enabled} onChange={v => upd({ enabled: v })} /></Row>

      {cfg.enabled && (
        <div className="mt-2 space-y-2">
          <Row label="Multi-Digit (ANY)"><Tog enabled={!!cfg.useMulti} onChange={v => upd({ useMulti: v })} /></Row>

          {cfg.useMulti ? (
            <div className="grid grid-cols-4 gap-1">
              {[0,1,2,3].map(idx => (
                <select
                  key={idx}
                  value={cfg.multiDigits?.[idx] !== undefined ? cfg.multiDigits[idx].toString() : ''}
                  onChange={e => {
                    const d = [...(cfg.multiDigits || [])];
                    if (e.target.value === '') { d.splice(idx, 1); }
                    else { d[idx] = parseInt(e.target.value); }
                    upd({ multiDigits: d.filter((x: any) => x !== undefined) });
                  }}
                  className="bg-black/40 border border-white/10 rounded text-center text-[10px] font-bold text-teal-400 py-1 outline-none focus:border-teal-500/40"
                >
                  <option value="">-</option>
                  {[0,1,2,3,4,5,6,7,8,9].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ))}
            </div>
          ) : (
            <Row label="Entry Digit">
              <Sel
                value={cfg.entryDigit.toString()}
                onChange={v => upd({ entryDigit: parseInt(v) })}
                options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
              />
            </Row>
          )}

          <div className="p-2 bg-white/3 rounded border border-white/5">
            <Row label="Instant Trigger"><Tog enabled={cfg.triggerOnEntry} onChange={v => upd({ triggerOnEntry: v })} /></Row>
            {!cfg.triggerOnEntry && (
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {[
                  { label: 'Monitor Ticks', key: 'monitorTicks', opts: [1,2,3,4,5,8,10,15,20] },
                  { label: 'Consecutive',   key: 'consecutive',  opts: [1,2,3,4,5]            },
                ].map(({ label, key, opts }) => (
                  <div key={key}>
                    <div className="text-[8px] text-gray-600 uppercase tracking-wider mb-1">{label}</div>
                    <select
                      value={(cfg as any)[key].toString()}
                      onChange={e => upd({ [key]: parseInt(e.target.value) })}
                      className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-white outline-none"
                    >
                      {opts.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <div className="text-[8px] text-gray-600 uppercase tracking-wider mb-1">Type</div>
                  <select
                    value={cfg.type}
                    onChange={e => upd({ type: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-white outline-none"
                  >
                    {['Over','Under','Even','Odd','Match','Diff'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[8px] text-gray-600 uppercase tracking-wider mb-1">Digit</div>
                  <select
                    value={cfg.targetValue.toString()}
                    onChange={e => upd({ targetValue: parseInt(e.target.value) })}
                    className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-white outline-none"
                  >
                    {[0,1,2,3,4,5,6,7,8,9].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Digit Pattern (with Multi-Entry Sequence) ────────────────────────────────

function DigitPatternSection() {
  const { triggers, setTrigger } = useDerivStore();
  const cfg = triggers.digitPattern;
  const multi = cfg.multiEntry || {
    enabled: false, showSettings: false, useCustomContracts: false,
    patterns: ['','','',''], contracts: ['','','',''],
    predictions: ['0','0','0','0'], currentIndex: 0,
  };

  const upd   = (f: any) => setTrigger('digitPattern', f);
  const updM  = (f: any) => upd({ multiEntry: { ...multi, ...f } });

  const cycle = (idx: number) => {
    const p = [...cfg.pattern];
    p[idx] = PATTERN_TYPES_LIST[(PATTERN_TYPES_LIST.indexOf(p[idx]) + 1) % PATTERN_TYPES_LIST.length] as any;
    upd({ pattern: p });
  };

  const updateBox = (boxIdx: number, newSteps: string[]) => {
    const np = [...(multi.patterns || ['','','',''])];
    np[boxIdx] = newSteps.join('-');
    updM({ patterns: np });
  };

  return (
    <Section
      title="Digit Pattern"
      icon={<Activity className="w-3.5 h-3.5" />}
      defaultOpen={cfg.enabled}
      badge={cfg.enabled && <span className="text-[8px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full ml-1">ON</span>}
    >
      {/* Enable row + settings icon */}
      <div className="flex items-center justify-between py-1">
        <span className="text-[10px] text-gray-500">👁 Digit Pattern Sniff</span>
        <div className="flex items-center gap-1.5">
          {cfg.enabled && (
            <button
              onClick={() => updM({ showSettings: !multi.showSettings })}
              className={`p-1 rounded transition-all ${multi.showSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-600 hover:text-gray-300'}`}
            >
              <Settings className="w-3 h-3" />
            </button>
          )}
          <Tog enabled={cfg.enabled} onChange={v => upd({ enabled: v })} />
        </div>
      </div>

      {/* Multi-Entry Sequence panel */}
      {cfg.enabled && multi.showSettings && (
        <div className="p-2 bg-black/30 rounded-lg border border-indigo-500/20 space-y-2 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Multi-Entry Sequence</span>
            <Tog enabled={multi.enabled} onChange={v => updM({ enabled: v })} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[0,1,2,3].map(boxIdx => {
              const patternStr = multi.patterns?.[boxIdx] || '';
              const steps = patternStr.split('-').filter((s: string) => s.length > 0);
              const isActive = multi.currentIndex === boxIdx && multi.enabled;

              return (
                <div key={boxIdx} className={`p-2 rounded-lg border-2 transition-all ${isActive ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/8 bg-white/3'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase">Box {boxIdx + 1}</span>
                    {isActive && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />}
                  </div>

                  {/* Pattern chips */}
                  <div className="flex flex-wrap gap-0.5 min-h-[24px] items-center mb-1">
                    {steps.map((step: string, si: number) => {
                      const type = step.charAt(0) === 'S' ? step.substring(0, 2) : step.charAt(0);
                      const digit = step.substring(type.length);
                      const isNoDigit = ['E','O','R','F'].includes(type);
                      const STEP_TYPES = ['U','V','M','D','E','O','R','F'];

                      return (
                        <div key={si} className="flex items-center rounded overflow-hidden border border-white/10">
                          <button
                            onClick={() => {
                              const ci = STEP_TYPES.indexOf(type);
                              const nt = STEP_TYPES[(ci + 1) % STEP_TYPES.length];
                              const ns = [...steps]; ns[si] = nt + (['E','O','R','F'].includes(nt) ? '' : (digit || '0'));
                              updateBox(boxIdx, ns);
                            }}
                            className={`px-1 py-0.5 text-[9px] font-black text-white ${PATTERN_COLORS[type] || 'bg-gray-600'}`}
                          >
                            {type}
                          </button>
                          {!isNoDigit && (
                            <button
                              onClick={() => {
                                const ns = [...steps]; ns[si] = type + ((parseInt(digit || '0') + 1) % 10);
                                updateBox(boxIdx, ns);
                              }}
                              className="px-0.5 py-0.5 text-[9px] font-bold bg-black/40 text-gray-300 border-l border-white/5 min-w-[14px] text-center"
                            >
                              {digit}
                            </button>
                          )}
                          <button
                            onClick={() => updateBox(boxIdx, steps.filter((_: string, i: number) => i !== si))}
                            className="px-0.5 py-0.5 bg-black/20 hover:bg-rose-500/40 text-white/40 hover:text-white transition-colors"
                          >
                            <X className="w-2 h-2" />
                          </button>
                        </div>
                      );
                    })}
                    {steps.length < 8 && (
                      <button
                        onClick={() => updateBox(boxIdx, [...steps, 'U0'])}
                        className="w-5 h-5 rounded border border-dashed border-gray-700 flex items-center justify-center text-gray-600 hover:text-gray-400 hover:border-gray-500 transition-all"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>

                  {/* Custom contracts per box */}
                  {multi.useCustomContracts && (
                    <div className="flex gap-1 mt-1">
                      <select
                        value={multi.contracts?.[boxIdx] || ''}
                        onChange={e => {
                          const nc = [...(multi.contracts || ['','','',''])]; nc[boxIdx] = e.target.value;
                          updM({ contracts: nc });
                        }}
                        className="flex-1 bg-black/40 border border-white/10 rounded text-[8px] py-0.5 px-1 text-gray-400 outline-none"
                      >
                        <option value="">Global</option>
                        <option value="DIGITOVER">Over</option>
                        <option value="DIGITUNDER">Under</option>
                        <option value="DIGITEVEN">Even</option>
                        <option value="DIGITODD">Odd</option>
                        <option value="DIGITMATCH">Match</option>
                        <option value="DIGITDIFF">Diff</option>
                      </select>
                      {!['DIGITEVEN','DIGITODD'].includes(multi.contracts?.[boxIdx] || '') && (
                        <select
                          value={multi.predictions?.[boxIdx] || '0'}
                          onChange={e => {
                            const np = [...(multi.predictions || ['0','0','0','0'])]; np[boxIdx] = e.target.value;
                            updM({ predictions: np });
                          }}
                          className="w-8 bg-black/40 border border-white/10 rounded text-[8px] py-0.5 text-center text-teal-400 outline-none"
                        >
                          {[0,1,2,3,4,5,6,7,8,9].map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Row label="Use Custom Contracts"><Tog enabled={!!multi.useCustomContracts} onChange={v => updM({ useCustomContracts: v })} /></Row>
        </div>
      )}

      {/* Standard pattern (when multi not active) */}
      {cfg.enabled && !multi.enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 mb-1">
            <button onClick={() => cfg.pattern.length < 8 && upd({ pattern: [...cfg.pattern, 'D'] })} className="p-0.5 text-gray-500 hover:text-white"><Plus className="w-3 h-3" /></button>
            <button onClick={() => cfg.pattern.length > 1 && upd({ pattern: cfg.pattern.slice(0,-1) })} className="p-0.5 text-gray-500 hover:text-white"><Minus className="w-3 h-3" /></button>
            <button onClick={() => upd({ pattern: ['D','D','M','D','D'] })} className="p-0.5 text-gray-500 hover:text-white ml-auto"><RotateCcw className="w-3 h-3" /></button>
          </div>
          <div className="flex flex-wrap gap-1">
            {cfg.pattern.map((p: string, i: number) => (
              <button
                key={i}
                onClick={() => cycle(i)}
                className={`w-8 h-8 rounded flex items-center justify-center text-[8px] font-black text-white ${PATTERN_COLORS[p] || 'bg-gray-700'}`}
              >
                {p}
              </button>
            ))}
          </div>
          {cfg.pattern.some((s: string) => ['D','M','V','U'].includes(s)) && (
            <Row label="Compare Digit">
              <Sel
                value={cfg.compareDigit.toString()}
                onChange={v => upd({ compareDigit: parseInt(v) })}
                options={[0,1,2,3,4,5,6,7,8,9].map(d => ({ value: String(d), label: String(d) }))}
              />
            </Row>
          )}
          <Row label="Wait for Opposite"><Tog enabled={cfg.waitForOpposite} onChange={v => upd({ waitForOpposite: v })} /></Row>
          <div className="text-[8px] text-gray-600">E=Even O=Odd D=Differs M=Matches V=Over U=Under</div>
        </div>
      )}
    </Section>
  );
}

// ─── Trade Pattern ────────────────────────────────────────────────────────────

function TradePatternSection() {
  const { tradePattern, setTradePattern, currentStep } = useDerivStore();
  const toggle = (i: number) => { const p = [...tradePattern]; p[i] = p[i] === 'trade' ? 'skip' : 'trade'; setTradePattern(p); };

  return (
    <Section title="Trade Pattern" icon={<RotateCcw className="w-3.5 h-3.5" />} defaultOpen>
      <div className="flex items-center gap-1 mb-2">
        <button onClick={() => tradePattern.length < 12 && setTradePattern([...tradePattern,'skip'])} className="p-0.5 text-gray-500 hover:text-white"><Plus className="w-3 h-3" /></button>
        <button onClick={() => tradePattern.length > 1 && setTradePattern(tradePattern.slice(0,-1))} className="p-0.5 text-gray-500 hover:text-white"><Minus className="w-3 h-3" /></button>
        <button onClick={() => setTradePattern(['trade','skip','skip','skip','trade','skip','skip','skip'])} className="p-0.5 text-gray-500 hover:text-white ml-auto"><RotateCcw className="w-3 h-3" /></button>
      </div>
      <div className="flex flex-wrap gap-1">
        {tradePattern.map((type: string, idx: number) => {
          const isActive = idx + 1 === currentStep;
          return (
            <button
              key={idx}
              onClick={() => toggle(idx)}
              className={`w-7 h-7 rounded flex items-center justify-center text-[9px] font-black transition-all active:scale-90 ${type === 'trade' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-500 border border-white/8'} ${isActive ? 'ring-1 ring-teal-400 ring-offset-1 ring-offset-black' : ''}`}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 mt-2 text-[8px] text-gray-600">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Trade</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/10 inline-block" />Skip</span>
        <span className="ml-auto font-mono text-gray-500">Step {currentStep}</span>
      </div>
    </Section>
  );
}

// ─── Money & Risk ─────────────────────────────────────────────────────────────

function MoneySection() {
  const {
    initialStake, martingaleMultiplier, maxMartingaleSteps, stopOnMaxSteps,
    takeProfit, stopLoss, stopAfterTotalWins, stopAfterTotalLosses,
    compoundProfits, setRiskSettings,
  } = useDerivStore();

  return (
    <Section title="Money & Risk" icon={<DollarSign className="w-3.5 h-3.5" />} defaultOpen>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-white/3 border border-white/8 rounded-lg p-2">
          <div className="text-[8px] text-gray-500 uppercase font-bold mb-1">Stake</div>
          <input type="number" step="0.01" min="0.35" value={initialStake}
            onChange={e => setRiskSettings({ initialStake: parseFloat(e.target.value) || 0.35 })}
            className="w-full bg-transparent text-base font-black text-teal-400 outline-none" />
        </div>
        <div className="bg-white/3 border border-white/8 rounded-lg p-2">
          <div className="text-[8px] text-gray-500 uppercase font-bold mb-1">M-Gale ×</div>
          <input type="number" step="0.1" min="1" value={martingaleMultiplier}
            onChange={e => setRiskSettings({ martingaleMultiplier: parseFloat(e.target.value) || 1 })}
            className="w-full bg-transparent text-base font-black text-indigo-400 outline-none" />
        </div>
        <div className="bg-white/3 border border-teal-500/15 rounded-lg p-2">
          <div className="text-[8px] text-teal-500 uppercase font-bold mb-1 flex items-center gap-1"><Target className="w-2.5 h-2.5" />TP ($)</div>
          <input type="number" step="1" min="0" value={takeProfit}
            onChange={e => setRiskSettings({ takeProfit: parseFloat(e.target.value) || 0 })}
            className="w-full bg-transparent text-base font-black text-white outline-none" />
        </div>
        <div className="bg-white/3 border border-rose-500/15 rounded-lg p-2">
          <div className="text-[8px] text-rose-500 uppercase font-bold mb-1 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" />SL ($)</div>
          <input type="number" step="1" min="0" value={stopLoss}
            onChange={e => setRiskSettings({ stopLoss: parseFloat(e.target.value) || 0 })}
            className="w-full bg-transparent text-base font-black text-white outline-none" />
        </div>
      </div>
      <Row label="Max M-Gale Steps">
        <div className="flex items-center gap-1">
          <input type="number" step="1" min="1" value={maxMartingaleSteps}
            onChange={e => setRiskSettings({ maxMartingaleSteps: Math.round(parseFloat(e.target.value)) || 1 })}
            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono text-white text-center outline-none" />
          <Tog enabled={stopOnMaxSteps} onChange={v => setRiskSettings({ stopOnMaxSteps: v })} />
        </div>
      </Row>
      <div className="my-1.5 border-t border-white/5" />
      <Row label="Max Wins">
        <div className="flex items-center gap-1">
          <input type="number" step="1" min="1" value={stopAfterTotalWins.value}
            onChange={e => setRiskSettings({ stopAfterTotalWins: { ...stopAfterTotalWins, value: Math.round(parseFloat(e.target.value)) || 1 } })}
            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono text-white text-center outline-none" />
          <Tog enabled={stopAfterTotalWins.enabled} onChange={v => setRiskSettings({ stopAfterTotalWins: { ...stopAfterTotalWins, enabled: v } })} />
        </div>
      </Row>
      <Row label="Max Losses">
        <div className="flex items-center gap-1">
          <input type="number" step="1" min="1" value={stopAfterTotalLosses?.value ?? 50}
            onChange={e => setRiskSettings({ stopAfterTotalLosses: { ...(stopAfterTotalLosses || { value: 50 }), value: Math.round(parseFloat(e.target.value)) || 1 } })}
            className="w-12 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono text-white text-center outline-none" />
          <Tog enabled={stopAfterTotalLosses?.enabled ?? false} onChange={v => setRiskSettings({ stopAfterTotalLosses: { ...(stopAfterTotalLosses || { value: 50 }), enabled: v } })} />
        </div>
      </Row>
      <Row label="Compound Wins"><Tog enabled={compoundProfits} onChange={v => setRiskSettings({ compoundProfits: v })} /></Row>
    </Section>
  );
}

// ─── Virtual Mode ─────────────────────────────────────────────────────────────

function VirtualSection() {
  const { virtualSettings, setVirtualSettings } = useDerivStore();
  const v = virtualSettings;
  const sm = v.smartSettings;
  const defaultSm = { enabled: false, type: 'sequence' as const, sequence: { step1Type: 'Wins', step1Qty: 2, step2Type: 'Losses', step2Qty: 2 }, alternating: { count: 2 } };

  return (
    <Section title="Virtual Mode" icon={<Sparkles className="w-3.5 h-3.5" />} defaultOpen={false}>
      <Row label="Virtual → Real">
        <Tog enabled={v.startVirtualToReal} onChange={val => setVirtualSettings({ startVirtualToReal: val })} />
      </Row>
      {v.startVirtualToReal && (
        <div className="bg-white/3 border border-white/8 rounded-lg p-2 mb-2">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <div className="text-[8px] text-gray-500 uppercase mb-1">Threshold</div>
              <input type="number" value={v.vThreshold} onChange={e => setVirtualSettings({ vThreshold: parseInt(e.target.value) || 0 })}
                className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-indigo-400 outline-none text-center" />
            </div>
            <div>
              <div className="text-[8px] text-gray-500 uppercase mb-1">Mode</div>
              <select value={v.vTriggerMode} onChange={e => setVirtualSettings({ vTriggerMode: e.target.value as any })}
                className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-indigo-400 outline-none">
                <option value="consec">Consec</option>
                <option value="total">Total</option>
              </select>
            </div>
          </div>
          <div className="flex gap-1">
            {(['wins','losses'] as const).map(t => (
              <button key={t} onClick={() => setVirtualSettings({ vTriggerType: t })}
                className={`flex-1 py-1 text-[9px] font-black capitalize rounded border-2 transition-all ${v.vTriggerType === t ? (t === 'wins' ? 'bg-teal-500/15 border-teal-500/40 text-teal-400' : 'bg-rose-500/15 border-rose-500/40 text-rose-400') : 'border-white/10 text-gray-500'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <Row label="Real → Virtual">
        <Tog enabled={v.startRealToVirtual} onChange={val => setVirtualSettings({ startRealToVirtual: val })} />
      </Row>
      {v.startRealToVirtual && (
        <div className="bg-white/3 border border-white/8 rounded-lg p-2 mb-2">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <div className="text-[8px] text-gray-500 uppercase mb-1">Threshold</div>
              <input type="number" value={v.rThreshold} onChange={e => setVirtualSettings({ rThreshold: parseInt(e.target.value) || 0 })}
                className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-teal-400 outline-none text-center" />
            </div>
            <div>
              <div className="text-[8px] text-gray-500 uppercase mb-1">Mode</div>
              <select value={v.rTriggerMode} onChange={e => setVirtualSettings({ rTriggerMode: e.target.value as any })}
                className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-bold text-teal-400 outline-none">
                <option value="consec">Consec</option>
                <option value="total">Total</option>
              </select>
            </div>
          </div>
          <div className="flex gap-1">
            {(['wins','losses'] as const).map(t => (
              <button key={t} onClick={() => setVirtualSettings({ rTriggerType: t })}
                className={`flex-1 py-1 text-[9px] font-black capitalize rounded border-2 transition-all ${v.rTriggerType === t ? (t === 'wins' ? 'bg-teal-500/15 border-teal-500/40 text-teal-400' : 'bg-rose-500/15 border-rose-500/40 text-rose-400') : 'border-white/10 text-gray-500'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <Row label="Smart Analysis">
        <Tog enabled={sm?.enabled || false} onChange={val => setVirtualSettings({ smartSettings: { ...(sm || defaultSm), enabled: val } })} />
      </Row>
      {sm?.enabled && (
        <div className="bg-white/3 border border-white/8 rounded-lg p-2">
          <div className="flex gap-1 mb-2">
            {(['sequence','alternating'] as const).map(t => (
              <button key={t} onClick={() => setVirtualSettings({ smartSettings: { ...sm, type: t } })}
                className={`flex-1 py-1 text-[8px] font-black uppercase rounded transition-all ${sm.type === t ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-600 hover:text-gray-400'}`}>
                {t === 'sequence' ? 'Sequence' : 'Alternating'}
              </button>
            ))}
          </div>
          {sm.type === 'alternating' ? (
            <div>
              <div className="text-[8px] text-gray-500 uppercase mb-1">Cycles: {sm.alternating?.count || 2}</div>
              <input type="range" min="1" max="5" value={sm.alternating?.count || 2}
                onChange={e => setVirtualSettings({ smartSettings: { ...sm, alternating: { count: parseInt(e.target.value) } } })}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-[8px] text-gray-500 mb-0.5">Stage 1</div>
                <div className="flex gap-1">
                  <select value={sm.sequence?.step1Type || 'Wins'} onChange={e => setVirtualSettings({ smartSettings: { ...sm, sequence: { ...sm.sequence, step1Type: e.target.value as any } } })}
                    className="flex-1 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-[9px] text-white outline-none">
                    <option value="Wins">Wins</option><option value="Losses">Losses</option>
                  </select>
                  <input type="number" min="1" value={sm.sequence?.step1Qty || 2}
                    onChange={e => setVirtualSettings({ smartSettings: { ...sm, sequence: { ...sm.sequence, step1Qty: parseInt(e.target.value) || 1 } } })}
                    className="w-10 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-[9px] text-indigo-400 text-center outline-none" />
                </div>
              </div>
              <ArrowRight className="w-3 h-3 text-gray-600 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-[8px] text-gray-500 mb-0.5">Stage 2</div>
                <div className="flex gap-1">
                  <select value={sm.sequence?.step2Type || 'Losses'} onChange={e => setVirtualSettings({ smartSettings: { ...sm, sequence: { ...sm.sequence, step2Type: e.target.value as any } } })}
                    className="flex-1 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-[9px] text-white outline-none">
                    <option value="Wins">Wins</option><option value="Losses">Losses</option>
                  </select>
                  <input type="number" min="1" value={sm.sequence?.step2Qty || 2}
                    onChange={e => setVirtualSettings({ smartSettings: { ...sm, sequence: { ...sm.sequence, step2Qty: parseInt(e.target.value) || 1 } } })}
                    className="w-10 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-[9px] text-indigo-400 text-center outline-none" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <div className={`mt-2 p-2 rounded border flex items-center justify-between ${v.isVirtualMode ? 'bg-indigo-500/8 border-indigo-500/20' : 'bg-teal-500/8 border-teal-500/20'}`}>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full animate-pulse ${v.isVirtualMode ? 'bg-indigo-500' : 'bg-teal-500'}`} />
          <span className={`text-[9px] font-black uppercase ${v.isVirtualMode ? 'text-indigo-400' : 'text-teal-400'}`}>{v.isVirtualMode ? 'Virtual Mode' : 'Real Mode'}</span>
        </div>
        <span className="text-[9px] font-mono text-gray-400">{v.isVirtualMode ? `${v.vConsecWins}W/${v.vConsecLosses}L` : `${v.rConsecWins}W/${v.rConsecLosses}L`}</span>
      </div>
    </Section>
  );
}

// ─── Continuous Trading ───────────────────────────────────────────────────────

function ContinuousTradingSection() {
  const { tradingMode, setTradingMode } = useDerivStore();
  return (
    <Section title="Continuous Trading" icon={<RefreshCw className="w-3.5 h-3.5" />} defaultOpen={false}>
      <Row label="After 1st entry (no re-check)">
        <Tog enabled={tradingMode === 'after_first'} onChange={v => v && setTradingMode('after_first')} />
      </Row>
      <Row label="Continuous + check entry">
        <Tog enabled={tradingMode === 'continuous_check'} onChange={v => v && setTradingMode('continuous_check')} />
      </Row>
    </Section>
  );
}

// ─── Bot Trade Log ─────────────────────────────────────────────────────────────

function BotTradeLogSection() {
  const { tradeLogs, clearLogs, stats } = useDerivStore();

  const exportCSV = () => {
    if (!tradeLogs.length) return;
    const rows = tradeLogs.map((l: any) =>
      [new Date(l.time).toISOString(), l.contract, l.stake, l.profit, l.result, l.isVirtual ? 'VIRTUAL' : 'REAL'].join(',')
    );
    const csv = ['Time,Contract,Stake,P/L,Result,Mode', ...rows].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `botlog_${Date.now()}.csv`;
    a.click();
  };

  return (
    <Section
      title="Bot Trade Log"
      icon={<ClipboardList className="w-3.5 h-3.5" />}
      defaultOpen={false}
      badge={tradeLogs.length > 0 && (
        <span className="text-[8px] font-black text-gray-400 bg-white/5 px-1.5 py-0.5 rounded-full ml-1">{tradeLogs.length}</span>
      )}
    >
      {/* Stats bar */}
      {tradeLogs.length > 0 && (
        <div className="flex items-center justify-between mb-2 text-[9px] font-mono">
          <span className="text-emerald-400 font-bold">{stats.won}W</span>
          <span className="text-rose-400 font-bold">{stats.lost}L</span>
          <span className={`font-bold ${stats.totalProfit >= 0 ? 'text-teal-400' : 'text-rose-400'}`}>
            {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(2)}
          </span>
          <div className="flex gap-1">
            <button onClick={exportCSV} className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors" title="Export CSV">
              <Download className="w-3 h-3" />
            </button>
            <button onClick={clearLogs} className="p-0.5 text-gray-500 hover:text-rose-400 transition-colors" title="Clear">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1 max-h-[200px] overflow-y-auto auto-panel-scroll">
        {tradeLogs.length === 0 ? (
          <div className="text-center py-4 text-gray-600 text-[10px]">No bot trades yet</div>
        ) : (
          tradeLogs.map((log: any, i: number) => (
            <div key={i} className={`flex items-center justify-between p-1.5 rounded border text-[9px] ${log.isVirtual ? 'border-indigo-500/20 bg-indigo-500/5' : 'border-white/5 bg-white/2'}`}>
              <div className="flex items-center gap-1.5">
                {log.isVirtual && <span className="text-[7px] font-black text-indigo-400 bg-indigo-500/15 border border-indigo-500/20 px-1 py-0.5 rounded">V</span>}
                <span className="font-bold text-gray-300">{log.contract}</span>
                <span className="text-gray-600 font-mono">{log.stake}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {log.profit != null && (
                  <span className={`font-mono font-bold ${Number(log.profit) >= 0 ? 'text-teal-400' : 'text-rose-400'}`}>
                    {Number(log.profit) >= 0 ? '+' : ''}{Number(log.profit).toFixed(2)}
                  </span>
                )}
                {log.result && log.result !== 'BUYING...' && (
                  <span className={`text-[8px] font-black px-1 py-0.5 rounded ${log.result === 'WON' ? 'text-emerald-400 bg-emerald-500/15' : log.result === 'LOST' ? 'text-rose-400 bg-rose-500/15' : 'text-gray-400'}`}>
                    {log.result}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}

// ─── Main AUTO Panel ──────────────────────────────────────────────────────────

export default function AutoPanel() {
  return (
    <div className="flex flex-col h-full bg-[#080c12] text-white overflow-hidden">
      <BotControlBar />
      <div className="flex-1 overflow-y-auto auto-panel-scroll">
        <PipelineSection />
        <AdaptiveSection />
        <EntryDigitSection />
        <DigitPatternSection />
        <TradePatternSection />
        <MoneySection />
        <VirtualSection />
        <ContinuousTradingSection />
        <BotTradeLogSection />
      </div>
    </div>
  );
}
