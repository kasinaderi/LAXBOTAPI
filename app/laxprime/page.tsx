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
  Strategy, Condition, TradeLog, PatternTrigger, PatternBox,
  AdaptiveSwitch, AdaptiveSwitchStep,
  ALL_MARKETS as BOT_ALL_MARKETS,
  TRADE_OPTIONS as BOT_TRADE_OPTIONS,
  createCondition, createStrategy, needsBarrier,
  botTradeIds,
} from '@/store/useBotStore';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
  { value: 'GREEN_BAR',     label: 'GREEN BAR IS ON DIGIT' },
  { value: 'DIGIT_PATTERN', label: 'DIGIT PATTERN' },
  { value: 'DIGIT_APPEARS', label: 'IF DIGIT ( ) APPEARS' },
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
  switch (c.type) {
    case 'EVEN_PCT':      return `EVEN % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'ODD_PCT':       return `ODD % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'FALL_PCT':      return `FALL % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'RISE_PCT':      return `RISE % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'OVER_PCT':      return `OVER(${c.digitBarrier ?? 4}) % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'UNDER_PCT':     return `UNDER(${c.digitBarrier ?? 4}) % ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'LAST_DIGITS': {
      const showB = c.digitValue === 'OVER' || c.digitValue === 'UNDER' || c.digitValue === 'EQUAL';
      return `last ${c.lastN} digits are ${c.digitValue}${showB ? ' ' + (c.digitBarrier ?? 4) : ''}`;
    }
    case 'GREEN_BAR':     return `GREEN BAR on ${c.barValue} with pct ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'DIGIT_PATTERN': return `PATTERN [${(c.pattern || []).join('→')}]`;
    case 'DIGIT_APPEARS': {
      const targetDigits = c.targetDigits && c.targetDigits.length > 0 ? c.targetDigits : [c.digitBarrier ?? 5];
      return `DIGIT ${targetDigits.join(' AND ')} APPEARS ${c.comparator} ${c.value} times in last ${c.period} ticks`;
    }
    default:              return '';
  }
}

function strategySummary(s: Strategy, idx: number): string {
  if (!s.conditions.length) return `Strategy ${idx + 1}: no conditions`;
  const cond = s.conditions.map((c, i) => `${i > 0 ? c.join + ' ' : ''}${conditionText(c)}`).join(' ');
  const label = TRADE_OPTIONS.find(t => t.value === s.tradeType)?.label || s.tradeType;
  return `If ${cond}, trade ${label} for ${s.ticks} ticks.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────



const STRATEGY_BG = [
  'lp-strat-blue', 'lp-strat-pink', 'lp-strat-purple', 'lp-strat-green', 'lp-strat-orange',
];

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION ROW COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// DIGIT PATTERN BUILDER COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN needs-barrier helper (for pattern triggers)
// ─────────────────────────────────────────────────────────────────────────────

function tokenNeedsBarrier(token: string): boolean {
  return token === 'V' || token === 'U' || token === 'M' || token === 'D';
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVANCED PATTERN BUILDER — Multi-Entry Sequence (LaxSniper XV style)
// ─────────────────────────────────────────────────────────────────────────────

function getTokenBgColor(token: string): string {
  switch (token) {
    case 'U': return '#2563eb'; // Blue
    case 'V': return '#059669'; // Green
    case 'E': return '#0d9488'; // Teal
    case 'O': return '#ea580c'; // Orange
    case 'D': return '#dc2626'; // Red
    case 'M': return '#7c3aed'; // Purple
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
        {/* Only show +Add Box when OR mode (THEN/THENALL only need 2 boxes) */}
        {(cond.patternBoxMode ?? 'OR') === 'OR' && (
          <button className="lp-apb-add-btn" onClick={addBox}>+ Add Box</button>
        )}
        {(cond.patternBoxMode === 'THEN' || cond.patternBoxMode === 'THENALL') && boxes.length < 2 && (
          <button className="lp-apb-add-btn" onClick={addBox}>+ Add Box 2</button>
        )}
      </div>

      {/* Dynamic orientation hint based on mode */}
      {cond.patternBoxes && cond.patternBoxes.length > 0 && (() => {
        const mode = cond.patternBoxMode ?? 'OR';
        const hintMap: Record<string, string> = {
          OR:      'Each trigger = 1 tick · Left = oldest, Right = latest · Multiple boxes = OR alternatives',
          THEN:    'Box 1 triggers → locks market → Box 2 must fire within timeout ticks',
          THENALL: 'Box 1 triggers → ALL markets scanned for Box 2 → fires up to max trades',
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
            // In THEN/THENALL mode: hide any boxes beyond the first 2
            if ((mode === 'THEN' || mode === 'THENALL') && bi >= 2) return null;

            return (
              <React.Fragment key={bi}>
                {/* Separator between boxes */}
                {bi > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 4px', gap: '6px' }}>

                    {/* Mode cycle chip — click to cycle OR→THEN→THENALL */}
                    {bi === 1 && (() => {
                      const curMode = cond.patternBoxMode ?? 'OR';
                      const nextMode = curMode === 'OR' ? 'THEN' : curMode === 'THEN' ? 'THENALL' : 'OR';
                      const modeStyles: Record<string, { bg: string; color: string; glow: string }> = {
                        OR:      { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', glow: '0 0 6px rgba(245,158,11,0.3)' },
                        THEN:    { bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf', glow: '0 0 6px rgba(20,184,166,0.35)' },
                        THENALL: { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa', glow: '0 0 6px rgba(139,92,246,0.4)' },
                      };
                      const st = modeStyles[curMode];
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

                          {/* THEN / THENALL config inputs */}
                          {(curMode === 'THEN' || curMode === 'THENALL') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center', minWidth: '72px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>⏱ TIMEOUT</span>
                                <input
                                  type="number" min={1} max={500}
                                  value={cond.thenTimeout ?? 20}
                                  onChange={e => onChange({ ...cond, thenTimeout: Math.max(1, +e.target.value || 20) })}
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

                    {/* Simple separator for boxes beyond the first pair (OR mode only) */}
                    {bi > 1 && (
                      <span style={{ fontSize: 9, fontWeight: 900, color: '#f59e0b', letterSpacing: 1, background: 'rgba(245,158,11,0.1)', borderRadius: 4, padding: '2px 4px' }}>OR</span>
                    )}
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
        </>
      )}

      {(cond.type === 'OVER_PCT' || cond.type === 'UNDER_PCT') && (
        <>
          <span className="lp-unit">( </span>
          <input className="lp-num lp-sm" type="number" min={0} max={9} value={cond.digitBarrier ?? 4}
            onChange={e => u({ digitBarrier: +e.target.value })} title="Barrier digit" />
          <span className="lp-unit"> )</span>
          <select className="lp-sel lp-cmp" value={cond.comparator} onChange={e => u({ comparator: e.target.value })}>
            {COMPARATORS.map(c => <option key={c}>{c}</option>)}
          </select>
          <input className="lp-num" type="number" min={0} max={100} value={cond.value}
            onChange={e => u({ value: +e.target.value })} />
          <span className="lp-unit">% in last</span>
          <input className="lp-num lp-sm" type="number" min={1} max={1000} value={cond.period}
            onChange={e => u({ period: +e.target.value })} />
          <span className="lp-unit">ticks</span>
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

      {cond.type === 'GREEN_BAR' && (
        <>
          <span className="lp-txt">IS ON DIGIT</span>
          <select className="lp-sel lp-cmp" value={cond.barValue} onChange={e => u({ barValue: +e.target.value })}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="lp-txt">WITH PCT</span>
          <select className="lp-sel lp-cmp" value={cond.comparator} onChange={e => u({ comparator: e.target.value })}>
            {COMPARATORS.map(c => <option key={c}>{c}</option>)}
          </select>
          <input className="lp-num lp-sm" type="number" min={0} max={100} value={cond.value}
            onChange={e => u({ value: +e.target.value })} />
          <span className="lp-unit">% in last</span>
          <input className="lp-num lp-sm" type="number" min={1} max={1000} value={cond.period}
            onChange={e => u({ period: +e.target.value })} />
          <span className="lp-unit">ticks</span>
        </>
      )}

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

      <button className="lp-rm-cond" onClick={onRemove} title="Remove condition">−</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADE PATTERN BUILDER COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function TradePatternBuilder({ pattern, onChange }: {
  pattern: boolean[];
  onChange: (p: boolean[]) => void;
}) {
  const toggle = (i: number) => onChange(pattern.map((v, idx) => idx === i ? !v : v));
  const addTick = () => onChange([...pattern, true]);
  const removeLast = () => { if (pattern.length > 1) onChange(pattern.slice(0, -1)); };

  return (
    <div className="lp-tpb">
      <div className="lp-tpb-seq">
        {pattern.map((trade, i) => (
          <button
            key={i}
            className={`lp-tpb-cell ${trade ? 'trade' : 'skip'}`}
            onClick={() => toggle(i)}
            title={`Tick ${i + 1}: ${trade ? 'TRADE (click to SKIP)' : 'SKIP (click to TRADE)'}`}
          >
            <span className="lp-tpb-num">{i + 1}</span>
            <span className="lp-tpb-label">{trade ? 'T' : 'S'}</span>
          </button>
        ))}
        <button className="lp-tpb-add" onClick={addTick} title="Add tick">+</button>
        {pattern.length > 1 && (
          <button className="lp-tpb-rm" onClick={removeLast} title="Remove last">−</button>
        )}
      </div>
      <div className="lp-tpb-legend">
        <span className="lp-tpb-leg-t">T=TRADE</span>
        <span className="lp-tpb-leg-s">S=SKIP</span>
        <span style={{ color: '#9ca3af', fontSize: 10 }}>Click cell to toggle</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY BLOCK COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

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

  const { selectedMarkets, adaptiveSwitch } = useBotStore();

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

      {/* Trade Pattern toggle - hidden when adaptive switch is active */}
      {!adaptiveSwitchEnabled && (
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
      {!adaptiveSwitchEnabled && strategy.useTradePattern && showPattern && (
        <TradePatternBuilder
          pattern={strategy.tradePattern || [true]}
          onChange={p => u({ tradePattern: p })}
        />
      )}
      {/* No Contradiction — hidden, always active */}
      <button className="lp-add-cond-btn" onClick={addCond}>+ CONDITION</button>

      <div className="lp-summary">{strategySummary(strategy, index)}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET CARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// TRADE LOG PANEL
// ─────────────────────────────────────────────────────────────────────────────

function TradeLogPanel({ logs: rawLogs, stats, onReset }: {
  logs: TradeLog[];
  stats: { won: number; lost: number; totalProfit: number; totalTrades: number };
  onReset: () => void;
}) {
  const [tab, setTab] = useState<'transactions' | 'summary' | 'journal'>('transactions');

  // Direct, superfast reading of real trades from the Deriv store
  const derivLogs = useDerivStore(state => state.tradeLogs);

  const combinedLogs = React.useMemo(() => {
    // 1. Map real trades from Deriv store
    const realBotLogs = derivLogs
      .filter(l => l.requestId && botTradeIds.has(String(l.requestId)))
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
      .filter(l => String(l.id).startsWith('VIRT_'))
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
        <button className="lp-tx-btn">Download</button>
        <button className="lp-tx-btn">View Detail</button>
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
              {combinedLogs.slice(0, 30).map(log => {
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

                    <span style={{ fontWeight: '500', color: '#4b5563' }}>USD {log.stake.toFixed(2)}</span>

                    <span style={{ fontFamily: 'monospace', fontWeight: '700', color: '#1f2937' }}>
                      {getExitDisplay(log)}
                    </span>

                    <div className={`lp-tx-pnl ${isVirt ? 'virt' : log.profit >= 0 ? 'pos' : 'neg'}`}>
                      {virtLive ? (
                        <span style={{ fontSize: 9, color: '#818cf8', fontStyle: 'italic' }}>VIRT…</span>
                      ) : live ? (
                        <Loader2 size={10} className="lp-spin" />
                      ) : isVirt ? (
                        <span style={{ fontSize: 9, color: (virtWon ? '#818cf8' : '#a78bfa'), fontStyle: 'italic' }}>
                          {virtWon ? '+' : ''}{log.profit.toFixed(2)}
                        </span>
                      ) : (
                        `${log.profit >= 0 ? '+' : ''}${log.profit.toFixed(2)}`
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
            {rawLogs.length === 0 ? 'No summary data yet.' : `${stats.totalTrades} trades completed.`}
          </span>
        </div>      )}

      {tab === 'journal' && (
        <div className="lp-tx-empty" style={{ paddingTop: 24 }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>No journal entries yet.</span>
        </div>
      )}

      <div className="lp-tx-stats">
        <div className="lp-tx-stat-row">
          <div className="lp-tx-stat"><span className="lp-tsl">Total stake</span><span className="lp-tsv">0.00 USD</span></div>
          <div className="lp-tx-stat"><span className="lp-tsl">Total payout</span><span className="lp-tsv">0.00 USD</span></div>
          <div className="lp-tx-stat"><span className="lp-tsl">No. of runs</span><span className="lp-tsv">{stats.totalTrades}</span></div>
        </div>
        <div className="lp-tx-stat-row" style={{ marginTop: 8 }}>
          <div className="lp-tx-stat"><span className="lp-tsl">Contracts lost</span><span className="lp-tsv">{stats.lost}</span></div>
          <div className="lp-tx-stat"><span className="lp-tsl">Contracts won</span><span className="lp-tsv">{stats.won}</span></div>
          <div className="lp-tx-stat">
            <span className="lp-tsl">Total profit/loss</span>
            <span className={`lp-tsv ${stats.totalProfit >= 0 ? 'pos' : 'neg'}`}>
              {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(2)} USD
            </span>
          </div>
        </div>
        <button className="lp-reset-btn" onClick={onReset}>Reset</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function LaxPrimePage() {
  const { status, account, isTradeAuthorized, virtualSettings, setVirtualSettings } = useDerivStore();
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
    globalStats,
    signalFlash,
    startBot, stopBot, resetAll,
    theme, setTheme,
    crossMarketDelay, setCrossMarketDelay,
    adaptiveSwitch, setAdaptiveSwitch,
    adaptiveLiveStatus,
  } = useBotStore();

  const [showVirtualPanel,   setShowVirtualPanel]   = useState(false);
  const [showSwitcherPanel,  setShowSwitcherPanel]  = useState(false);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);

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
    if (isRunning) stopBot();
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
      <div className="lp-risk-disc">⚠ Risk Disclaimer!</div>

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
                {theme === 'dark' ? '☀️' : '🌑'}
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
                <label className="lp-sl">MARTINGALE</label>
                {tradingMode === 'continuous' && (
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
              <button
                className="lp-virt-toggle-btn"
                onClick={() => setShowVirtualPanel(v => !v)}
                title="Toggle Virtual System panel">
                ⚗ VIRTUAL SYSTEM {showVirtualPanel ? '▲' : '▼'}
                {virtualSettings.isVirtualMode && <span className="lp-virt-active-dot" />}
              </button>
              <button
                className={`lp-switcher-btn ${adaptiveSwitch.enabled ? 'active' : ''}`}
                onClick={() => setShowSwitcherPanel(v => !v)}
                title="Toggle Switcher panel">
                ⚡ SWITCHER {showSwitcherPanel ? '▲' : '▼'}
                {adaptiveSwitch.enabled && <span className="lp-sw-active-dot" />}
              </button>
              <button className="lp-add-strat-btn"
                onClick={() => {
                  if (strategies.length >= 5) return;
                  setStrategies(p => [...p, createStrategy(p.length)]);
                }}
                disabled={strategies.length >= 5}>
                + ADD STRATEGY
              </button>
            </div>

            {showVirtualPanel && (
              <div className="lp-vp">
                <div className="lp-vp-hdr">
                  <span className="lp-vp-title">⚗ VIRTUAL SYSTEM</span>
                  <span className={`lp-vp-badge ${virtualSettings.isVirtualMode ? 'lp-vp-badge--virtual' : 'lp-vp-badge--real'}`}>
                    {virtualSettings.isVirtualMode ? '● VIRTUAL TRACKING ACTIVE' : '● REAL EXECUTION ACTIVE'}
                  </span>
                  <button
                    className={`lp-vp-force-btn ${virtualSettings.isVirtualMode ? 'lp-vp-force-btn--toreal' : 'lp-vp-force-btn--tovirt'}`}
                    onClick={() => setVirtualSettings({ isVirtualMode: !virtualSettings.isVirtualMode })}>
                    {virtualSettings.isVirtualMode ? '→ SWITCH TO REAL' : '→ SWITCH TO VIRTUAL'}
                  </button>
                </div>

                <div className="lp-vp-grid">
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
                        <div className="lp-vp-sub">
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

                {/* Switcher Mode Tabs (Sequence Steps vs Adaptive Auto-Switch) */}
                <div style={{ display: 'flex', gap: '6px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '8px', marginBottom: '12px' }}>
                  <button
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
                    onClick={() => setAdaptiveSwitch({ ...adaptiveSwitch, mode: 'adaptive' })}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 'bold',
                      background: (adaptiveSwitch.mode || 'sequence') === 'adaptive' ? '#7c3aed' : 'transparent',
                      color: (adaptiveSwitch.mode || 'sequence') === 'adaptive' ? '#ffffff' : 'rgba(255,255,255,0.6)',
                      border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    ⚡ ADAPTIVE CONTRACTS
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

                {/* Steps List (Only when mode === 'sequence') */}
                {(adaptiveSwitch.mode || 'sequence') === 'sequence' && (
                <div className="lp-sw-steps">
                  {adaptiveSwitch.steps.map((step, si) => {
                    const stepTrades = step.trades && step.trades.length > 0
                      ? step.trades
                      : [{ contractType: step.contractType || 'DIGITEVEN', barrier: 4, count: 1 }];

                    const updateStepTrades = (newTrades: typeof stepTrades) => {
                      const next = [...adaptiveSwitch.steps];
                      next[si] = { ...next[si], trades: newTrades };
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
                                      value={t.ticks ?? 5}
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
                        : [{ contractType: step.contractType || 'DIGITEVEN', count: 1 }];

                      const label = stepTrades.map(t => {
                        const lbl = TRADE_OPTIONS.find(o => o.value === t.contractType)?.label || t.contractType;
                        return t.count > 1 ? `${lbl} (x${t.count})` : lbl;
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
              {virtualSettings.isVirtualMode ? '⚗ VIRT' : '💰 REAL'}
            </button>
            <span className="lp-run-status">
              {isRunning
                ? <><span className="lp-dot connected" />Bot is running</>
                : <><span className="lp-dot" />Bot is not running</>}
            </span>
          </div>

          {/* Quick stats row */}
          {isRunning && (
            <div className="lp-quick-stats">
              <div className="lp-qs"><span className="lp-qs-l">W</span><span className="lp-qs-v green">{globalStats.won}</span></div>
              <div className="lp-qs"><span className="lp-qs-l">L</span><span className="lp-qs-v red">{globalStats.lost}</span></div>
              <div className="lp-qs">
                <span className="lp-qs-l">P/L</span>
                <span className={`lp-qs-v ${globalStats.totalProfit >= 0 ? 'green' : 'red'}`}>
                  {globalStats.totalProfit >= 0 ? '+' : ''}{globalStats.totalProfit.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Trade Log Panel */}
          <TradeLogPanel logs={tradeLogs} stats={globalStats} onReset={resetAll} />

          {/* Footer */}
          <div className="lp-right-footer">
            <span className={`lp-dot ${status === 'connected' ? 'connected' : ''}`} />
            <span className="lp-time">{new Date().toLocaleString('en-GB', { hour12: false }).replace(',', '')}</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

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

