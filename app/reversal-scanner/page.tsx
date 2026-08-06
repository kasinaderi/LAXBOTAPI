'use client';

import './scanner.css';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import { useScannerStore } from '@/store/useScannerStore';
import { derivWS } from '@/lib/deriv/websocket';
import { Play, Square, ChevronDown, AlertTriangle, Loader2, Layers, ShieldAlert } from 'lucide-react';
import {
  useBotStore,
  Strategy, Condition, TradeLog, PatternTrigger, PatternBox,
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
  { value: 'LAST_DIGITS',   label: 'LAST N DIGITS ARE' },
  { value: 'GREEN_BAR',     label: 'GREEN BAR IS ON DIGIT' },
  { value: 'DIGIT_PATTERN', label: 'DIGIT PATTERN' },
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
    case 'LAST_DIGITS': {
      const showB = c.digitValue === 'OVER' || c.digitValue === 'UNDER' || c.digitValue === 'EQUAL';
      return `last ${c.lastN} digits are ${c.digitValue}${showB ? ' ' + (c.digitBarrier ?? 4) : ''}`;
    }
    case 'GREEN_BAR':     return `GREEN BAR on ${c.barValue} with pct ${c.comparator} ${c.value}% in last ${c.period} ticks`;
    case 'DIGIT_PATTERN': return `PATTERN [${(c.pattern || []).join('→')}]`;
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
  return token === 'V' || token === 'U';
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVANCED PATTERN BUILDER — Multi-Entry Sequence (LaxSniper XV style)
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
      <div className="lp-apb-header">
        <span className="lp-apb-title">Multi-Entry Sequence</span>
        <button className="lp-apb-add-btn" onClick={addBox}>+ Add Box</button>
      </div>

      {/* Boxes */}
      <div className="lp-apb-grid">
        {boxes.map((box, bi) => (
          <div key={bi} className="lp-apb-card">
            <div className="lp-apb-card-hdr">
              <span className="lp-apb-card-title">Box {bi + 1}</span>
              {boxes.length > 1 && (
                <button className="lp-apb-card-remove" onClick={() => removeBox(bi)}>✕</button>
              )}
            </div>

            {/* Triggers list */}
            <div className="lp-apb-triggers">
              {box.triggers.map((trig, ti) => (
                <div key={ti} className="lp-apb-trig-row">
                  <select
                    className="lp-sel lp-apb-tok-sel"
                    value={trig.token}
                    onChange={e => updateTrigger(bi, ti, { token: e.target.value, barrier: tokenNeedsBarrier(e.target.value) ? (trig.barrier ?? 4) : undefined })}
                  >
                    {PATTERN_TOKENS.map(pt => (
                      <option key={pt.value} value={pt.value} title={pt.title}>{pt.label}</option>
                    ))}
                  </select>
                  {tokenNeedsBarrier(trig.token) ? (
                    <input
                      className="lp-num lp-apb-trig-inp"
                      type="number" min={0} max={9}
                      value={trig.barrier ?? 4}
                      onChange={e => updateTrigger(bi, ti, { barrier: +e.target.value })}
                    />
                  ) : (
                    <span className="lp-apb-trig-dash">—</span>
                  )}
                  {box.triggers.length > 1 && (
                    <button className="lp-apb-trig-rm" onClick={() => removeTrigger(bi, ti)}>✕</button>
                  )}
                </div>
              ))}
            </div>

            <button className="lp-apb-add-trig" onClick={() => addTrigger(bi)}>+ trigger</button>
          </div>
        ))}
      </div>

      {/* Retrigger */}
      <div className="lp-apb-retrig-row">
        <span className="lp-unit" style={{ fontSize: 10 }}>Retrigger:</span>
        <select className="lp-sel" style={{ fontSize: 11 }} value={cond.patternRetrigger || 'any'}
          onChange={e => onChange({ ...cond, patternRetrigger: e.target.value })}>
          {PATTERN_RETRIGGER.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* USE CUSTOM CONTRACTS — only visible inside DIGIT_PATTERN */}
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

      <select className="lp-sel lp-ctype" value={cond.type} onChange={e => u({ type: e.target.value as Condition['type'] })}>
        {CONDITION_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
      </select>

      {(cond.type === 'EVEN_PCT' || cond.type === 'ODD_PCT') && (
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

function StrategyBlock({ strategy, index, onChange, onRemove }: {
  strategy: Strategy;
  index: number;
  onChange: (s: Strategy) => void;
  onRemove: () => void;
}) {
  const [showPattern, setShowPattern] = useState(false);
  const u = (p: Partial<Strategy>) => onChange({ ...strategy, ...p });

  const addCond = () => u({ conditions: [...strategy.conditions, createCondition()] });
  const removeCond = (id: string) => u({ conditions: strategy.conditions.filter(c => c.id !== id) });
  const updateCond = (id: string, updated: Condition) =>
    u({ conditions: strategy.conditions.map(c => c.id === id ? updated : c) });

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

      {/* THEN TRADE row */}
      <div className="lp-then-row">
        <span className="lp-then-lbl">THEN TRADE</span>
        <select className="lp-sel lp-trade-sel" value={strategy.tradeType} onChange={e => u({ tradeType: e.target.value })}>
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
            <input className="lp-num lp-sm" type="number" min={1} max={100} value={strategy.ticks}
              onChange={e => u({ ticks: +e.target.value })} />
            <span className="lp-unit">TICKS</span>
          </>
        )}
      </div>

      {/* Trade Pattern toggle */}
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
      {strategy.useTradePattern && showPattern && (
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
    };
    return m[type] || type;
  };

  const getExitDisplay = (log: any) => {
    const isRiseFall = log.contract === 'CALL' || log.contract === 'PUT';

    if (isRiseFall) {
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
                const virtWon  = isVirt && (log.result === 'VIRT WON'  || log.result === 'WON');
                const virtLost = isVirt && (log.result === 'VIRT LOST' || log.result === 'LOST');
                const live   = !isVirt && (log.result === 'SENT' || log.result === 'BUYING...' || log.result === 'RUNNING...' || log.result === 'RUNNING');
                const virtLive = isVirt && log.result === 'VIRTUAL';

                return (
                  <div key={log.id} className={`lp-tx-row ${won ? 'won' : lost ? 'lost' : isVirt ? 'virt' : ''}`}>
                    <div className="lp-tx-contract">
                      <span className="lp-tx-type">{contractLabel(log.contract)}</span>
                      <span className="lp-tx-sym">{log.symbol}</span>
                      {isVirt && <span className="lp-virt-badge">VIRT</span>}
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
  } = useBotStore();

  const [showVirtualPanel, setShowVirtualPanel] = useState(false);

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
            <div className="lp-sg lp-sg-wide">
              <label className="lp-sl">TRADING MODE</label>
              <select className="lp-si lp-mode" value={tradingMode} onChange={e => setTradingMode(e.target.value)}>
                {TRADING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
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
              <button className="lp-circles-btn">Circles</button>
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
                      <div className="lp-vp-sub">
                        <span className="lp-vp-sub-lbl">Trigger on:</span>
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
                        <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.vThreshold}
                          onChange={e => setVirtualSettings({ vThreshold: +e.target.value || 0 })} />
                      </div>
                    )}
                    <div className="lp-vp-streak">
                      <span style={{ color: '#4ade80' }}>{virtualSettings.virtualWins}W</span>
                      <span style={{ color: '#f87171' }}>{virtualSettings.virtualLosses}L</span>
                      <span className="lp-vp-streak-sep">|</span>
                      <span style={{ color: '#86efac' }}>Streak {virtualSettings.vConsecWins}W / {virtualSettings.vConsecLosses}L</span>
                    </div>
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
                        <input className="lp-num lp-sm" type="number" min={1} value={virtualSettings.rThreshold}
                          onChange={e => setVirtualSettings({ rThreshold: +e.target.value || 0 })} />
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

            <div className="lp-strats-list">
              {strategies.map((s, i) => (
                <StrategyBlock
                  key={s.id}
                  strategy={s}
                  index={i}
                  onChange={updated => setStrategies(p => p.map(x => x.id === updated.id ? updated : x))}
                  onRemove={() => setStrategies(p => p.filter(x => x.id !== s.id))}
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

