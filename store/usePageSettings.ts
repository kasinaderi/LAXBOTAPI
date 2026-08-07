'use client';

/**
 * usePageSettings — per-page settings isolation for useDerivStore.
 *
 * Call ONCE in the root component of each trading page:
 *   usePageSettings('laxsniper-xv')   // in LaxSniperXV component
 *   usePageSettings('dtrader')         // in TradingStation component
 *   usePageSettings('auto-trade')      // in AutoTradePage component
 *
 * How it works:
 *   • On mount    → loads this page's saved settings from localStorage and
 *                   applies them to useDerivStore in one batched setState call.
 *   • On change   → auto-saves (debounced 600 ms) whenever any settings field
 *                   changes (ignores tick / runtime churn so no perf impact).
 *   • On unmount  → saves one final snapshot before navigating away.
 *   • On unload   → saves on tab/window close / hard refresh.
 *
 * Result: stake, martingale, triggers, trade pattern, virtual settings,
 * recovery settings, compounding, TP/SL, and trade logs are completely
 * independent between pages. Each page remembers its own last-used values.
 *
 * The following are intentionally SHARED (infrastructure, not settings):
 *   token, status, account, accounts, isRunning, ticks, lastTick, etc.
 */

import { useEffect, useRef } from 'react';
import { useDerivStore } from './useDerivStore';

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS FIELDS — isolated per page.
// These mirror useDerivStore's `partialize` list, minus `token` (shared auth).
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_FIELDS = [
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

type Snap = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function storageKey(pageId: string): string {
  return `page-settings-v1-${pageId}`;
}

function captureSnapshot(): Snap {
  const s = useDerivStore.getState() as unknown as Record<string, unknown>;
  const snap: Snap = {};

  for (const f of SETTINGS_FIELDS) {
    if (s[f] !== undefined) snap[f] = s[f];
  }

  // Save runtime state too — each page keeps its own trade log history
  // and stats within a session (not persisted cross-reload but useful
  // when navigating back to the same page in the same tab).
  const tradeLogs = s.tradeLogs as unknown[] | undefined;
  snap.tradeLogs = (tradeLogs || []).slice(0, 50);
  snap.stats     = s.stats;

  return snap;
}

function persistSnapshot(pageId: string): void {
  try {
    localStorage.setItem(storageKey(pageId), JSON.stringify(captureSnapshot()));
  } catch {
    // Storage quota / private browsing — ignore silently.
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

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function usePageSettings(pageId: string): void {
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHash   = useRef<string>('');

  useEffect(() => {
    // ── 1. Apply saved settings on mount ──────────────────────────────────
    const snap = loadSnapshot(pageId);
    if (snap) {
      // Build a single patch object so useDerivStore only re-renders once.
      const patch: Snap = {};
      for (const f of SETTINGS_FIELDS) {
        if (snap[f] !== undefined) patch[f] = snap[f];
      }
      if (snap.tradeLogs !== undefined) patch.tradeLogs = snap.tradeLogs;
      if (snap.stats     !== undefined) patch.stats     = snap.stats;

      if (Object.keys(patch).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useDerivStore.setState(patch as any);
      }
    } else {
      // First visit to this page — save current store state as the
      // initial snapshot so future visits restore these values.
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = (useDerivStore as any).subscribe((state: Record<string, unknown>) => {
      // Compute a cheap hash of only the tracked settings fields.
      // This avoids triggering a save on every market tick (≈1 per second).
      const hash = SETTINGS_FIELDS.map(f => {
        const v = state[f];
        return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      }).join('|');

      if (hash !== prevHash.current) {
        prevHash.current = hash;
        scheduleSave();
      }
    });

    // ── 3. Save on tab / window close ─────────────────────────────────────
    const handleBeforeUnload = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      persistSnapshot(pageId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // ── 4. Cleanup on unmount (normal page navigation) ────────────────────
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsubscribe();
      // Final save before leaving this page.
      persistSnapshot(pageId);
    };
  // pageId is stable (passed from a constant), so this is intentionally
  // an empty-deps-equivalent for the pageId dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
}
