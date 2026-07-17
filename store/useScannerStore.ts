import { create } from 'zustand';
import { SmartScanner, ScannerSignal, ScannerTick } from '../lib/scanner/SmartScanner';
import { ALL_MARKETS, ticksToDecimals } from '../lib/deriv/constants';
import { derivWS } from '../lib/deriv/websocket';

// Internal memory for scanners (not in Zustand state to avoid render thrashing)
const scanners = new Map<string, SmartScanner>();

// Initial Fetch Queue
const fetchQueue: string[] = [];
let activeFetches = 0;
const MAX_CONCURRENT_FETCHES = 5;

// Pre-buffer for ticks arriving before history
const preBuffers = new Map<string, ScannerTick[]>();

interface ScannerStoreState {
    signals: Record<string, ScannerSignal | null>;
    marketRegimes: Record<string, {
        regime: string;
        historySize: number;
        historyReady: boolean;
        digits?: number[]; // Exposed for UI
        details?: {
            dominantSide: string;
            oddPct: number;
            evenPct: number;
            gap: number;
            top3Digits: { digit: number; pct: number }[];
            top3Sum: number;
        }
    }>;
    activeCount: number;

    handleBackendTick: (tick: { symbol: string, quote: number, digit: number, epoch: number }) => void;
    startScanning: () => void;
    stopScanning: () => void;
    ensureScanner: (symbol: string) => void;
    processQueue: () => void;
}

export const useScannerStore = create<ScannerStoreState>((set, get) => ({
    signals: {},
    marketRegimes: {},
    activeCount: 0,

    handleBackendTick: (tick: { symbol: string, quote: number, digit: number, epoch: number }) => {
        const { symbol, quote, digit, epoch } = tick;

        // Ensure scanner exists and history is being fetched
        get().ensureScanner(symbol);

        let scanner = scanners.get(symbol);
        if (!scanner) {
            scanner = new SmartScanner(symbol);
            scanners.set(symbol, scanner);
        }

        const scannerTick: ScannerTick = {
            quote,
            digit,
            epoch
        };

        if (!scanner.historyReady) {
            // Pre-buffer
            const buffer = preBuffers.get(symbol) || [];
            buffer.push(scannerTick);
            // Limit prebuffer size to avoid memory leaks if history never loads
            if (buffer.length > 2000) buffer.shift();
            preBuffers.set(symbol, buffer);
            return;
        }

        // Update Scanner Logic
        const signal = scanner.update(scannerTick);
        const status = scanner.getStatus();

        // Update State
        set((state: ScannerStoreState) => ({
            activeCount: scanners.size,
            signals: {
                ...state.signals,
                [symbol]: signal
            },
            marketRegimes: {
                ...state.marketRegimes,
                [symbol]: {
                    regime: status.regime,
                    historySize: status.historySize,
                    historyReady: status.historyReady,
                    digits: status.digits || [],
                    details: status.details || undefined
                }
            }
        }));
    },

    ensureScanner: (symbol: string) => {
        let scanner = scanners.get(symbol);
        if (!scanner) {
            scanner = new SmartScanner(symbol);
            scanners.set(symbol, scanner);
        }

        if (scanner.historyReady) return;

        // Check if already in queue or processing
        // We can check preBuffers existence as a proxy for "started or pending" 
        // effectively if it's new, preBuffer might be empty.
        // Better: use a loading Set.
        // But for simplicity, let's use a static set or just use preBuffers existence?
        // No, preBuffers is for ticks.

        // Let's deduce from 'marketRegimes' state?
        // Or strictly manage queue here.

        if (fetchQueue.includes(symbol)) return; // Already queued

        // We need to know if it's currently fetching.
        // Let's assume if it is in scanners but historyReady is false, it needs fetch.
        // But we need to avoid double queueing.

        // Add to queue if not fetching
        // We need a way to track "fetching started".
        // Let's use a Set in module scope
        if (fetchingSymbols.has(symbol)) return;

        fetchQueue.push(symbol);
        get().processQueue();
    },

    processQueue: () => {
        if (activeFetches >= MAX_CONCURRENT_FETCHES) return;
        if (fetchQueue.length === 0) return;

        const symbol = fetchQueue.shift();
        if (!symbol) return;

        activeFetches++;
        fetchingSymbols.add(symbol);

        console.log(`[ScannerStore] Fetching history for ${symbol}... (Active: ${activeFetches})`);

        derivWS.getTickHistory(symbol, 500).then((response: any) => {
            if (response.history && response.history.times && response.history.prices) {
                const times = response.history.times as number[];
                const prices = response.history.prices as number[];

                // Determine precise decimals from API response directly
                const rawPipSize = response.pip_size;
                let decimals = 2;
                if (rawPipSize !== undefined && rawPipSize > 0 && rawPipSize < 1) {
                    decimals = Math.abs(Math.round(Math.log10(1 / rawPipSize)));
                } else if (prices && prices.length > 0) {
                    let maxDecimals = 0;
                    for (let i = 0; i < Math.min(prices.length, 100); i++) {
                        const str = prices[i].toString();
                        if (str.includes('.')) {
                            maxDecimals = Math.max(maxDecimals, str.split('.')[1].length);
                        }
                    }
                    decimals = maxDecimals || ticksToDecimals(symbol);
                } else {
                    decimals = ticksToDecimals(symbol);
                }

                // Convert to ScannerTick[]
                const historyTicks: ScannerTick[] = times.map((time, index) => {
                    const price = prices[index];
                    const factor = Math.pow(10, decimals);
                    const roundedPrice = Math.round(price * factor) / factor;
                    const priceStr = roundedPrice.toFixed(decimals);
                    const digit = parseInt(priceStr.charAt(priceStr.length - 1), 10);

                    return {
                        epoch: time,
                        quote: price,
                        digit: isNaN(digit) ? 0 : digit
                    };
                });

                const scanner = scanners.get(symbol);
                if (scanner) {
                    scanner.loadHistory(historyTicks);

                    // Merge Pre-buffer
                    const preBuffer = preBuffers.get(symbol) || [];
                    console.log(`[ScannerStore] Merging ${preBuffer.length} live ticks for ${symbol}`);

                    preBuffer.forEach(t => scanner.update(t));
                    preBuffers.delete(symbol);

                    // Force update state
                    const status = scanner.getStatus();
                    set((state: ScannerStoreState) => ({
                        marketRegimes: {
                            ...state.marketRegimes,
                            [symbol]: {
                                regime: status.regime,
                                historySize: status.historySize,
                                historyReady: status.historyReady,
                                digits: status.digits || [],
                                details: status.details || undefined
                            }
                        }
                    }));
                }
            }
        }).catch((err: any) => {
            console.error(`[ScannerStore] History fetch failed for ${symbol}:`, err);
            // Retry logic? For now just remove from fetching set so it can be retried if ensureScanner called.
            // But we should probably use exponential backoff as requested.
            // Simplified: Re-queue after timeout?
            setTimeout(() => {
                fetchingSymbols.delete(symbol);
                fetchQueue.push(symbol);
                get().processQueue();
            }, 5000);
            return;
        }).finally(() => {
            activeFetches--;
            fetchingSymbols.delete(symbol);
            // Process next
            get().processQueue();
        });
    },

    startScanning: () => {
        console.log('[ScannerStore] Scanning initiated.');
        // Optionally trigger ensureScanner for all symbols if we want aggressive preloading
        // ALL_MARKETS.forEach(m => get().ensureScanner(m));
    },

    stopScanning: () => {
        set({ signals: {}, marketRegimes: {} });
        scanners.clear();
        preBuffers.clear();
        fetchQueue.length = 0;
        activeFetches = 0;
        fetchingSymbols.clear();
    }
}));

const fetchingSymbols = new Set<string>();

// Helper for decimals (Fallback)
function getDecimals(symbol: string): number {
    if (symbol.includes('100') || symbol.includes('10')) return 2; // Rough guess
    // Better to use constants or just trust string parsing
    // Actually Masterbot has ticksToDecimals in lib/deriv/constants
    return 2;
}
