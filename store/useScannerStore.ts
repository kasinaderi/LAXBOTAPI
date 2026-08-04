import { create } from 'zustand';
import { SmartScanner, ScannerSignal, ScannerTick } from '../lib/scanner/SmartScanner';
import { ticksToDecimals } from '../lib/deriv/constants';
import { derivWS } from '../lib/deriv/websocket';

// ─────────────────────────────────────────────────────────────────────────────
// Module-scope state (kept outside Zustand to avoid render thrashing)
// ─────────────────────────────────────────────────────────────────────────────

/** One SmartScanner instance per market symbol */
const scanners = new Map<string, SmartScanner>();

/** Symbols we have already sent a subscribe request for on this WS session */
const subscribedSymbols = new Set<string>();

/** Pre-buffer: live ticks that arrive before history is ready */
const preBuffers = new Map<string, ScannerTick[]>();

/** History fetch queue (rate-limited) */
const fetchQueue: string[] = [];
let activeFetches = 0;
const MAX_CONCURRENT_FETCHES = 5;
const fetchingSymbols = new Set<string>();

/** Unsubscribe handle returned by derivWS.onMessage */
let derivWsUnsubscribe: (() => void) | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract last digit from a quote price using pip_size or string parsing.
 * This mirrors what the trade engine already does.
 */
function extractDigit(quote: number, pipSize?: number): number {
    const decimals = pipSize && pipSize > 0
        ? Math.abs(Math.round(Math.log10(1 / pipSize)))
        : (() => {
              const s = quote.toString();
              return s.includes('.') ? s.split('.')[1].length : 0;
          })();
    const str = quote.toFixed(decimals);
    const d = parseInt(str[str.length - 1], 10);
    return isNaN(d) ? 0 : d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store types
// ─────────────────────────────────────────────────────────────────────────────

interface ScannerStoreState {
    signals: Record<string, ScannerSignal | null>;
    marketRegimes: Record<string, {
        regime: string;
        historySize: number;
        historyReady: boolean;
        digits?: number[];
        details?: {
            dominantSide: string;
            oddPct: number;
            evenPct: number;
            gap: number;
            top3Digits: { digit: number; pct: number }[];
            top3Sum: number;
        };
    }>;
    activeCount: number;

    /** Called by the internal onMessage listener — do not call from UI */
    handleDerivTick: (tick: { symbol: string; quote: number; pip_size?: number; epoch: number }) => void;

    /** Ensure a scanner exists for this symbol and it is subscribed to live ticks */
    ensureScanner: (symbol: string) => void;

    /** Register the derivWS onMessage listener and start scanning */
    startScanning: () => void;

    /** Tear everything down */
    stopScanning: () => void;

    /** Internal — fetches tick history for a queued symbol */
    processQueue: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useScannerStore = create<ScannerStoreState>((set, get) => ({
    signals: {},
    marketRegimes: {},
    activeCount: 0,

    // ── Live tick handler ─────────────────────────────────────────────────
    handleDerivTick: ({ symbol, quote, pip_size, epoch }) => {
        // Make sure a scanner exists (ensureScanner also triggers history load)
        get().ensureScanner(symbol);

        const scanner = scanners.get(symbol);
        if (!scanner) return;

        const digit = extractDigit(quote, pip_size);

        const scannerTick: ScannerTick = { quote, digit, epoch };

        if (!scanner.historyReady) {
            // Pre-buffer until history arrives
            const buffer = preBuffers.get(symbol) || [];
            buffer.push(scannerTick);
            if (buffer.length > 2000) buffer.shift();
            preBuffers.set(symbol, buffer);
            return;
        }

        // Feed the tick into the scanner engine
        scanner.update(scannerTick);

        // Always call getStatus() so the digits array in Zustand is refreshed
        // on every tick — not just when update() fires a signal.
        // (update() returns early when buffer < 1000 but getStatus() still
        // exposes the growing buffer so the UI can rank markets correctly.)
        const status = scanner.getStatus();
        const signal = scanner.currentSignal;

        set((state) => ({
            activeCount: scanners.size,
            signals: { ...state.signals, [symbol]: signal },
            marketRegimes: {
                ...state.marketRegimes,
                [symbol]: {
                    regime: status.regime,
                    historySize: status.historySize,
                    historyReady: status.historyReady,
                    digits: status.digits || [],
                    details: status.details || undefined,
                },
            },
        }));
    },

    // ── Ensure scanner + WS subscription ─────────────────────────────────
    ensureScanner: (symbol: string) => {
        // Create scanner if missing
        if (!scanners.has(symbol)) {
            scanners.set(symbol, new SmartScanner(symbol));
        }

        const scanner = scanners.get(symbol)!;

        // Subscribe to live ticks on derivWS if not already subscribed
        // We use derivWS.send() directly (NOT subscribeTicks) so we can subscribe
        // to multiple markets simultaneously without forget_all clearing others.
        if (!subscribedSymbols.has(symbol)) {
            subscribedSymbols.add(symbol);
            derivWS.addKeepAliveSymbol(symbol);
            derivWS.send({ ticks: symbol, subscribe: 1 });
            console.log(`[ScannerStore] Subscribed to live ticks: ${symbol}`);
        }

        // Queue history fetch if not started yet
        if (!scanner.historyReady && !fetchingSymbols.has(symbol) && !fetchQueue.includes(symbol)) {
            fetchQueue.push(symbol);
            get().processQueue();
        }
    },

    // ── History fetch queue processor ─────────────────────────────────────
    processQueue: () => {
        if (activeFetches >= MAX_CONCURRENT_FETCHES) return;
        if (fetchQueue.length === 0) return;

        const symbol = fetchQueue.shift();
        if (!symbol) return;

        activeFetches++;
        fetchingSymbols.add(symbol);

        console.log(`[ScannerStore] Fetching history for ${symbol}… (active: ${activeFetches})`);

        derivWS.getTickHistory(symbol, 500)
            .then((response: any) => {
                if (response.history?.times && response.history?.prices) {
                    const times  = response.history.times  as number[];
                    const prices = response.history.prices as number[];

                    // Determine decimal precision from pip_size or price strings
                    const rawPipSize = response.pip_size;
                    let decimals = 2;
                    if (rawPipSize && rawPipSize > 0 && rawPipSize < 1) {
                        decimals = Math.abs(Math.round(Math.log10(1 / rawPipSize)));
                    } else if (prices.length > 0) {
                        let maxDec = 0;
                        for (let i = 0; i < Math.min(prices.length, 100); i++) {
                            const s = prices[i].toString();
                            if (s.includes('.')) maxDec = Math.max(maxDec, s.split('.')[1].length);
                        }
                        decimals = maxDec || ticksToDecimals(symbol);
                    } else {
                        decimals = ticksToDecimals(symbol);
                    }

                    const historyTicks: ScannerTick[] = times.map((time, idx) => {
                        const price  = prices[idx];
                        const factor = Math.pow(10, decimals);
                        const rounded = Math.round(price * factor) / factor;
                        const str    = rounded.toFixed(decimals);
                        const digit  = parseInt(str[str.length - 1], 10);
                        return { epoch: time, quote: price, digit: isNaN(digit) ? 0 : digit };
                    });

                    const scanner = scanners.get(symbol);
                    if (scanner) {
                        scanner.loadHistory(historyTicks);

                        // Drain pre-buffer
                        const preBuffer = preBuffers.get(symbol) || [];
                        console.log(`[ScannerStore] Merging ${preBuffer.length} buffered ticks for ${symbol}`);
                        preBuffer.forEach(t => scanner.update(t));
                        preBuffers.delete(symbol);

                        const status = scanner.getStatus();
                        set((state) => ({
                            marketRegimes: {
                                ...state.marketRegimes,
                                [symbol]: {
                                    regime: status.regime,
                                    historySize: status.historySize,
                                    historyReady: status.historyReady,
                                    digits: status.digits || [],
                                    details: status.details || undefined,
                                },
                            },
                        }));
                    }
                }
            })
            .catch((err: any) => {
                console.error(`[ScannerStore] History fetch failed for ${symbol}:`, err);
                // Retry after 5 s
                setTimeout(() => {
                    fetchingSymbols.delete(symbol);
                    fetchQueue.push(symbol);
                    get().processQueue();
                }, 5000);
            })
            .finally(() => {
                activeFetches--;
                fetchingSymbols.delete(symbol);
                get().processQueue();
            });
    },

    // ── Start scanning — register derivWS tick listener ───────────────────
    startScanning: () => {
        // Idempotent: don't register multiple listeners
        if (derivWsUnsubscribe) return;

        console.log('[ScannerStore] Attaching derivWS tick listener for scanner.');

        // Listen for incoming ticks on the main derivWS socket
        const unsubMessage = derivWS.onMessage((message: any) => {
            if (message.msg_type !== 'tick' || !message.tick) return;

            const { symbol, quote, epoch, pip_size } = message.tick as {
                symbol: string;
                quote: number;
                epoch: number;
                pip_size?: number;
            };

            if (!symbol || quote == null) return;

            get().handleDerivTick({ symbol, quote, pip_size, epoch: epoch ?? Date.now() / 1000 });
        });

        // Re-subscribe all scanner markets after a WS reconnect
        // (Deriv server forgets all subscriptions on disconnect)
        const unsubStatus = derivWS.onStatusChange((status) => {
            if (status === 'connected' && subscribedSymbols.size > 0) {
                console.log('[ScannerStore] Reconnected — re-subscribing scanner markets…');
                subscribedSymbols.forEach(sym => {
                    derivWS.send({ ticks: sym, subscribe: 1 });
                });
            }
        });

        // Combine both cleanup functions into a single unsubscribe handle
        derivWsUnsubscribe = () => {
            unsubMessage();
            unsubStatus();
        };
    },

    // ── Stop scanning — clean up everything ───────────────────────────────
    stopScanning: () => {
        // Detach the derivWS onMessage listener — scanner will no longer process ticks
        if (derivWsUnsubscribe) {
            derivWsUnsubscribe();
            derivWsUnsubscribe = null;
        }

        // Unsubscribe all scanner markets individually without affecting the trade engine's subscription
        subscribedSymbols.forEach(symbol => {
            derivWS.removeKeepAliveSymbol(symbol);
            derivWS.unsubscribeTick(symbol);
        });
        subscribedSymbols.clear();

        set({ signals: {}, marketRegimes: {}, activeCount: 0 });
        scanners.clear();
        preBuffers.clear();
        fetchQueue.length = 0;
        activeFetches = 0;
        fetchingSymbols.clear();

        console.log('[ScannerStore] Stopped. All scanners cleared.');
    },
}));
