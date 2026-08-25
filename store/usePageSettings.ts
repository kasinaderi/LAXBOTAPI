'use client';

/**
 * usePageSettings — complete per-page settings and trade log isolation.
 *
 * Call ONCE in the root component of each trading page:
 *   usePageSettings('laxprime')        // in LaxPrime component
 *   usePageSettings('laxsniper-xv')    // in LaxSniperXV component
 *   usePageSettings('dtrader')         // in TradingStation component
 *   usePageSettings('auto-trade')      // in AutoTradePage component
 *   usePageSettings('reversal-scanner')// in ReversalScanner component
 *
 * Result: adaptive switch, virtual settings, stake, martingale, triggers,
 * trade pattern, recovery settings, compounding, TP/SL, and trade logs are
 * completely independent between pages. Each page remembers its own values.
 */

import { useEffect, useRef } from 'react';
import { useDerivStore } from './useDerivStore';
import { useBotStore } from './useBotStore';

export function getActivePageId(): string {
  if (typeof window !== 'undefined') {
    const p = window.location.pathname;
    if (p.includes('laxprime')) return 'laxprime';
    if (p.includes('laxsniper-xv')) return 'laxsniper-xv';
    if (p.includes('dtrader')) return 'dtrader';
    if (p.includes('auto-trade')) return 'auto-trade';
    if (p.includes('reversal-scanner')) return 'reversal-scanner';
  }
  return 'laxprime';
}

const DERIV_SETTINGS_FIELDS = [
  'market',
  'contractType',
  'prediction',
  'triggerSequence',
  'triggerMode',
  'initialStake',
  'martingaleMultiplier',
  'maxMartingaleSteps',
  'takeProfit',
  'stopLoss',
  'stopAfterTotalWins',
  'stopAfterConsecutiveLosses',
  'compoundProfits',
  'stopOnMaxSteps',
  'triggers',
  'tradePattern',
  'tradingMode',
  'virtualSettings',
  'recoverySettings',
  'showQuickControls',
  'quickSwitchVirtualBehavior',
  'showLogOverlayOnRun',
] as const;

const BOT_SETTINGS_FIELDS = [
  'stake',
  'targetProfit',
  'targetProfitMode',
  'stopLoss',
  'stopLossMode',
  'martingale',
  'tradingMode',
  'strategies',
  'selectedMarkets',
  'crossMarketDelay',
  'adaptiveSwitch',
] as const;

type Snap = Record<string, unknown>;

function storageKey(pageId: string): string {
  return `page-settings-v2-${pageId}`;
}

function captureSnapshot(pageId: string): Snap {
  const dState = useDerivStore.getState() as unknown as Record<string, unknown>;
  const bState = useBotStore.getState() as unknown as Record<string, unknown>;

  const snap: Snap = { pageId };

  // 1. Capture Deriv Store fields
  for (const f of DERIV_SETTINGS_FIELDS) {
    if (dState[f] !== undefined) snap[`deriv_${f}`] = dState[f];
  }

  // 2. Capture Bot Store fields
  for (const f of BOT_SETTINGS_FIELDS) {
    if (bState[f] !== undefined) snap[`bot_${f}`] = bState[f];
  }

  return snap;
}

function persistSnapshot(pageId: string): void {
  try {
    localStorage.setItem(storageKey(pageId), JSON.stringify(captureSnapshot(pageId)));
  } catch {
    // Storage quota / private browsing — ignore
  }
}

function loadSnapshot(pageId: string): Snap | null {
  try {
    const raw = localStorage.getItem(storageKey(pageId));
    return raw ? (JSON.parse(raw) as Snap) : null;
  } catch {
    return null;
  }
}

export function usePageSettings(pageId: string): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHash = useRef<string>('');

  useEffect(() => {
    // ── 1. Apply saved settings on mount ──────────────────────────────────
    const snap = loadSnapshot(pageId);
    if (snap) {
      // Patch Deriv Store
      const derivPatch: Snap = {};
      for (const f of DERIV_SETTINGS_FIELDS) {
        if (snap[`deriv_${f}`] !== undefined) derivPatch[f] = snap[`deriv_${f}`];
      }
      if (Object.keys(derivPatch).length > 0) {
        useDerivStore.setState(derivPatch as any);
      }

      // Patch Bot Store
      const botPatch: Snap = {};
      for (const f of BOT_SETTINGS_FIELDS) {
        if (snap[`bot_${f}`] !== undefined) botPatch[f] = snap[`bot_${f}`];
      }
      if (Object.keys(botPatch).length > 0) {
        useBotStore.setState(botPatch as any);
      }
    } else {
      // First visit to this page — reset logs & stats so no spillover occurs
      useDerivStore.setState({
        tradeLogs: [],
        stats: { wins: 0, losses: 0, winRate: 0, totalProfit: 0, maxStake: 0, currentStep: 1 },
      } as any);
      useBotStore.setState({
        tradeLogs: [],
        globalStats: { won: 0, lost: 0, netProfit: 0, currentConsecutiveWins: 0, currentConsecutiveLosses: 0 },
      } as any);
      persistSnapshot(pageId);
    }

    // ── 2. Auto-save (debounced) on any settings change ───────────────────
    const scheduleSave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        persistSnapshot(pageId);
        timerRef.current = null;
      }, 600);
    };

    const checkAndSave = () => {
      const dState = useDerivStore.getState() as unknown as Record<string, unknown>;
      const bState = useBotStore.getState() as unknown as Record<string, unknown>;

      const dHash = DERIV_SETTINGS_FIELDS.map(f => {
        const v = dState[f];
        return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      }).join('|');

      const bHash = BOT_SETTINGS_FIELDS.map(f => {
        const v = bState[f];
        return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      }).join('|');

      const combinedHash = `${dHash}#${bHash}`;
      if (combinedHash !== prevHash.current) {
        prevHash.current = combinedHash;
        scheduleSave();
      }
    };

    const unsubDeriv = (useDerivStore as any).subscribe(checkAndSave);
    const unsubBot = (useBotStore as any).subscribe(checkAndSave);

    const handleBeforeUnload = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      persistSnapshot(pageId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsubDeriv();
      unsubBot();
      persistSnapshot(pageId);
    };
  }, [pageId]);
}
