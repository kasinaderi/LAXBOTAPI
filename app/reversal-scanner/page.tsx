'use client';

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

function MarketCard({ symbol, label, isFlashing }: {
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
      <style>{STYLES}</style>

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
              <label className="lp-sl">MARTINGALE</label>
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
/* ── Root ──────────────────────────────────────────────── */
/* Use !important throughout so our scoped styles beat Tailwind's global html.dark cascade */
.lp-root { display:flex !important; gap:0; min-height:calc(100vh - 90px); font-family:'Inter',sans-serif; background:#f3f4f6 !important; }
.lp-main { flex:1; display:flex; flex-direction:column; gap:0; min-width:0; }

/* ── Header ─────────────────────────────────────────────── */
.lp-header-card { background:#fff !important; border:1px solid #e5e7eb !important; border-radius:10px 10px 0 0; padding:16px 22px 12px; text-align:center; }
.lp-title-row { display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:4px; }
.lp-title { font-size:22px; font-weight:900; color:#111 !important; display:flex; align-items:center; gap:8px; }
.lp-ai-badge { background:#06b6d4 !important; color:#fff !important; font-size:10px; font-weight:900; padding:2px 7px; border-radius:4px; letter-spacing:1px; }
.lp-premium-badge { background:linear-gradient(135deg,#f59e0b,#d97706) !important; color:#fff !important; font-size:10px; font-weight:800; padding:2px 10px; border-radius:20px; letter-spacing:1px; }
.lp-subtitle { font-size:12px; color:#6b7280 !important; }
.lp-subtitle strong { color:#06b6d4 !important; }

/* ── Auth Warning ───────────────────────────────────────── */
.lp-auth-warn { display:flex; align-items:center; gap:8px; padding:8px 14px; font-size:11px; font-weight:600; background:#fef9c3 !important; color:#854d0e !important; border-bottom:1px solid #fde68a !important; }
.lp-disconnected { background:#fee2e2 !important; color:#991b1b !important; }

/* ── Settings Row ───────────────────────────────────────── */
.lp-settings-row { display:flex; gap:0; border:1px solid #e5e7eb !important; border-top:none !important; background:#fff !important; }
.lp-sg { flex:1; padding:10px 12px; border-right:1px solid #e5e7eb !important; min-width:0; }
.lp-sg:last-child { border-right:none !important; }
.lp-sg-wide { flex:1.5; }
.lp-sl { display:block; font-size:10px; font-weight:800; color:#9ca3af !important; letter-spacing:0.8px; text-transform:uppercase; margin-bottom:3px; }
.lp-sl-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:3px; }
.lp-sl-row .lp-sl { margin-bottom:0; }
.lp-mode-pill { font-size:9px; font-weight:800; padding:1px 5px; border-radius:20px; border:1px solid #06b6d4 !important; background:#ecfeff !important; color:#0e7490 !important; cursor:pointer; letter-spacing:.3px; transition:all .15s; white-space:nowrap; line-height:1.4; }
.lp-mode-pill:hover { background:#06b6d4 !important; color:#fff !important; }
.lp-theme-toggle { font-size:13px; background:none !important; border:none !important; cursor:pointer; padding:1px 4px; border-radius:5px; transition:transform .2s; line-height:1; vertical-align:middle; opacity:.75; }
.lp-theme-toggle:hover { opacity:1; transform:scale(1.15); }
.lp-si { width:100%; border:1px solid #e5e7eb !important; border-radius:5px; padding:6px 8px; font-size:13px; font-weight:600; color:#111 !important; background:#fff !important; outline:none; }
.lp-si:focus { border-color:#06b6d4 !important; }
.lp-mode { font-size:11px; }

/* ══ DARK THEME (.lp-dark on .lp-root) ══════════════════════════════════════ */
.lp-dark { background:linear-gradient(160deg,#070d1e 0%,#0d1330 40%,#0a1225 100%) !important; }
.lp-dark .lp-header-card { background:linear-gradient(135deg,#0d1630 0%,#120e38 100%) !important; border-color:#1e3558 !important; box-shadow:0 4px 24px rgba(6,182,212,.1); }
.lp-dark .lp-title { color:#e2e8f0 !important; }
.lp-dark .lp-subtitle { color:#4b6cb7 !important; }
.lp-dark .lp-subtitle strong { color:#22d3ee !important; }
.lp-dark .lp-auth-warn { background:rgba(133,77,14,.18) !important; color:#fcd34d !important; border-color:rgba(252,211,77,.18) !important; }
.lp-dark .lp-disconnected { background:rgba(153,27,27,.2) !important; color:#fca5a5 !important; border-color:rgba(252,165,165,.15) !important; }
.lp-dark .lp-settings-row { background:linear-gradient(135deg,#0c1830,#0f0d30) !important; border-color:#1e3558 !important; }
.lp-dark .lp-sg { border-right-color:#1e3558 !important; }
.lp-dark .lp-sl { color:#4b6cb7 !important; }
.lp-dark .lp-si { background:#06091a !important; border-color:#1e3558 !important; color:#e2e8f0 !important; }
.lp-dark .lp-si:focus { border-color:#22d3ee !important; box-shadow:0 0 0 2px rgba(34,211,238,.12); }
.lp-dark select.lp-si option { background:#06091a !important; color:#e2e8f0 !important; }
.lp-dark .lp-mode-pill { background:rgba(34,211,238,.08) !important; border-color:#22d3ee !important; color:#22d3ee !important; }
.lp-dark .lp-mode-pill:hover { background:#22d3ee !important; color:#06091a !important; }
.lp-dark .lp-strategy-section { background:linear-gradient(135deg,#0a1428 0%,#0c0d28 100%) !important; border-color:#1e3558 !important; }
.lp-dark .lp-sec-title { color:transparent !important; background:linear-gradient(90deg,#22d3ee 0%,#818cf8 100%) !important; -webkit-background-clip:text; background-clip:text; }
.lp-dark .lp-strategy { background:rgba(12,22,55,.65) !important; border-color:#1e3558 !important; }
.lp-dark .lp-strat-blue   { background:rgba(30,58,138,.22) !important; border-color:#1e3a8a55 !important; }
.lp-dark .lp-strat-pink   { background:rgba(131,24,67,.18) !important; border-color:#83184355 !important; }
.lp-dark .lp-strat-purple { background:rgba(88,28,135,.22) !important; border-color:#581c8755 !important; }
.lp-dark .lp-strat-green  { background:rgba(6,78,59,.22) !important; border-color:#064e3b55 !important; }
.lp-dark .lp-strat-orange { background:rgba(120,53,15,.22) !important; border-color:#78350f55 !important; }
.lp-dark .lp-strat-name { color:#cbd5e1 !important; }
.lp-dark .lp-cond-badge { background:rgba(34,211,238,.08) !important; color:#22d3ee !important; }
.lp-dark .lp-toggle-label { color:#64748b !important; }
.lp-dark .lp-if-label { color:#64748b !important; }
.lp-dark .lp-sel { background:#06091a !important; border-color:#1e3558 !important; color:#cbd5e1 !important; }
.lp-dark .lp-add-cond-btn { background:rgba(34,211,238,.08) !important; color:#22d3ee !important; border:1px dashed rgba(34,211,238,.35) !important; }
.lp-dark .lp-add-cond-btn:hover { background:rgba(34,211,238,.18) !important; }
.lp-dark .lp-add-strat-btn { background:linear-gradient(135deg,#065f46,#047857) !important; }
.lp-dark .lp-summary { background:rgba(34,211,238,.04) !important; border-color:rgba(34,211,238,.12) !important; color:#4b6cb7 !important; }
.lp-dark .lp-summary strong { color:#22d3ee !important; }
.lp-dark .lp-rm-strat { background:#7f1d1d !important; }
.lp-dark .lp-then-row { background:rgba(34,211,238,.05) !important; border-color:rgba(34,211,238,.12) !important; }
.lp-dark .lp-markets-section { background:linear-gradient(135deg,#070d1e,#0a0d25) !important; border-color:#1e3558 !important; }
.lp-dark .lp-market-chips { background:transparent !important; }
.lp-dark .lp-mc-chip { background:#0a1430 !important; border-color:#1e3558 !important; color:#64748b !important; }
.lp-dark .lp-mc-chip.active { background:rgba(34,211,238,.12) !important; border-color:#22d3ee !important; color:#22d3ee !important; }
.lp-dark .lp-market-card { background:rgba(12,22,55,.8) !important; border-color:#1e3558 !important; }
.lp-dark .lp-mc-label { color:#94a3b8 !important; }
.lp-dark .lp-mc-sym { color:#e2e8f0 !important; }
.lp-dark .lp-bubble { background:#1e3558 !important; color:#94a3b8 !important; }
.lp-dark .lp-bubble.even { background:rgba(34,211,238,.15) !important; color:#22d3ee !important; }
.lp-dark .lp-bubble.odd  { background:rgba(129,140,248,.15) !important; color:#818cf8 !important; }
.lp-dark .lp-run-hdr { background:rgba(12,22,55,.9) !important; border-color:#1e3558 !important; }
.lp-dark .lp-status-row { background:rgba(6,9,26,.6) !important; border-color:#1e3558 !important; }
.lp-dark .lp-status-box { border-color:#1e3558 !important; }
.lp-dark .lp-status-label { color:#4b6cb7 !important; }
.lp-dark .lp-status-text { color:#e2e8f0 !important; }
.lp-dark .lp-signal-text { color:#22d3ee !important; }
.lp-dark .lp-bot-ctrl { background:linear-gradient(135deg,#070d1e,#0a0c25) !important; border-color:#1e3558 !important; }
.lp-dark .lp-ctrl-status { background:#06091a !important; border-color:#1e3558 !important; color:#4b6cb7 !important; }
.lp-dark .lp-stats-row { background:#06091a !important; border-color:#1e3558 !important; }
.lp-dark .lp-stat-val { color:#e2e8f0 !important; }
.lp-dark .lp-stat-val.pos { color:#34d399 !important; }
.lp-dark .lp-stat-val.neg { color:#f87171 !important; }
.lp-dark .lp-stat-lbl { color:#4b6cb7 !important; }
.lp-dark .lp-right { border-color:#1e3558 !important; }
.lp-dark .lp-right-card { background:linear-gradient(135deg,#070d1e,#0a0c25) !important; border-color:#1e3558 !important; }
.lp-dark .lp-last-signal { background:rgba(34,211,238,.06) !important; border-color:rgba(34,211,238,.18) !important; color:#22d3ee !important; }
.lp-dark .lp-tx-panel { background:#06091a !important; border-color:#1e3558 !important; }
.lp-dark .lp-tx-tabs { background:#070d1e !important; border-bottom-color:#1e3558 !important; }
.lp-dark .lp-tx-tab { color:#4b6cb7 !important; }
.lp-dark .lp-tx-tab.active { color:#22d3ee !important; border-bottom-color:#22d3ee !important; }
.lp-dark .lp-tx-actions { background:#06091a !important; border-bottom-color:#1e3558 !important; }
.lp-dark .lp-tx-btn { background:#0a1225 !important; border-color:#1e3558 !important; color:#64748b !important; }
.lp-dark .lp-tx-btn:hover { border-color:#22d3ee !important; color:#22d3ee !important; }
.lp-dark .lp-tx-hdr { border-bottom-color:#1e3558 !important; }
.lp-dark .lp-tx-hdr span { color:#4b6cb7 !important; }
.lp-dark .lp-tx-row { border-bottom-color:#1e3558 !important; }
.lp-dark .lp-tx-row.won  { background:rgba(6,78,59,.22) !important; }
.lp-dark .lp-tx-row.lost { background:rgba(127,29,29,.22) !important; }
.lp-dark .lp-tx-row.virt { background:rgba(88,28,135,.18) !important; border-left-color:#818cf8 !important; }
.lp-dark .lp-virt-badge  { background:#818cf8 !important; }
.lp-dark .lp-tx-type  { color:#e2e8f0 !important; }
.lp-dark .lp-tx-sym { color:#4b6cb7 !important; }
.lp-dark .lp-tx-empty span { color:#4b6cb7 !important; }
.lp-dark .lp-tx-stats { background:#070d1e !important; border-top-color:#1e3558 !important; }
.lp-dark .lp-tsl { color:#4b6cb7 !important; }
.lp-dark .lp-tsv { color:#94a3b8 !important; }
.lp-dark .lp-tsv.pos { color:#34d399 !important; }
.lp-dark .lp-tsv.neg { color:#f87171 !important; }
.lp-dark .lp-reset-btn { background:rgba(127,29,29,.3) !important; border-color:rgba(239,68,68,.3) !important; color:#f87171 !important; }
.lp-dark .lp-right-footer { background:#06091a !important; border-top-color:#1e3558 !important; color:#4b6cb7 !important; }
.lp-dark .lp-dot { background:#4b6cb7 !important; }
.lp-dark .lp-dot.connected { background:#22d3ee !important; box-shadow:0 0 6px #22d3ee88; }
.lp-dark .lp-time { color:#4b6cb7 !important; }
.lp-dark .lp-virt-toggle-btn { background:linear-gradient(135deg,#1e1b4b,#2e1065) !important; border-color:#4338ca !important; color:#c7d2fe !important; }
.lp-dark .lp-vp { background:rgba(14,26,64,.8) !important; border-color:#1e3558 !important; }
.lp-dark .lp-vp-card { background:rgba(12,22,55,.8) !important; border-color:#1e3558 !important; }
.lp-dark .lp-vp-card-lbl { color:#e0e7ff !important; }
.lp-dark .lp-vp-sub-lbl { color:#818cf8 !important; }
.lp-dark .lp-pnl-pos { color:#34d399 !important; }
.lp-dark .lp-pnl-neg { color:#f87171 !important; }
.lp-dark .lp-run-btn.running { box-shadow:0 0 28px rgba(239,68,68,.35) !important; }
.lp-dark .lp-run-btn { box-shadow:0 0 18px rgba(34,211,238,.2) !important; }
.lp-dark .lp-tpb-lbl-check { color:#64748b !important; }

/* ── Strategy Section ───────────────────────────────────── */
.lp-strategy-section { background:#f0fdfc; border:1px solid #e5e7eb; border-top:none; padding:12px 14px; }
.lp-ss-hdr { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.lp-sec-title { font-size:11px; font-weight:900; color:#374151; letter-spacing:1.5px; text-transform:uppercase; flex:1; }
.lp-circles-btn { background:linear-gradient(135deg,#f59e0b,#ec4899); color:#fff; border:none; border-radius:20px; padding:4px 14px; font-size:12px; font-weight:700; cursor:pointer; }
.lp-add-strat-btn { background:#16a34a; color:#fff; border:none; border-radius:5px; padding:6px 14px; font-size:11px; font-weight:800; cursor:pointer; }
.lp-add-strat-btn:disabled { background:#9ca3af; cursor:not-allowed; }

.lp-strats-list { display:flex; flex-direction:column; gap:8px; }

/* Strategy block color variants */
.lp-strategy { border-radius:8px; border:1px solid; padding:12px 14px; background:#fff; }
.lp-strat-blue   { background:#eff6ff; border-color:#bfdbfe; }
.lp-strat-pink   { background:#fdf2f8; border-color:#fbcfe8; }
.lp-strat-purple { background:#f5f3ff; border-color:#ddd6fe; }
.lp-strat-green  { background:#f0fdf4; border-color:#bbf7d0; }
.lp-strat-orange { background:#fff7ed; border-color:#fed7aa; }

.lp-strat-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.lp-strat-title { display:flex; align-items:center; gap:6px; }
.lp-strat-name { font-size:11px; font-weight:900; color:#374151; letter-spacing:1px; }
.lp-cond-badge { background:#f3f4f6; border-radius:4px; padding:1px 7px; font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; }
.lp-toggle-label { display:flex; align-items:center; gap:4px; cursor:pointer; font-size:10px; font-weight:700; color:#374151; }
.lp-toggle-label input { accent-color:#06b6d4; cursor:pointer; }
.lp-rm-strat { background:#ef4444; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; font-weight:800; cursor:pointer; }
.lp-if-label { font-size:11px; font-weight:800; color:#374151; margin-bottom:5px; text-transform:uppercase; }

/* ── Condition Row ──────────────────────────────────────── */
.lp-cond-row { display:flex; align-items:center; flex-wrap:wrap; gap:5px; margin-bottom:7px; }
.lp-sel { border:1px solid #d1d5db; border-radius:5px; padding:4px 7px; font-size:12px; font-weight:600; color:#374151; background:#fff; outline:none; cursor:pointer; }
.lp-sel:focus { border-color:#06b6d4; }
.lp-join { width:54px; background:#0f172a; color:#fff; font-weight:800; font-size:10px; }
.lp-ctype { min-width:160px; }
.lp-cmp { width:48px; }
.lp-num { width:56px; border:1px solid #d1d5db; border-radius:5px; padding:4px 6px; font-size:13px; font-weight:700; color:#374151; background:#fff; outline:none; text-align:center; }
.lp-num:focus { border-color:#06b6d4; }
.lp-sm { width:44px; }
.lp-unit { font-size:11px; font-weight:600; color:#6b7280; }
.lp-cyan { color:#0891b2; font-weight:700; }
.lp-txt { font-size:12px; font-weight:600; color:#374151; }

/* Digit dropdown */
.lp-dd-btn { display:inline-flex; align-items:center; min-width:90px; font-weight:700; font-size:12px; color:#374151; border:1px solid #d1d5db; border-radius:5px; padding:4px 8px; background:#fff; cursor:pointer; }
.lp-dd-menu { position:absolute; top:calc(100% + 3px); left:0; min-width:120px; background:#fff; border:1px solid #e5e7eb; border-radius:7px; box-shadow:0 8px 20px rgba(0,0,0,.12); z-index:300; overflow:hidden; }
.lp-dd-item { padding:7px 12px; font-size:12px; font-weight:600; color:#374151; cursor:pointer; }
.lp-dd-item:hover { background:#f0fdfc; color:#0e7490; }
.lp-dd-item.active { background:#06b6d4; color:#fff; }

.lp-rm-cond { width:20px; height:20px; border-radius:50%; border:none; background:#ef4444; color:#fff; font-size:15px; font-weight:700; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.lp-rm-cond:hover { background:#dc2626; }

/* Advanced Pattern Builder Styles */
.lp-apb { display:flex; flex-direction:column; gap:6px; background:rgba(6,182,212,.03); border:1px dashed rgba(6,182,212,.3); border-radius:8px; padding:8px; margin-top:4px; }
.lp-dark .lp-apb { background:rgba(6,182,212,.01) !important; border-color:rgba(6,182,212,.15) !important; }
.lp-apb-header { display:flex; justify-content:space-between; align-items:center; }
.lp-apb-title { font-size:10px; font-weight:800; color:#0891b2; text-transform:uppercase; letter-spacing:.3px; }
.lp-dark .lp-apb-title { color:#22d3ee !important; }
.lp-apb-add-btn { background:#0891b2; color:#fff; border:none; border-radius:4px; padding:2px 8px; font-size:10px; font-weight:800; cursor:pointer; }
.lp-apb-add-btn:hover { background:#0e7490; }
.lp-apb-grid { display:flex; gap:6px; flex-wrap:wrap; margin-top:2px; }
.lp-apb-card { flex:1; min-width:65px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:5px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:4px; position:relative; }
.lp-dark .lp-apb-card { background:#0a122c !important; border-color:#1e3558 !important; }
.lp-apb-card-hdr { display:flex; justify-content:space-between; align-items:center; width:100%; border-bottom:1px solid #f3f4f6; padding-bottom:3px; margin-bottom:1px; }
.lp-dark .lp-apb-card-hdr { border-bottom-color:#1e3558 !important; }
.lp-apb-card-title { font-size:9px; font-weight:700; color:#6b7280; }
.lp-dark .lp-apb-card-title { color:#94a3b8 !important; }
.lp-apb-card-remove { border:none; background:none; color:#ef4444; font-size:9px; font-weight:800; cursor:pointer; padding:0 2px; }
.lp-apb-sel { font-size:11px !important; padding:1px 3px !important; width:100% !important; height:auto !important; }
.lp-apb-input { width:100% !important; margin:0 !important; font-size:11px !important; padding:1px 3px !important; height:auto !important; text-align:center; }
.lp-apb-placeholder { font-size:11px; font-weight:700; color:#9ca3af; line-height:18px; }

/* THEN TRADE row */
.lp-then-row { display:flex; align-items:center; gap:7px; margin:4px 0 8px; flex-wrap:wrap; }
.lp-then-lbl { font-size:12px; font-weight:700; color:#374151; }
.lp-trade-sel { min-width:80px; font-weight:800; }

.lp-add-cond-btn { background:#0e7490; color:#fff; border:none; border-radius:20px; padding:4px 14px; font-size:11px; font-weight:800; cursor:pointer; display:inline-block; margin-bottom:7px; }
.lp-add-cond-btn:hover { background:#0c6680; }
.lp-summary { font-size:11px; color:#6b7280; font-style:italic; }

/* Custom Contracts sequence box grid */
.lp-custom-boxes-grid { display:flex; gap:8px; margin:6px 0 10px; flex-wrap:wrap; }
.lp-custom-box-card { flex:1; min-width:65px; background:rgba(245,158,11,.05); border:1px solid rgba(245,158,11,.2); border-radius:6px; padding:6px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:4px; }
.lp-dark .lp-custom-box-card { background:rgba(245,158,11,.03) !important; border-color:rgba(245,158,11,.15) !important; }
.lp-custom-box-title { font-size:9px; font-weight:800; color:#b45309; text-transform:uppercase; letter-spacing:.3px; }
.lp-dark .lp-custom-box-title { color:#f59e0b; }
.lp-custom-box-sel { font-size:11px !important; padding:2px 4px !important; width:100% !important; text-align:center; }
.lp-custom-box-input { width:100% !important; margin:0 !important; font-size:11px !important; padding:2px 4px !important; }
.lp-custom-box-placeholder { font-size:11px; font-weight:700; color:#9ca3af; line-height:22px; }

/* ── Markets Section ────────────────────────────────────── */
.lp-markets-section { background:#fff; border:1px solid #e5e7eb; border-top:none; padding:10px 14px; }
.lp-ms-hdr { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:7px; }
.lp-ms-sub { font-size:11px; color:#6b7280; margin-top:2px; }
.lp-ms-count { font-size:11px; font-weight:700; color:#06b6d4; }
.lp-market-chips { display:flex; flex-wrap:wrap; gap:5px; }
.lp-chip { border:2px solid #e5e7eb; border-radius:20px; padding:3px 11px; font-size:12px; font-weight:700; color:#374151; background:#f9fafb; cursor:pointer; transition:all .15s; }
.lp-chip:hover { border-color:#06b6d4; color:#0e7490; }
.lp-chip.active { background:#0e7490; border-color:#0e7490; color:#fff; }

/* ── Execute Button ─────────────────────────────────────── */
.lp-exec-btn { width:100%; background:#0e7490; color:#fff; border:none; padding:13px 0; font-size:14px; font-weight:900; letter-spacing:1.5px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s; margin-top:2px; }
.lp-exec-btn:hover:not(:disabled) { background:#0c6680; }
.lp-exec-btn.running { background:#ef4444; }
.lp-exec-btn.running:hover { background:#dc2626; }
.lp-exec-btn:disabled { background:#9ca3af; cursor:not-allowed; }

/* ── Status Row ─────────────────────────────────────────── */
.lp-status-row { display:grid; grid-template-columns:1fr 1fr; border:1px solid #e5e7eb; border-top:none; background:#fff; }
.lp-status-box { padding:9px 12px; border-right:1px solid #e5e7eb; }
.lp-status-box:last-child { border-right:none; }
.lp-signal-box { border-left:2px solid #0e7490; }
.lp-status-label { font-size:9px; font-weight:900; color:#9ca3af; letter-spacing:1px; text-transform:uppercase; margin-bottom:2px; }
.lp-status-text { font-size:11px; font-weight:600; color:#374151; display:flex; align-items:center; gap:5px; }
.lp-signal-text { color:#0e7490; }
.lp-pulse-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#16a34a; animation:lp-pulse 1s infinite; flex-shrink:0; }
@keyframes lp-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(1.3)} }

/* ── Market Cards Grid ──────────────────────────────────── */
.lp-mc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(165px,1fr)); gap:6px; padding:10px 14px; background:#fff; border:1px solid #e5e7eb; border-top:none; }

.lp-market-card { background:#f9fafb; border:1px solid #e5e7eb; border-radius:7px; padding:9px; }
.lp-mc-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; }
.lp-mc-label { font-size:12px; font-weight:800; color:#374151; }
.lp-scan-badge { font-size:9px; font-weight:900; letter-spacing:1px; border-radius:3px; padding:1px 6px; }
.lp-scan-badge.ready { background:#dcfce7; color:#16a34a; }
.lp-scan-badge.loading { background:#fef9c3; color:#ca8a04; animation:lp-pulse 1.2s infinite; }
.lp-mc-row { display:flex; align-items:center; gap:4px; margin-bottom:3px; }
.lp-mc-rl { font-size:9px; font-weight:700; color:#9ca3af; width:34px; flex-shrink:0; }
.lp-bubbles { display:flex; gap:3px; }

.lp-bubble { width:21px; height:21px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; flex-shrink:0; transition:transform .1s; }
.lp-bubble.neutral { background:#f3f4f6; color:#6b7280; }
.lp-bubble.rise { background:#dcfce7; color:#16a34a; }
.lp-bubble.fall { background:#fee2e2; color:#ef4444; }
.lp-bubble.green-bar { outline:2px solid #16a34a; outline-offset:1px; }

/* Digit colours */
.lp-bubble.d0 { background:#eff6ff; color:#3b82f6; }
.lp-bubble.d1 { background:#f0fdf4; color:#22c55e; }
.lp-bubble.d2 { background:#fef9c3; color:#ca8a04; }
.lp-bubble.d3 { background:#fff7ed; color:#f97316; }
.lp-bubble.d4 { background:#fdf4ff; color:#c026d3; }
.lp-bubble.d5 { background:#f0fdfa; color:#0d9488; }
.lp-bubble.d6 { background:#fef2f2; color:#ef4444; }
.lp-bubble.d7 { background:#f0f9ff; color:#0ea5e9; }
.lp-bubble.d8 { background:#eff6ff; color:#6366f1; }
.lp-bubble.d9 { background:#fdf2f8; color:#ec4899; }

/* ── Right Panel ────────────────────────────────────────── */
.lp-right { width:276px; flex-shrink:0; display:flex; flex-direction:column; background:#fff; border-left:1px solid #e5e7eb; border-top:1px solid #e5e7eb; position:sticky; top:64px; height:calc(100vh - 80px); overflow-y:auto; }

.lp-run-hdr { display:flex; align-items:center; gap:8px; padding:9px 12px; border-bottom:1px solid #e5e7eb; background:#f9fafb; }
.lp-run-btn { display:flex; align-items:center; gap:4px; background:#16a34a; color:#fff; border:none; border-radius:5px; padding:6px 14px; font-size:12px; font-weight:800; cursor:pointer; }
.lp-run-btn:hover:not(:disabled) { background:#15803d; }
.lp-run-btn.running { background:#ef4444; }
.lp-run-btn:disabled { background:#9ca3af; cursor:not-allowed; }
.lp-run-status { font-size:11px; font-weight:600; color:#6b7280; display:flex; align-items:center; gap:4px; margin-left:auto; }

/* ── Virtual Quick-Toggle button (next to RUN) ─────────────── */
.lp-virt-quick-btn {
  display:flex; align-items:center; gap:3px;
  border:none; border-radius:5px; padding:6px 11px;
  font-size:11px; font-weight:800; cursor:pointer; letter-spacing:0.3px;
  transition: background 0.2s, transform 0.1s;
}
.lp-virt-quick-btn:active { transform:scale(0.96); }
.lp-virt-quick-btn.virtual {
  background:linear-gradient(135deg,#4f46e5,#7c3aed);
  color:#fff;
  box-shadow:0 2px 8px rgba(99,102,241,0.4);
}
.lp-virt-quick-btn.real {
  background:linear-gradient(135deg,#0e7490,#0369a1);
  color:#fff;
  box-shadow:0 2px 8px rgba(14,116,144,0.4);
}
.lp-virt-quick-btn.virtual:hover { background:linear-gradient(135deg,#4338ca,#6d28d9); }
.lp-virt-quick-btn.real:hover    { background:linear-gradient(135deg,#0c6078,#025880); }

/* ── Market card signal flash ──────────────────────────────── */
@keyframes lp-flash-pulse {
  0%   { box-shadow:0 0 0 0 rgba(251,191,36,0); border-color:#fbbf24; }
  30%  { box-shadow:0 0 12px 4px rgba(251,191,36,0.6); border-color:#f59e0b; }
  70%  { box-shadow:0 0 8px 2px rgba(251,191,36,0.3); border-color:#fcd34d; }
  100% { box-shadow:0 0 0 0 rgba(251,191,36,0); border-color:#e5e7eb; }
}
.lp-mc-flash {
  animation: lp-flash-pulse 0.7s ease-out 3;
  border:2px solid #fbbf24 !important;
}
.lp-mc-signal-badge {
  display:inline-flex; align-items:center; gap:2px;
  background:linear-gradient(90deg,#f59e0b,#ef4444);
  color:#fff; font-size:9px; font-weight:900; padding:2px 6px;
  border-radius:10px; letter-spacing:0.4px;
  animation: fadeInScale 0.2s ease-out;
}
@keyframes fadeInScale {
  from { opacity:0; transform:scale(0.7); }
  to   { opacity:1; transform:scale(1); }
}

.lp-quick-stats { display:flex; gap:0; border-bottom:1px solid #e5e7eb; background:#f0fdf4; }
.lp-qs { flex:1; padding:6px 4px; text-align:center; border-right:1px solid #e5e7eb; }
.lp-qs:last-child { border-right:none; }
.lp-qs-l { display:block; font-size:9px; font-weight:800; color:#9ca3af; letter-spacing:0.5px; }
.lp-qs-v { display:block; font-size:14px; font-weight:900; }
.lp-qs-v.green { color:#16a34a; }
.lp-qs-v.red { color:#ef4444; }

/* ── Transaction Panel ──────────────────────────────────── */
.lp-tx-panel { display:flex; flex-direction:column; flex:1; }
.lp-tx-tabs { display:flex; border-bottom:1px solid #e5e7eb; }
.lp-tx-tab { flex:1; padding:9px 4px; font-size:12px; font-weight:700; color:#9ca3af; border:none; border-bottom:2px solid transparent; background:transparent; cursor:pointer; }
.lp-tx-tab.active { color:#0e7490; border-bottom-color:#0e7490; }
.lp-tx-actions { display:flex; gap:5px; padding:7px 10px; border-bottom:1px solid #f3f4f6; }
.lp-tx-btn { flex:1; border:1px solid #d1d5db; border-radius:4px; padding:4px; font-size:11px; font-weight:700; color:#374151; background:#f9fafb; cursor:pointer; }
.lp-tx-hdr { display:grid; grid-template-columns:1fr 1fr 1.2fr 1fr; padding:5px 10px; border-bottom:1px solid #f3f4f6; }
.lp-tx-hdr span { font-size:9px; font-weight:800; color:#9ca3af; }
.lp-tx-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:28px 14px; gap:6px; flex:1; }
.lp-tx-icon { font-size:28px; opacity:0.3; }
.lp-tx-empty span { font-size:11px; color:#9ca3af; text-align:center; }

.lp-tx-list { overflow-y:auto; max-height:260px; }
.lp-tx-row { display:grid; grid-template-columns:1fr 1fr 1.2fr 1fr; padding:5px 10px; border-bottom:1px solid #f9fafb; font-size:10px; align-items:center; }
.lp-tx-row.won  { background:#f0fdf4; }
.lp-tx-row.lost { background:#fef2f2; }
.lp-tx-row.virt { background:#f5f3ff; border-left:2px solid #818cf8; }
.lp-tx-contract { display:flex; flex-direction:column; gap:1px; }
.lp-tx-type { font-weight:800; color:#374151; }
.lp-tx-sym { font-size:9px; color:#9ca3af; }
.lp-virt-badge { display:inline-block; font-size:7px; font-weight:900; background:#818cf8; color:#fff; border-radius:3px; padding:1px 4px; letter-spacing:.5px; line-height:1.4; margin-top:1px; }
.lp-tx-pnl { font-size:11px; font-weight:800; text-align:right; }
.lp-tx-pnl.pos  { color:#16a34a; }
.lp-tx-pnl.neg  { color:#ef4444; }
.lp-tx-pnl.virt { color:#818cf8; }
.lp-spin { animation:spin 1s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }

.lp-tx-stats { padding:10px; border-top:1px solid #e5e7eb; margin-top:auto; }
.lp-tx-stat-row { display:flex; gap:4px; }
.lp-tx-stat { flex:1; display:flex; flex-direction:column; gap:1px; }
.lp-tsl { font-size:9px; font-weight:700; color:#9ca3af; }
.lp-tsv { font-size:12px; font-weight:800; color:#374151; }
.lp-tsv.pos { color:#16a34a; }
.lp-tsv.neg { color:#ef4444; }
.lp-reset-btn { width:100%; margin-top:8px; border:1px solid #d1d5db; border-radius:5px; padding:6px; font-size:12px; font-weight:700; color:#374151; background:#f9fafb; cursor:pointer; }

/* ── Right Footer ───────────────────────────────────────── */
.lp-right-footer { display:flex; align-items:center; gap:5px; padding:7px 10px; border-top:1px solid #e5e7eb; background:#f9fafb; }
.lp-dot { width:7px; height:7px; border-radius:50%; background:#d1d5db; flex-shrink:0; }
.lp-dot.connected { background:#16a34a; box-shadow:0 0 5px rgba(22,163,74,.5); }
.lp-time { font-size:10px; color:#9ca3af; font-family:monospace; }

/* ── Risk Disclaimer ────────────────────────────────────── */
.lp-risk-disc { position:fixed; bottom:16px; left:16px; background:#f59e0b; color:#fff; font-size:11px; font-weight:800; padding:5px 12px; border-radius:5px; z-index:900; box-shadow:0 2px 8px rgba(0,0,0,.15); }

/* ── Virtual System toggle button ──────────────────────── */
.lp-virt-toggle-btn { position:relative; display:flex; align-items:center; gap:5px; background:linear-gradient(135deg,#312e81,#4f46e5); color:#c7d2fe; border:1px solid #4338ca; border-radius:6px; padding:4px 10px; font-size:10px; font-weight:900; letter-spacing:.8px; cursor:pointer; transition:all .2s; }
.lp-virt-toggle-btn:hover { background:linear-gradient(135deg,#3730a3,#6366f1); color:#fff; }
.lp-virt-active-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#4ade80; box-shadow:0 0 5px rgba(74,222,128,.7); animation:lp-pulse 1.2s infinite; margin-left:2px; }
@keyframes lp-pulse { 0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7} }

/* ── Virtual System Panel ──────────────────────────────── */
.lp-vp { background:#1e1b4b; border:2px solid #4338ca; border-radius:8px; padding:12px; margin-bottom:10px; display:flex; flex-direction:column; gap:10px; animation:lp-slideDown .2s ease; }
@keyframes lp-slideDown { from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)} }
.lp-vp-hdr { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.lp-vp-title { font-size:12px; font-weight:900; color:#c7d2fe; letter-spacing:1.5px; }
.lp-vp-badge { font-size:9px; font-weight:900; padding:2px 8px; border-radius:4px; letter-spacing:.5px; }
.lp-vp-badge--virtual { background:#4f46e5; color:#fff; }
.lp-vp-badge--real { background:#0d9488; color:#fff; }
.lp-vp-force-btn { margin-left:auto; padding:3px 10px; border:none; border-radius:4px; font-size:10px; font-weight:800; cursor:pointer; letter-spacing:.5px; transition:all .2s; }
.lp-vp-force-btn--toreal { background:#0d9488; color:#fff; }
.lp-vp-force-btn--tovirt { background:#4f46e5; color:#fff; }
.lp-vp-force-btn:hover { opacity:.85; }
.lp-vp-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.lp-vp-card { background:#312e81; border:1px solid #4338ca; border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:6px; }
.lp-vp-card-hdr { display:flex; align-items:center; justify-content:space-between; }
.lp-vp-card-lbl { font-size:11px; font-weight:700; color:#e0e7ff; }
.lp-vp-sub { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-top:2px; }
.lp-vp-sub-lbl { font-size:10px; font-weight:600; color:#a5b4fc; }
.lp-vp-streak { display:flex; align-items:center; gap:6px; font-size:10px; font-weight:800; padding-top:4px; border-top:1px solid #3730a3; margin-top:2px; }
.lp-vp-streak-sep { color:#4338ca; }
/* Toggle switch */
.lp-vp-sw { position:relative; display:inline-block; width:32px; height:17px; flex-shrink:0; }
.lp-vp-sw input { opacity:0; width:0; height:0; }
.lp-vp-sw-track { position:absolute; cursor:pointer; inset:0; background:#374151; border-radius:17px; transition:.3s; }
.lp-vp-sw-track:before { content:""; position:absolute; height:13px; width:13px; left:2px; bottom:2px; background:#fff; border-radius:50%; transition:.3s; }
.lp-vp-sw input:checked + .lp-vp-sw-track { background:#4f46e5; }
.lp-vp-sw input:checked + .lp-vp-sw-track:before { transform:translateX(15px); }
.lp-sm { width:52px!important; padding:2px 4px!important; font-size:11px!important; }

/* ── Digit Pattern Builder ────────────────────────────── */
.lp-dpb { display:flex; flex-direction:column; gap:5px; padding:6px 8px; background:#0f172a; border:1px solid #334155; border-radius:7px; margin-top:4px; }
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

/* ── Responsive ─────────────────────────────────────────── */
@media (max-width:900px) {
  .lp-root { flex-direction:column; }
  .lp-right { width:100%; height:auto; position:static; }
  .lp-settings-row { flex-wrap:wrap; }
  .lp-sg { min-width:140px; }
  .lp-mc-grid { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); }
}
`;
