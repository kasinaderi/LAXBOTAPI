'use client';

import './scanner.css';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import { usePageSettings } from '@/store/usePageSettings';
import { useScannerStore } from '@/store/useScannerStore';
import { derivWS } from '@/lib/deriv/websocket';
import { Play, Square, ChevronDown, AlertTriangle, Loader2, Layers, ShieldAlert } from 'lucide-react';
import {
  useBotStore,
  Strategy, Condition, TradeLog, JournalLog, PatternTrigger, PatternBox,
  AdaptiveSwitch, AdaptiveSwitchStep,
  ALL_MARKETS as BOT_ALL_MARKETS,
  TRADE_OPTIONS as BOT_TRADE_OPTIONS,
  createCondition, createStrategy, needsBarrier,
  botTradeIds,
  normalizeContractType,
  ContinuousLockConfig,
  getManualContractList,
  ManualContractsConfig,
  ManualContractItem,
} from '@/store/useBotStore';


// ───────────────────────────────────────────────────────────────────────────
// CONSTANTS & TYPES
// ───────────────────────────────────────────────────────────────────────────

// Re-export from store for local use
const ALL_MARKETS  = BOT_ALL_MARKETS;
const TRADE_OPTIONS = BOT_TRADE_OPTIONS;

/** Map contract type string → Deriv API contract_type */
function toDerivContract(tradeType: string): string {
  return tradeType;
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

// Pattern alphabet tokens (LaxSniper XV)
const PATTERN_TOKENS = [
  { value: 'E',  label: 'E',  title: 'Even' },
  { value: 'O',  label: 'O',  title: 'Odd' },
  { value: 'D',  label: 'D',  title: 'Differs (digit ≠ prev digit)' },
  { value: 'M',  label: 'M',  title: 'Matches (digit = prev digit)' },
  { value: 'V',  label: 'V',  title: 'Over 4' },
  { value: 'U',  label: 'U',  title: 'Under 5' },
  { value: 'SE', label: 'SE', title: 'Same Even (even AND = prev digit)' },
  { value: 'SO', label: 'SO', title: 'Same Odd (odd AND = prev digit)' },
  { value: 'R',  label: 'R',  title: 'Rise (quote > prev quote)' },
  { value: 'F',  label: 'F',  title: 'Fall (quote < prev quote)' },
  { value: 'HE', label: 'HE', title: 'Highest Even (1000t most frequent even)' },
  { value: 'LE', label: 'LE', title: 'Least Even (1000t least frequent even)' },
  { value: 'HO', label: 'HO', title: 'Highest Odd (1000t most frequent odd)' },
  { value: 'LO', label: 'LO', title: 'Least Odd (1000t least frequent odd)' },
];

const PATTERN_RETRIGGER = [
  { value: 'any',      label: 'Trigger anytime' },
  { value: 'no_contra', label: 'No Contradiction' },
  { value: 'wait_opp', label: 'Wait for opposite before re-trigger' },
];

const COMPARATORS = ['>', '<', '=', '>=', '<='];

const DIGIT_OPTIONS = [
  { value: 'EVEN',      label: 'EVEN' },
  { value: 'ODD',       label: 'ODD' },
  { value: 'OVER',      label: '>(OVER)' },
  { value: 'UNDER',     label: '<(UNDER)' },
  { value: 'EQUAL',     label: '=(EQUAL)' },
  { value: 'RISE',      label: 'RISE' },
  { value: 'FALL',      label: 'FALL' },
  { value: 'ONLY_UPS',  label: 'Only Ups' },
  { value: 'ONLY_DOWNS',label: 'Only Downs' },
];

const TRADING_MODES = [
  { value: 'continuous', label: 'Trade continuously when there is a loss' },
  { value: 'once',       label: 'Trade once per signal' },
  { value: 'target',     label: 'Trade until target profit' },
];



// Types imported from @/store/useBotStore: Condition, Strategy, TradeLog





/** Human-readable summary of a condition */
function conditionText(c: Condition): string {
  const winSuffix = c.eligibleWindow?.enabled ? ` [⏱ ${c.eligibleWindow.seconds ?? 90}s]` : '';
  switch (c.type) {
    case 'EVEN_PCT':      return `EVEN % ${c.comparator} ${c.value}% in last ${c.period} ticks${winSuffix}`;
    case 'ODD_PCT':       return `ODD % ${c.comparator} ${c.value}% in last ${c.period} ticks${winSuffix}`;
    case 'FALL_PCT':      return `FALL % ${c.comparator} ${c.value}% in last ${c.period} ticks${winSuffix}`;
    case 'RISE_PCT':      return `RISE % ${c.comparator} ${c.value}% in last ${c.period} ticks${winSuffix}`;
    case 'OVER_PCT':      return `OVER(${c.digitBarrier ?? 4}) % ${c.comparator} ${c.value}% in last ${c.period} ticks${winSuffix}`;
    case 'UNDER_PCT':     return `UNDER(${c.digitBarrier ?? 4}) % ${c.comparator} ${c.value}% in last ${c.period} ticks${winSuffix}`;
    case 'LAST_DIGITS': {
      const showB = c.digitValue === 'OVER' || c.digitValue === 'UNDER' || c.digitValue === 'EQUAL';
      return `last ${c.lastN} digits are ${c.digitValue}${showB ? ' ' + (c.digitBarrier ?? 4) : ''}`;
    }
    case 'GREEN_BAR': {
      const rank = c.rankType === 'LOWEST' ? 'LOWEST' : 'TOP';
      const topN = c.topCount ?? 3;
      const cat = c.digitValue || 'EVEN';
      const barrierStr = (cat === 'OVER' || cat === 'UNDER') ? ` ${c.digitBarrier ?? 4}` : '';
      const compSym = (c.pctCompare || (rank === 'LOWEST' ? 'BELOW' : 'ABOVE')) === 'BELOW' ? '<=' : '>=';
      const minPctStr = (c.allAboveMinPct ?? true) ? ` & each ${compSym} ${c.value}%` : '';
      return `${rank} ${topN} DIGITS ARE ${cat}${barrierStr}${minPctStr} in last ${c.period} ticks`;
    }
    case 'DIGIT_PATTERN': return `PATTERN [${(c.pattern || []).join('→')}]`;
    case 'DIGIT_APPEARS': {
      const targetDigits = c.targetDigits && c.targetDigits.length > 0 ? c.targetDigits : [c.digitBarrier ?? 5];
      return `DIGIT ${targetDigits.join(' AND ')} APPEARS ${c.comparator} ${c.value} times in last ${c.period} ticks`;
    }
    case 'RSI_SIGNAL': {
      const act = c.rsiSignalAction || 'AUTO';
      const parts: string[] = [];
      if (c.rsiMaMode ?? true) parts.push(`MA(${c.rsiMaType || 'SMA'} ${c.rsiMaLength || 14})`);
      if (c.rsiBbMode ?? true) parts.push(`BB(${c.rsiBbType || 'SMA'} ${c.rsiBbLength || 14})`);
      if (c.rsiDivergenceMode ?? true) parts.push('Div');
      return `RSI(${c.rsiLength || 14}) [${act}] · ${parts.join('+')} · ${c.rsiTicksPerCandle || 5}t/bar`;
    }
    default:              return '';
  }
}

function strategySummary(s: Strategy, idx: number): string {
  if (!s.conditions.length) return `Strategy ${idx + 1}: no conditions`;
  const cond = s.conditions.map((c, i) => `${i > 0 ? c.join + ' ' : ''}${conditionText(c)}`).join(' ');
  const label = TRADE_OPTIONS.find(t => t.value === s.tradeType)?.label || s.tradeType;
  const patternSuffix = s.useTradePattern && s.tradePattern && s.tradePattern.length > 0
    ? ` [Pattern: ${s.tradePattern.map(t => t ? 'T' : 'S').join('→')}]`
    : '';
  return `If ${cond}, trade ${label} for ${s.ticks} ticks${patternSuffix}.`;
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────



const STRATEGY_BG = [
  'lp-strat-blue', 'lp-strat-pink', 'lp-strat-purple', 'lp-strat-green', 'lp-strat-orange',
];

// ───────────────────────────────────────────────────────────────────────────
// CONDITION ROW COMPONENT
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// DIGIT PATTERN BUILDER COMPONENT
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// TOKEN needs-barrier helper (for pattern triggers)
// ───────────────────────────────────────────────────────────────────────────

function tokenNeedsBarrier(token: string): boolean {
  return token === 'V' || token === 'U' || token === 'M' || token === 'D';
}

// ───────────────────────────────────────────────────────────────────────────
// ADVANCED PATTERN BUILDER — Multi-Entry Sequence (LaxSniper XV style)
// ───────────────────────────────────────────────────────────────────────────

function getTokenBgColor(token: string): string {
  switch (token) {
    case 'U': return '#2563eb'; // Blue
    case 'V': return '#059669'; // Green
    case 'E': return '#0d9488'; // Teal
    case 'O': return '#ea580c'; // Orange
    case 'D': return '#dc2626'; // Red
    case 'M': return '#7c3aed'; // Purple
    case 'SE': return '#0891b2'; // Cyan
    case 'SO': return '#c026d3'; // Fuchsia
    case 'R': return '#16a34a'; // Green
    case 'F': return '#e11d48'; // Rose
    case 'HE': return '#10b981'; // Emerald (Highest Even)
    case 'LE': return '#0284c7'; // Sky/Cyan (Least Even)
    case 'HO': return '#f59e0b'; // Amber (Highest Odd)
    case 'LO': return '#db2777'; // Pink (Least Odd)
    default: return '#475569';  // Gray
  }
}

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

  // Custom contracts (loss steps)
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
    <div className="lp-apb">
      {/* Header */}
      <div className="lp-apb-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="lp-apb-title">Multi-Entry Sequence</span>
          {/* Simple toggle slider matching the design */}
          <div 
            style={{ width: '30px', height: '16px', background: (cond.patternBoxes && cond.patternBoxes.length > 0) ? '#10b981' : '#334155', borderRadius: '8px', position: 'relative', cursor: 'pointer', transition: 'background-color 0.2s' }}
            onClick={() => {
              // Toggle sequence ON/OFF (just empty boxes to toggle off)
              if (cond.patternBoxes && cond.patternBoxes.length > 0) {
                onChange({ ...cond, patternBoxes: [] });
              } else {
                onChange({ ...cond, patternBoxes: [{ triggers: [{ token: 'E' }] }] });
              }
            }}
          >
            <div style={{
              width: '12px',
              height: '12px',
              background: '#fff',
              borderRadius: '50%',
              position: 'absolute',
              top: '2px',
              right: (cond.patternBoxes && cond.patternBoxes.length > 0) ? '2px' : 'auto',
              left: (cond.patternBoxes && cond.patternBoxes.length > 0) ? 'auto' : '2px',
              transition: 'all 0.2s'
            }}></div>
          </div>
        </div>
        {/* Show +Add Box when < 4 boxes */}
        {(cond.patternBoxMode ?? 'OR') === 'OR' && boxes.length < 4 && (
          <button className="lp-apb-add-btn" onClick={addBox}>+ Add Box</button>
        )}
        {(cond.patternBoxMode === 'THEN' || cond.patternBoxMode === 'THENALL') && boxes.length < 4 && (
          <button className="lp-apb-add-btn" onClick={addBox}>+ Add Box {boxes.length + 1}</button>
        )}
      </div>

      {/* Dynamic orientation hint based on mode */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (() => {
        const mode = cond.patternBoxMode ?? 'OR';
        const numB = boxes.length;
        const hintMap: Record<string, string> = {
          OR:      'Each trigger = 1 tick · Left = oldest, Right = latest · Multiple boxes = OR alternatives',
          THEN:    numB > 2
            ? `Box 1 triggers → locks market → sequential boxes (Box 2 to Box ${numB}) must match within their timeouts`
            : 'Box 1 triggers → locks market → Box 2 must fire within timeout ticks',
          THENALL: numB > 2
            ? `Box 1 triggers → scans markets for sequential boxes (up to Box ${numB}) → fires up to max trades`
            : 'Box 1 triggers → ALL markets scanned for Box 2 → fires up to max trades',
        };
        return (
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 2, paddingLeft: 2 }}>
            {hintMap[mode]}
          </div>
        );
      })()}

      {/* Boxes Grid */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (
        <div className="lp-apb-grid">
          {boxes.map((box, bi) => {
            const mode = cond.patternBoxMode ?? 'OR';
            // In THEN/THENALL mode: allow up to 4 boxes
            if ((mode === 'THEN' || mode === 'THENALL') && bi >= 4) return null;

            return (
              <React.Fragment key={bi}>
                {/* Separator between boxes */}
                {bi > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 4px', gap: '6px' }}>

                    {/* Mode cycle chip — click to cycle OR→THEN→THENALL (shown on first separator) */}
                    {bi === 1 && (() => {
                      const curMode = cond.patternBoxMode ?? 'OR';
                      const nextMode = curMode === 'OR' ? 'THEN' : curMode === 'THEN' ? 'THENALL' : 'OR';
                      const modeStyles: Record<string, { bg: string; color: string; glow: string }> = {
                        OR:      { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', glow: '0 0 6px rgba(245,158,11,0.3)' },
                        THEN:    { bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf', glow: '0 0 6px rgba(20,184,166,0.35)' },
                        THENALL: { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa', glow: '0 0 6px rgba(139,92,246,0.4)' },
                      };
                      const st = modeStyles[curMode];
                      const box2Timeout = cond.thenTimeouts?.[1] ?? cond.thenTimeout ?? 20;

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <button
                            onClick={() => onChange({ ...cond, patternBoxMode: nextMode as 'OR' | 'THEN' | 'THENALL' })}
                            title={`Mode: ${curMode} — click to switch to ${nextMode}`}
                            style={{
                              fontSize: 8, fontWeight: 900, letterSpacing: 1,
                              background: st.bg, color: st.color,
                              border: `1px solid ${st.color}40`,
                              borderRadius: 4, padding: '3px 7px',
                              cursor: 'pointer', boxShadow: st.glow,
                              transition: 'all 0.2s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {curMode} ▾
                          </button>

                          {/* THEN / THENALL config inputs for Box 2 */}
                          {(curMode === 'THEN' || curMode === 'THENALL') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center', minWidth: '72px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>⏱ TIMEOUT</span>
                                <input
                                  type="number" min={1} max={500}
                                  value={box2Timeout}
                                  onChange={e => {
                                    const val = Math.max(1, +e.target.value || 20);
                                    const nextTimeouts = [...(cond.thenTimeouts || [20, val, 20, 20])];
                                    while (nextTimeouts.length <= 1) nextTimeouts.push(20);
                                    nextTimeouts[1] = val;
                                    onChange({ ...cond, thenTimeout: val, thenTimeouts: nextTimeouts });
                                  }}
                                  style={{
                                    width: '34px', textAlign: 'center', fontSize: 9,
                                    background: 'rgba(0,0,0,0.4)', color: '#fff',
                                    border: `1px solid ${st.color}40`, borderRadius: 3,
                                    padding: '1px 2px', outline: 'none',
                                    MozAppearance: 'textfield',
                                  } as React.CSSProperties}
                                  title="Max ticks to wait for Box 2 before resetting"
                                />
                                <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>t</span>
                              </div>
                              {curMode === 'THENALL' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>🔢 MAX</span>
                                  <input
                                    type="number" min={1} max={50}
                                    value={cond.thenMaxTrades ?? 3}
                                    onChange={e => onChange({ ...cond, thenMaxTrades: Math.max(1, +e.target.value || 3) })}
                                    style={{
                                      width: '34px', textAlign: 'center', fontSize: 9,
                                      background: 'rgba(0,0,0,0.4)', color: '#fff',
                                      border: `1px solid ${st.color}40`, borderRadius: 3,
                                      padding: '1px 2px', outline: 'none',
                                      MozAppearance: 'textfield',
                                    } as React.CSSProperties}
                                    title="Max trades Box 2 fires per round before resetting to Box 1"
                                  />
                                  <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>×</span>
                                </div>
                              )}
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
                          <span style={{ fontSize: 9, fontWeight: 900, color: '#f59e0b', letterSpacing: 1, background: 'rgba(245,158,11,0.1)', borderRadius: 4, padding: '2px 4px' }}>OR</span>
                        );
                      }
                      const modeStyles: Record<string, { bg: string; color: string; glow: string }> = {
                        THEN:    { bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf', glow: '0 0 6px rgba(20,184,166,0.35)' },
                        THENALL: { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa', glow: '0 0 6px rgba(139,92,246,0.4)' },
                      };
                      const st = modeStyles[curMode] || modeStyles.THEN;
                      const boxTimeout = cond.thenTimeouts?.[bi] ?? cond.thenTimeout ?? 20;

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <span
                            style={{
                              fontSize: 8, fontWeight: 900, letterSpacing: 1,
                              background: st.bg, color: st.color,
                              border: `1px solid ${st.color}40`,
                              borderRadius: 4, padding: '3px 7px',
                              boxShadow: st.glow,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {curMode}
                          </span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>⏱ TIMEOUT</span>
                            <input
                              type="number" min={1} max={500}
                              value={boxTimeout}
                              onChange={e => {
                                const val = Math.max(1, +e.target.value || 20);
                                const nextTimeouts = [...(cond.thenTimeouts || [20, 20, 20, 20])];
                                while (nextTimeouts.length <= bi) nextTimeouts.push(20);
                                nextTimeouts[bi] = val;
                                onChange({ ...cond, thenTimeouts: nextTimeouts });
                              }}
                              style={{
                                width: '34px', textAlign: 'center', fontSize: 9,
                                background: 'rgba(0,0,0,0.4)', color: '#fff',
                                border: `1px solid ${st.color}40`, borderRadius: 3,
                                padding: '1px 2px', outline: 'none',
                                MozAppearance: 'textfield',
                              } as React.CSSProperties}
                              title={`Max ticks to wait for Box ${bi + 1} before resetting`}
                            />
                            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>t</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              <div className={`lp-apb-card ${bi === 0 ? 'active-step' : ''}`}>
                <div className="lp-apb-card-hdr">
                  <span className="lp-apb-card-title">Box {bi + 1}</span>
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>oldest→latest</span>
                  {boxes.length > 1 && (
                    <button className="lp-apb-card-remove" onClick={() => removeBox(bi)}>✕</button>
                  )}
                </div>

              {/* Triggers list */}
              <div className="lp-apb-triggers">
                {box.triggers.map((trig, ti) => {
                  const bNeedsBarrier = tokenNeedsBarrier(trig.token);
                  return (
                    <div key={ti} className="lp-badge-trigger">
                      {/* Token Select badge */}
                      <select
                        value={trig.token}
                        onChange={e => {
                          const token = e.target.value;
                          const barrier = tokenNeedsBarrier(token) ? (trig.barrier ?? 4) : undefined;
                          updateTrigger(bi, ti, { token, barrier });
                        }}
                        style={{
                          background: getTokenBgColor(trig.token),
                          color: '#fff',
                          border: 'none',
                          borderRadius: bNeedsBarrier ? '4px 0 0 4px' : '4px',
                          padding: '0 6px',
                          height: '100%',
                          fontSize: '10px',
                          fontWeight: '900',
                          cursor: 'pointer',
                          outline: 'none',
                          appearance: 'none',
                          textAlign: 'center',
                          minWidth: '22px'
                        }}
                      >
                        <option value="E">E</option>
                        <option value="O">O</option>
                        <option value="U">U</option>
                        <option value="V">V</option>
                        <option value="M">M</option>
                        <option value="D">D</option>
                        <option value="SE">SE</option>
                        <option value="SO">SO</option>
                        <option value="R">R</option>
                        <option value="F">F</option>
                        <option value="HE" title="Highest Even in 1000 ticks">HE</option>
                        <option value="LE" title="Least Even in 1000 ticks">LE</option>
                        <option value="HO" title="Highest Odd in 1000 ticks">HO</option>
                        <option value="LO" title="Least Odd in 1000 ticks">LO</option>
                      </select>

                      {/* Barrier Select (0-9) inside badge */}
                      {bNeedsBarrier && (
                        <select
                          value={trig.barrier ?? 4}
                          onChange={e => updateTrigger(bi, ti, { barrier: +e.target.value })}
                          style={{
                            background: 'rgba(0, 0, 0, 0.45)',
                            color: '#fff',
                            border: 'none',
                            padding: '0 6px',
                            height: '100%',
                            fontSize: '10px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            outline: 'none',
                            appearance: 'none',
                            textAlign: 'center',
                            minWidth: '20px'
                          }}
                        >
                          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      )}

                      {/* Delete Trigger Button */}
                      {box.triggers.length > 1 && (
                        <button
                          onClick={() => removeTrigger(bi, ti)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.4)',
                            padding: '0 6px',
                            fontSize: '9px',
                            cursor: 'pointer',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Dashed plus button to add trigger */}
                <button className="lp-apb-add-trig-dashed" onClick={() => addTrigger(bi)}>+</button>
              </div>
              </div>
              </React.Fragment>
            );
          })}

        </div>
      )}

      {/* Retrigger */}
      <div className="lp-apb-retrig-row">
        <span className="lp-unit" style={{ fontSize: 10 }}>Retrigger:</span>
        <select className="lp-sel" style={{ fontSize: 11 }} value={cond.patternRetrigger || 'any'}
          onChange={e => onChange({ ...cond, patternRetrigger: e.target.value })}>
          {PATTERN_RETRIGGER.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* USE CUSTOM CONTRACTS */}
      <div className="lp-apb-ucc-row">
        <label className="lp-tpb-lbl-check">
          <input type="checkbox" checked={!!cond.useCustomContracts}
            onChange={e => onChange({ ...cond, useCustomContracts: e.target.checked })} />
          <ShieldAlert size={11} style={{ marginLeft: 3, marginRight: 3, color: '#f59e0b' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706' }}>USE CUSTOM CONTRACTS</span>
        </label>
      </div>

      {cond.useCustomContracts && (
        <div className="lp-custom-boxes-grid">
          {contracts.map((box, ci) => {
            const bNeedsBarrier = needsBarrier(box.type);
            return (
              <div key={ci} className="lp-custom-box-card">
                <div className="lp-apb-card-hdr">
                  <span className="lp-custom-box-title">Box {ci + 1}</span>
                  {contracts.length > 1 && (
                    <button className="lp-apb-card-remove" onClick={() => removeContract(ci)}>✕</button>
                  )}
                </div>
                <select className="lp-sel lp-custom-box-sel" value={box.type}
                  onChange={e => updateContractType(ci, e.target.value)}>
                  <option value="DIGITUNDER">U (Under)</option>
                  <option value="DIGITOVER">V (Over)</option>
                  <option value="DIGITMATCH">M (Match)</option>
                  <option value="DIGITDIFF">D (Diff)</option>
                  <option value="DIGITEVEN">E (Even)</option>
                  <option value="DIGITODD">O (Odd)</option>
                  <option value="CALL">R (Rise)</option>
                  <option value="PUT">F (Fall)</option>
                </select>
                {bNeedsBarrier ? (
                  <input className="lp-num lp-sm lp-custom-box-input" type="number" min={0} max={9}
                    value={box.barrier} onChange={e => updateContractBarrier(ci, +e.target.value)} />
                ) : (
                  <div className="lp-custom-box-placeholder">—</div>
                )}
              </div>
            );
          })}
          <button className="lp-apb-add-btn" style={{ alignSelf: 'flex-end', marginTop: 4 }}
            onClick={addContract}>+ Box</button>
        </div>
      )}
    </div>
  );
}

const MA_TYPES = ['SMA', 'EMA', 'WMA', 'HMA', 'KAMA', 'VWMA', 'ALMA', 'TEMA', 'ZLEMA', 'LSMA'];

function RsiSignalBuilder({ cond, onChange }: { cond: Condition; onChange: (c: Condition) => void }) {
  const u = (p: Partial<Condition>) => onChange({ ...cond, ...p });
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="lp-rsi-builder" style={{
      background: 'rgba(15, 23, 42, 0.75)',
      border: '1px solid rgba(99, 102, 241, 0.4)',
      borderRadius: '8px',
      padding: '8px 10px',
      marginTop: '6px',
      fontSize: '11px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      width: '100%'
    }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 'bold', color: '#a5b4fc' }}>⚡ RSI Signal [trade_lexx]</span>
          <span style={{ fontSize: '9px', color: '#64748b' }}>(Synthetic Candle Numerical Engine)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#94a3b8', fontSize: '10px' }}>Action:</span>
          <select
            className="lp-sel"
            style={{ fontSize: '10px', padding: '2px 6px', borderColor: '#6366f1', background: '#1e1b4b', color: '#c7d2fe' }}
            value={cond.rsiSignalAction || 'AUTO'}
            onChange={e => u({ rsiSignalAction: e.target.value as any })}
          >
            <option value="AUTO">AUTO (Match Strategy Trade Type)</option>
            <option value="BUY">BUY Signal (Rise / Call only)</option>
            <option value="SELL">SELL Signal (Fall / Put only)</option>
          </select>
        </div>
      </div>

      {/* Primary parameters row */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: '#cbd5e1' }}>Ticks/Bar:</span>
          <input
            className="lp-num lp-sm"
            type="number"
            min={1}
            max={60}
            value={cond.rsiTicksPerCandle ?? 5}
            onChange={e => u({ rsiTicksPerCandle: Math.max(1, +e.target.value || 5) })}
            title="Number of ticks grouped into one synthetic candle"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: '#cbd5e1' }}>RSI Length:</span>
          <input
            className="lp-num lp-sm"
            type="number"
            min={2}
            max={100}
            value={cond.rsiLength ?? 14}
            onChange={e => u({ rsiLength: Math.max(2, +e.target.value || 14) })}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: '#cbd5e1' }}>Reentry Pause:</span>
          <input
            className="lp-num lp-sm"
            type="number"
            min={0}
            max={50}
            value={cond.rsiReentryPause ?? 5}
            onChange={e => u({ rsiReentryPause: Math.max(0, +e.target.value || 0) })}
            title="Minimum bars between same-direction signals"
          />
          <span style={{ color: '#64748b', fontSize: '9px' }}>bars</span>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: showAdvanced ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            color: '#c7d2fe',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '9px',
            cursor: 'pointer',
            marginLeft: 'auto'
          }}
        >
          {showAdvanced ? '▴ Less Settings' : '▾ More Settings'}
        </button>
      </div>

      {/* Sub-signals checklist row */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {/* MA Signal toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cond.rsiMaMode ?? true}
            onChange={e => u({ rsiMaMode: e.target.checked })}
          />
          <span style={{ color: (cond.rsiMaMode ?? true) ? '#86efac' : '#64748b', fontWeight: 'bold' }}>MA Cross</span>
        </label>
        {(cond.rsiMaMode ?? true) && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <select
              className="lp-sel"
              style={{ fontSize: '9px', padding: '1px 3px' }}
              value={cond.rsiMaType || 'SMA'}
              onChange={e => u({ rsiMaType: e.target.value as any })}
            >
              {MA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              className="lp-num lp-sm"
              type="number"
              min={2}
              max={100}
              value={cond.rsiMaLength ?? 14}
              onChange={e => u({ rsiMaLength: Math.max(2, +e.target.value || 14) })}
              style={{ width: '34px' }}
              title="MA Length"
            />
          </div>
        )}

        {/* BB Signal toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cond.rsiBbMode ?? true}
            onChange={e => u({ rsiBbMode: e.target.checked })}
          />
          <span style={{ color: (cond.rsiBbMode ?? true) ? '#86efac' : '#64748b', fontWeight: 'bold' }}>BB Cross</span>
        </label>
        {(cond.rsiBbMode ?? true) && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <select
              className="lp-sel"
              style={{ fontSize: '9px', padding: '1px 3px' }}
              value={cond.rsiBbType || 'SMA'}
              onChange={e => u({ rsiBbType: e.target.value as any })}
            >
              {MA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              className="lp-num lp-sm"
              type="number"
              min={2}
              max={100}
              value={cond.rsiBbLength ?? 14}
              onChange={e => u({ rsiBbLength: Math.max(2, +e.target.value || 14) })}
              style={{ width: '34px' }}
              title="BB Length"
            />
            <span style={{ color: '#94a3b8', fontSize: '9px' }}>Ïƒ</span>
            <input
              className="lp-num lp-sm"
              type="number"
              step={0.1}
              min={0.1}
              max={10}
              value={cond.rsiBbMult ?? 2.0}
              onChange={e => u({ rsiBbMult: Math.max(0.1, +e.target.value || 2.0) })}
              style={{ width: '34px' }}
              title="StdDev Multiplier"
            />
          </div>
        )}

        {/* Divergence toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cond.rsiDivergenceMode ?? true}
            onChange={e => u({ rsiDivergenceMode: e.target.checked })}
          />
          <span style={{ color: (cond.rsiDivergenceMode ?? true) ? '#86efac' : '#64748b', fontWeight: 'bold' }}>Divergence</span>
        </label>
      </div>

      {/* Advanced expandable section */}
      {showAdvanced && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          paddingTop: '6px',
          borderTop: '1px dashed rgba(255,255,255,0.1)',
          color: '#cbd5e1'
        }}>
          {/* Overbought / Oversold filter */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={cond.rsiFilterEnabled ?? true}
                onChange={e => u({ rsiFilterEnabled: e.target.checked })}
              />
              <span style={{ fontWeight: '600' }}>RSI Zone Filter:</span>
            </label>
            {(cond.rsiFilterEnabled ?? true) && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                <span style={{ color: '#22c55e' }}>Buy Zone:</span>
                <input
                  className="lp-num lp-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={cond.rsiOversoldLow ?? 20}
                  onChange={e => u({ rsiOversoldLow: +e.target.value })}
                  style={{ width: '32px' }}
                />
                <span>-</span>
                <input
                  className="lp-num lp-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={cond.rsiOversoldHigh ?? 40}
                  onChange={e => u({ rsiOversoldHigh: +e.target.value })}
                  style={{ width: '32px' }}
                />
                <span style={{ color: '#ef4444', marginLeft: '6px' }}>Sell Zone:</span>
                <input
                  className="lp-num lp-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={cond.rsiOverboughtLow ?? 60}
                  onChange={e => u({ rsiOverboughtLow: +e.target.value })}
                  style={{ width: '32px' }}
                />
                <span>-</span>
                <input
                  className="lp-num lp-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={cond.rsiOverboughtHigh ?? 80}
                  onChange={e => u({ rsiOverboughtHigh: +e.target.value })}
                  style={{ width: '32px' }}
                />
              </div>
            )}
          </div>

          {/* Mode, Wait Opposite & Signal Hold Window */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#a5b4fc', fontWeight: 'bold' }}>Signal Hold Window:</span>
              <input
                className="lp-num lp-sm"
                type="number"
                min={1}
                max={50}
                value={cond.rsiSignalHoldTicks ?? 10}
                onChange={e => u({ rsiSignalHoldTicks: Math.max(1, +e.target.value || 10) })}
                title="How many ticks the signal stays active waiting for collaborating conditions (like [F, F] pullbacks)"
                style={{ width: '38px', borderColor: '#818cf8' }}
              />
              <span style={{ color: '#94a3b8', fontSize: '10px' }}>ticks (for AND pullback conditions)</span>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={cond.rsiWaitForOpposite ?? false}
                onChange={e => u({ rsiWaitForOpposite: e.target.checked })}
              />
              <span>Wait for Opposite Signal</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={cond.rsiAndMode ?? false}
                onChange={e => u({ rsiAndMode: e.target.checked })}
              />
              <span title="Require at least 2 sub-signals simultaneously">AND Mode (Multi-Signal Confluence)</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionRow({ cond, isFirst, onChange, onRemove }: {
  cond: Condition;
  isFirst: boolean;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const [showDigitMenu, setShowDigitMenu] = useState(false);
  const u = (p: Partial<Condition>) => onChange({ ...cond, ...p });

  return (
    <div className="lp-cond-row">
      {!isFirst && (
        <select className="lp-sel lp-join" value={cond.join} onChange={e => u({ join: e.target.value as 'AND' | 'OR' })}>
          <option>AND</option>
          <option>OR</option>
        </select>
      )}

      <select
        className="lp-sel lp-ctype"
        value={cond.type}
        onChange={e => {
          const newType = e.target.value as Condition['type'];
          const patch: Partial<Condition> = { type: newType };
          if (newType === 'DIGIT_APPEARS') {
            patch.period = 10;
            patch.value = 4;
            patch.digitBarrier = 5;
            patch.targetDigits = [5];
            patch.comparator = '=';
          } else if (newType === 'EVEN_PCT' || newType === 'ODD_PCT' || newType === 'FALL_PCT' || newType === 'RISE_PCT') {
            patch.period = 100;
            patch.value = 60;
            patch.comparator = '>';
          } else if (newType === 'OVER_PCT' || newType === 'UNDER_PCT') {
            patch.period = 100;
            patch.value = 60;
            patch.digitBarrier = 4;
            patch.comparator = '>';
          } else if (newType === 'RSI_SIGNAL') {
            patch.rsiTicksPerCandle = 5;
            patch.rsiLength = 14;
            patch.rsiSignalAction = 'AUTO';
            patch.rsiSignalHoldTicks = 10;
            patch.rsiMaMode = true;
            patch.rsiMaType = 'SMA';
            patch.rsiMaLength = 14;
            patch.rsiBbMode = true;
            patch.rsiBbType = 'SMA';
            patch.rsiBbLength = 14;
            patch.rsiBbMult = 2.0;
            patch.rsiDivergenceMode = true;
            patch.rsiFilterEnabled = true;
            patch.rsiOversoldLow = 20;
            patch.rsiOversoldHigh = 40;
            patch.rsiOverboughtLow = 60;
            patch.rsiOverboughtHigh = 80;
            patch.rsiReentryPause = 5;
            patch.rsiWaitForOpposite = false;
            patch.rsiAndMode = false;
          }
          u(patch);
        }}
      >
        {CONDITION_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
      </select>

      {(cond.type === 'EVEN_PCT' || cond.type === 'ODD_PCT' || cond.type === 'FALL_PCT' || cond.type === 'RISE_PCT') && (
        <>
          <select className="lp-sel lp-cmp" value={cond.comparator} onChange={e => u({ comparator: e.target.value })}>
            {COMPARATORS.map(c => <option key={c}>{c}</option>)}
          </select>
          <input className="lp-num" type="number" min={0} max={100} value={cond.value}
            onChange={e => u({ value: +e.target.value })} />
          <span className="lp-unit">% in last</span>
          <input className="lp-num lp-sm" type="number" min={1} max={1000} value={cond.period}
            onChange={e => u({ period: +e.target.value })} />
          <span className="lp-unit">ticks</span>
          {/* ── Eligible Window ── */}
          <button
            type="button"
            title="Eligible Window: keep this market eligible for N seconds after the condition is met"
            onClick={() => u({ eligibleWindow: { enabled: !(cond.eligibleWindow?.enabled), seconds: cond.eligibleWindow?.seconds ?? 90 } })}
            style={{
              padding: '1px 5px', fontSize: 10, borderRadius: 4, cursor: 'pointer', marginLeft: 4,
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
                onChange={e => u({ eligibleWindow: { enabled: true, seconds: Math.max(1, +e.target.value || 1) } })}
                className="lp-num lp-sm"
                title="Eligible window duration in seconds"
              />
              <span className="lp-unit">s</span>
            </>
          )}
        </>
      )}


      {(cond.type === 'OVER_PCT' || cond.type === 'UNDER_PCT') && (
        <>
          <span className="lp-unit">( </span>
          <input className="lp-num lp-sm" type="number" min={0} max={9} value={cond.digitBarrier ?? 4}
            onChange={e => u({ digitBarrier: +e.target.value })} title="Barrier digit" />
          <span className="lp-unit"> )</span>
          <select className="lp-sel lp-cmp" value={cond.comparator} onChange={e => u({ comparator: e.target.value })}>
            {COMPARATORS.map(c => <option key={c}>{c}</option>)}
          </select>
          <input className="lp-num" type="number" min={0} max={100} value={cond.value}
            onChange={e => u({ value: +e.target.value })} />
          <span className="lp-unit">% in last</span>
          <input className="lp-num lp-sm" type="number" min={1} max={1000} value={cond.period}
            onChange={e => u({ period: +e.target.value })} />
          <span className="lp-unit">ticks</span>
          {/* ── Eligible Window ── */}
          <button
            type="button"
            title="Eligible Window: keep this market eligible for N seconds after the condition is met"
            onClick={() => u({ eligibleWindow: { enabled: !(cond.eligibleWindow?.enabled), seconds: cond.eligibleWindow?.seconds ?? 90 } })}
            style={{
              padding: '1px 5px', fontSize: 10, borderRadius: 4, cursor: 'pointer', marginLeft: 4,
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
                onChange={e => u({ eligibleWindow: { enabled: true, seconds: Math.max(1, +e.target.value || 1) } })}
                className="lp-num lp-sm"
                title="Eligible window duration in seconds"
              />
              <span className="lp-unit">s</span>
            </>
          )}
        </>
      )}

      {cond.type === 'LAST_DIGITS' && (
        <>
          <span className="lp-txt">LAST</span>
          <input className="lp-num lp-sm" type="number" min={1} max={50} value={cond.lastN}
            onChange={e => u({ lastN: +e.target.value })} />
          <span className="lp-txt">DIGITS ARE</span>
          <div style={{ position: 'relative' }}>
            <button className="lp-sel lp-dd-btn" onClick={() => setShowDigitMenu(v => !v)}>
              {DIGIT_OPTIONS.find(o => o.value === cond.digitValue)?.label || cond.digitValue}
              <ChevronDown size={11} style={{ marginLeft: 4 }} />
            </button>
            {showDigitMenu && (
              <div className="lp-dd-menu">
                {DIGIT_OPTIONS.map(o => (
                  <div key={o.value} className={`lp-dd-item ${cond.digitValue === o.value ? 'active' : ''}`}
                    onClick={() => { u({ digitValue: o.value }); setShowDigitMenu(false); }}>
                    {o.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          {(cond.digitValue === 'OVER' || cond.digitValue === 'UNDER' || cond.digitValue === 'EQUAL') && (
            <input className="lp-num lp-sm" type="number" min={0} max={9} value={cond.digitBarrier ?? 4}
              onChange={e => u({ digitBarrier: +e.target.value })} style={{ marginLeft: 6 }} />
          )}
          <span className="lp-unit lp-cyan" style={{ marginLeft: 4 }}>DIGITS</span>
        </>
      )}

      {cond.type === 'GREEN_BAR' && (() => {
        const topCount = Math.max(1, cond.topCount ?? 3);
        const rankType = cond.rankType || 'TOP'; // 'TOP' | 'LOWEST'
        const category = cond.digitValue || 'EVEN'; // 'EVEN' | 'ODD' | 'OVER' | 'UNDER'
        const isOverUnder = category === 'OVER' || category === 'UNDER';
        const barrier = cond.digitBarrier ?? 4;
        const allAbove = cond.allAboveMinPct ?? true;
        const pctCompare = cond.pctCompare || (rankType === 'LOWEST' ? 'BELOW' : 'ABOVE');

        // Calculate max topCount based on category
        let maxTop = 5;
        if (category === 'OVER') maxTop = Math.max(1, 9 - barrier);
        else if (category === 'UNDER') maxTop = Math.max(1, barrier + 1);

        // Calculate barrier range based on topCount
        // OVER: barrier max is 9 - topCount (e.g. top 3 -> max barrier is 6)
        // UNDER: barrier min is topCount - 1 (e.g. top 3 -> min barrier is 2)
        const overMaxBarrier = Math.max(0, 9 - topCount);
        const underMinBarrier = Math.min(9, Math.max(0, topCount - 1));

        return (
          <>
            <select
              className="lp-sel lp-cmp"
              value={rankType}
              onChange={e => {
                const newRank = e.target.value as 'TOP' | 'LOWEST';
                const newPctComp = newRank === 'LOWEST' ? 'BELOW' : 'ABOVE';
                u({ rankType: newRank, pctCompare: newPctComp });
              }}
              style={{ fontWeight: 800, color: rankType === 'LOWEST' ? '#fb7185' : '#34d399' }}
            >
              <option value="TOP">TOP</option>
              <option value="LOWEST">LOWEST</option>
            </select>
            <input
              className="lp-num lp-sm"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={cond.topCount !== undefined ? cond.topCount : 3}
              onFocus={e => e.target.select()}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9]/g, '');
                if (raw === '') {
                  u({ topCount: '' as any });
                  return;
                }
                const n = parseInt(raw, 10);
                if (!isNaN(n)) {
                  const clamped = Math.max(1, Math.min(maxTop, n));
                  let b = barrier;
                  if (category === 'OVER' && b > 9 - clamped) b = 9 - clamped;
                  if (category === 'UNDER' && b < clamped - 1) b = clamped - 1;
                  u({ topCount: clamped, digitBarrier: b });
                }
              }}
              onBlur={() => {
                if (!cond.topCount || isNaN(+cond.topCount) || +cond.topCount < 1) {
                  u({ topCount: Math.min(maxTop, 2) });
                }
              }}
              style={{ width: '40px', textAlign: 'center' }}
            />
            <span className="lp-txt">DIGITS ARE</span>
            <select
              className="lp-sel lp-cmp"
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
                u({ digitValue: newCat, topCount: clampedTop, digitBarrier: b });
              }}
            >
              <option value="EVEN">EVEN</option>
              <option value="ODD">ODD</option>
              <option value="OVER">OVER</option>
              <option value="UNDER">UNDER</option>
            </select>

            {isOverUnder && (
              <>
                <span className="lp-txt">{category}</span>
                <input
                  className="lp-num lp-sm"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={cond.digitBarrier !== undefined ? cond.digitBarrier : 4}
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    if (raw === '') {
                      u({ digitBarrier: '' as any });
                      return;
                    }
                    let b = parseInt(raw, 10);
                    if (!isNaN(b)) {
                      if (category === 'OVER') b = Math.max(0, Math.min(overMaxBarrier, b));
                      if (category === 'UNDER') b = Math.max(underMinBarrier, Math.min(9, b));
                      u({ digitBarrier: b });
                    }
                  }}
                  onBlur={() => {
                    if ((cond.digitBarrier as any) === '' || isNaN(+(cond.digitBarrier ?? 0))) {
                      u({ digitBarrier: 4 });
                    }
                  }}
                  title={category === 'OVER'
                    ? `Max barrier is ${overMaxBarrier} so that at least ${topCount} digits can be over ${overMaxBarrier}`
                    : `Min barrier is ${underMinBarrier} so that at least ${topCount} digits can be under ${underMinBarrier}`}
                  style={{ width: '38px', textAlign: 'center', borderColor: '#38bdf8', color: '#38bdf8' }}
                />
              </>
            )}

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', marginLeft: '4px' }}>
              <input
                type="checkbox"
                checked={allAbove}
                onChange={e => u({ allAboveMinPct: e.target.checked })}
                style={{ cursor: 'pointer', accentColor: '#10b981' }}
              />
              <span className="lp-txt" style={{ fontSize: '11px', color: allAbove ? '#10b981' : '#64748b' }}>
                and each
              </span>
            </label>

            {allAbove && (
              <>
                <select
                  className="lp-sel lp-cmp"
                  value={pctCompare}
                  onChange={e => u({ pctCompare: e.target.value as 'ABOVE' | 'BELOW' })}
                  style={{ fontSize: '11px', padding: '2px 4px', fontWeight: 700, color: pctCompare === 'BELOW' ? '#fb7185' : '#34d399' }}
                >
                  <option value="ABOVE">&gt;= (above)</option>
                  <option value="BELOW">&lt;= (below)</option>
                </select>
                <input
                  className="lp-num lp-sm"
                  type="text"
                  inputMode="decimal"
                  value={cond.value !== undefined ? cond.value : 10}
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === '' || raw === '.') {
                      u({ value: raw as any });
                      return;
                    }
                    const num = parseFloat(raw);
                    if (!isNaN(num)) {
                      u({ value: Math.max(0, Math.min(100, num)) });
                    }
                  }}
                  onBlur={() => {
                    if ((cond.value as any) === '' || isNaN(+(cond.value ?? 0))) {
                      u({ value: 10 });
                    }
                  }}
                  style={{ width: '44px', textAlign: 'center' }}
                />
                <span className="lp-unit">%</span>
              </>
            )}

            <span className="lp-unit" style={{ marginLeft: 2 }}>in last</span>
            <input
              className="lp-num lp-sm"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={cond.period !== undefined ? cond.period : 100}
              onFocus={e => e.target.select()}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9]/g, '');
                if (raw === '') {
                  u({ period: '' as any });
                  return;
                }
                const num = parseInt(raw, 10);
                if (!isNaN(num)) {
                  u({ period: Math.max(1, Math.min(1000, num)) });
                }
              }}
              onBlur={() => {
                if ((cond.period as any) === '' || isNaN(+(cond.period ?? 0))) {
                  u({ period: 100 });
                }
              }}
              style={{ width: '52px', textAlign: 'center' }}
            />
            <span className="lp-unit">ticks</span>
          </>
        );
      })()}

      {cond.type === 'DIGIT_APPEARS' && (
        <>
          <span className="lp-unit">IF DIGIT </span>
          {(() => {
            const digitsList = cond.targetDigits && cond.targetDigits.length > 0
              ? cond.targetDigits
              : [cond.digitBarrier ?? 5];

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '0 4px' }}>
                {digitsList.map((digit, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '2px', position: 'relative' }}>
                    {index > 0 && <span className="lp-unit" style={{ fontSize: '9px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', marginRight: '2px' }}>AND</span>}
                    <input
                      className="lp-num lp-sm"
                      type="number"
                      min={0}
                      max={9}
                      value={digit}
                      onChange={e => {
                        const newDigits = [...digitsList];
                        newDigits[index] = Math.min(9, Math.max(0, +e.target.value || 0));
                        u({
                          targetDigits: newDigits,
                          digitBarrier: newDigits[0],
                        });
                      }}
                      title={`Target Digit ${index + 1}`}
                      style={{ width: '32px', paddingLeft: 0, paddingRight: 0 }}
                    />
                    {digitsList.length > 1 && (
                      <button
                        onClick={() => {
                          const newDigits = digitsList.filter((_, idx) => idx !== index);
                          u({
                            targetDigits: newDigits,
                            digitBarrier: newDigits[0] ?? 5,
                          });
                        }}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#ef4444',
                          border: 'none',
                          borderRadius: '4px',
                          width: '14px',
                          height: '14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '8px',
                          cursor: 'pointer',
                          position: 'absolute',
                          top: '-4px',
                          right: '-4px',
                          zIndex: 10
                        }}
                        title="Remove digit"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                
                {digitsList.length < 5 && (
                  <button
                    onClick={() => {
                      const newDigits = [...digitsList, 4];
                      u({
                        targetDigits: newDigits,
                        digitBarrier: newDigits[0],
                      });
                    }}
                    style={{
                      background: 'rgba(99, 102, 241, 0.2)',
                      color: '#a5b4fc',
                      border: '1px dashed rgba(99, 102, 241, 0.5)',
                      borderRadius: '4px',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      marginLeft: '2px',
                    }}
                    title="Add another digit"
                  >
                    +
                  </button>
                )}
              </div>
            );
          })()}
          <span className="lp-unit">APPEAR</span>
          
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '6px', border: '1px solid var(--glass-border)', marginLeft: '4px', marginRight: '4px', alignItems: 'center' }}>
            {[
              { op: '>', label: '>', title: 'Over (More Than)' },
              { op: '=', label: '=', title: 'Equal To' },
              { op: '<', label: '<', title: 'Under (Less Than)' }
            ].map(item => (
              <button
                key={item.op}
                onClick={() => u({ comparator: item.op })}
                title={item.title}
                style={{
                  background: cond.comparator === item.op ? '#6366f1' : 'transparent',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <input className="lp-num lp-sm" type="number" min={0} max={100} value={cond.value}
            onChange={e => u({ value: +e.target.value })} />
          <span className="lp-unit">times in last</span>
          <input className="lp-num lp-sm" type="number" min={1} max={1000} value={cond.period}
            onChange={e => u({ period: +e.target.value })} />
          <span className="lp-unit">ticks</span>
        </>
      )}

      {cond.type === 'DIGIT_PATTERN' && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <AdvancedPatternBuilder cond={cond} onChange={onChange} />
        </div>
      )}

      {cond.type === 'RSI_SIGNAL' && (
        <div style={{ width: '100%', marginTop: 4 }}>
          <RsiSignalBuilder cond={cond} onChange={onChange} />
        </div>
      )}

      <button className="lp-rm-cond" onClick={onRemove} title="Remove condition">−</button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// TRADE PATTERN BUILDER COMPONENT
// ───────────────────────────────────────────────────────────────────────────

function TradePatternBuilder({ pattern, onChange }: {
  pattern: boolean[];
  onChange: (p: boolean[]) => void;
}) {
  const toggle = (i: number) => onChange(pattern.map((v, idx) => idx === i ? !v : v));
  const addStep = () => onChange([...pattern, true]);
  const removeLast = () => { if (pattern.length > 1) onChange(pattern.slice(0, -1)); };

  return (
    <div className="lp-tpb">
      <div className="lp-tpb-seq">
        {pattern.map((trade, i) => (
          <button
            key={i}
            className={`lp-tpb-cell ${trade ? 'trade' : 'skip'}`}
            onClick={() => toggle(i)}
            title={`Trade Signal ${i + 1}: ${trade ? 'TRADE (runs for set ticks)' : 'SKIP (skips this trade signal)'}`}
          >
            <span className="lp-tpb-num">{i + 1}</span>
            <span className="lp-tpb-label">{trade ? 'T' : 'S'}</span>
          </button>
        ))}
        <button className="lp-tpb-add" onClick={addStep} title="Add trade step">+</button>
        {pattern.length > 1 && (
          <button className="lp-tpb-rm" onClick={removeLast} title="Remove last step">−</button>
        )}
      </div>
      <div className="lp-tpb-legend">
        <span className="lp-tpb-leg-t">T=TRADE (places contract for set ticks)</span>
        <span className="lp-tpb-leg-s">S=SKIP (skips trade signal)</span>
        <span style={{ color: '#9ca3af', fontSize: 10 }}>Click cell to toggle T ↔ S</span>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// STRATEGY BLOCK COMPONENT
// ───────────────────────────────────────────────────────────────────────────

function StrategyBlock({ strategy, index, onChange, onRemove, adaptiveSwitchEnabled }: {
  strategy: Strategy;
  index: number;
  onChange: (s: Strategy) => void;
  onRemove: () => void;
  adaptiveSwitchEnabled?: boolean;
}) {
  const [showPattern, setShowPattern] = useState(false);
  const u = (p: Partial<Strategy>) => onChange({ ...strategy, ...p });

  const addCond = () => u({ conditions: [...strategy.conditions, createCondition()] });
  const removeCond = (id: string) => u({ conditions: strategy.conditions.filter(c => c.id !== id) });
  const updateCond = (id: string, updated: Condition) =>
    u({ conditions: strategy.conditions.map(c => c.id === id ? updated : c) });

  const { selectedMarkets, adaptiveSwitch, continuousLock } = useBotStore();
  const continuousLockEnabled = Boolean(continuousLock?.enabled);

  const isUsingOnlyUpDown = (() => {
    if (adaptiveSwitchEnabled) {
      return adaptiveSwitch.steps.some(step => {
        const stepTrades = step.trades && step.trades.length > 0
          ? step.trades
          : [{ contractType: step.contractType || 'DIGITEVEN' }];
        return stepTrades.some(t => t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW');
      });
    }
    return strategy.tradeType === 'RUNHIGH' || strategy.tradeType === 'RUNLOW';
  })();

  useEffect(() => {
    if (isUsingOnlyUpDown) {
      if (strategy.ticks < 2 || strategy.ticks > 5) {
        u({ ticks: Math.max(2, Math.min(5, strategy.ticks)) });
      }
    }
  }, [isUsingOnlyUpDown, strategy.ticks]);

  const hasBarrier = needsBarrier(strategy.tradeType);

  return (
    <div className={`lp-strategy ${STRATEGY_BG[index % STRATEGY_BG.length]}`}>
      <div className="lp-strat-hdr">
        <div className="lp-strat-title">
          <span className="lp-strat-name">STRATEGY {index + 1}</span>
          <span className="lp-cond-badge">{strategy.conditions.length} CONDITION{strategy.conditions.length !== 1 ? 'S' : ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="lp-toggle-label">
            <input type="checkbox" checked={strategy.enabled} onChange={e => u({ enabled: e.target.checked })} />
            <span className="lp-toggle-text">{strategy.enabled ? 'ON' : 'OFF'}</span>
          </label>
          <button className="lp-rm-strat" onClick={onRemove}>REMOVE</button>
        </div>
      </div>

      <div className="lp-if-label">IF</div>

      {strategy.conditions.map((c, ci) => (
        <ConditionRow key={c.id} cond={c} isFirst={ci === 0}
          onChange={updated => updateCond(c.id, updated)}
          onRemove={() => removeCond(c.id)} />
      ))}

      {isUsingOnlyUpDown && selectedMarkets.some(sym => sym.startsWith('JD')) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#ef4444',
          fontSize: '11px',
          fontWeight: 'bold',
          padding: '6px 12px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: '6px',
          marginTop: '4px',
          marginBottom: '8px',
        }}>
          <ShieldAlert size={14} />
          <span>Warning: Only Ups/Downs is not supported on JUMP Indices!</span>
        </div>
      )}

      {/* THEN TRADE row - hidden when Adaptive Switch is active */}
      {!adaptiveSwitchEnabled && (
        <div className="lp-then-row">
          <span className="lp-then-lbl">THEN TRADE</span>
          <select className="lp-sel lp-trade-sel" value={strategy.tradeType} onChange={e => {
            const newType = e.target.value;
            const updates: any = { tradeType: newType };
            if (newType === 'RUNHIGH' || newType === 'RUNLOW') {
              if (strategy.ticks < 2 || strategy.ticks > 5) {
                updates.ticks = Math.max(2, Math.min(5, strategy.ticks));
              }
            }
            u(updates);
          }}>
            {TRADE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {hasBarrier && (
            <>
              <span className="lp-then-lbl" style={{ color: '#f59e0b', fontWeight: 900 }}>BARRIER</span>
              <input className="lp-num lp-sm" type="number" min={0} max={9} value={strategy.prediction}
                onChange={e => u({ prediction: +e.target.value })} />
            </>
          )}
          {/* Ticks input hidden when Trade Pattern is active (pattern manages duration) */}
          {!strategy.useTradePattern && (
            <>
              <span className="lp-then-lbl">FOR</span>
              <input 
                className="lp-num lp-sm" 
                type="number" 
                min={isUsingOnlyUpDown ? 2 : 0} 
                max={isUsingOnlyUpDown ? 5 : 100} 
                value={strategy.ticks}
                onChange={e => {
                  let val = +e.target.value;
                  if (isUsingOnlyUpDown) val = Math.max(2, Math.min(5, val));
                  u({ ticks: val });
                }} 
              />
              <span className="lp-unit">{isUsingOnlyUpDown ? 'TICKS (2-5)' : 'TICKS'}</span>
            </>
          )}
        </div>
      )}

      {/* When Adaptive Switch is active: only show FOR ticks */}
      {adaptiveSwitchEnabled && (
        <div className="lp-then-row">
          <span className="lp-then-lbl" style={{ color: '#a78bfa' }}>SWITCHER ACTIVE</span>
          <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginLeft: 4 }}>→ contract determined by SWITCHER</span>
          <span className="lp-then-lbl" style={{ marginLeft: 8 }}>FOR</span>
          <input 
            className="lp-num lp-sm" 
            type="number" 
            min={isUsingOnlyUpDown ? 2 : 0} 
            max={isUsingOnlyUpDown ? 5 : 100} 
            value={strategy.ticks}
            onChange={e => {
              let val = +e.target.value;
              if (isUsingOnlyUpDown) val = Math.max(2, Math.min(5, val));
              u({ ticks: val });
            }} 
          />
          <span className="lp-unit">{isUsingOnlyUpDown ? 'TICKS (2-5)' : 'TICKS'}</span>
        </div>
      )}

      {/* Trade Pattern toggle - hidden when adaptive switch or continuous lock is active */}
      {!adaptiveSwitchEnabled && !continuousLockEnabled && (
        <div className="lp-tpb-row">
          <label className="lp-tpb-lbl-check">
            <input type="checkbox" checked={!!strategy.useTradePattern}
              onChange={e => u({ useTradePattern: e.target.checked })} />
            <Layers size={11} style={{ marginLeft: 3, marginRight: 3, color: '#6366f1' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5' }}>TRADE PATTERN</span>
          </label>
          {strategy.useTradePattern && (
            <button className="lp-tpb-expand" onClick={() => setShowPattern(v => !v)}>
              {showPattern ? '▲ Hide' : '▼ Edit'}
            </button>
          )}
          {strategy.useTradePattern && (
            <div className="lp-tpb-inline-preview">
              {(strategy.tradePattern || []).map((t, i) => (
                <span key={i} className={`lp-tpb-mini ${t ? 'trade' : 'skip'}`}>{t ? 'T' : 'S'}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {!adaptiveSwitchEnabled && !continuousLockEnabled && strategy.useTradePattern && showPattern && (
        <TradePatternBuilder
          pattern={strategy.tradePattern || [true]}
          onChange={p => u({ tradePattern: p })}
        />
      )}
      {continuousLockEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '6px', fontSize: '10px', color: '#fbbf24', margin: '6px 0' }}>
          <Layers size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span>🔒 <strong>Continuous Lock Active</strong> — Strategy Trade Pattern is disabled. Using Locked Trade Pattern loop.</span>
        </div>
      )}
      {/* No Contradiction — hidden, always active */}
      <button className="lp-add-cond-btn" onClick={addCond}>+ CONDITION</button>

      <div className="lp-summary">{strategySummary(strategy, index)}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MARKET CARD COMPONENT
// ───────────────────────────────────────────────────────────────────────────

function MarketCardInner({ symbol, label, isFlashing }: {
  symbol: string;
  label: string;
  isFlashing: boolean;
}) {
  const { marketRegimes } = useScannerStore();
  const regime = marketRegimes[symbol];
  const digits = regime?.digits ?? [];
  const quotes = regime?.quotes ?? [];
  const historyReady = regime?.historyReady ?? false;

  const last5       = digits.slice(-5);
  const last5Quotes = quotes.slice(-6);

  // Compute R/F moves
  const moves: ('R' | 'F' | '-')[] = [];
  for (let i = 0; i < last5.length; i++) {
    const qi = last5Quotes.length - 5 + i;
    if (qi <= 0 || last5Quotes.length < 2) { moves.push('-'); }
    else { moves.push(last5Quotes[qi] > last5Quotes[qi - 1] ? 'R' : 'F'); }
  }

  // 100-tick frequency
  const ticks100 = digits.slice(-100);
  const freq = Array(10).fill(0);
  ticks100.forEach(d => { if (d >= 0 && d <= 9) freq[d]++; });
  const maxFreq      = Math.max(...freq);
  const greenBarDigit = freq.indexOf(maxFreq);

  return (
    <div className={`lp-market-card${isFlashing ? ' lp-mc-flash' : ''}`}>
      <div className="lp-mc-hdr">
        <span className="lp-mc-label">{label}</span>
        <span className={`lp-scan-badge ${historyReady ? 'ready' : 'loading'}`}>
          {historyReady ? 'SCAN' : '...'}
        </span>
        {isFlashing && <span className="lp-mc-signal-badge">⚡ SIGNAL</span>}
      </div>
      <div className="lp-mc-row">
        <span className="lp-mc-rl">Digits</span>
        <div className="lp-bubbles">
          {last5.length === 0
            ? Array(5).fill(null).map((_, i) => <span key={i} className="lp-bubble neutral">-</span>)
            : last5.map((d, i) => (
              <span key={i} className={`lp-bubble d${d} ${d === greenBarDigit && historyReady ? 'green-bar' : ''}`}>{d}</span>
            ))}
        </div>
      </div>
      <div className="lp-mc-row">
        <span className="lp-mc-rl">Moves</span>
        <div className="lp-bubbles">
          {moves.map((m, i) => (
            <span key={i} className={`lp-bubble ${m === 'R' ? 'rise' : m === 'F' ? 'fall' : 'neutral'}`}>{m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Memoized — only re-renders when symbol/label/isFlashing actually change
const MarketCard = React.memo(MarketCardInner);

// ───────────────────────────────────────────────────────────────────────────
// TRADE LOG PANEL
// ───────────────────────────────────────────────────────────────────────────

function TradeLogPanel({ logs: rawLogs, stats, journalLogs = [], onReset, onClearJournal }: {
  logs: TradeLog[];
  stats: { won: number; lost: number; totalProfit: number; totalTrades: number };
  journalLogs?: JournalLog[];
  onReset: () => void;
  onClearJournal?: () => void;
}) {
  const [tab, setTab] = useState<'transactions' | 'summary' | 'journal'>('transactions');

  // Direct, superfast reading of real trades from the Deriv store
  const derivLogs = useDerivStore(state => state.tradeLogs);

  const combinedLogs = React.useMemo(() => {
    // 1. Map real trades from Deriv store
    const realBotLogs = derivLogs
      .filter(l => l.requestId && botTradeIds.has(String(l.requestId)) && (!l.pageId || l.pageId === 'laxprime'))
      .map(l => {
        const localLog = rawLogs.find(x => String(x.id) === String(l.requestId));
        
        // Fallback to local instant results if Deriv WebSocket response is still pending or RUNNING
        const isDerivPending = !l.result || l.result === 'RUNNING...' || l.result === 'RUNNING' || l.result === 'SENT' || l.result === 'BUYING...';
        const isWon = l.result === 'WON' || l.result === 'RISE WIN' || l.result === 'FALL WIN' || l.result === 'RISE_WIN' || l.result === 'FALL_WIN'
          || (isDerivPending && localLog?.result === 'WON');
        const isLost = l.result === 'LOST' || l.result === 'RISE LOSS' || l.result === 'FALL LOSS' || l.result === 'RISE_LOSS' || l.result === 'FALL_LOSS'
          || (isDerivPending && localLog?.result === 'LOST');
          
        const resultLabel = isWon ? 'WON' : isLost ? 'LOST' : (l.result || localLog?.result || 'RUNNING...');
        const profitVal = (l.profit !== null && l.profit !== undefined && l.profit !== 0)
          ? parseFloat(String(l.profit))
          : (localLog?.profit || 0);

        const stakeVal = parseFloat(String(l.stake)) || localLog?.stake || 1;

        return {
          id: String(l.requestId),
          time: l.time,
          contract: l.contract,
          symbol: l.symbol || localLog?.symbol || 'V10(1s)',
          stake: stakeVal,
          exitSpot: (l.exit && l.exit !== '-') ? l.exit : (localLog?.exitSpot || '-'),
          entrySpot: (l.entrySpot && l.entrySpot !== '-') ? l.entrySpot : (localLog?.entrySpot || '-'),
          profit: profitVal,
          result: resultLabel,
          step: localLog?.step || 1,
          strategyIndex: localLog?.strategyIndex,
        };
      });

    // 2. Map virtual trades from botStore
    const virtLogs = rawLogs
      .filter(l => String(l.id).startsWith('VIRT_') && (!l.pageId || l.pageId === 'laxprime'))
      .map(l => ({
        id: String(l.id),
        time: l.time,
        contract: l.contract,
        symbol: l.symbol,
        stake: l.stake,
        exitSpot: l.exitSpot,
        entrySpot: l.entrySpot,
        profit: l.profit,
        result: l.result,
        step: l.step || 1,
        strategyIndex: l.strategyIndex,
      }));

    // 3. Merge and sort
    const merged = [...realBotLogs, ...virtLogs];
    merged.sort((a, b) => b.time - a.time);
    return merged;
  }, [derivLogs, rawLogs]);

  const contractLabel = (type: string) => {
    const m: Record<string, string> = {
      DIGITEVEN: 'EVEN', DIGITODD: 'ODD',
      DIGITOVER: 'OVER', DIGITUNDER: 'UNDER',
      DIGITMATCH: 'MATCH', DIGITDIFF: 'DIFF',
      CALL: 'RISE', PUT: 'FALL',
      RUNHIGH: 'ONLY UPS', RUNLOW: 'ONLY DOWNS',
    };
    return m[type] || type;
  };

  const getExitDisplay = (log: any) => {
    const isFullSpot = log.contract === 'CALL' || log.contract === 'PUT' ||
                       log.contract === 'RUNHIGH' || log.contract === 'RUNLOW';

    if (isFullSpot) {
      const entry = log.entrySpot && log.entrySpot !== '-' ? log.entrySpot : '';
      const exit = log.exitSpot && log.exitSpot !== '-' ? log.exitSpot : '';
      if (!exit) {
        return entry ? `${entry}-...` : '-';
      }
      return `${entry}-${exit}`;
    } else {
      const rawExit = String(log.exitSpot || '-').trim();
      if (rawExit === '-') return '-';
      if (rawExit.includes('.')) {
        return rawExit.charAt(rawExit.length - 1);
      }
      return rawExit;
    }
  };

  return (
    <div className="lp-tx-panel">
      <div className="lp-tx-tabs">
        {(['transactions', 'summary', 'journal'] as const).map(t => (
          <button key={t} className={`lp-tx-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="lp-tx-actions">
        <button className="lp-tx-btn" onClick={() => {
          if (tab === 'journal') {
            const header = 'Time,Type,Title,Message\n';
            const rows = (journalLogs || []).map(log => {
              const time = log.time || (log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '');
              const type = log.type || 'info';
              const title = `"${(log.title || '').replace(/"/g, '""')}"`;
              const msg = `"${(log.message || '').replace(/"/g, '""')}"`;
              return `${time},${type},${title},${msg}`;
            }).join('\n');
            const blob = new Blob([header + rows], { type: 'text/csv' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url;
            a.download = `laxprime-journal-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            return;
          }

          // Build CSV from raw trade logs
          const header = 'Type,Symbol,Strategy,Stake,Entry,Exit,Result,P/L,Time\n';
          const rows = rawLogs.map(log => {
            const type = log.contract || '';
            const sym  = log.symbol || '';
            const strat = log.strategyIndex !== undefined ? `S${log.strategyIndex + 1}` : '';
            const stake = (log.stake ?? 0).toFixed(2);
            const entry = log.entrySpot ?? '-';
            const exit  = log.exitSpot ?? '-';
            const result = log.result || '';
            const pl = (log.profit ?? 0).toFixed(2);
            const time = log.time ? new Date(log.time).toLocaleString('en-GB', { hour12: false }) : '';
            return `${type},${sym},${strat},${stake},${entry},${exit},${result},${pl},${time}`;
          }).join('\n');
          const blob = new Blob([header + rows], { type: 'text/csv' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url;
          a.download = `laxprime-trades-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }}>Download</button>
        <button className="lp-tx-btn" onClick={() => {
          if (tab === 'journal' && onClearJournal) {
            onClearJournal();
          } else {
            onReset();
          }
        }}>Reset</button>
      </div>

      {tab === 'transactions' && (
        <>
          <div className="lp-tx-hdr">
            <span>Type</span>
            <span>Stake</span>
            <span>Exit</span>
            <span>P/L</span>
          </div>
          {combinedLogs.length === 0 ? (
            <div className="lp-tx-empty">
              <div className="lp-tx-icon">📦</div>
              <span>There are no transactions to display</span>
            </div>
          ) : (
            <div className="lp-tx-list">
              {combinedLogs.map(log => {
                const isVirt = String(log.id).startsWith('VIRT_');
                const won    = !isVirt && (log.result === 'WON');
                const lost   = !isVirt && (log.result === 'LOST');
                const virtWon  = isVirt && (log.result === 'VIRT WON'  || log.result === 'WON'  || (log.profit !== undefined && log.profit > 0));
                const virtLost = isVirt && (log.result === 'VIRT LOST' || log.result === 'LOST' || (log.profit !== undefined && log.profit < 0));
                const live   = !isVirt && (log.result === 'SENT' || log.result === 'BUYING...' || log.result === 'RUNNING...' || log.result === 'RUNNING');
                const virtLive = isVirt && log.result === 'VIRTUAL';

                return (
                  <div key={log.id} className={`lp-tx-row ${won ? 'won' : lost ? 'lost' : isVirt ? 'virt' : ''}`}>
                    <div className="lp-tx-contract">
                      <span className="lp-tx-type">{contractLabel(log.contract)}</span>
                      <span className="lp-tx-sym">{log.symbol}</span>
                      {log.strategyIndex !== undefined && (
                        <span style={{ 
                          fontSize: 8, 
                          background: 'rgba(255,255,255,0.06)', 
                          border: '1px solid rgba(255,255,255,0.1)', 
                          borderRadius: '3px', 
                          padding: '0 4px', 
                          fontWeight: '800', 
                          color: '#38bdf8',
                          marginLeft: 3
                        }}>
                          S{log.strategyIndex + 1}
                        </span>
                      )}
                      {isVirt && (
                        <span className={`lp-virt-badge ${virtWon ? 'won' : virtLost ? 'lost' : ''}`}>VIRT</span>
                      )}
                      {log.step > 1 && <span style={{ fontSize: 8, color: '#f59e0b', fontWeight: 'bold' }}>Step {log.step}</span>}
                    </div>

                    <span style={{ fontWeight: '500', color: '#94a3b8' }}>USD {(log.stake ?? 0).toFixed(2)}</span>

                    <span style={{ fontFamily: 'monospace', fontWeight: '700', color: '#f3f4f6' }}>
                      {getExitDisplay(log)}
                    </span>

                    <div className={`lp-tx-pnl ${isVirt ? 'virt' : (log.profit ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                      {virtLive ? (
                        <span style={{ fontSize: 9, color: '#818cf8', fontStyle: 'italic' }}>VIRT…</span>
                      ) : live ? (
                        <Loader2 size={10} className="lp-spin" />
                      ) : isVirt ? (
                        <span style={{ fontSize: 9, color: (virtWon ? '#818cf8' : '#a78bfa'), fontStyle: 'italic' }}>
                          {virtWon ? '+' : ''}{(log.profit ?? 0).toFixed(2)}
                        </span>
                      ) : (
                        `${(log.profit ?? 0) >= 0 ? '+' : ''}${(log.profit ?? 0).toFixed(2)}`
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'summary' && (
        <div className="lp-tx-empty" style={{ paddingTop: 24 }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {rawLogs.length === 0 ? 'No summary data yet.' : `${stats?.totalTrades ?? (stats?.won ?? 0) + (stats?.lost ?? 0)} trades completed.`}
          </span>
        </div>
      )}

      {tab === 'journal' && (
        (journalLogs && journalLogs.length > 0) ? (
          <div className="lp-tx-list" style={{ maxHeight: 320, padding: '6px' }}>
            {journalLogs.map(item => {
              const badgeColors: Record<string, { bg: string; text: string; border: string }> = {
                success:  { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
                error:    { bg: 'rgba(239, 68, 68, 0.15)',   text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
                stop:     { bg: 'rgba(245, 158, 11, 0.18)',  text: '#f59e0b', border: 'rgba(245, 158, 11, 0.35)' },
                warn:     { bg: 'rgba(245, 158, 11, 0.15)',  text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' },
                trade:    { bg: 'rgba(56, 189, 248, 0.15)',  text: '#38bdf8', border: 'rgba(56, 189, 248, 0.3)' },
                switcher: { bg: 'rgba(168, 85, 247, 0.15)',  text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' },
                info:     { bg: 'rgba(148, 163, 184, 0.12)', text: '#cbd5e1', border: 'rgba(148, 163, 184, 0.25)' },
              };
              const col = badgeColors[item.type] || badgeColors.info;
              return (
                <div key={item.id} style={{
                  padding: '7px 9px',
                  marginBottom: 6,
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{
                      fontSize: 8,
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: col.bg,
                      color: col.text,
                      border: `1px solid ${col.border}`,
                      letterSpacing: '0.4px',
                    }}>
                      {item.type}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted, #94a3b8)', fontFamily: 'monospace' }}>
                      {item.time}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-main, #f1f5f9)', lineHeight: 1.3 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {item.message}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="lp-tx-empty" style={{ paddingTop: 24 }}>
            <div className="lp-tx-icon">📜</div>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>No journal entries yet.</span>
            <span style={{ fontSize: 10, color: '#6b7280' }}>Bot starts, trades, triggers, and stop reasons will appear here in real-time.</span>
          </div>
        )
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ───────────────────────────────────────────────────────────────────────────

export default function LaxPrimePage() {
  const { status, account, isTradeAuthorized, virtualSettings, setVirtualSettings, compoundProfits, setRiskSettings } = useDerivStore();
  const { startScanning, stopScanning, ensureScanner } = useScannerStore();

  // Isolate this page's useDerivStore settings (virtual settings, trade logs, etc.)
  // from all other trading pages. Core bot settings are in useBotStore which
  // already has its own isolated persist key ('laxprime-bot-v1').
  usePageSettings('laxprime');

  const {
    stake, setStake,
    targetProfit, setTargetProfit,
    targetProfitMode, setTargetProfitMode,
    stopLoss, setStopLoss,
    stopLossMode, setStopLossMode,
    martingale, setMartingale,
    tradingMode, setTradingMode,
    strategies, setStrategies,
    selectedMarkets, setSelectedMarkets,
    isRunning,
    botStatusMsg,
    lastSignal,
    tradeLogs,
    journalLogs, clearJournal,
    globalStats,
    signalFlash,
    startBot, stopBot, resetAll,
    theme, setTheme,
    crossMarketDelay, setCrossMarketDelay,
    adaptiveSwitch, setAdaptiveSwitch,
    adaptiveLiveStatus,
    continuousLock, setContinuousLock,
  } = useBotStore();

  const [showContinuousLockPanel, setShowContinuousLockPanel] = useState(false);
  const [showVirtualPanel,   setShowVirtualPanel]   = useState(false);
  const [showSwitcherPanel,  setShowSwitcherPanel]  = useState(false);

  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const mgLabelTapRef   = useRef<number>(0); // double-tap timer for martingale/compounding toggle
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setIsModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      startScanning();
      selectedMarkets.forEach(m => ensureScanner(m));
    }
    return () => {
      stopScanning();
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'connected') return;
    selectedMarkets.forEach(m => ensureScanner(m));
  }, [selectedMarkets, status]);

  const handleToggle = () => {
    if (isRunning) stopBot('Stopped manually by user');
    else startBot();
  };

  const canRun = status === 'connected' && !!account;

  // Ticker to keep flash states alive (re-renders every 500ms while any flash is active)
  const [_tick, setTick] = useState(0);
  useEffect(() => {
    const hasFlash = Object.keys(signalFlash).some(sym => Date.now() - (signalFlash[sym] || 0) < 3000);
    if (!hasFlash) return;
    const t = setInterval(() => setTick(p => p + 1), 500);
    return () => clearInterval(t);
  }, [signalFlash]);

  return (
    <>
      <div className="lp-risk-disc">⚠️ Risk Disclaimer!</div>

      <div className={`lp-root ${theme === 'dark' ? 'lp-dark' : ''}`}>
        <div className="lp-main">

          <div className="lp-header-card">
            <div className="lp-title-row">
              <h1 className="lp-title">
                LAXPRIME
                <span className="lp-ai-badge">AI</span>
                <span className="lp-premium-badge">PREMIUM</span>
              </h1>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="lp-theme-toggle"
                title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
              >
                {theme === 'dark' ? '☀️' : '🌑'}
              </button>
            </div>
            <p className="lp-subtitle">
              A Multi-Strategy Trading Bot that allows you to execute up to 5 Strategies at Once. Example:{' '}
              <strong>If the last 4 digits are ODD, trade EVEN .</strong>
            </p>
          </div>

          {status === 'connected' && !isTradeAuthorized && (
            <div className="lp-auth-warn">
              <AlertTriangle size={14} />
              Trade authorization pending — trades will execute once Trade WS is authorized
            </div>
          )}
          {status !== 'connected' && (
            <div className="lp-auth-warn lp-disconnected">
              <AlertTriangle size={14} />
              Not connected — please authorize your Deriv account first
            </div>
          )}

          <div className="lp-settings-row">
            <div className="lp-sg">
              <label className="lp-sl">STAKE (USD)</label>
              <input className="lp-si" type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} />
            </div>
            <div className="lp-sg">
              <div className="lp-sl-row">
                <label className="lp-sl">{targetProfitMode === 'wins' ? 'TARGET WINS' : 'TARGET PROFIT'}</label>
                <button
                  className="lp-mode-pill"
                  onClick={() => setTargetProfitMode(targetProfitMode === 'profit' ? 'wins' : 'profit')}
                  title="Toggle between USD profit and number of wins"
                >
                  {targetProfitMode === 'wins' ? '🏆 Wins' : '💵 USD'}
                </button>
              </div>
              <input className="lp-si" type="number" min="0" value={targetProfit} onChange={e => setTargetProfit(e.target.value)} />
            </div>
            <div className="lp-sg">
              <div className="lp-sl-row">
                <label className="lp-sl">{stopLossMode === 'losses' ? 'STOP LOSSES' : 'STOP LOSS'}</label>
                <button
                  className="lp-mode-pill"
                  onClick={() => setStopLossMode(stopLossMode === 'loss' ? 'losses' : 'loss')}
                  title="Toggle between USD loss and number of losses"
                >
                  {stopLossMode === 'losses' ? '🔢 Count' : '💵 USD'}
                </button>
              </div>
              <input className="lp-si" type="number" min="0" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
            </div>
            <div className="lp-sg">
              <div className="lp-sl-row">
                <label
                  className="lp-sl"
                  title="Double-tap / double-click to switch between Martingale and Compounding"
                  style={{ cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s', color: compoundProfits ? '#22c55e' : undefined }}
                  onDoubleClick={() => {
                    setRiskSettings({ compoundProfits: !compoundProfits });
                  }}
                  onClick={() => {
                    const now = Date.now();
                    if (now - mgLabelTapRef.current < 400) {
                      // Double-tap detected — toggle compounding
                      setRiskSettings({ compoundProfits: !compoundProfits });
                      mgLabelTapRef.current = 0;
                    } else {
                      mgLabelTapRef.current = now;
                    }
                  }}
                >
                  {compoundProfits ? 'COMPOUNDING' : 'MARTINGALE'}
                </label>
                {compoundProfits && (
                  <span
                    className="lp-mg-dot"
                    title="Compounding active: Stake adds profit on real wins"
                    style={{ background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}
                    onClick={() => setRiskSettings({ compoundProfits: !compoundProfits })}
                  />
                )}
                {!compoundProfits && tradingMode === 'continuous' && (
                  <span className="lp-mg-dot" title="Martingale active" />
                )}
              </div>
              <input className="lp-si" type="number" min="1" step="0.1" value={martingale} onChange={e => setMartingale(e.target.value)} />
            </div>
            <div className="lp-sg lp-sg-wide" style={{ position: 'relative', zIndex: isModeDropdownOpen ? 100 : 1 }} ref={modeDropdownRef}>
              <label className="lp-sl">TRADING MODE</label>
              
              {/* Custom Trigger Button */}
              <div 
                className="lp-si lp-mode" 
                onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  position: 'relative',
                  userSelect: 'none',
                  height: '34px',
                  boxSizing: 'border-box'
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginRight: '8px' }}>
                  {tradingMode === 'continuous' 
                    ? `Trade continuously when there is a loss (${crossMarketDelay}s)`
                    : TRADING_MODES.find(m => m.value === tradingMode)?.label}
                </span>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', transition: 'transform 0.2s', transform: isModeDropdownOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                  ▼
                </span>
              </div>

              {/* Custom Dropdown Overlay */}
              {isModeDropdownOpen && (
                <div 
                  className="lp-dd-menu" 
                  style={{ 
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    width: '100%',
                    marginTop: '4px',
                    zIndex: 999,
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(12px)',
                    overflow: 'hidden'
                  }}
                >
                  {/* Option 1: Continuous */}
                  <div 
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      background: tradingMode === 'continuous' ? 'rgba(255,255,255,0.03)' : 'transparent'
                    }}
                  >
                    <div 
                      className={`lp-dd-item ${tradingMode === 'continuous' ? 'active' : ''}`}
                      onClick={() => {
                        setTradingMode('continuous');
                        // Keep dropdown open so they can click the delay options if they want
                      }}
                      style={{
                        padding: '10px 14px',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        color: tradingMode === 'continuous' ? 'var(--accent-cyan)' : '#f1f5f9',
                        transition: 'all 0.15s'
                      }}
                    >
                      Trade continuously when there is a loss
                    </div>
                    
                    {/* Delayed Option Selector (Nested inside dropdown under Option 1) */}
                    <div 
                      style={{ 
                        padding: '0 14px 10px 20px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px'
                      }}
                    >
                      <span style={{ fontSize: '9px', fontWeight: '900', color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase' }}>
                        Delay:
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {['1.5', '2.0', '3.0'].map(sec => (
                          <button
                            key={sec}
                            onClick={(e) => {
                              e.stopPropagation(); // prevent closing/triggering outer selection
                              setCrossMarketDelay(sec);
                              setTradingMode('continuous');
                            }}
                            style={{
                              background: crossMarketDelay === sec ? '#0d9488' : '#1e293b',
                              color: '#fff',
                              border: '1px solid rgba(255,255,255,0.05)',
                              borderRadius: '4px',
                              padding: '2px 8px',
                              fontSize: '9px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Option 2: Once per signal */}
                  <div 
                    className={`lp-dd-item ${tradingMode === 'once' ? 'active' : ''}`}
                    onClick={() => {
                      setTradingMode('once');
                      setIsModeDropdownOpen(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      color: tradingMode === 'once' ? 'var(--accent-cyan)' : '#f1f5f9',
                      transition: 'all 0.15s'
                    }}
                  >
                    Trade once per signal
                  </div>

                  {/* Option 3: Until Target Profit */}
                  <div 
                    className={`lp-dd-item ${tradingMode === 'target' ? 'active' : ''}`}
                    onClick={() => {
                      setTradingMode('target');
                      setIsModeDropdownOpen(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      color: tradingMode === 'target' ? 'var(--accent-cyan)' : '#f1f5f9',
                      transition: 'all 0.15s'
                    }}
                  >
                    Trade until target profit
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lp-strategy-section">
            <div className="lp-ss-hdr">
              <span className="lp-sec-title">STRATEGY BUILDER</span>
              <div className="lp-hdr-tool-btns">
                <button
                  className={`lp-virt-toggle-btn ${continuousLock?.enabled ? 'active' : ''}`}
                  onClick={() => setShowContinuousLockPanel(v => !v)}
                  title="Toggle Continuous Lock panel"
                  style={continuousLock?.enabled ? { borderColor: 'rgba(245, 158, 11, 0.5)', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.15)' } : undefined}>
                  <span className="lp-btn-icon">🔒</span>
                  <span className="lp-btn-label">
                    <span className="lp-word-desktop">CONTINUOUS </span>LOCK
                  </span>
                  <span className="lp-arrow-ind">{showContinuousLockPanel ? '▲' : '▼'}</span>
                  {continuousLock?.enabled && <span className="lp-virt-active-dot" style={{ background: '#f59e0b' }} />}
                </button>
                <button
                  className="lp-virt-toggle-btn"
                  onClick={() => setShowVirtualPanel(v => !v)}
                  title="Toggle Virtual System panel">
                  <span className="lp-btn-icon">🧪</span>
                  <span className="lp-btn-label">
                    VIRTUAL<span className="lp-word-desktop"> SYSTEM</span>
                  </span>
                  <span className="lp-arrow-ind">{showVirtualPanel ? '▲' : '▼'}</span>
                  {virtualSettings.isVirtualMode && <span className="lp-virt-active-dot" />}
                </button>
                <button
                  className={`lp-switcher-btn ${adaptiveSwitch.enabled ? 'active' : ''}`}
                  onClick={() => setShowSwitcherPanel(v => !v)}
                  title="Toggle Switcher panel">
                  <span className="lp-btn-icon">⚡</span>
                  <span className="lp-btn-label">SWITCHER</span>
                  <span className="lp-arrow-ind">{showSwitcherPanel ? '▲' : '▼'}</span>
                  {adaptiveSwitch.enabled && <span className="lp-sw-active-dot" />}
                </button>
                <button className="lp-add-strat-btn"
                  onClick={() => {
                    if (strategies.length >= 5) return;
                    setStrategies(p => [...p, createStrategy(p.length)]);
                  }}
                  disabled={strategies.length >= 5}
                  title="Add new strategy">
                  <span className="lp-btn-icon">+</span>
                  <span className="lp-btn-label">
                    <span className="lp-word-desktop">ADD </span>STRAT
                  </span>
                </button>
              </div>
            </div>

            {showContinuousLockPanel && (
              <div className="lp-vp" style={{ border: '1px solid rgba(245, 158, 11, 0.35)', background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                {/* Header */}
                <div className="lp-vp-hdr" style={{ borderBottom: '1px solid rgba(245, 158, 11, 0.2)', paddingBottom: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 900, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔒 CONTINUOUS LOCK TRADING
                    </span>
                    {continuousLock?.enabled && (
                      <span className="lp-vp-badge" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)', fontSize: '9px', fontWeight: 900, padding: '2px 8px', borderRadius: '4px' }}>
                        ● LOCKED TRADING MODE ACTIVE
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', color: '#e2e8f0' }}>
                      <input
                        type="checkbox"
                        checked={continuousLock?.enabled || false}
                        onChange={e => setContinuousLock({
                          ...continuousLock,
                          enabled: e.target.checked,
                        })}
                        style={{ accentColor: '#f59e0b', width: '15px', height: '15px', cursor: 'pointer' }}
                      />
                      <span>Enable Continuous Lock</span>
                    </label>
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: '1.4', marginBottom: '14px' }}>
                  When enabled, the bot scans all strategies across markets. As soon as the first strategy matches its conditions, the bot <strong style={{ color: '#fbbf24' }}>locks into that market &amp; strategy</strong>, executing trades continuously according to the Trade Pattern until Take Profit or Stop Loss is reached. All other strategies and markets are locked out.
                </div>

                {/* Mode Selector Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                  {/* Option 1: No Re-check */}
                  <div
                    onClick={() => setContinuousLock({ ...continuousLock, mode: 'no_recheck' })}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      border: continuousLock?.mode === 'no_recheck' ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      background: continuousLock?.mode === 'no_recheck' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(0,0,0,0.3)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 900, color: continuousLock?.mode === 'no_recheck' ? '#fbbf24' : '#f1f5f9' }}>
                        1. Trade after 1st entry (no re-check)
                      </span>
                      {continuousLock?.mode === 'no_recheck' && (
                        <span style={{ fontSize: '9px', fontWeight: 900, background: '#f59e0b', color: '#000', padding: '1px 6px', borderRadius: '4px' }}>SELECTED</span>
                      )}
                    </div>
                    <p style={{ fontSize: '10px', color: '#94a3b8', margin: 0, lineHeight: '1.35' }}>
                      Strategy condition acts as the initial entry trigger. Once triggered, it locks into this market and executes the trade pattern continuously on every tick without waiting for or re-checking conditions.
                    </p>
                  </div>

                  {/* Option 2: Continuous + Check */}
                  <div
                    onClick={() => setContinuousLock({ ...continuousLock, mode: 'continuous_check' })}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      border: continuousLock?.mode === 'continuous_check' ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      background: continuousLock?.mode === 'continuous_check' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(0,0,0,0.3)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 900, color: continuousLock?.mode === 'continuous_check' ? '#fbbf24' : '#f1f5f9' }}>
                        2. Trade continuously + check entry
                      </span>
                      {continuousLock?.mode === 'continuous_check' && (
                        <span style={{ fontSize: '9px', fontWeight: 900, background: '#f59e0b', color: '#000', padding: '1px 6px', borderRadius: '4px' }}>SELECTED</span>
                      )}
                    </div>
                    <p style={{ fontSize: '10px', color: '#94a3b8', margin: 0, lineHeight: '1.35' }}>
                      Locks onto the triggering market and strategy. Continues monitoring and verifying this strategy's entry conditions on the locked market before each trade in the pattern occurs.
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
                    <div style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: '10px', padding: '12px 14px', marginTop: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 900, color: '#2dd4bf', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        🔄 Repeat Boxes (after 1st trigger)
                        <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 400 }}>
                          Box 1 = initial trigger only · tick boxes to repeat while locked
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {boxes.map((_: any, bi: number) => {
                          const isBox1 = bi === 0;
                          const curIndices: number[] = (continuousLock?.repeatBoxIndices ?? []) as number[];
                          const isSelected = !isBox1 && curIndices.includes(bi);
                          return (
                            <label key={bi} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: isBox1 ? 'default' : 'pointer', opacity: isBox1 ? 0.35 : 1 }}>
                              <input
                                type="checkbox"
                                disabled={isBox1}
                                checked={isBox1 ? false : isSelected}
                                onChange={() => {
                                  if (isBox1) return;
                                  const next = isSelected
                                    ? curIndices.filter((x: number) => x !== bi)
                                    : [...curIndices, bi].sort((a, b) => a - b);
                                  setContinuousLock({ ...continuousLock, repeatBoxIndices: next });
                                }}
                                style={{ accentColor: '#14b8a6', width: '13px', height: '13px' }}
                              />
                              <span style={{ fontSize: '10px', fontWeight: 700, color: isBox1 ? '#64748b' : (isSelected ? '#2dd4bf' : '#e2e8f0') }}>
                                Box {bi + 1}{isBox1 ? ' (trigger)' : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {((continuousLock?.repeatBoxIndices ?? []) as number[]).length === 0 && (
                        <p style={{ fontSize: '9px', color: '#64748b', margin: '6px 0 0 0', fontStyle: 'italic' }}>
                          No boxes selected — bot will re-check full sequence each entry (Mode 2 default behavior)
                        </p>
                      )}
                    </div>
                  );
                })()}


                {/* Trade Pattern Config Section */}
                <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 900, color: '#e2e8f0', textTransform: 'uppercase' }}>
                        Locked Trade Pattern Loop
                      </span>
                      <span style={{ fontSize: '9px', color: '#94a3b8' }}>
                        Click cells to toggle Trade (T) ↔ Skip (S)
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const cur = continuousLock?.tradePattern || [true, false];
                          if (cur.length < 16) {
                            setContinuousLock({ ...continuousLock, tradePattern: [...cur, true] });
                          }
                        }}
                        style={{ fontSize: '9px', fontWeight: 'bold', background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                      >
                        + Add Step
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const cur = continuousLock?.tradePattern || [true, false];
                          if (cur.length > 1) {
                            setContinuousLock({ ...continuousLock, tradePattern: cur.slice(0, -1) });
                          }
                        }}
                        style={{ fontSize: '9px', fontWeight: 'bold', background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                      >
                        − Remove Step
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setContinuousLock({ ...continuousLock, tradePattern: [true, false, false, false, true, false, false, false] });
                        }}
                        style={{ fontSize: '9px', fontWeight: 'bold', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Step Buttons */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {(continuousLock?.tradePattern || [true, false]).map((isTrade, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          const updated = [...(continuousLock?.tradePattern || [true, false])];
                          updated[idx] = !updated[idx];
                          setContinuousLock({ ...continuousLock, tradePattern: updated });
                        }}
                        style={{
                          width: '36px',
                          height: '38px',
                          borderRadius: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 900,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          border: isTrade ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                          background: isTrade ? '#059669' : '#1e293b',
                          color: '#fff',
                          boxShadow: isTrade ? '0 2px 8px rgba(16, 185, 129, 0.3)' : 'none',
                        }}
                        title={`Step ${idx + 1}: ${isTrade ? 'TRADE' : 'SKIP'}`}
                      >
                        <span style={{ fontSize: '8px', opacity: 0.7, lineHeight: 1 }}>{idx + 1}</span>
                        <span style={{ fontSize: '12px', lineHeight: 1, marginTop: '2px' }}>{isTrade ? 'T' : 'S'}</span>
                      </button>
                    ))}
                  </div>

                  {/* Pattern Sequence Readout */}
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                    Loop: {(continuousLock?.tradePattern || [true, false]).map((t, i) => (
                      <span key={i}>
                        <span style={{ color: t ? '#34d399' : '#64748b', fontWeight: 'bold' }}>{t ? 'Trade' : 'Skip'}</span>
                        {i < (continuousLock?.tradePattern || []).length - 1 && ' → '}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Lock TP / SL Card ──────────────────────────────────────────── */}
                <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 900, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🎯 Lock Session TP / SL
                    <span style={{ fontSize: '9px', fontWeight: 400, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
                      — unlock &amp; rescan when hit (bot keeps running)
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {/* Lock TP */}
                    <div style={{ background: 'rgba(16,185,129,0.07)', border: `1px solid ${continuousLock?.lockTPEnabled ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '8px', padding: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 900, color: '#34d399' }}>✅ LOCK TAKE PROFIT</span>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                          <input type="checkbox" style={{ display: 'none' }}
                            checked={continuousLock?.lockTPEnabled || false}
                            onChange={e => setContinuousLock({ ...continuousLock, lockTPEnabled: e.target.checked })} />
                          <div style={{
                            width: '28px', height: '15px', borderRadius: '8px', transition: 'background 0.2s',
                            background: continuousLock?.lockTPEnabled ? '#10b981' : 'rgba(255,255,255,0.12)',
                            position: 'relative', cursor: 'pointer',
                          }}>
                            <div style={{
                              position: 'absolute', top: '2px',
                              left: continuousLock?.lockTPEnabled ? '14px' : '2px',
                              width: '11px', height: '11px', borderRadius: '50%', background: '#fff',
                              transition: 'left 0.2s',
                            }} />
                          </div>
                        </label>
                      </div>
                      {continuousLock?.lockTPEnabled && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <select
                            value={continuousLock?.lockTPMode || 'wins'}
                            onChange={e => setContinuousLock({ ...continuousLock, lockTPMode: e.target.value as 'wins' | 'profit' })}
                            style={{ background: '#0f172a', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '5px', fontSize: '10px', padding: '3px 6px', cursor: 'pointer' }}>
                            <option value="wins">Wins</option>
                            <option value="profit">$ Profit</option>
                          </select>
                          <input
                            type="number" min={1} step={continuousLock?.lockTPMode === 'profit' ? 0.1 : 1}
                            value={continuousLock?.lockTP ?? 3}
                            onChange={e => setContinuousLock({ ...continuousLock, lockTP: Math.max(0.01, parseFloat(e.target.value) || 1) })}
                            style={{ width: '56px', background: '#0f172a', color: '#34d399', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '5px', fontSize: '11px', fontWeight: 'bold', padding: '3px 6px', textAlign: 'center' }} />
                          <span style={{ fontSize: '9px', color: '#64748b' }}>
                            {continuousLock?.lockTPMode === 'profit' ? '$ profit → unlock' : 'wins → unlock'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Lock SL */}
                    <div style={{ background: 'rgba(239,68,68,0.07)', border: `1px solid ${continuousLock?.lockSLEnabled ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '8px', padding: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 900, color: '#f87171' }}>🛡️ LOCK STOP LOSS</span>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                          <input type="checkbox" style={{ display: 'none' }}
                            checked={continuousLock?.lockSLEnabled || false}
                            onChange={e => setContinuousLock({ ...continuousLock, lockSLEnabled: e.target.checked })} />
                          <div style={{
                            width: '28px', height: '15px', borderRadius: '8px', transition: 'background 0.2s',
                            background: continuousLock?.lockSLEnabled ? '#ef4444' : 'rgba(255,255,255,0.12)',
                            position: 'relative', cursor: 'pointer',
                          }}>
                            <div style={{
                              position: 'absolute', top: '2px',
                              left: continuousLock?.lockSLEnabled ? '14px' : '2px',
                              width: '11px', height: '11px', borderRadius: '50%', background: '#fff',
                              transition: 'left 0.2s',
                            }} />
                          </div>
                        </label>
                      </div>
                      {continuousLock?.lockSLEnabled && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <select
                            value={continuousLock?.lockSLMode || 'losses'}
                            onChange={e => setContinuousLock({ ...continuousLock, lockSLMode: e.target.value as 'losses' | 'loss' })}
                            style={{ background: '#0f172a', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '5px', fontSize: '10px', padding: '3px 6px', cursor: 'pointer' }}>
                            <option value="losses">Losses</option>
                            <option value="loss">$ Loss</option>
                          </select>
                          <input
                            type="number" min={1} step={continuousLock?.lockSLMode === 'loss' ? 0.1 : 1}
                            value={continuousLock?.lockSL ?? 3}
                            onChange={e => setContinuousLock({ ...continuousLock, lockSL: Math.max(0.01, parseFloat(e.target.value) || 1) })}
                            style={{ width: '56px', background: '#0f172a', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '5px', fontSize: '11px', fontWeight: 'bold', padding: '3px 6px', textAlign: 'center' }} />
                          <span style={{ fontSize: '9px', color: '#64748b' }}>
                            {continuousLock?.lockSLMode === 'loss' ? '$ loss → unlock' : 'losses → unlock'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}


            {showVirtualPanel && (
              <div className="lp-vp">
                <div className="lp-vp-hdr">
                  <span className="lp-vp-title">🧪 VIRTUAL SYSTEM</span>
                  <span className={`lp-vp-badge ${virtualSettings.isVirtualMode ? 'lp-vp-badge--virtual' : 'lp-vp-badge--real'}`}>
                    {virtualSettings.isVirtualMode ? '● VIRTUAL TRACKING ACTIVE' : '● REAL EXECUTION ACTIVE'}
                  </span>
                  <button
                    className={`lp-vp-force-btn ${virtualSettings.isVirtualMode ? 'lp-vp-force-btn--toreal' : 'lp-vp-force-btn--tovirt'}`}
                    onClick={() => setVirtualSettings({ isVirtualMode: !virtualSettings.isVirtualMode })}>
                    {virtualSettings.isVirtualMode ? '→ SWITCH TO REAL' : '→ SWITCH TO VIRTUAL'}
                  </button>
                </div>

                {adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled && (
                  <div style={{
                    background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <span style={{ fontSize: '15px' }}>🔒</span>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#fbbf24' }}>
                        Virtual System Locked by Switcher
                      </div>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
                        Virtual Trade Switcher is active in the Switcher settings. Standard virtual triggers and double virtual gates are locked to prevent collisions.
                      </div>
                    </div>
                  </div>
                )}

                <div className="lp-vp-grid" style={adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}>
                  <div className="lp-vp-card">
                    <div className="lp-vp-card-hdr">
                      <span className="lp-vp-card-lbl">Start Virtual → Switch to Real</span>
                      <label className="lp-vp-sw">
                        <input type="checkbox" checked={virtualSettings.startVirtualToReal}
                          onChange={e => setVirtualSettings({ startVirtualToReal: e.target.checked })} />
                        <span className="lp-vp-sw-track" />
                      </label>
                    </div>
                    {virtualSettings.startVirtualToReal && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '6px' }}>
                        {/* Double Virtual Toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(124, 58, 237, 0.08)', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(124, 58, 237, 0.2)' }}>
                          <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#c4b5fd' }}>⚡ Double Virtual (2-Stage Cascade)</span>
                          <label className="lp-vp-sw">
                            <input type="checkbox" checked={!!virtualSettings.isDoubleVirtual}
                              onChange={e => setVirtualSettings({ isDoubleVirtual: e.target.checked, vDoubleStage: 'A', vStageBCompletedReps: 0 })} />
                            <span className="lp-vp-sw-track" style={{ background: virtualSettings.isDoubleVirtual ? '#7c3aed' : '' }} />
                          </label>
                        </div>

                        {/* Stage A Controls */}
                        <div className="lp-vp-sub" style={{ flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                          <span className="lp-vp-sub-lbl">{virtualSettings.isDoubleVirtual ? 'Stage A Gate:' : 'Trigger on:'}</span>
                          <select className="lp-sel" value={virtualSettings.vTriggerType}
                            onChange={e => setVirtualSettings({ vTriggerType: e.target.value as any })}>
                            <option value="wins">Wins</option>
                            <option value="losses">Losses</option>
                          </select>
                          <select className="lp-sel" value={virtualSettings.vTriggerMode}
                            onChange={e => setVirtualSettings({ vTriggerMode: e.target.value as any })}>
                            <option value="consec">Consecutive</option>
                            <option value="total">Total</option>
                          </select>
                          <span className="lp-vp-sub-lbl">Threshold:</span>
                          <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.vThreshold ?? ''}
                            onChange={e => setVirtualSettings({ vThreshold: e.target.value === '' ? ('' as any) : (+e.target.value || 0) })} />
                          
                          <button
                            type="button"
                            onClick={() => setVirtualSettings({ vInEnabled: !virtualSettings.vInEnabled })}
                            style={{
                              padding: '2px 7px',
                              borderRadius: '5px',
                              fontSize: '9px',
                              fontWeight: 800,
                              cursor: 'pointer',
                              border: virtualSettings.vInEnabled ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.15)',
                              background: virtualSettings.vInEnabled ? '#6366f1' : 'rgba(255,255,255,0.06)',
                              color: virtualSettings.vInEnabled ? '#ffffff' : '#9ca3af',
                              transition: 'all 0.2s',
                            }}
                            title="Evaluate threshold within last N virtual trades"
                          >
                            IN
                          </button>
                          {virtualSettings.vInEnabled && (
                            <>
                              <input
                                className="lp-num lp-sm"
                                type="number"
                                min={1}
                                value={virtualSettings.vInTrades ?? 5}
                                onChange={e => setVirtualSettings({ vInTrades: Math.max(1, parseInt(e.target.value) || 1) })}
                                style={{ width: '45px', borderColor: '#818cf8', textAlign: 'center' }}
                                title="Number of virtual trades window"
                              />
                              <span className="lp-vp-sub-lbl">trades</span>
                            </>
                          )}
                        </div>

                        {/* Stage B Controls (Double Virtual) */}
                        {virtualSettings.isDoubleVirtual && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(124, 58, 237, 0.06)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(124, 58, 237, 0.2)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#a78bfa' }}>STAGE B (Gate 2 & Execution Cycle):</span>
                              <span style={{ fontSize: '9px', fontWeight: 'bold', color: virtualSettings.vDoubleStage === 'B' ? '#4ade80' : '#9ca3af' }}>
                                {virtualSettings.vDoubleStage === 'B' ? `ACTIVE [Rep ${(virtualSettings.vStageBCompletedReps || 0) + 1}/${virtualSettings.vStageBReps || 1}]` : 'WAITING FOR STAGE A'}
                              </span>
                            </div>
                            <div className="lp-vp-sub" style={{ flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                              <span className="lp-vp-sub-lbl">Gate B:</span>
                              <select className="lp-sel" value={virtualSettings.vTriggerTypeB || 'wins'}
                                onChange={e => setVirtualSettings({ vTriggerTypeB: e.target.value as any })}>
                                <option value="wins">Wins</option>
                                <option value="losses">Losses</option>
                              </select>
                              <select className="lp-sel" value={virtualSettings.vTriggerModeB || 'consec'}
                                onChange={e => setVirtualSettings({ vTriggerModeB: e.target.value as any })}>
                                <option value="consec">Consecutive</option>
                                <option value="total">Total</option>
                              </select>
                              <span className="lp-vp-sub-lbl">Target:</span>
                              <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.vThresholdB ?? ''}
                                onChange={e => setVirtualSettings({ vThresholdB: e.target.value === '' ? ('' as any) : (+e.target.value || 1) })} title="Virtual Target in Stage B" />
                              <button
                                type="button"
                                onClick={() => setVirtualSettings({ vInEnabledB: !virtualSettings.vInEnabledB })}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: '5px',
                                  fontSize: '9px',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  border: virtualSettings.vInEnabledB ? '1px solid #c084fc' : '1px solid rgba(255,255,255,0.15)',
                                  background: virtualSettings.vInEnabledB ? '#9333ea' : 'rgba(255,255,255,0.06)',
                                  color: virtualSettings.vInEnabledB ? '#ffffff' : '#9ca3af',
                                  transition: 'all 0.2s',
                                }}
                                title="Evaluate Stage B threshold within last N virtual trades"
                              >
                                IN
                              </button>
                              {virtualSettings.vInEnabledB && (
                                <>
                                  <input
                                    className="lp-num lp-sm"
                                    type="number"
                                    min={1}
                                    value={virtualSettings.vInTradesB ?? 5}
                                    onChange={e => setVirtualSettings({ vInTradesB: Math.max(1, parseInt(e.target.value) || 1) })}
                                    style={{ width: '40px', borderColor: '#c084fc', textAlign: 'center' }}
                                    title="Number of Stage B virtual trades window"
                                  />
                                  <span className="lp-vp-sub-lbl">trades</span>
                                </>
                              )}
                              <span className="lp-vp-sub-lbl">→ Real Reps:</span>
                              <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.vStageBReps ?? ''}
                                onChange={e => setVirtualSettings({ vStageBReps: e.target.value === '' ? ('' as any) : (+e.target.value || 1) })} title="Real trades to run in Stage B before recycling back to Stage A" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="lp-vp-streak">
                      <span style={{ color: '#4ade80' }}>{virtualSettings.virtualWins}W</span>
                      <span style={{ color: '#f87171' }}>{virtualSettings.virtualLosses}L</span>
                      <span className="lp-vp-streak-sep">|</span>
                      <span style={{ color: '#86efac' }}>Streak {virtualSettings.vConsecWins}W / {virtualSettings.vConsecLosses}L</span>
                    </div>
                  </div>

                  {/* Smart Analysis Switch Card */}
                  <div className="lp-vp-card" style={{ border: '1px solid rgba(99, 102, 241, 0.25)', background: 'rgba(99, 102, 241, 0.04)' }}>
                    <div className="lp-vp-card-hdr">
                      <div>
                        <span className="lp-vp-card-lbl" style={{ color: '#818cf8' }}>🧠 Smart Analysis Switch</span>
                        <p style={{ fontSize: '9px', color: '#9ca3af', margin: 0 }}>Switch to Real on strict result patterns</p>
                      </div>
                      <label className="lp-vp-sw">
                        <input type="checkbox" checked={virtualSettings.smartSettings?.enabled || false}
                          onChange={e => setVirtualSettings({
                            smartSettings: {
                              ...(virtualSettings.smartSettings || {
                                enabled: false,
                                type: 'sequence' as const,
                                sequence: { step1Type: 'Wins', step1Qty: 2, step1Mode: 'consecutive', step2Type: 'Losses', step2Qty: 2, step2Mode: 'consecutive' },
                                alternating: { count: 2 }
                              }),
                              enabled: e.target.checked
                            }
                          })} />
                        <span className="lp-vp-sw-track" style={{ background: virtualSettings.smartSettings?.enabled ? '#6366f1' : '' }} />
                      </label>
                    </div>

                    {virtualSettings.smartSettings?.enabled && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '6px' }}>
                        {/* Mode Selector */}
                        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '2px', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <button
                            onClick={() => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, type: 'sequence' } })}
                            style={{ flex: 1, padding: '3px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', background: virtualSettings.smartSettings?.type === 'sequence' ? '#6366f1' : 'transparent', color: virtualSettings.smartSettings?.type === 'sequence' ? '#fff' : '#9ca3af', border: 'none', cursor: 'pointer' }}>
                            STRICT SEQUENCE
                          </button>
                          <button
                            onClick={() => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, type: 'alternating' } })}
                            style={{ flex: 1, padding: '3px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', background: virtualSettings.smartSettings?.type === 'alternating' ? '#6366f1' : 'transparent', color: virtualSettings.smartSettings?.type === 'alternating' ? '#fff' : '#9ca3af', border: 'none', cursor: 'pointer' }}>
                            ALTERNATING
                          </button>
                        </div>

                        {virtualSettings.smartSettings?.type === 'sequence' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                              {/* Stage 1 */}
                              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase' }}>Step 1 Gate</span>
                                <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
                                  <select className="lp-sel" style={{ fontSize: '9px', padding: '2px 4px' }}
                                    value={virtualSettings.smartSettings?.sequence?.step1Type || 'Wins'}
                                    onChange={e => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step1Type: e.target.value as any } } })}>
                                    <option value="Wins">Wins</option>
                                    <option value="Losses">Losses</option>
                                  </select>
                                  <input className="lp-num lp-sm" type="number" min={1} style={{ width: '40px', fontSize: '9px' }}
                                    value={virtualSettings.smartSettings?.sequence?.step1Qty || 2}
                                    onChange={e => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step1Qty: +e.target.value || 1 } } })} />
                                </div>
                                <div style={{ display: 'flex', gap: '2px', marginTop: '4px' }}>
                                  <button onClick={() => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step1Mode: 'consecutive' } } })}
                                    style={{ flex: 1, fontSize: '8px', padding: '2px', borderRadius: '3px', border: 'none', background: (virtualSettings.smartSettings?.sequence?.step1Mode || 'consecutive') === 'consecutive' ? '#6366f1' : 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer' }}>Consec</button>
                                  <button onClick={() => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step1Mode: 'total' } } })}
                                    style={{ flex: 1, fontSize: '8px', padding: '2px', borderRadius: '3px', border: 'none', background: (virtualSettings.smartSettings?.sequence?.step1Mode || 'consecutive') === 'total' ? '#6366f1' : 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer' }}>Total</button>
                                </div>
                              </div>
                              {/* Stage 2 */}
                              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase' }}>Step 2 Gate</span>
                                <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
                                  <select className="lp-sel" style={{ fontSize: '9px', padding: '2px 4px' }}
                                    value={virtualSettings.smartSettings?.sequence?.step2Type || 'Losses'}
                                    onChange={e => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step2Type: e.target.value as any } } })}>
                                    <option value="Wins">Wins</option>
                                    <option value="Losses">Losses</option>
                                  </select>
                                  <input className="lp-num lp-sm" type="number" min={1} style={{ width: '40px', fontSize: '9px' }}
                                    value={virtualSettings.smartSettings?.sequence?.step2Qty || 2}
                                    onChange={e => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step2Qty: +e.target.value || 1 } } })} />
                                </div>
                                <div style={{ display: 'flex', gap: '2px', marginTop: '4px' }}>
                                  <button onClick={() => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step2Mode: 'consecutive' } } })}
                                    style={{ flex: 1, fontSize: '8px', padding: '2px', borderRadius: '3px', border: 'none', background: (virtualSettings.smartSettings?.sequence?.step2Mode || 'consecutive') === 'consecutive' ? '#6366f1' : 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer' }}>Consec</button>
                                  <button onClick={() => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, sequence: { ...virtualSettings.smartSettings!.sequence, step2Mode: 'total' } } })}
                                    style={{ flex: 1, fontSize: '8px', padding: '2px', borderRadius: '3px', border: 'none', background: (virtualSettings.smartSettings?.sequence?.step2Mode || 'consecutive') === 'total' ? '#6366f1' : 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer' }}>Total</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase' }}>Required Alternating Patterns</span>
                              <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#818cf8' }}>{virtualSettings.smartSettings?.alternating?.count || 2} CYCLES</span>
                            </div>
                            <input type="range" min="1" max="5" value={virtualSettings.smartSettings?.alternating?.count || 2}
                              onChange={e => setVirtualSettings({ smartSettings: { ...virtualSettings.smartSettings!, alternating: { count: +e.target.value } } })}
                              style={{ width: '100%', accentColor: '#6366f1' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#6b7280', fontWeight: 'bold', marginTop: '2px' }}>
                              <span>W-L</span>
                              <span>W-L-W-L</span>
                              <span>W-L-W-L-W-L</span>
                            </div>
                          </div>
                        )}

                        {/* Stage B Controls inside Smart Analysis when Double Virtual is active */}
                        {virtualSettings.isDoubleVirtual && (
                          <div style={{
                            display: 'flex', flexDirection: 'column', gap: '6px',
                            background: 'rgba(124, 58, 237, 0.08)', padding: '8px 10px',
                            borderRadius: '6px', border: '1px solid rgba(124, 58, 237, 0.25)',
                            marginTop: '4px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#c4b5fd' }}>
                                ⚡ STAGE B (Gate 2 & Execution Cycle for Smart Pattern):
                              </span>
                              <span style={{ fontSize: '9px', fontWeight: 'bold', color: virtualSettings.vDoubleStage === 'B' ? '#4ade80' : '#9ca3af' }}>
                                {virtualSettings.vDoubleStage === 'B' ? `ACTIVE [Rep ${(virtualSettings.vStageBCompletedReps || 0) + 1}/${virtualSettings.vStageBReps || 1}]` : 'WAITING FOR STAGE A (Smart Pattern)'}
                              </span>
                            </div>
                            <div className="lp-vp-sub" style={{ flexWrap: 'wrap', gap: '4px' }}>
                              <span className="lp-vp-sub-lbl">Gate B:</span>
                              <select className="lp-sel" value={virtualSettings.vTriggerTypeB || 'wins'}
                                onChange={e => setVirtualSettings({ vTriggerTypeB: e.target.value as any })}>
                                <option value="wins">Wins</option>
                                <option value="losses">Losses</option>
                              </select>
                              <select className="lp-sel" value={virtualSettings.vTriggerModeB || 'consec'}
                                onChange={e => setVirtualSettings({ vTriggerModeB: e.target.value as any })}>
                                <option value="consec">Consecutive</option>
                                <option value="total">Total</option>
                              </select>
                              <span className="lp-vp-sub-lbl">Target:</span>
                              <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.vThresholdB ?? ''}
                                onChange={e => setVirtualSettings({ vThresholdB: e.target.value === '' ? ('' as any) : (+e.target.value || 1) })} title="Virtual Target in Stage B" />
                              <span className="lp-vp-sub-lbl">→ Real Reps:</span>
                              <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.vStageBReps ?? ''}
                                onChange={e => setVirtualSettings({ vStageBReps: e.target.value === '' ? ('' as any) : (+e.target.value || 1) })} title="Real trades to run in Stage B before recycling back to Stage A" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="lp-vp-card">
                    <div className="lp-vp-card-hdr">
                      <span className="lp-vp-card-lbl">Start Real → Switch to Virtual</span>
                      <label className="lp-vp-sw">
                        <input type="checkbox" checked={virtualSettings.startRealToVirtual}
                          onChange={e => setVirtualSettings({ startRealToVirtual: e.target.checked })} />
                        <span className="lp-vp-sw-track" />
                      </label>
                    </div>
                    {virtualSettings.startRealToVirtual && (
                      <div className="lp-vp-sub">
                        <span className="lp-vp-sub-lbl">Trigger on:</span>
                        <select className="lp-sel" value={virtualSettings.rTriggerType}
                          onChange={e => setVirtualSettings({ rTriggerType: e.target.value as any })}>
                          <option value="wins">Wins</option>
                          <option value="losses">Losses</option>
                        </select>
                        <select className="lp-sel" value={virtualSettings.rTriggerMode}
                          onChange={e => setVirtualSettings({ rTriggerMode: e.target.value as any })}>
                          <option value="consec">Consecutive</option>
                          <option value="total">Total</option>
                        </select>
                        <span className="lp-vp-sub-lbl">Threshold:</span>
                        <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.rThreshold ?? ''}
                          onChange={e => setVirtualSettings({ rThreshold: e.target.value === '' ? ('' as any) : (+e.target.value || 0) })} />
                      </div>
                    )}
                    <div className="lp-vp-streak">
                      <span style={{ color: '#4ade80' }}>{virtualSettings.realWins}W</span>
                      <span style={{ color: '#f87171' }}>{virtualSettings.realLosses}L</span>
                      <span className="lp-vp-streak-sep">|</span>
                      <span style={{ color: '#86efac' }}>Streak {virtualSettings.rConsecWins}W / {virtualSettings.rConsecLosses}L</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showSwitcherPanel && (
              <div className="lp-sw-panel">
                <div className="lp-sw-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="lp-sw-title" style={{ fontSize: '15px', fontWeight: 'bold' }}>⚡ SWITCHER (Adaptive Contracts)</span>
                    <label className="lp-vp-sw">
                      <input type="checkbox" checked={adaptiveSwitch.enabled}
                        onChange={e => setAdaptiveSwitch({ ...adaptiveSwitch, enabled: e.target.checked })} />
                      <span className="lp-vp-sw-track" />
                    </label>
                  </div>
                  {(adaptiveSwitch.mode || 'sequence') === 'sequence' && (
                    <button
                      className="lp-sw-add-step"
                      onClick={() => setAdaptiveSwitch({
                        ...adaptiveSwitch,
                        steps: [...adaptiveSwitch.steps, { contractType: 'DIGITEVEN', reps: 2 }],
                      })}
                    >
                      + Add Step
                    </button>
                  )}
                </div>

                <div className="lp-sw-desc" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px', marginBottom: '10px' }}>
                  {(adaptiveSwitch.mode || 'sequence') === 'adaptive'
                    ? 'Automatically inter-switches between Contract A and Contract B on loss to target the winning side.'
                    : 'Adaptive Switch mode overrides strategy trade types using a step-by-step cycle. On win, it advances reps or moves to next step.'}
                </div>

                {/* ─── VIRTUAL TRADE SWITCHER ─── */}
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
                    const nextVS = { ...vs, ...patch };
                    setAdaptiveSwitch({
                      ...adaptiveSwitch,
                      // If VS is being enabled, also enable the outer adaptive switch
                      enabled: nextVS.enabled ? true : adaptiveSwitch.enabled,
                      virtualSwitcher: nextVS,
                    });
                  };
                  const updateVirtContract = (patch: Partial<typeof vs.virtualContract>) => {
                    const normPatch = patch.contractType
                      ? { ...patch, contractType: normalizeContractType(patch.contractType) }
                      : patch;
                    updateVS({ virtualContract: { ...vs.virtualContract, ...normPatch } });
                  };
                  const updateWinRule  = (patch: Partial<typeof vs.onVirtualWins>) => {
                    const normPatch = patch.contractType
                      ? { ...patch, contractType: normalizeContractType(patch.contractType) }
                      : patch;
                    updateVS({ onVirtualWins:   { ...vs.onVirtualWins,   ...normPatch } });
                  };
                  const updateLossRule = (patch: Partial<typeof vs.onVirtualLosses>) => {
                    const normPatch = patch.contractType
                      ? { ...patch, contractType: normalizeContractType(patch.contractType) }
                      : patch;
                    updateVS({ onVirtualLosses: { ...vs.onVirtualLosses, ...normPatch } });
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


                  const winNeedsBarrier = needsBarrier(vs.onVirtualWins?.contractType || 'DIGITUNDER');
                  const lossNeedsBarrier = needsBarrier(vs.onVirtualLosses?.contractType || 'DIGITOVER');
                  const virtNeedsBarrier = needsBarrier(vs.virtualContract?.contractType || 'DIGITEVEN');

                  const activeContractLbl = vs._activeContract
                    ? (TRADE_OPTIONS.find(o => o.value === vs._activeContract!.contractType)?.label || vs._activeContract!.contractType)
                    : null;

                  return (
                    <div style={{
                      margin: '0 0 12px 0', border: '1px solid rgba(251,191,36,0.3)',
                      borderRadius: '8px', background: 'rgba(251,191,36,0.04)', padding: '12px',
                    }}>
                      {/* Header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: vs.enabled ? '12px' : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fbbf24', letterSpacing: '0.5px' }}>
                            🎯 VIRTUAL TRADE SWITCHER
                          </span>
                          {vs.enabled && (
                            <span style={{
                              fontSize: '9px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px',
                              background: vs._phase === 'real' ? 'rgba(74,222,128,0.15)' : vs._phase === 'gate_b' ? 'rgba(251,146,60,0.15)' : 'rgba(168,85,247,0.15)',
                              color: vs._phase === 'real' ? '#4ade80' : vs._phase === 'gate_b' ? '#fb923c' : '#c084fc',
                              border: `1px solid ${vs._phase === 'real' ? 'rgba(74,222,128,0.3)' : vs._phase === 'gate_b' ? 'rgba(251,146,60,0.3)' : 'rgba(168,85,247,0.3)'}`,
                            }}>
                              {vs._phase === 'real' ? `● REAL TRADING (${activeContractLbl || 'ACTIVE'})` : vs._phase === 'gate_b' ? `🔷 GATE B (${activeContractLbl || 'LOCKED'})` : '● VIRTUAL TESTING ACTIVE'}
                            </span>
                          )}
                        </div>
                        <label className="lp-vp-sw">
                          <input type="checkbox" checked={!!vs.enabled}
                            onChange={e => updateVS({ enabled: e.target.checked })} />
                          <span className="lp-vp-sw-track" style={{ background: vs.enabled ? '#fbbf24' : '' }} />
                        </label>
                      </div>

                      {vs.enabled && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {/* Live telemetry banner */}
                          <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                            padding: '6px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)',
                            fontSize: '10px'
                          }}>
                            <div style={{ display: 'flex', gap: '12px' }}>
                              <span style={{ color: '#4ade80', fontWeight: 'bold' }}>
                                ✓ V-Wins: {vs._totalWins || 0} (streak: {vs._consecWins || 0})
                              </span>
                              <span style={{ color: '#f87171', fontWeight: 'bold' }}>
                                ✕ V-Losses: {vs._totalLosses || 0} (streak: {vs._consecLosses || 0})
                              </span>
                            </div>
                            {vs._phase === 'real' && (
                              <span style={{ color: '#22d3ee', fontWeight: 'bold' }}>
                                ⚡ Real Count: {vs.returnToVirtual?.triggerType === 'wins' ? vs._rConsecWins || 0 : vs.returnToVirtual?.triggerType === 'losses' ? vs._rConsecLosses || 0 : vs._rTotalTrades || 0}/{vs.returnToVirtual?.threshold || 1} {vs.returnToVirtual?.triggerType}
                              </span>
                            )}
                            {vs._phase === 'gate_b' && (
                              <span style={{ color: '#fb923c', fontWeight: 'bold' }}>
                                🔷 Gate B: {vs.gateB?.triggerType === 'wins' ? (vs.gateB?.mode === 'consec' ? vs._gateBConsecWins || 0 : vs._gateBTotalWins || 0) : vs.gateB?.triggerType === 'losses' ? (vs.gateB?.mode === 'consec' ? vs._gateBConsecLosses || 0 : vs._gateBTotalLosses || 0) : vs._gateBTotalTrades || 0}/{vs.gateB?.threshold || 2} {vs.gateB?.triggerType}
                              </span>
                            )}
                          </div>

                          {/* Section 1: Virtual Test Contract */}
                          <div style={{
                            background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)',
                            borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#c084fc' }}>
                                🧪 VIRTUAL TEST CONTRACT
                              </span>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>
                                Simulated in Virtual Phase
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)' }}>Test Contract:</span>
                              <select className="lp-sel" style={{ height: '24px', fontSize: '10px', flex: 1, minWidth: '110px' }}
                                value={vs.virtualContract?.contractType || 'DIGITEVEN'}
                                onChange={e => updateVirtContract({ contractType: e.target.value })}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                              </select>
                              {virtNeedsBarrier && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontSize: '9px', color: '#f59e0b', fontWeight: 'bold' }}>Bar:</span>
                                  <input className="lp-num" type="number" min={0} max={9}
                                    value={vs.virtualContract?.barrier ?? 4}
                                    style={{ width: '32px', height: '24px', fontSize: '11px', textAlign: 'center' }}
                                    onChange={e => updateVirtContract({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })} />
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks:</span>
                                <input className="lp-num" type="number" min={1} max={100}
                                  value={isLockMode1 ? 1 : (vs.virtualContract?.ticks ?? 1)}
                                  disabled={isLockMode1}
                                  style={{ width: '34px', height: '24px', fontSize: '11px', textAlign: 'center', opacity: isLockMode1 ? 0.5 : 1 }}
                                  onChange={e => updateVirtContract({ ticks: Math.max(1, +e.target.value || 1) })} />
                                {isLockMode1 && <span style={{ fontSize: '8px', color: '#f59e0b', fontWeight: 'bold' }}>Pattern</span>}
                              </div>
                            </div>
                          </div>

                          {/* Section 2: Virtual Wins Rule (Switch to Real) */}
                          <div style={{
                            background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)',
                            borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px',
                          }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#4ade80' }}>
                                🏆 ON VIRTUAL WINS →
                              </span>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>After</span>
                              <input className="lp-num" type="number" min={1} max={99}
                                value={vs.onVirtualWins?.threshold ?? 3}
                                style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                onChange={e => updateWinRule({ threshold: Math.max(1, +e.target.value || 1) })} />
                              <div style={{ display: 'flex', gap: '2px' }}>
                                {(['consec', 'total'] as const).map(m => (
                                  <button key={m} type="button" onClick={() => updateWinRule({ mode: m })} style={{
                                    fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: (vs.onVirtualWins?.mode || 'consec') === m ? '#4ade80' : 'rgba(255,255,255,0.07)',
                                    color: (vs.onVirtualWins?.mode || 'consec') === m ? '#000' : 'rgba(255,255,255,0.5)',
                                  }}>
                                    {m === 'consec' ? 'Consecutive' : 'Total'}
                                  </button>
                                ))}
                              </div>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>Wins</span>
                            </div>

                            {/* Target Real Contract */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>→ Trade Real:</span>
                              <select className="lp-sel" style={{ height: '24px', fontSize: '10px', flex: 1, minWidth: '110px' }}
                                value={vs.onVirtualWins?.contractType || 'DIGITUNDER'}
                                onChange={e => updateWinRule({ contractType: e.target.value })}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                              </select>
                              {winNeedsBarrier && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontSize: '9px', color: '#f59e0b', fontWeight: 'bold' }}>Bar:</span>
                                  <input className="lp-num" type="number" min={0} max={9}
                                    value={vs.onVirtualWins?.barrier ?? 4}
                                    style={{ width: '30px', height: '24px', fontSize: '11px', textAlign: 'center' }}
                                    onChange={e => updateWinRule({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })} />
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks:</span>
                                <input className="lp-num" type="number" min={1} max={100}
                                  value={isLockMode1 ? 1 : (vs.onVirtualWins?.ticks ?? 1)}
                                  disabled={isLockMode1}
                                  style={{ width: '32px', height: '24px', fontSize: '11px', textAlign: 'center', opacity: isLockMode1 ? 0.5 : 1 }}
                                  onChange={e => updateWinRule({ ticks: Math.max(1, +e.target.value || 1) })} />
                                {isLockMode1 && <span style={{ fontSize: '8px', color: '#f59e0b', fontWeight: 'bold' }}>Pattern</span>}
                              </div>
                            </div>

                            {/* Market override */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Market Override:</span>
                              <select className="lp-sel" style={{ height: '22px', fontSize: '10px', flex: 1 }}
                                value={vs.onVirtualWins?.market || ''}
                                onChange={e => updateWinRule({ market: e.target.value || undefined })}>
                                <option value="">— Same active market —</option>
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* Section 3: Virtual Losses Rule (Switch to Real) */}
                          <div style={{
                            background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)',
                            borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px',
                          }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#f87171' }}>
                                🛑 ON VIRTUAL LOSSES →
                              </span>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>After</span>
                              <input className="lp-num" type="number" min={1} max={99}
                                value={vs.onVirtualLosses?.threshold ?? 3}
                                style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                onChange={e => updateLossRule({ threshold: Math.max(1, +e.target.value || 1) })} />
                              <div style={{ display: 'flex', gap: '2px' }}>
                                {(['consec', 'total'] as const).map(m => (
                                  <button key={m} type="button" onClick={() => updateLossRule({ mode: m })} style={{
                                    fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: (vs.onVirtualLosses?.mode || 'consec') === m ? '#f87171' : 'rgba(255,255,255,0.07)',
                                    color: (vs.onVirtualLosses?.mode || 'consec') === m ? '#000' : 'rgba(255,255,255,0.5)',
                                  }}>
                                    {m === 'consec' ? 'Consecutive' : 'Total'}
                                  </button>
                                ))}
                              </div>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>Losses</span>
                            </div>

                            {/* Target Real Contract */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>→ Trade Real:</span>
                              <select className="lp-sel" style={{ height: '24px', fontSize: '10px', flex: 1, minWidth: '110px' }}
                                value={vs.onVirtualLosses?.contractType || 'DIGITOVER'}
                                onChange={e => updateLossRule({ contractType: e.target.value })}>
                                {TRADE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                              </select>
                              {lossNeedsBarrier && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontSize: '9px', color: '#f59e0b', fontWeight: 'bold' }}>Bar:</span>
                                  <input className="lp-num" type="number" min={0} max={9}
                                    value={vs.onVirtualLosses?.barrier ?? 5}
                                    style={{ width: '30px', height: '24px', fontSize: '11px', textAlign: 'center' }}
                                    onChange={e => updateLossRule({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })} />
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks:</span>
                                <input className="lp-num" type="number" min={1} max={100}
                                  value={isLockMode1 ? 1 : (vs.onVirtualLosses?.ticks ?? 1)}
                                  disabled={isLockMode1}
                                  style={{ width: '32px', height: '24px', fontSize: '11px', textAlign: 'center', opacity: isLockMode1 ? 0.5 : 1 }}
                                  onChange={e => updateLossRule({ ticks: Math.max(1, +e.target.value || 1) })} />
                                {isLockMode1 && <span style={{ fontSize: '8px', color: '#f59e0b', fontWeight: 'bold' }}>Pattern</span>}
                              </div>
                            </div>

                            {/* Market override */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Market Override:</span>
                              <select className="lp-sel" style={{ height: '22px', fontSize: '10px', flex: 1 }}
                                value={vs.onVirtualLosses?.market || ''}
                                onChange={e => updateLossRule({ market: e.target.value || undefined })}>
                                <option value="">— Same active market —</option>
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* Section 3.5: Gate B — Additional virtual confirmation gate after Gate A */}
                          <div style={{
                            background: 'rgba(251,146,60,0.05)', border: '1px solid rgba(251,146,60,0.25)',
                            borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#fb923c' }}>
                                  🔷 GATE B
                                </span>
                                <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                                  (additional virtual confirmation after Gate A)
                                </span>
                              </div>
                              <label className="lp-vp-sw">
                                <input type="checkbox" checked={!!vs.gateB?.enabled}
                                  onChange={e => updateGateB({ enabled: e.target.checked })} />
                                <span className="lp-vp-sw-track" style={{ background: vs.gateB?.enabled ? '#fb923c' : '' }} />
                              </label>
                            </div>
                            {vs.gateB?.enabled && (
                              <>
                                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.4' }}>
                                  After Gate A fires and locks a contract, Gate B keeps trading it <strong style={{ color: '#fb923c' }}>virtually</strong> until its own condition is met — then switches to REAL. The contract never changes during Gate B.
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>Go REAL after</span>
                                  <input className="lp-num" type="number" min={1} max={99}
                                    value={vs.gateB?.threshold ?? 2}
                                    style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                    onChange={e => updateGateB({ threshold: Math.max(1, +e.target.value || 1) })} />
                                  <div style={{ display: 'flex', gap: '2px' }}>
                                    {(['consec', 'total'] as const).map(m => (
                                      <button key={m} type="button" onClick={() => updateGateB({ mode: m })} style={{
                                        fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                        background: (vs.gateB?.mode || 'consec') === m ? '#fb923c' : 'rgba(255,255,255,0.07)',
                                        color: (vs.gateB?.mode || 'consec') === m ? '#000' : 'rgba(255,255,255,0.5)',
                                      }}>
                                        {m === 'consec' ? 'Consecutive' : 'Total'}
                                      </button>
                                    ))}
                                  </div>
                                  <select className="lp-sel" style={{ height: '22px', fontSize: '10px' }}
                                    value={vs.gateB?.triggerType || 'losses'}
                                    onChange={e => updateGateB({ triggerType: e.target.value as any })}>
                                    <option value="wins">Wins</option>
                                    <option value="losses">Losses</option>
                                    <option value="trades">Trades</option>
                                  </select>
                                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>in virtual</span>
                                </div>
                                {vs._phase === 'gate_b' && (
                                  <div style={{ fontSize: '9px', color: '#fb923c', fontWeight: 'bold', padding: '3px 6px', background: 'rgba(251,146,60,0.1)', borderRadius: '4px' }}>
                                    🔷 ACTIVE: {vs._gateBConsecWins || 0}W streak / {vs._gateBConsecLosses || 0}L streak (total {vs._gateBTotalWins || 0}W / {vs._gateBTotalLosses || 0}L)
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Section 4: Return to Virtual Setting */}
                          <div style={{
                            background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
                            borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#a5b4fc' }}>
                                🔄 RETURN TO VIRTUAL (REAL EXIT)
                              </span>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>
                                Reverts to virtual cycle
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)' }}>Switch back after:</span>
                              <input className="lp-num" type="number" min={1} max={99}
                                value={vs.returnToVirtual?.threshold ?? 3}
                                style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                onChange={e => updateReturnRule({ threshold: Math.max(1, +e.target.value || 1) })} />
                              <select className="lp-sel" style={{ height: '22px', fontSize: '10px' }}
                                value={vs.returnToVirtual?.mode || 'consec'}
                                onChange={e => updateReturnRule({ mode: e.target.value as any })}>
                                <option value="consec">Consecutive</option>
                                <option value="total">Total</option>
                              </select>
                              <select className="lp-sel" style={{ height: '22px', fontSize: '10px' }}
                                value={vs.returnToVirtual?.triggerType || 'wins'}
                                onChange={e => updateReturnRule({ triggerType: e.target.value as any })}>
                                <option value="wins">Wins</option>
                                <option value="losses">Losses</option>
                                <option value="trades">Trades</option>
                              </select>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)' }}>in Real Mode</span>
                            </div>
                            <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                              Once hit, Deriv automatically reverts to Virtual testing, resetting streak counters for the next run.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {(adaptiveSwitch.enabled && adaptiveSwitch.virtualSwitcher?.enabled) ? (
                  <div style={{
                    padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)', fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '12px',
                  }}>
                    <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>🔒 Standard Switcher Modes Paused: </span>
                    Adaptive Contracts and Sequence Steps are inactive while Virtual Trade Switcher is running.
                  </div>
                ) : (
                  <>
                {/* Switcher Mode Tabs (Sequence Steps vs Adaptive Auto-Switch vs Manual Contracts) */}
                <div style={{ display: 'flex', gap: '6px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '8px', marginBottom: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setAdaptiveSwitch({ ...adaptiveSwitch, mode: 'sequence' })}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 'bold',
                      background: (adaptiveSwitch.mode || 'sequence') === 'sequence' ? '#7c3aed' : 'transparent',
                      color: (adaptiveSwitch.mode || 'sequence') === 'sequence' ? '#ffffff' : 'rgba(255,255,255,0.6)',
                      border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    📋 SEQUENCE STEPS
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdaptiveSwitch({ ...adaptiveSwitch, mode: 'adaptive' })}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 'bold',
                      background: adaptiveSwitch.mode === 'adaptive' ? '#7c3aed' : 'transparent',
                      color: adaptiveSwitch.mode === 'adaptive' ? '#ffffff' : 'rgba(255,255,255,0.6)',
                      border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    ⚡ ADAPTIVE CONTRACTS
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdaptiveSwitch({ ...adaptiveSwitch, mode: 'manual' })}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 'bold',
                      background: adaptiveSwitch.mode === 'manual' ? '#0284c7' : 'transparent',
                      color: adaptiveSwitch.mode === 'manual' ? '#ffffff' : 'rgba(255,255,255,0.6)',
                      border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    🎛️ MANUAL CONTRACTS
                  </button>
                </div>

                {/* Dual Mode Switcher Toggle */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(124, 58, 237, 0.06)',
                  border: '1px solid rgba(124, 58, 237, 0.18)',
                  gap: '12px',
                  marginBottom: '12px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#c4b5fd', letterSpacing: '0.5px' }}>⚡ DUAL CONTRACTS SYSTEM</span>
                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>Fires exactly 2 contracts on the same tick. Martingale only acts on both-loss.</span>
                  </div>
                  <label className="lp-vp-sw" style={{ marginLeft: 'auto' }}>
                    <input type="checkbox" checked={!!adaptiveSwitch.dualMode}
                      onChange={e => setAdaptiveSwitch({ ...adaptiveSwitch, dualMode: e.target.checked })} />
                    <span className="lp-vp-sw-track" style={{ background: adaptiveSwitch.dualMode ? '#7c3aed' : '' }} />
                  </label>
                </div>

                {/* ADAPTIVE CONTRACTS (AUTO-SWITCH ON LOSS) PANEL */}
                {adaptiveSwitch.mode === 'adaptive' && (() => {
                  const ac = adaptiveSwitch.adaptiveContracts || {
                    contractA: { type: 'DIGITEVEN', barrier: 4, ticks: 5 },
                    contractB: { type: 'DIGITODD', barrier: 4, ticks: 5 },
                    activeSide: 'A',
                    startSide: 'A',
                  };
                  const activeSide = ac.activeSide || ac.startSide || 'A';
                  const startSide = ac.startSide || 'A';

                  const updateAC = (patch: Partial<typeof ac>) => {
                    setAdaptiveSwitch({
                      ...adaptiveSwitch,
                      adaptiveContracts: { ...ac, ...patch },
                    });
                  };

                  return (
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: '10px',
                      padding: '12px', background: 'rgba(124, 58, 237, 0.05)',
                      borderRadius: '8px', border: '1px solid rgba(124, 58, 237, 0.2)',
                      marginBottom: '12px'
                    }}>
                      {/* Active Status Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#c4b5fd' }}>AUTO-SWITCH ON LOSS</span>
                          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>Targets winning side. Switches instantly when a loss occurs.</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#4ade80', background: 'rgba(74,222,128,0.12)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(74,222,128,0.3)' }}>
                            ● ACTIVE: CONTRACT {activeSide}
                          </span>
                          <button
                            onClick={() => updateAC({ activeSide: activeSide === 'A' ? 'B' : 'A' })}
                            style={{ fontSize: '9px', fontWeight: 'bold', background: 'rgba(255,255,255,0.08)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            ⇌ Switch Now
                          </button>
                        </div>
                      </div>

                      {/* Start Side Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>Start Side:</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            onClick={() => updateAC({ startSide: 'A', activeSide: 'A' })}
                            style={{ fontSize: '9px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '4px', border: 'none', background: startSide === 'A' ? '#6366f1' : 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}
                          >
                            Contract A
                          </button>
                          <button
                            onClick={() => updateAC({ startSide: 'B', activeSide: 'B' })}
                            style={{ fontSize: '9px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '4px', border: 'none', background: startSide === 'B' ? '#6366f1' : 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}
                          >
                            Contract B
                          </button>
                        </div>
                      </div>

                      {/* Contract A & B Configuration Cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        {/* Contract A */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', background: activeSide === 'A' ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.02)', borderRadius: '6px', border: activeSide === 'A' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)' }}>
                          <span style={{ fontSize: '10px', fontWeight: 'bold', color: activeSide === 'A' ? '#818cf8' : '#9ca3af' }}>
                            CONTRACT A {activeSide === 'A' ? '(CURRENTLY TRADING)' : ''}
                          </span>
                          <select
                            className="lp-sel"
                            style={{ height: '26px', fontSize: '11px', padding: '0 4px', width: '100%' }}
                            value={ac.contractA?.type || 'DIGITEVEN'}
                            onChange={e => updateAC({ contractA: { ...ac.contractA, type: e.target.value } })}
                          >
                            {TRADE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {needsBarrier(ac.contractA?.type || 'DIGITEVEN') && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>Barrier:</span>
                              <input
                                className="lp-num"
                                type="number" min={0} max={9}
                                value={ac.contractA?.barrier ?? 4}
                                style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                onChange={e => updateAC({ contractA: { ...ac.contractA, barrier: Math.min(9, Math.max(0, +e.target.value || 0)) } })}
                              />
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks:</span>
                            <input
                              className="lp-num"
                              type="number" min={1} max={100}
                              value={ac.contractA?.ticks ?? 5}
                              style={{ width: '36px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                              onChange={e => updateAC({ contractA: { ...ac.contractA, ticks: Math.max(1, +e.target.value || 1) } })}
                            />
                          </div>
                        </div>

                        {/* Contract B */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', background: activeSide === 'B' ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.02)', borderRadius: '6px', border: activeSide === 'B' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)' }}>
                          <span style={{ fontSize: '10px', fontWeight: 'bold', color: activeSide === 'B' ? '#818cf8' : '#9ca3af' }}>
                            CONTRACT B {activeSide === 'B' ? '(CURRENTLY TRADING)' : ''}
                          </span>
                          <select
                            className="lp-sel"
                            style={{ height: '26px', fontSize: '11px', padding: '0 4px', width: '100%' }}
                            value={ac.contractB?.type || 'DIGITODD'}
                            onChange={e => updateAC({ contractB: { ...ac.contractB, type: e.target.value } })}
                          >
                            {TRADE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {needsBarrier(ac.contractB?.type || 'DIGITODD') && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>Barrier:</span>
                              <input
                                className="lp-num"
                                type="number" min={0} max={9}
                                value={ac.contractB?.barrier ?? 4}
                                style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                onChange={e => updateAC({ contractB: { ...ac.contractB, barrier: Math.min(9, Math.max(0, +e.target.value || 0)) } })}
                              />
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks:</span>
                            <input
                              className="lp-num"
                              type="number" min={1} max={100}
                              value={ac.contractB?.ticks ?? 5}
                              style={{ width: '36px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                              onChange={e => updateAC({ contractB: { ...ac.contractB, ticks: Math.max(1, +e.target.value || 1) } })}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                                {/* MANUAL CONTRACTS (QUICK HUD SWITCHER) PANEL */}
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

                  const updateMC = (patch: Partial<typeof mc>) => {
                    setAdaptiveSwitch({
                      ...adaptiveSwitch,
                      manualContracts: { ...mc, ...patch },
                    });
                  };

                  const contractsList = getManualContractList(mc);

                  return (
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: '10px',
                      padding: '12px', background: 'rgba(2, 132, 199, 0.06)',
                      borderRadius: '8px', border: '1px solid rgba(2, 132, 199, 0.25)',
                      marginBottom: '12px'
                    }}>
                      {/* Active Status Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#38bdf8' }}>🎛️ MANUAL HUD CONTRACTS</span>
                          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>
                            Configure contracts below. Switch between them on-the-fly while running via the Quick HUD.
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                            ● ACTIVE: CONTRACT {activeSide}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const nextSide = activeSide === 'A' ? 'B' : 'A';
                              updateMC({ activeSide: nextSide });
                            }}
                            style={{ fontSize: '9px', fontWeight: 'bold', background: 'rgba(255,255,255,0.08)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            ⇌ Switch
                          </button>
                        </div>
                      </div>

                      {/* Virtual Switch Behavior Setting */}
                      <div style={{
                        background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '6px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: '#e2e8f0', fontWeight: 'bold' }}>
                            Virtual HUD Switch Behavior:
                          </span>
                          <span style={{ fontSize: '9px', color: virtualBehavior === 'switch_to_real' ? '#fbbf24' : '#94a3b8', fontWeight: 600 }}>
                            {virtualBehavior === 'switch_to_real' ? '⚡ Switch to Real on click' : '🧪 Stay in Virtual mode'}
                          </span>
                        </div>
                        <p style={{ fontSize: '9px', color: '#94a3b8', margin: 0, lineHeight: 1.3 }}>
                          What happens when clicking a contract button in Quick HUD while in Virtual Mode:
                        </p>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => updateMC({ onSwitchVirtualBehavior: 'stay_virtual' })}
                            style={{
                              flex: 1, padding: '4px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold',
                              background: virtualBehavior === 'stay_virtual' ? '#6366f1' : 'rgba(255,255,255,0.05)',
                              color: '#fff', border: virtualBehavior === 'stay_virtual' ? '1px solid #818cf8' : '1px solid rgba(255,255,255,0.1)',
                              cursor: 'pointer'
                            }}
                          >
                            STAY VIRTUAL
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMC({ onSwitchVirtualBehavior: 'switch_to_real' })}
                            style={{
                              flex: 1, padding: '4px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold',
                              background: virtualBehavior === 'switch_to_real' ? '#f59e0b' : 'rgba(255,255,255,0.05)',
                              color: virtualBehavior === 'switch_to_real' ? '#000' : '#fff',
                              border: virtualBehavior === 'switch_to_real' ? '1px solid #fbbf24' : '1px solid rgba(255,255,255,0.1)',
                              cursor: 'pointer'
                            }}
                          >
                            SWITCH TO REAL
                          </button>
                        </div>
                      </div>

                      {/* Start Side Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>Start Side:</span>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {contractsList.map((c, idx) => (
                            <button
                              key={c.id || idx}
                              type="button"
                              onClick={() => updateMC({ startSide: c.id, activeSide: c.id })}
                              style={{
                                fontSize: '9px', fontWeight: 'bold', padding: '3px 8px', borderRadius: '4px',
                                border: 'none', background: startSide === c.id ? '#0284c7' : 'rgba(255,255,255,0.06)',
                                color: '#fff', cursor: 'pointer'
                              }}
                            >
                              {c.label || `Contract ${c.id}`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Contracts Cards Grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: contractsList.length === 2 ? '1fr 1fr' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                        {contractsList.map((c, idx) => {
                          const isA = idx === 0;
                          const isB = idx === 1;
                          const isCurActive = (c.id === activeSide) || (isA && activeSide === 'A') || (isB && activeSide === 'B');

                          const updateThisContract = (patch: any) => {
                            if (isA) {
                              updateMC({ contractA: { ...mc.contractA, ...patch } });
                            } else if (isB) {
                              updateMC({ contractB: { ...mc.contractB, ...patch } });
                            }
                            if (mc.contracts) {
                              const nextC = [...mc.contracts];
                              nextC[idx] = { ...nextC[idx], ...patch };
                              updateMC({ contracts: nextC });
                            }
                          };

                          return (
                            <div
                              key={c.id || idx}
                              style={{
                                display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px',
                                background: isCurActive ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255,255,255,0.02)',
                                borderRadius: '6px',
                                border: isCurActive ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '10px', fontWeight: 'bold', color: isCurActive ? '#38bdf8' : '#9ca3af' }}>
                                  {c.label || `CONTRACT ${c.id}`} {isCurActive ? '✓ (ACTIVE)' : ''}
                                </span>
                                {contractsList.length > 2 && idx >= 2 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextC = (mc.contracts || contractsList).filter((_, i) => i !== idx);
                                      updateMC({ contracts: nextC, activeSide: activeSide === c.id ? 'A' : activeSide });
                                    }}
                                    style={{ fontSize: '9px', color: '#f87171', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                              <select
                                className="lp-sel"
                                style={{ height: '26px', fontSize: '11px', padding: '0 4px', width: '100%' }}
                                value={c.type || 'DIGITEVEN'}
                                onChange={e => updateThisContract({ type: e.target.value })}
                              >
                                {TRADE_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              {needsBarrier(c.type || 'DIGITEVEN') && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>Barrier:</span>
                                  <input
                                    className="lp-num"
                                    type="number" min={0} max={9}
                                    value={c.barrier ?? 4}
                                    style={{ width: '32px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                    onChange={e => updateThisContract({ barrier: Math.min(9, Math.max(0, +e.target.value || 0)) })}
                                  />
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '9px', color: '#38bdf8', fontWeight: 'bold' }}>Ticks:</span>
                                <input
                                  className="lp-num"
                                  type="number" min={1} max={100}
                                  value={c.ticks ?? 1}
                                  style={{ width: '36px', height: '22px', fontSize: '11px', textAlign: 'center' }}
                                  onChange={e => updateThisContract({ ticks: Math.max(1, +e.target.value || 1) })}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Add Extra Contract Button (up to 4 contracts) */}
                      {contractsList.length < 4 && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextId = String.fromCharCode(65 + contractsList.length);
                            const newContract = {
                              id: nextId,
                              label: `Contract ${nextId}`,
                              type: 'DIGITEVEN',
                              barrier: 4,
                              ticks: 1,
                            };
                            const fullList = [...contractsList, newContract];
                            updateMC({ contracts: fullList });
                          }}
                          style={{
                            padding: '6px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)',
                            border: '1px dashed rgba(255,255,255,0.15)', color: '#94a3b8', fontSize: '10px',
                            fontWeight: 'bold', cursor: 'pointer'
                          }}
                        >
                          + Add Contract ({String.fromCharCode(65 + contractsList.length)})
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Steps List (Only when mode === 'sequence') */}
                {(adaptiveSwitch.mode || 'sequence') === 'sequence' && (
                <div className="lp-sw-steps">
                  {adaptiveSwitch.steps.map((step, si) => {
                    const stepTrades = step.trades && step.trades.length > 0
                      ? step.trades
                      : [{ contractType: step.contractType || 'DIGITEVEN', barrier: step.barrier ?? 4, count: 1, ticks: step.ticks ?? 1 }];

                    const updateStepTrades = (newTrades: typeof stepTrades) => {
                      const next = [...adaptiveSwitch.steps];
                      next[si] = {
                        ...next[si],
                        trades: newTrades,
                        contractType: newTrades[0]?.contractType || next[si].contractType,
                        barrier: newTrades[0]?.barrier ?? next[si].barrier,
                        ticks: newTrades[0]?.ticks ?? next[si].ticks,
                      };
                      setAdaptiveSwitch({ ...adaptiveSwitch, steps: next });
                    };

                    return (
                      <div key={si} className="lp-sw-step" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: '12px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.02)',
                        marginBottom: '8px'
                      }}>
                        {/* Step Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 'bold', color: adaptiveSwitch.dualMode ? '#c4b5fd' : '#22d3ee' }}>
                            Step {si + 1}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Reps</span>
                              <input
                                className="lp-num"
                                type="number" min={1} max={50}
                                value={step.reps}
                                style={{ width: '36px', height: '22px', fontSize: '11px', padding: '0 4px', textAlign: 'center' }}
                                onChange={e => {
                                  const next = [...adaptiveSwitch.steps];
                                  next[si] = { ...next[si], reps: Math.max(1, +e.target.value || 1) };
                                  setAdaptiveSwitch({ ...adaptiveSwitch, steps: next });
                                }}
                              />
                            </div>
                            <button
                              onClick={() => {
                                const next = adaptiveSwitch.steps.filter((_, idx) => idx !== si);
                                setAdaptiveSwitch({ ...adaptiveSwitch, steps: next });
                              }}
                              disabled={adaptiveSwitch.steps.length <= 1}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'rgba(239, 68, 68, 0.7)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                opacity: adaptiveSwitch.steps.length <= 1 ? 0.4 : 1
                              }}
                            >
                              ✕ Remove Step
                            </button>
                          </div>
                        </div>

                        {/* Step Trades Config */}
                        {adaptiveSwitch.dualMode ? (() => {
                          const stepHasOnlyUD = stepTrades.some(t =>
                            t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW'
                          );
                          const hasJDMarket = selectedMarkets.some(sym => sym.startsWith('JD'));
                          return (
                          /* DUAL CONTRACT SELECTORS */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                            {stepHasOnlyUD && hasJDMarket && (
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                color: '#ef4444', fontSize: '10px', fontWeight: 'bold',
                                padding: '4px 8px', background: 'rgba(239,68,68,0.08)',
                                border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px',
                              }}>
                                <ShieldAlert size={12} />
                                <span>Only Ups/Downs not supported on JUMP Indices!</span>
                              </div>
                            )}
                            {stepHasOnlyUD && (
                              <div style={{ fontSize: '10px', color: '#a78bfa', fontWeight: 600, paddingLeft: 2 }}>
                                ⚡ Only Ups/Downs: customize contract tick durations below (2–5 ticks)
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                              {/* Contract A */}
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}>CONTRACT A</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <select
                                    className="lp-sel"
                                    style={{ height: '24px', fontSize: '11px', padding: '0 4px', flex: 1, minWidth: '90px' }}
                                    value={stepTrades[0]?.contractType || 'DIGITEVEN'}
                                    onChange={e => {
                                      const nextT = [...stepTrades];
                                      if (!nextT[0]) nextT[0] = { contractType: 'DIGITEVEN', barrier: 4, count: 1, ticks: 5 };
                                      const newType = e.target.value;
                                      let curTicks = nextT[0].ticks ?? 5;
                                      if (newType === 'RUNHIGH' || newType === 'RUNLOW') {
                                        curTicks = Math.max(2, Math.min(5, curTicks));
                                      }
                                      nextT[0] = { ...nextT[0], contractType: newType, ticks: curTicks };
                                      updateStepTrades(nextT);
                                    }}
                                  >
                                    {TRADE_OPTIONS.map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                  {needsBarrier(stepTrades[0]?.contractType || 'DIGITEVEN') && (
                                    <input
                                      className="lp-num"
                                      type="number" min={0} max={9}
                                      value={stepTrades[0]?.barrier ?? 4}
                                      style={{ width: '28px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                      onChange={e => {
                                        const nextT = [...stepTrades];
                                        if (!nextT[0]) nextT[0] = { contractType: 'DIGITEVEN', barrier: 4, count: 1, ticks: 5 };
                                        nextT[0] = { ...nextT[0], barrier: Math.min(9, Math.max(0, +e.target.value || 0)) };
                                        updateStepTrades(nextT);
                                      }}
                                    />
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} title="Ticks duration (2-5 for Only Ups/Downs)">
                                    <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks</span>
                                    <input
                                      className="lp-num"
                                      type="number"
                                      min={(stepTrades[0]?.contractType === 'RUNHIGH' || stepTrades[0]?.contractType === 'RUNLOW') ? 2 : 1}
                                      max={(stepTrades[0]?.contractType === 'RUNHIGH' || stepTrades[0]?.contractType === 'RUNLOW') ? 5 : 100}
                                      value={stepTrades[0]?.ticks ?? 5}
                                      style={{ width: '32px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                      onChange={e => {
                                        const nextT = [...stepTrades];
                                        if (!nextT[0]) nextT[0] = { contractType: 'DIGITEVEN', barrier: 4, count: 1, ticks: 5 };
                                        let val = Math.max(1, Math.min(100, +e.target.value || 1));
                                        const isOU = nextT[0].contractType === 'RUNHIGH' || nextT[0].contractType === 'RUNLOW';
                                        if (isOU) val = Math.max(2, Math.min(5, val));
                                        nextT[0] = { ...nextT[0], ticks: val };
                                        updateStepTrades(nextT);
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Contract B */}
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', fontWeight: 'bold' }}>CONTRACT B</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <select
                                    className="lp-sel"
                                    style={{ height: '24px', fontSize: '11px', padding: '0 4px', flex: 1, minWidth: '90px' }}
                                    value={stepTrades[1]?.contractType || 'DIGITODD'}
                                    onChange={e => {
                                      const nextT = [...stepTrades];
                                      if (!nextT[0]) nextT[0] = { contractType: 'DIGITEVEN', barrier: 4, count: 1, ticks: 5 };
                                      if (!nextT[1]) nextT[1] = { contractType: 'DIGITODD', barrier: 4, count: 1, ticks: 5 };
                                      const newType = e.target.value;
                                      let curTicks = nextT[1].ticks ?? 5;
                                      if (newType === 'RUNHIGH' || newType === 'RUNLOW') {
                                        curTicks = Math.max(2, Math.min(5, curTicks));
                                      }
                                      nextT[1] = { ...nextT[1], contractType: newType, ticks: curTicks };
                                      updateStepTrades(nextT);
                                    }}
                                  >
                                    {TRADE_OPTIONS.map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                  {needsBarrier(stepTrades[1]?.contractType || 'DIGITODD') && (
                                    <input
                                      className="lp-num"
                                      type="number" min={0} max={9}
                                      value={stepTrades[1]?.barrier ?? 4}
                                      style={{ width: '28px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                      onChange={e => {
                                        const nextT = [...stepTrades];
                                        if (!nextT[0]) nextT[0] = { contractType: 'DIGITEVEN', barrier: 4, count: 1, ticks: 5 };
                                        if (!nextT[1]) nextT[1] = { contractType: 'DIGITODD', barrier: 4, count: 1, ticks: 5 };
                                        nextT[1] = { ...nextT[1], barrier: Math.min(9, Math.max(0, +e.target.value || 0)) };
                                        updateStepTrades(nextT);
                                      }}
                                    />
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} title="Ticks duration (2-5 for Only Ups/Downs)">
                                    <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks</span>
                                    <input
                                      className="lp-num"
                                      type="number"
                                      min={(stepTrades[1]?.contractType === 'RUNHIGH' || stepTrades[1]?.contractType === 'RUNLOW') ? 2 : 1}
                                      max={(stepTrades[1]?.contractType === 'RUNHIGH' || stepTrades[1]?.contractType === 'RUNLOW') ? 5 : 100}
                                      value={stepTrades[1]?.ticks ?? 5}
                                      style={{ width: '32px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                      onChange={e => {
                                        const nextT = [...stepTrades];
                                        if (!nextT[0]) nextT[0] = { contractType: 'DIGITEVEN', barrier: 4, count: 1, ticks: 5 };
                                        if (!nextT[1]) nextT[1] = { contractType: 'DIGITODD', barrier: 4, count: 1, ticks: 5 };
                                        let val = Math.max(1, Math.min(100, +e.target.value || 1));
                                        const isOU = nextT[1].contractType === 'RUNHIGH' || nextT[1].contractType === 'RUNLOW';
                                        if (isOU) val = Math.max(2, Math.min(5, val));
                                        nextT[1] = { ...nextT[1], ticks: val };
                                        updateStepTrades(nextT);
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          );
                        })() : (
                          /* STANDARD/BULK MULTIPLE CONTRACTS BUILDER */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {stepTrades.map((t, ti) => {
                              const bNeedsBarrier = needsBarrier(t.contractType);
                              return (
                                <div key={ti} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <select
                                    className="lp-sel"
                                    style={{ height: '24px', fontSize: '11px', padding: '0 4px', minWidth: '110px' }}
                                    value={t.contractType}
                                    onChange={e => {
                                      const nextT = [...stepTrades];
                                      const newType = e.target.value;
                                      let curTicks = nextT[ti].ticks ?? 5;
                                      if (newType === 'RUNHIGH' || newType === 'RUNLOW') {
                                        curTicks = Math.max(2, Math.min(5, curTicks));
                                      }
                                      nextT[ti] = { ...nextT[ti], contractType: newType, ticks: curTicks };
                                      updateStepTrades(nextT);
                                    }}
                                  >
                                    {TRADE_OPTIONS.map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>

                                  {bNeedsBarrier ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                      <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Bar</span>
                                      <input
                                        className="lp-num"
                                        type="number" min={0} max={9}
                                        value={t.barrier ?? 4}
                                        style={{ width: '28px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                        onChange={e => {
                                          const nextT = [...stepTrades];
                                          nextT[ti] = { ...nextT[ti], barrier: Math.min(9, Math.max(0, +e.target.value || 0)) };
                                          updateStepTrades(nextT);
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <div style={{ width: '48px' }} />
                                  )}

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>Bulk</span>
                                    <input
                                      className="lp-num"
                                      type="number" min={1} max={20}
                                      value={t.count}
                                      style={{ width: '32px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                      onChange={e => {
                                        const nextT = [...stepTrades];
                                        nextT[ti] = { ...nextT[ti], count: Math.max(1, Math.min(20, +e.target.value || 1)) };
                                        updateStepTrades(nextT);
                                      }}
                                    />
                                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>tx</span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} title="Ticks duration">
                                    <span style={{ fontSize: '9px', color: '#a78bfa', fontWeight: 'bold' }}>Ticks</span>
                                    <input
                                      className="lp-num"
                                      type="number"
                                      min={(t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW') ? 2 : 1}
                                      max={(t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW') ? 5 : 100}
                                      value={(t as any).ticks ?? 5}
                                      style={{ width: '32px', height: '24px', fontSize: '11px', padding: 0, textAlign: 'center' }}
                                      onChange={e => {
                                        const nextT = [...stepTrades];
                                        let val = Math.max(1, Math.min(100, +e.target.value || 1));
                                        const isOU = t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW';
                                        if (isOU) val = Math.max(2, Math.min(5, val));
                                        nextT[ti] = { ...nextT[ti], ticks: val };
                                        updateStepTrades(nextT);
                                      }}
                                    />
                                  </div>

                                  {stepTrades.length > 1 && (
                                    <button
                                      onClick={() => {
                                        const nextT = stepTrades.filter((_, idx) => idx !== ti);
                                        updateStepTrades(nextT);
                                      }}
                                      style={{
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        color: '#f87171',
                                        border: 'none',
                                        borderRadius: '4px',
                                        width: '18px',
                                        height: '18px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '11px',
                                        cursor: 'pointer'
                                      }}
                                      title="Delete trade"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              );
                            })}

                            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '2px' }}>
                              <button
                                onClick={() => {
                                  updateStepTrades([...stepTrades, { contractType: 'DIGITEVEN', barrier: 4, count: 1 }]);
                                }}
                                style={{
                                  background: 'rgba(99, 102, 241, 0.15)',
                                  color: '#a5b4fc',
                                  border: '1px dashed rgba(99, 102, 241, 0.3)',
                                  borderRadius: '4px',
                                  padding: '2px 8px',
                                  fontSize: '9px',
                                  fontWeight: 'bold',
                                  cursor: 'pointer'
                                }}
                              >
                                + Add Trade
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}

                {/* Preview sequence */}
                <div className="lp-sw-preview" style={{ marginTop: '10px' }}>
                  {adaptiveSwitch.mode === 'adaptive' ? (() => {
                    const ac = adaptiveSwitch.adaptiveContracts || {
                      contractA: { type: 'DIGITEVEN' },
                      contractB: { type: 'DIGITODD' },
                      activeSide: 'A',
                    };
                    const lblA = TRADE_OPTIONS.find(o => o.value === (ac.contractA?.type || 'DIGITEVEN'))?.label || ac.contractA?.type;
                    const lblB = TRADE_OPTIONS.find(o => o.value === (ac.contractB?.type || 'DIGITODD'))?.label || ac.contractB?.type;
                    const activeSide = ac.activeSide || ac.startSide || 'A';

                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 'bold' }}>
                        <span className={`lp-sw-preview-chip ${activeSide === 'A' ? 'active' : ''}`} style={{ background: activeSide === 'A' ? '#6366f1' : undefined, color: activeSide === 'A' ? '#fff' : undefined }}>
                          A: {lblA}
                        </span>
                        <span className="lp-sw-arrow">⇌</span>
                        <span className={`lp-sw-preview-chip ${activeSide === 'B' ? 'active' : ''}`} style={{ background: activeSide === 'B' ? '#6366f1' : undefined, color: activeSide === 'B' ? '#fff' : undefined }}>
                          B: {lblB}
                        </span>
                        <span style={{ fontSize: '9px', color: '#a78bfa', marginLeft: 4 }}>(Switches on Loss)</span>
                      </div>
                    );
                  })() : (
                    adaptiveSwitch.steps.map((step, si) => {
                      const stepTrades = step.trades && step.trades.length > 0
                        ? step.trades
                        : [{ contractType: step.contractType || 'DIGITEVEN', barrier: step.barrier ?? 4, count: 1, ticks: step.ticks ?? 1 }];

                      const label = stepTrades.map(t => {
                        const lbl = TRADE_OPTIONS.find(o => o.value === t.contractType)?.label || t.contractType;
                        const bar = needsBarrier(t.contractType) && ((t as any).barrier !== undefined || step.barrier !== undefined)
                          ? ` [${(t as any).barrier ?? step.barrier ?? 4}]`
                          : '';
                        const tks = ((t as any).ticks || step.ticks) ? ` (${(t as any).ticks || step.ticks}t)` : '';
                        const formatted = `${lbl}${bar}${tks}`;
                        return t.count > 1 ? `${formatted} (x${t.count})` : formatted;
                      }).join(' + ');

                      return (
                        <span key={si} className="lp-sw-preview-chip">
                          {label} ×{step.reps}
                          {si < adaptiveSwitch.steps.length - 1 && <span className="lp-sw-arrow">→</span>}
                        </span>
                      );
                    })
                  )}
                </div>

                {/* Live status when running */}
                {adaptiveSwitch.enabled && isRunning && adaptiveLiveStatus && (
                  <div className="lp-sw-live" style={{ marginTop: '10px' }}>
                    <span className="lp-sw-live-dot" />
                    <span className="lp-sw-live-label">LIVE:</span>
                    <span className="lp-sw-live-val">{adaptiveLiveStatus}</span>
                  </div>
                )}
                </>
                )}
              </div>
            )}

            <div className="lp-strats-list">
              {strategies.map((s, i) => (
                <StrategyBlock
                  key={s.id}
                  strategy={s}
                  index={i}
                  onChange={updated => setStrategies(p => p.map(x => x.id === updated.id ? updated : x))}
                  onRemove={() => setStrategies(p => p.filter(x => x.id !== s.id))}
                  adaptiveSwitchEnabled={adaptiveSwitch.enabled}
                />
              ))}
            </div>
          </div>

          {/* Markets Selector */}
          <div className="lp-markets-section">
            <div className="lp-ms-hdr">
              <div>
                <div className="lp-sec-title">MARKETS</div>
                <div className="lp-ms-sub">Select market(s) to Execute your Strategies on.</div>
              </div>
              <span className="lp-ms-count">{selectedMarkets.length} selected</span>
            </div>
            <div className="lp-market-chips">
              {ALL_MARKETS.map(m => (
                <button key={m.value}
                  className={`lp-chip ${selectedMarkets.includes(m.value) ? 'active' : ''}`}
                  onClick={() => setSelectedMarkets(p =>
                    p.includes(m.value) ? p.filter(x => x !== m.value) : [...p, m.value]
                  )}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Execute Button */}
          <button
            className={`lp-exec-btn ${isRunning ? 'running' : ''}`}
            onClick={handleToggle}
            disabled={!canRun}>
            {isRunning
              ? <><Square size={15} style={{ marginRight: 8, fill: 'currentColor' }} />STOP STRATEGIES</>
              : <><Play size={15} style={{ marginRight: 8, fill: 'currentColor' }} />EXECUTE STRATEGIES</>
            }
          </button>

          {/* Status Row */}
          <div className="lp-status-row">
            <div className="lp-status-box">
              <div className="lp-status-label">STATUS</div>
              <div className="lp-status-text">
                {isRunning && <span className="lp-pulse-dot" />}
                {botStatusMsg}
                {(virtualSettings.startVirtualToReal || virtualSettings.isDoubleVirtual || virtualSettings.smartSettings?.enabled) && virtualSettings.isDoubleVirtual && isRunning && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    marginLeft: 8, padding: '1px 6px', borderRadius: 4, fontSize: 9,
                    fontWeight: 900, letterSpacing: '.5px',
                    background: virtualSettings.vDoubleStage === 'B' ? 'rgba(74,222,128,0.18)' : 'rgba(129,140,248,0.18)',
                    color: virtualSettings.vDoubleStage === 'B' ? '#4ade80' : '#818cf8',
                    border: `1px solid ${virtualSettings.vDoubleStage === 'B' ? '#4ade8055' : '#818cf855'}`,
                  }}>
                    {virtualSettings.vDoubleStage === 'B' ? '⚡ GATE B EXEC' : '🔵 GATE A VIRT'}
                  </span>
                )}
              </div>
            </div>
            <div className="lp-status-box lp-signal-box">
              <div className="lp-status-label">LAST SIGNAL</div>
              <div className="lp-status-text lp-signal-text">{lastSignal || '—'}</div>
            </div>
          </div>

          {/* Market Cards Grid */}
          <div className="lp-mc-grid">
            {selectedMarkets.map(sym => {
              const m = ALL_MARKETS.find(x => x.value === sym);
              const isFlashing = Date.now() - (signalFlash[sym] || 0) < 2500;
              return m ? (
                <MarketCard key={sym} symbol={sym} label={m.label} isFlashing={isFlashing} />
              ) : null;
            })}
          </div>

        </div>

        {/* ══ RIGHT PANEL ══════════════════════════════════════════════════ */}
        <div className="lp-right">

          {/* Run button + status */}
          <div className="lp-run-hdr">
            <button className={`lp-run-btn ${isRunning ? 'running' : ''}`}
              onClick={handleToggle} disabled={!canRun}>
              {isRunning
                ? <Square size={13} style={{ fill: 'currentColor' }} />
                : <Play size={13} style={{ fill: 'currentColor' }} />}
              {isRunning ? 'Stop' : 'Run'}
            </button>
            {/* Quick Virtual/Real toggle — survives bot restarts */}
            <button
              className={`lp-virt-quick-btn ${virtualSettings.isVirtualMode ? 'virtual' : 'real'}`}
              onClick={() => setVirtualSettings({ isVirtualMode: !virtualSettings.isVirtualMode })}
              title={virtualSettings.isVirtualMode
                ? 'VIRTUAL MODE — click to switch to REAL trading'
                : 'REAL MODE — click to switch to VIRTUAL tracking'}
            >
              {virtualSettings.isVirtualMode ? '🧪 VIRT' : '💵 REAL'}
            </button>
            <span className="lp-run-status">
              {isRunning
                ? <><span className="lp-dot connected" />Bot is running</>
                : <><span className="lp-dot" />Bot is not running</>}
            </span>
          </div>
          {/* Quick HUD for Manual Contracts — shown in right panel when Manual Contracts mode is active */}
          {adaptiveSwitch.enabled && adaptiveSwitch.mode === 'manual' && !adaptiveSwitch.virtualSwitcher?.enabled && (() => {
            const mc = adaptiveSwitch.manualContracts;
            const list = getManualContractList(mc);
            const activeId = mc?.activeSide || mc?.startSide || 'A';

            return (
              <div className="lp-manual-hud">
                <div className="lp-manual-hud-inner">
                  {list.map((c, idx) => {
                    const isActive = (c.id === activeId) || (idx === 0 && activeId === 'A') || (idx === 1 && activeId === 'B');
                    const typeOpt = TRADE_OPTIONS.find(o => o.value === c.type);
                    const shortType = typeOpt ? typeOpt.label.replace(' (CALL)', '').replace(' (PUT)', '').replace('DIGIT ', '') : c.type;
                    const barStr = c.barrier !== undefined && needsBarrier(c.type) ? ` ${c.barrier}` : '';
                    const tickStr = c.ticks ? ` ${c.ticks}t` : '';

                    return (
                      <button
                        key={c.id || idx}
                        type="button"
                        className={`lp-manual-hud-btn ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          const targetId = c.id || (idx === 0 ? 'A' : 'B');
                          const curASw = useBotStore.getState().adaptiveSwitch;
                          const curMC = curASw.manualContracts || {
                            contractA: { type: 'DIGITEVEN', barrier: 4, ticks: 1 },
                            contractB: { type: 'DIGITODD', barrier: 4, ticks: 1 },
                            activeSide: 'A',
                            startSide: 'A',
                            onSwitchVirtualBehavior: 'stay_virtual',
                          };
                          
                          useBotStore.getState().setAdaptiveSwitch({
                            ...curASw,
                            manualContracts: {
                              ...curMC,
                              activeSide: targetId,
                            },
                          });

                          const vSettings = useDerivStore.getState().virtualSettings;
                          if (vSettings.isVirtualMode && curMC.onSwitchVirtualBehavior === 'switch_to_real') {
                            useDerivStore.getState().setVirtualSettings({ isVirtualMode: false });
                            useBotStore.getState().set_status(`🔄 Switched to REAL mode on manual contract switch (${targetId}: ${shortType})!`);
                          } else {
                            useBotStore.getState().set_status(`🎛️ Switched active contract to ${c.label || targetId} (${shortType})!`);
                          }
                        }}
                        title={`Click to switch to ${c.label || `Contract ${c.id}`} (${shortType}${barStr}${tickStr})`}
                      >
                        <div className="lp-manual-hud-btn-top">
                          <span className={`lp-manual-hud-dot ${isActive ? 'active' : ''}`} />
                          <span className="lp-manual-hud-label">{c.label || `Contract ${c.id}`}</span>
                        </div>
                        <div className="lp-manual-hud-val">
                          <span>{shortType}{barStr}</span>
                          {tickStr && <span className="lp-manual-hud-ticks">{tickStr}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}



          {/* Quick stats row — always visible */}
          <div className="lp-quick-stats">
            <div className="lp-qs"><span className="lp-qs-l">W</span><span className="lp-qs-v green">{globalStats?.won ?? 0}</span></div>
            <div className="lp-qs"><span className="lp-qs-l">L</span><span className="lp-qs-v red">{globalStats?.lost ?? 0}</span></div>
            <div className="lp-qs">
              <span className="lp-qs-l">P/L</span>
              <span className={`lp-qs-v ${(globalStats?.totalProfit ?? 0) >= 0 ? 'green' : 'red'}`}>
                {(globalStats?.totalProfit ?? 0) >= 0 ? '+' : ''}{(globalStats?.totalProfit ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Trade Log Panel */}
          <TradeLogPanel
            logs={tradeLogs || []}
            stats={globalStats || { won: 0, lost: 0, totalProfit: 0, totalTrades: 0 }}
            journalLogs={journalLogs || []}
            onReset={resetAll}
            onClearJournal={clearJournal}
          />

          {/* Footer */}
          <div className="lp-right-footer">
            <span className={`lp-dot ${status === 'connected' ? 'connected' : ''}`} />
            <span className="lp-time" suppressHydrationWarning>
              {mounted ? new Date().toLocaleString('en-GB', { hour12: false }).replace(',', '') : ''}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// STYLES
// ───────────────────────────────────────────────────────────────────────────

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

/* ── Parent Layout Override (Full Screen Support) ─────────── */
main:has(.lp-root) {
  max-width: 100% !important;
  width: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow-x: hidden !important;
}

/* ── Liquid Glass Core Design System ──────────────────────── */
.lp-root {
  display: flex !important;
  gap: 16px !important;
  min-height: 100dvh;
  width: 100%;
  font-family: 'Outfit', sans-serif;
  padding: 16px;
  box-sizing: border-box;
  align-items: flex-start;
  overflow-x: hidden;
}
.lp-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin-right: 306px; /* Space for fixed right panel */
}

/* Light Theme Variables */
.lp-root {
  --glass-bg: rgba(255, 255, 255, 0.45);
  --glass-border: rgba(255, 255, 255, 0.6);
  --card-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6);
  --bg-gradient: radial-gradient(circle at 50% 30%, #f4f6fc 0%, #e2e8f0 100%);
  --text-main: #1e293b;
  --text-muted: #64748b;
  --input-bg: rgba(255, 255, 255, 0.7);
  --input-border: rgba(14, 116, 144, 0.15);
  --accent-cyan: #06b6d4;
  --accent-purple: #8b5cf6;
  --btn-glow-cyan: 0 4px 14px 0 rgba(6, 182, 212, 0.25);
  --btn-glow-purple: 0 4px 14px 0 rgba(139, 92, 246, 0.25);
  background: var(--bg-gradient) !important;
}

/* Dark Theme Variables (Liquid Glass Dark) */
.lp-dark {
  --glass-bg: rgba(9, 13, 29, 0.6);
  --glass-border: rgba(255, 255, 255, 0.08);
  --card-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37), inset 0 1.5px 2px rgba(255, 255, 255, 0.15);
  --bg-gradient: radial-gradient(circle at 50% 30%, #0c122b 0%, #03050c 80%);
  --text-main: #f1f5f9;
  --text-muted: #4b6cb7;
  --input-bg: rgba(5, 7, 18, 0.85);
  --input-border: rgba(30, 41, 59, 0.8);
  --accent-cyan: #00e5ff;
  --accent-purple: #bf5af2;
  --btn-glow-cyan: 0 4px 18px 0 rgba(0, 229, 255, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.4);
  --btn-glow-purple: 0 4px 18px 0 rgba(191, 90, 242, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.4);
  background: var(--bg-gradient) !important;
}

/* Scscoped Scrollbars */
.lp-right::-webkit-scrollbar,
.lp-tx-list::-webkit-scrollbar {
  width: 6px;
}
.lp-right::-webkit-scrollbar-track,
.lp-tx-list::-webkit-scrollbar-track {
  background: transparent;
}
.lp-right::-webkit-scrollbar-thumb,
.lp-tx-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}
.lp-dark .lp-right::-webkit-scrollbar-thumb,
.lp-dark .lp-tx-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
}

/* ── Header ─────────────────────────────────────────────── */
.lp-header-card {
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 16px;
  padding: 18px 24px 14px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.lp-header-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
}
.lp-title-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 6px;
}
.lp-title {
  font-size: 24px;
  font-weight: 900;
  color: var(--text-main) !important;
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: 0.5px;
}
.lp-ai-badge {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #fff !important;
  font-size: 10px;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 5px;
  letter-spacing: 1px;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
}
.lp-premium-badge {
  background: linear-gradient(135deg, #ffd60a, #ff9f0a) !important;
  color: #000 !important;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 10px;
  border-radius: 20px;
  letter-spacing: 1px;
  box-shadow: 0 0 10px rgba(255, 214, 10, 0.2);
}
.lp-subtitle {
  font-size: 13px;
  color: var(--text-muted) !important;
}
.lp-subtitle strong {
  color: var(--accent-cyan) !important;
  text-shadow: 0 0 8px rgba(6, 182, 212, 0.2);
}

/* ── Auth Warning ───────────────────────────────────────── */
.lp-auth-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(234, 179, 8, 0.1) !important;
  color: #fbbf24 !important;
  border: 1px solid rgba(234, 179, 8, 0.2) !important;
  border-radius: 12px;
  backdrop-filter: blur(8px);
}
.lp-disconnected {
  background: rgba(239, 68, 68, 0.1) !important;
  color: #fca5a5 !important;
  border: 1px solid rgba(239, 68, 68, 0.2) !important;
}

/* ── Settings Row ───────────────────────────────────────── */
.lp-settings-row {
  display: flex;
  gap: 12px;
  background: transparent !important;
  border: none !important;
}
.lp-sg {
  flex: 1;
  padding: 12px 16px;
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 14px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.lp-sg-wide {
  flex: 1.6;
}
.lp-sl {
  display: block;
  font-size: 10px;
  font-weight: 800;
  color: var(--text-muted) !important;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.lp-sl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.lp-sl-row .lp-sl {
  margin-bottom: 0;
}
.lp-mode-pill {
  font-size: 9px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid var(--accent-cyan) !important;
  background: rgba(6, 182, 212, 0.08) !important;
  color: var(--accent-cyan) !important;
  cursor: pointer;
  letter-spacing: .5px;
  transition: all 0.2s;
  white-space: nowrap;
}
.lp-mode-pill:hover {
  background: var(--accent-cyan) !important;
  color: #000 !important;
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.4);
}
.lp-theme-toggle {
  font-size: 14px;
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid var(--glass-border) !important;
  backdrop-filter: blur(4px);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: all 0.25s;
  opacity: 0.85;
}
.lp-theme-toggle:hover {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 0 8px rgba(255,255,255,0.15);
}
.lp-si {
  width: 100%;
  border: 1px solid var(--input-border) !important;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main) !important;
  background: var(--input-bg) !important;
  outline: none;
  transition: all 0.2s;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
}
.lp-si:focus {
  border-color: var(--accent-cyan) !important;
  box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.15), inset 0 1px 2px rgba(0,0,0,0.3) !important;
}
.lp-mode {
  font-size: 11px;
}

/* ── Strategy Section ───────────────────────────────────── */
.lp-strategy-section {
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 16px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lp-ss-hdr {
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 10px;
}
.lp-sec-title {
  font-size: 13px;
  font-weight: 900;
  color: transparent !important;
  background: linear-gradient(90deg, var(--accent-cyan), var(--accent-purple)) !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  flex: 1;
}
.lp-circles-btn {
  background: linear-gradient(135deg, #ff007f, #7f00ff) !important;
  color: #fff !important;
  border: none !important;
  border-radius: 20px;
  padding: 5px 15px;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(127, 0, 255, 0.35);
  transition: all 0.2s;
}
.lp-circles-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 5px 15px rgba(127, 0, 255, 0.5);
}
.lp-add-strat-btn {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #000 !important;
  border: none !important;
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: var(--btn-glow-cyan);
  transition: all 0.2s;
}
.lp-add-strat-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  opacity: 0.95;
}
.lp-add-strat-btn:disabled {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255,255,255,0.2) !important;
  box-shadow: none !important;
  cursor: not-allowed;
}

.lp-strats-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 3D Liquid Glass Strategy Block */
.lp-strategy {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  padding: 14px 16px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1), 0 4px 20px rgba(0, 0, 0, 0.15);
}
.lp-strategy::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%);
  pointer-events: none;
}
.lp-strat-blue   { background: rgba(30, 64, 175, 0.2) !important; border-color: rgba(59, 130, 246, 0.2) !important; }
.lp-strat-pink   { background: rgba(157, 23, 77, 0.18) !important; border-color: rgba(236, 72, 153, 0.2) !important; }
.lp-strat-purple { background: rgba(109, 40, 217, 0.2) !important; border-color: rgba(139, 92, 246, 0.2) !important; }
.lp-strat-green  { background: rgba(6, 95, 70, 0.2) !important; border-color: rgba(16, 185, 129, 0.2) !important; }
.lp-strat-orange { background: rgba(194, 65, 12, 0.2) !important; border-color: rgba(249, 115, 22, 0.2) !important; }

.lp-strat-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.lp-strat-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lp-strat-name {
  font-size: 11px;
  font-weight: 900;
  color: var(--text-main) !important;
  letter-spacing: 1.5px;
}
.lp-cond-badge {
  background: rgba(255, 255, 255, 0.05) !important;
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-main) !important;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.lp-toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-main) !important;
}
.lp-toggle-label input {
  accent-color: var(--accent-cyan);
}
.lp-rm-strat {
  background: linear-gradient(135deg, #ef4444, #991b1b) !important;
  color: #fff !important;
  border: none !important;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
  transition: all 0.2s;
}
.lp-rm-strat:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
.lp-if-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted) !important;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Condition Row ──────────────────────────────────────── */
.lp-cond-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.lp-sel {
  border: 1px solid var(--input-border) !important;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-main) !important;
  background: var(--input-bg) !important;
  outline: none;
  cursor: pointer;
  transition: border 0.2s;
}
.lp-sel:focus {
  border-color: var(--accent-cyan) !important;
}
.lp-join {
  background: #0f172a !important;
  color: #38bdf8 !important;
  font-weight: 800;
  font-size: 10px;
  border: 1px solid #1e293b !important;
}
.lp-ctype {
  min-width: 170px;
}
.lp-cmp {
  width: 52px;
}
.lp-num {
  width: 60px;
  border: 1px solid var(--input-border) !important;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-main) !important;
  background: var(--input-bg) !important;
  outline: none;
  text-align: center;
}
.lp-num:focus {
  border-color: var(--accent-cyan) !important;
}
.lp-sm {
  width: 48px;
}
.lp-unit {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted) !important;
}
.lp-cyan {
  color: var(--accent-cyan) !important;
  font-weight: 800;
}
.lp-txt {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-main) !important;
}

/* Digit dropdown */
.lp-dd-btn {
  display: inline-flex;
  align-items: center;
  min-width: 95px;
  font-weight: 700;
  font-size: 12px;
  color: var(--text-main) !important;
  border: 1px solid var(--input-border) !important;
  border-radius: 6px;
  padding: 4px 10px;
  background: var(--input-bg) !important;
  cursor: pointer;
}
.lp-dd-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 130px;
  background: rgba(10, 18, 38, 0.95) !important;
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border) !important;
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  z-index: 300;
  overflow: hidden;
}
.lp-dd-item {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-main) !important;
  cursor: pointer;
  transition: all 0.15s;
}
.lp-dd-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--accent-cyan) !important;
}
.lp-dd-item.active {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #000 !important;
}

.lp-rm-cond {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none !important;
  background: linear-gradient(135deg, #ef4444, #dc2626) !important;
  color: #fff !important;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
}
.lp-rm-cond:hover {
  opacity: 0.9;
}

/* ── Advanced Pattern Builder ─────────────────────────────────────────── */
.lp-apb {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 12px;
  padding: 10px;
  margin-top: 6px;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
}
.lp-apb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 6px;
  margin-bottom: 4px;
}
.lp-apb-title {
  font-size: 10px;
  font-weight: 800;
  color: var(--accent-cyan) !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.lp-apb-add-btn {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #000 !important;
  border: none !important;
  border-radius: 5px;
  padding: 2px 10px;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: var(--btn-glow-cyan);
}
.lp-apb-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

/* Frosted glass pattern box */
.lp-apb-card {
  flex: 1;
  min-width: 80px;
  background: rgba(255,255,255,0.03) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 10px;
  padding: 6px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(10px);
}
.lp-apb-card-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  border-bottom: 1px solid var(--glass-border) !important;
  padding-bottom: 4px;
  margin-bottom: 2px;
}
.lp-apb-card-title {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-muted) !important;
  letter-spacing: 0.3px;
}
.lp-apb-card-remove {
  border: none !important;
  background: none !important;
  color: #ef4444;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
}
.lp-apb-triggers {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lp-apb-trig-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.lp-apb-tok-sel {
  font-size: 10px !important;
  padding: 2px 4px !important;
  height: 22px !important;
  flex: 1;
  text-align-last: center;
}
.lp-apb-trig-inp {
  width: 28px !important;
  height: 22px !important;
  font-size: 10px !important;
  padding: 1px !important;
  font-weight: 800;
  border-radius: 4px !important;
}
.lp-apb-trig-dash {
  font-size: 9px;
  color: var(--text-muted);
  width: 28px;
  text-align: center;
}
.lp-apb-trig-rm {
  background: transparent !important;
  border: none !important;
  color: #ef4444;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
  padding: 0 2px;
}
.lp-apb-add-trig {
  background: rgba(255,255,255,0.05) !important;
  color: var(--text-main) !important;
  border: 1px dashed var(--glass-border) !important;
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;
  width: 100%;
  transition: all 0.2s;
}
.lp-apb-add-trig:hover {
  background: rgba(255,255,255,0.1) !important;
}

.lp-apb-retrig-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--glass-border);
}
.lp-apb-ucc-row {
  display: flex;
  align-items: center;
  margin-top: 4px;
}

/* THEN TRADE Row */
.lp-then-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 10px;
  flex-wrap: wrap;
  background: rgba(255,255,255,0.01) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 8px;
  padding: 6px 12px;
}
.lp-then-lbl {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-main) !important;
  letter-spacing: 0.5px;
}
.lp-trade-sel {
  min-width: 90px;
  font-weight: 800;
}
.lp-add-cond-btn {
  background: rgba(255, 255, 255, 0.04) !important;
  color: var(--text-main) !important;
  border: 1px dashed var(--glass-border) !important;
  border-radius: 20px;
  padding: 4px 16px;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  display: inline-block;
  margin-bottom: 6px;
  transition: all 0.2s;
}
.lp-add-cond-btn:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: var(--accent-cyan) !important;
}
.lp-summary {
  font-size: 11px;
  color: var(--text-muted) !important;
  font-style: italic;
  background: rgba(255,255,255,0.02) !important;
  border: 1px solid var(--glass-border) !important;
  padding: 6px 12px;
  border-radius: 8px;
}
.lp-summary strong {
  color: var(--accent-cyan) !important;
}

/* Custom Contracts sequence box grid */
.lp-custom-boxes-grid {
  display: flex;
  gap: 8px;
  margin: 8px 0 12px;
  flex-wrap: wrap;
}
.lp-custom-box-card {
  flex: 1;
  min-width: 75px;
  background: rgba(245, 158, 11, 0.03) !important;
  border: 1px solid rgba(245, 158, 11, 0.15) !important;
  border-radius: 8px;
  padding: 6px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.05);
}
.lp-custom-box-title {
  font-size: 9px;
  font-weight: 900;
  color: #f59e0b !important;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.lp-custom-box-sel {
  font-size: 10px !important;
  padding: 2px 4px !important;
  width: 100% !important;
  text-align: center;
}
.lp-custom-box-input {
  width: 100% !important;
  margin: 0 !important;
  font-size: 10px !important;
  padding: 2px 4px !important;
  border-radius: 4px !important;
}

/* ── Markets Section ────────────────────────────────────── */
.lp-markets-section {
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 16px;
  padding: 12px 16px;
}
.lp-ms-hdr {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}
.lp-ms-sub {
  font-size: 11px;
  color: var(--text-muted) !important;
}
.lp-ms-count {
  font-size: 11px;
  font-weight: 800;
  color: var(--accent-cyan) !important;
}
.lp-market-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lp-chip {
  border: 1px solid var(--glass-border) !important;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-main) !important;
  background: rgba(255, 255, 255, 0.03) !important;
  cursor: pointer;
  transition: all 0.2s;
}
.lp-chip:hover {
  border-color: var(--accent-cyan) !important;
  color: var(--accent-cyan) !important;
  background: rgba(255, 255, 255, 0.06) !important;
}
.lp-chip.active {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  border-color: #00f0ff !important;
  color: #000 !important;
  font-weight: 800;
  box-shadow: var(--btn-glow-cyan);
}

/* ── Execute Button ─────────────────────────────────────── */
.lp-exec-btn {
  width: 100%;
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #000 !important;
  border: none !important;
  padding: 14px 0;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  margin-top: 2px;
  border-radius: 12px;
  box-shadow: var(--btn-glow-cyan);
}
.lp-exec-btn:hover:not(:disabled) {
  opacity: 0.95;
  transform: translateY(-1px);
}
.lp-exec-btn.running {
  background: linear-gradient(135deg, #ef4444, #7f1d1d) !important;
  color: #fff !important;
  box-shadow: 0 4px 20px rgba(239, 68, 68, 0.45) !important;
}
.lp-exec-btn:disabled {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255,255,255,0.2) !important;
  box-shadow: none !important;
  cursor: not-allowed;
}

/* ── Status Row ─────────────────────────────────────────── */
.lp-status-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 14px;
  overflow: hidden;
}
.lp-status-box {
  padding: 10px 16px;
  border-right: 1px solid var(--glass-border) !important;
}
.lp-status-box:last-child {
  border-right: none !important;
}
.lp-signal-box {
  border-left: 2px solid var(--accent-cyan) !important;
}
.lp-status-label {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-muted) !important;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.lp-status-text {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-main) !important;
  display: flex;
  align-items: center;
  gap: 6px;
}
.lp-signal-text {
  color: var(--accent-cyan) !important;
}
.lp-pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: lp-pulse 1s infinite;
  flex-shrink: 0;
}
@keyframes lp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.35); }
}

/* ── Market Cards Grid ──────────────────────────────────── */
.lp-mc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 10px;
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 16px;
  padding: 12px 16px;
}

/* Frosted glass market card */
.lp-market-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 10px;
  padding: 10px;
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.05);
  transition: all 0.2s;
}
.lp-mc-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.lp-mc-label {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-main) !important;
}
.lp-scan-badge {
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.8px;
  border-radius: 4px;
  padding: 1px 6px;
}
.lp-scan-badge.ready {
  background: rgba(16, 185, 129, 0.15) !important;
  color: #10b981 !important;
  border: 1px solid rgba(16, 185, 129, 0.2);
}
.lp-scan-badge.loading {
  background: rgba(245, 158, 11, 0.15) !important;
  color: #f59e0b !important;
  border: 1px solid rgba(245, 158, 11, 0.2);
  animation: lp-pulse 1.2s infinite;
}
.lp-mc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.lp-mc-rl {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-muted) !important;
  width: 38px;
  flex-shrink: 0;
}
.lp-bubbles {
  display: flex;
  gap: 4px;
}

/* 3D Liquid Bubbles */
.lp-bubble {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05) !important;
  color: var(--text-muted) !important;
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow: inset 0 1px 2px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.15);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.lp-bubble.even {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.15), rgba(0, 114, 255, 0.15)) !important;
  border-color: rgba(0, 229, 255, 0.3) !important;
  color: var(--accent-cyan) !important;
  box-shadow: inset 0 1px 2px rgba(255,255,255,0.1), 0 0 6px rgba(0, 229, 255, 0.2);
}
.lp-bubble.odd  {
  background: linear-gradient(135deg, rgba(191, 90, 242, 0.15), rgba(94, 92, 230, 0.15)) !important;
  border-color: rgba(191, 90, 242, 0.3) !important;
  color: var(--accent-purple) !important;
  box-shadow: inset 0 1px 2px rgba(255,255,255,0.1), 0 0 6px rgba(191, 90, 242, 0.2);
}
.lp-bubble.green-bar {
  outline: 2px solid #10b981;
  outline-offset: 1px;
}

/* Digit Colors with Glass shine */
.lp-bubble.d0 { background: rgba(59, 130, 246, 0.1) !important; color: #3b82f6 !important; border-color: rgba(59, 130, 246, 0.2) !important; }
.lp-bubble.d1 { background: rgba(16, 185, 129, 0.1) !important; color: #10b981 !important; border-color: rgba(16, 185, 129, 0.2) !important; }
.lp-bubble.d2 { background: rgba(245, 158, 11, 0.1) !important; color: #f59e0b !important; border-color: rgba(245, 158, 11, 0.2) !important; }
.lp-bubble.d3 { background: rgba(249, 115, 22, 0.1) !important; color: #f97316 !important; border-color: rgba(249, 115, 22, 0.2) !important; }
.lp-bubble.d4 { background: rgba(236, 72, 153, 0.1) !important; color: #ec4899 !important; border-color: rgba(236, 72, 153, 0.2) !important; }
.lp-bubble.d5 { background: rgba(20, 184, 166, 0.1) !important; color: #14b8a6 !important; border-color: rgba(20, 184, 166, 0.2) !important; }
.lp-bubble.d6 { background: rgba(239, 68, 68, 0.1) !important; color: #ef4444 !important; border-color: rgba(239, 68, 68, 0.2) !important; }
.lp-bubble.d7 { background: rgba(6, 182, 212, 0.1) !important; color: #06b6d4 !important; border-color: rgba(6, 182, 212, 0.2) !important; }
.lp-bubble.d8 { background: rgba(99, 102, 241, 0.1) !important; color: #6366f1 !important; border-color: rgba(99, 102, 241, 0.2) !important; }
.lp-bubble.d9 { background: rgba(217, 70, 239, 0.1) !important; color: #d946ef !important; border-color: rgba(217, 70, 239, 0.2) !important; }

/* ── Right Panel (Trade Log & Execution Controls) ────────────────────── */
.lp-right {
  width: 290px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border-left: 1px solid var(--glass-border) !important;
  border-top: 1px solid var(--glass-border) !important;
  box-shadow: var(--card-shadow) !important;
  border-radius: 16px;
  position: fixed !important;
  right: 16px;
  top: 80px;
  height: calc(100vh - 96px) !important;
  overflow-y: auto;
  gap: 12px;
  padding: 12px;
  z-index: 90;
}
.lp-run-hdr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--glass-border) !important;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02) !important;
}
.lp-run-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #10b981, #047857) !important;
  color: #fff !important;
  border: none !important;
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  transition: all 0.2s;
}
.lp-run-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.5);
}
.lp-run-btn.running {
  background: linear-gradient(135deg, #ef4444, #b91c1c) !important;
  box-shadow: 0 4px 15px rgba(239, 68, 68, 0.45) !important;
}
.lp-run-btn:disabled {
  background: rgba(255, 255, 255, 0.05) !important;
  color: rgba(255,255,255,0.2) !important;
  box-shadow: none !important;
  cursor: not-allowed;
}
.lp-run-status {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted) !important;
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}

/* ── Virtual Quick-Toggle Button ────────────────────────────── */
.lp-virt-quick-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none !important;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.lp-virt-quick-btn:active {
  transform: scale(0.96);
}
.lp-virt-quick-btn.virtual {
  background: linear-gradient(135deg, #bf5af2, #5e5ce6) !important;
  color: #fff !important;
  box-shadow: var(--btn-glow-purple);
}
.lp-virt-quick-btn.real {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #000 !important;
  box-shadow: var(--btn-glow-cyan);
}
.lp-virt-quick-btn.virtual:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}
.lp-virt-quick-btn.real:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}

/* ── Market card signal flash ──────────────────────────────── */
@keyframes lp-flash-pulse {
  0%   { box-shadow:0 0 0 0 rgba(0, 229, 255, 0); border-color: rgba(0, 229, 255, 0.2); }
  30%  { box-shadow:0 0 16px 6px rgba(0, 229, 255, 0.7); border-color: #00e5ff; }
  70%  { box-shadow:0 0 10px 3px rgba(0, 229, 255, 0.4); border-color: #00e5ff; }
  100% { box-shadow:0 0 0 0 rgba(0, 229, 255, 0); border-color: var(--glass-border); }
}
.lp-mc-flash {
  animation: lp-flash-pulse 0.7s ease-out 3;
  border: 1px solid #00e5ff !important;
}
.lp-mc-signal-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: linear-gradient(90deg, #ffd60a, #ff375f);
  color: #000;
  font-size: 9px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 10px;
  letter-spacing: 0.5px;
}

.lp-quick-stats {
  display: flex;
  border: 1px solid var(--glass-border) !important;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(16, 185, 129, 0.05) !important;
}
.lp-qs {
  flex: 1;
  padding: 8px 4px;
  text-align: center;
  border-right: 1px solid var(--glass-border) !important;
}
.lp-qs:last-child {
  border-right: none !important;
}
.lp-qs-l {
  display: block;
  font-size: 9px;
  font-weight: 800;
  color: var(--text-muted) !important;
  letter-spacing: 0.8px;
}
.lp-qs-v {
  display: block;
  font-size: 14px;
  font-weight: 900;
}
.lp-qs-v.green { color: #10b981; text-shadow: 0 0 8px rgba(16, 185, 129, 0.3); }
.lp-qs-v.red { color: #ef4444; text-shadow: 0 0 8px rgba(239, 68, 68, 0.3); }

/* ── Transaction Panel ──────────────────────────────────── */
.lp-tx-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  border: 1px solid var(--glass-border) !important;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.01) !important;
  overflow: hidden;
}
.lp-tx-tabs {
  display: flex;
  background: rgba(0, 0, 0, 0.1) !important;
  border-bottom: 1px solid var(--glass-border) !important;
}
.lp-tx-tab {
  flex: 1;
  padding: 10px 4px;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-muted) !important;
  border: none !important;
  border-bottom: 2px solid transparent !important;
  background: transparent !important;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}
.lp-tx-tab.active {
  color: var(--accent-cyan) !important;
  border-bottom-color: var(--accent-cyan) !important;
}
.lp-tx-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--glass-border) !important;
}
.lp-tx-btn {
  flex: 1;
  border: 1px solid var(--input-border) !important;
  border-radius: 6px;
  padding: 5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-main) !important;
  background: var(--input-bg) !important;
  cursor: pointer;
  transition: all 0.2s;
}
.lp-tx-btn:hover {
  border-color: var(--accent-cyan) !important;
  color: var(--accent-cyan) !important;
}
.lp-tx-hdr {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr 1fr;
  padding: 6px 10px;
  border-bottom: 1px solid var(--glass-border) !important;
  background: rgba(0,0,0,0.05);
}
.lp-tx-hdr span {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-muted) !important;
  letter-spacing: 0.5px;
}
.lp-tx-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 14px;
  gap: 8px;
  flex: 1;
}
.lp-tx-icon {
  font-size: 28px;
  opacity: 0.4;
}
.lp-tx-empty span {
  font-size: 11px;
  color: var(--text-muted) !important;
  text-align: center;
}

.lp-tx-list {
  overflow-y: auto;
  max-height: 270px;
}
.lp-tx-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr 1fr;
  padding: 6px 10px;
  border-bottom: 1px solid var(--glass-border) !important;
  font-size: 11px;
  align-items: center;
  transition: background 0.15s;
}
.lp-tx-row.won  { background: rgba(16, 185, 129, 0.06) !important; }
.lp-tx-row.lost { background: rgba(239, 68, 68, 0.06) !important; }
.lp-tx-row.virt {
  background: rgba(139, 92, 246, 0.04) !important;
  border-left: 2px solid var(--accent-purple) !important;
}
.lp-tx-contract {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.lp-tx-type {
  font-weight: 800;
  color: var(--text-main) !important;
}
.lp-tx-sym {
  font-size: 9px;
  color: var(--text-muted) !important;
}
.lp-virt-badge {
  display: inline-block;
  font-size: 7px;
  font-weight: 900;
  background: var(--accent-purple) !important;
  color: #fff !important;
  border-radius: 3px;
  padding: 1px 4px;
  letter-spacing: .5px;
}
.lp-tx-pnl {
  font-size: 11px;
  font-weight: 900;
  text-align: right;
}
.lp-tx-pnl.pos  { color: #10b981 !important; }
.lp-tx-pnl.neg  { color: #ef4444 !important; }
.lp-tx-pnl.virt { color: var(--accent-purple) !important; }
.lp-spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.lp-tx-stats {
  padding: 12px;
  border-top: 1px solid var(--glass-border) !important;
  margin-top: auto;
  background: rgba(0, 0, 0, 0.08) !important;
}
.lp-tx-stat-row {
  display: flex;
  gap: 8px;
}
.lp-tx-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lp-tsl {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-muted) !important;
  letter-spacing: 0.5px;
}
.lp-tsv {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-main) !important;
}
.lp-tsv.pos { color: #10b981 !important; }
.lp-tsv.neg { color: #ef4444 !important; }
.lp-reset-btn {
  width: 100%;
  margin-top: 10px;
  border: 1px solid rgba(239, 68, 68, 0.2) !important;
  border-radius: 8px;
  padding: 7px;
  font-size: 12px;
  font-weight: 800;
  color: #f87171 !important;
  background: rgba(239, 68, 68, 0.08) !important;
  cursor: pointer;
  transition: all 0.2s;
}
.lp-reset-btn:hover {
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.4) !important;
}

/* ── Right Footer ───────────────────────────────────────── */
.lp-right-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--glass-border) !important;
  background: rgba(0,0,0,0.05) !important;
  border-radius: 0 0 12px 12px;
}
.lp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #475569 !important;
  flex-shrink: 0;
}
.lp-dot.connected {
  background: #10b981 !important;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}
.lp-time {
  font-size: 10px;
  color: var(--text-muted) !important;
  font-family: monospace;
}

/* ── Risk Disclaimer ────────────────────────────────────── */
.lp-risk-disc {
  position: fixed;
  bottom: 16px;
  left: 16px;
  background: linear-gradient(135deg, #d97706, #b45309) !important;
  color: #fff !important;
  font-size: 11px;
  font-weight: 800;
  padding: 6px 14px;
  border-radius: 20px;
  z-index: 900;
  box-shadow: 0 4px 15px rgba(217, 119, 6, 0.3);
  border: 1px solid rgba(255,255,255,0.1);
}

/* ── Virtual System Panel ──────────────────────────────── */
.lp-virt-toggle-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-main) !important;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: var(--card-shadow);
}
.lp-virt-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: var(--accent-purple) !important;
  color: var(--accent-purple) !important;
}
.lp-virt-active-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: lp-pulse 1.2s infinite;
  margin-left: 4px;
}

.lp-vp {
  background: var(--glass-bg) !important;
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--glass-border) !important;
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--card-shadow) !important;
  animation: lp-slideDown 0.25s ease-out;
}
.lp-vp-hdr {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 8px;
}
.lp-vp-title {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-main) !important;
  letter-spacing: 1.5px;
}
.lp-vp-badge {
  font-size: 9px;
  font-weight: 900;
  padding: 3px 10px;
  border-radius: 5px;
  letter-spacing: 0.5px;
}
.lp-vp-badge--virtual {
  background: var(--accent-purple) !important;
  color: #fff !important;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.3);
}
.lp-vp-badge--real {
  background: var(--accent-cyan) !important;
  color: #000 !important;
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.3);
}
.lp-vp-force-btn {
  margin-left: auto;
  padding: 4px 14px;
  border: none !important;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 900;
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: all 0.2s;
}
.lp-vp-force-btn--toreal {
  background: linear-gradient(135deg, #00f0ff, #0072ff) !important;
  color: #000 !important;
  box-shadow: var(--btn-glow-cyan);
}
.lp-vp-force-btn--tovirt {
  background: linear-gradient(135deg, #bf5af2, #5e5ce6) !important;
  color: #fff !important;
  box-shadow: var(--btn-glow-purple);
}
.lp-vp-force-btn:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}
.lp-vp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.lp-vp-card {
  background: rgba(255, 255, 255, 0.03) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--card-shadow);
}
.lp-dark .lp-vp-card {
  background: rgba(255, 255, 255, 0.01) !important;
}
.lp-vp-card-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lp-vp-card-lbl {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-main) !important;
}
.lp-vp-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid var(--glass-border) !important;
  border-radius: 6px;
  padding: 6px;
}
.lp-vp-sub-lbl {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted) !important;
}
.lp-vp-streak {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 800;
  padding-top: 6px;
  border-top: 1px solid var(--glass-border) !important;
  margin-top: 4px;
}
.lp-vp-streak-sep {
  color: var(--glass-border) !important;
}

/* Toggle Switch matching style */
.lp-vp-sw {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 19px;
  flex-shrink: 0;
}
.lp-vp-sw input {
  opacity: 0;
  width: 0;
  height: 0;
}
.lp-vp-sw-track {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: rgba(255,255,255,0.08) !important;
  border-radius: 18px;
  transition: .25s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid var(--glass-border);
}
.lp-vp-sw-track:before {
  content: "";
  position: absolute;
  height: 13px;
  width: 13px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: .25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.lp-vp-sw input:checked + .lp-vp-sw-track {
  background: var(--accent-purple) !important;
  box-shadow: 0 0 8px rgba(191, 90, 242, 0.4);
}
.lp-vp-sw input:checked + .lp-vp-sw-track:before {
  transform: translateX(17px);
}

.lp-dpb-seq { display:flex; align-items:center; flex-wrap:wrap; gap:4px; min-height:28px; }
.lp-dpb-empty { font-size:10px; color:#475569; font-style:italic; }
.lp-dpb-tok { display:inline-flex; align-items:center; justify-content:center; min-width:24px; height:24px; border-radius:5px; background:#1e3a5f; color:#7dd3fc; font-size:10px; font-weight:900; border:1px solid #0ea5e9; cursor:pointer; padding:0 4px; transition:all .12s; letter-spacing:.3px; }
.lp-dpb-tok:hover { background:#ef4444; border-color:#ef4444; color:#fff; }
.lp-dpb-clear { width:18px; height:18px; border-radius:50%; border:none; background:#ef4444; color:#fff; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; margin-left:4px; }
.lp-dpb-palette { display:flex; flex-wrap:wrap; gap:3px; }
.lp-dpb-pill { padding:3px 8px; border-radius:20px; border:1px solid #334155; background:#1e293b; color:#94a3b8; font-size:10px; font-weight:800; cursor:pointer; transition:all .12s; letter-spacing:.3px; }
.lp-dpb-pill:hover { background:#0ea5e9; border-color:#0ea5e9; color:#fff; transform:scale(1.05); }
.lp-dpb-preview { display:flex; align-items:center; flex-wrap:wrap; gap:2px; padding-top:4px; border-top:1px solid #1e293b; }
.lp-dpb-arrow { color:#475569; font-size:9px; margin:0 1px; }
.lp-dpb-prv-tok { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; border-radius:4px; font-size:9px; font-weight:900; padding:0 3px; }
.lp-dpb-prv-e  { background:#166534; color:#4ade80; border:1px solid #16a34a; }
.lp-dpb-prv-o  { background:#1e3a8a; color:#93c5fd; border:1px solid #3b82f6; }
.lp-dpb-prv-v  { background:#7c3aed; color:#e9d5ff; border:1px solid #9333ea; }
.lp-dpb-prv-u  { background:#92400e; color:#fcd34d; border:1px solid #d97706; }
.lp-dpb-prv-d  { background:#374151; color:#e5e7eb; border:1px solid #6b7280; }
.lp-dpb-prv-m  { background:#134e4a; color:#5eead4; border:1px solid #14b8a6; }
.lp-dpb-prv-se { background:#064e3b; color:#6ee7b7; border:1px solid #10b981; }
.lp-dpb-prv-so { background:#1e1b4b; color:#a5b4fc; border:1px solid #6366f1; }
.lp-dpb-prv-r  { background:#14532d; color:#86efac; border:1px solid #22c55e; }
.lp-dpb-prv-f  { background:#7f1d1d; color:#fca5a5; border:1px solid #ef4444; }

/* ── Trade Pattern Builder ───────────────────────────── */
.lp-tpb-row { display:flex; align-items:center; gap:6px; margin:5px 0 4px; flex-wrap:wrap; }
.lp-tpb-lbl-check { display:flex; align-items:center; gap:3px; cursor:pointer; }
.lp-tpb-lbl-check input { accent-color:#6366f1; cursor:pointer; }
.lp-tpb-expand { background:#6366f1; color:#fff; border:none; border-radius:4px; padding:2px 8px; font-size:10px; font-weight:800; cursor:pointer; }
.lp-tpb-inline-preview { display:flex; gap:2px; }
.lp-tpb-mini { width:16px; height:16px; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:900; }
.lp-tpb-mini.trade { background:#166534; color:#4ade80; }
.lp-tpb-mini.skip  { background:#7f1d1d; color:#fca5a5; }

.lp-tpb { display:flex; flex-direction:column; gap:5px; padding:8px 10px; background:#0f172a; border:1px solid #334155; border-radius:7px; margin-bottom:6px; }
.lp-tpb-seq { display:flex; align-items:center; flex-wrap:wrap; gap:5px; }
.lp-tpb-cell { display:flex; flex-direction:column; align-items:center; justify-content:center; width:32px; height:38px; border-radius:6px; border:2px solid transparent; cursor:pointer; transition:all .15s; }
.lp-tpb-cell.trade { background:#166534; border-color:#16a34a; }
.lp-tpb-cell.skip  { background:#7f1d1d; border-color:#ef4444; }
.lp-tpb-cell:hover { opacity:.8; transform:scale(1.08); }
.lp-tpb-num { font-size:8px; font-weight:700; color:#9ca3af; }
.lp-tpb-label { font-size:11px; font-weight:900; color:#fff; }
.lp-tpb-add { width:28px; height:38px; border-radius:6px; border:2px dashed #334155; background:transparent; color:#6b7280; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
.lp-tpb-add:hover { border-color:#6366f1; color:#6366f1; }
.lp-tpb-rm  { width:28px; height:38px; border-radius:6px; border:2px dashed #7f1d1d; background:transparent; color:#ef4444; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
.lp-tpb-rm:hover { background:#7f1d1d; }
.lp-tpb-legend { display:flex; gap:8px; align-items:center; }
.lp-tpb-leg-t { font-size:10px; font-weight:800; color:#4ade80; }
.lp-tpb-leg-s { font-size:10px; font-weight:800; color:#fca5a5; }

/* ── Martingale Active Dot ──────────────────────────────── */
.lp-mg-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  animation: lp-mg-blink 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes lp-mg-blink {
  0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); opacity: 1; }
  50%  { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); opacity: 0.7; }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); opacity: 1; }
}

/* ── Responsive: Tablet (< 900px) ───────────────────────── */
@media (max-width: 900px) {
  .lp-root {
    flex-direction: column;
    padding: 16px;
    align-items: stretch !important;
  }
  .lp-main {
    overflow: visible;
    margin-right: 0 !important;
  }
  .lp-right {
    width: 100% !important;
    height: auto !important;
    position: static !important;
    max-height: none !important;
    border-radius: 14px;
    margin-top: 12px;
  }
  .lp-settings-row { flex-wrap: wrap; gap: 6px; }
  .lp-sg { min-width: calc(50% - 4px); flex: none; }
  .lp-sg-wide { min-width: 100%; flex: none; }
  .lp-mc-grid { grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 6px; }
  .lp-title { font-size: 20px !important; }
}

/* ── Responsive: Mobile (< 600px) ───────────────────────── */
@media (max-width: 600px) {
  .lp-root { padding: 16px; }
  .lp-main { gap: 6px; }

  /* Settings: 2-column grid */
  .lp-settings-row {
    display: grid !important;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .lp-sg { min-width: 0; width: 100%; flex: none; }
  .lp-sg-wide { grid-column: 1 / -1; }

  /* Stack virtual system cards vertically for better space */
  .lp-vp-grid {
    grid-template-columns: 1fr !important;
    gap: 8px;
  }

  /* Market cards: exactly 2 per row */
  .lp-mc-grid {
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 5px;
    padding: 8px;
  }
  .lp-market-card { padding: 7px; }
  .lp-mc-label { font-size: 11px !important; }
  .lp-mc-rl { font-size: 8px !important; width: 28px !important; }
  .lp-bubble { width: 18px !important; height: 18px !important; font-size: 9px !important; }
  .lp-bubbles { gap: 2px !important; }

  /* Market chip filter */
  .lp-market-chips { gap: 4px; }
  .lp-chip { padding: 3px 8px; font-size: 11px; }

  /* Header */
  .lp-header-card { padding: 10px 10px 8px; border-radius: 12px; }
  .lp-title { font-size: 17px !important; }
  .lp-subtitle { font-size: 11px !important; }

  /* Strategy builder */
  .lp-strategy { padding: 10px; }
  .lp-cond-row { gap: 4px; }

  /* Exec button */
  .lp-exec-btn { padding: 12px 0; font-size: 13px !important; }

  /* Right panel */
  .lp-right { border-radius: 12px; padding: 8px; gap: 8px; }
  .lp-run-hdr { flex-wrap: wrap; }
  .lp-tx-list { max-height: 200px !important; }
}

/* ── Responsive: Small phones (< 400px) ─────────────────── */
@media (max-width: 400px) {
  .lp-title { font-size: 15px !important; }
  .lp-bubble { width: 16px !important; height: 16px !important; font-size: 8px !important; }
  .lp-market-card { padding: 5px; }
  .lp-sg { padding: 8px 10px; }
}
`;

