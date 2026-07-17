import { create } from 'zustand';

interface RelayState {
    socket: WebSocket | null;
    status: 'connected' | 'disconnected' | 'connecting';
    ticks: Record<string, number[]>;
    lastQuotes: Record<string, number>;
    lastTick: any | null;
    latency: number;
    relayStats: {
        uptime: number;
        reconnects: number;
        clients: number;
        markets: number;
        status: string;
        totalTicks: number;
    } | null;
    onTickCallback: ((tick: any) => void) | null;
    reconnectAttempts: number;

    registerTickCallback: (callback: (tick: any) => void) => () => void;
    handleBackendTick: (tick: { symbol: string; quote: number; epoch: number; digit: number }) => void;
    connect: () => void;
    disconnect: () => void;
    reconnect: () => void;
}

export const useRelayStore = create<RelayState>((set, get) => ({
    socket: null,
    status: 'disconnected',
    ticks: {},
    lastQuotes: {},
    lastTick: null,
    latency: 0,
    relayStats: null,
    onTickCallback: null,

    registerTickCallback: (callback: (tick: any) => void) => {
        set({ onTickCallback: callback });
        return () => set({ onTickCallback: null });
    },

    handleBackendTick: (tick: { symbol: string; quote: number; epoch: number; digit: number }) => {
        // No-op: Decoupled from Backend per User Request
    },

    reconnectAttempts: 0,

    connect: () => {
        const { socket, status, reconnectAttempts } = get() as any;
        if (socket || status === 'connecting' || status === 'connected') return;

        const url = process.env.NEXT_PUBLIC_RELAY_URL || 'ws://127.0.0.1:8081';

        // Only log connection attempt occasionally to reduce noise
        if (reconnectAttempts === 0) {
            console.log('[RelayStore] Connecting to Local Relay...');
        }

        set({ status: 'connecting' });

        try {
            const newSocket = new WebSocket(url);

            newSocket.onopen = () => {
                console.log('[RelayStore] Connected to Local Relay');
                set({ status: 'connected', socket: newSocket, reconnectAttempts: 0 });
            };

            newSocket.onclose = () => {
                const currentAttempts = get().reconnectAttempts || 0;
                set({ status: 'disconnected', socket: null, reconnectAttempts: currentAttempts + 1 });

                // Exponential backoff: 1s, 2s, 4s, 8s, 15s... max 30s
                const delays = [1000, 2000, 4000, 8000, 15000];
                const delay = delays[currentAttempts] || 30000;

                if (currentAttempts % 5 === 0) {
                    console.warn(`[RelayStore] Connection failed. Retrying in ${delay}ms... (Attempt ${currentAttempts + 1})`);
                }

                setTimeout(() => get().connect(), delay);
            };

            newSocket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'tick') {
                        // msg: { type: 'tick', symbol, digit, quote, pip_size, serverTime }
                        const { symbol, digit, quote, serverTime } = msg;

                        // DEBUG: Check reception of new markets
                        if (['1HZ15V', '1HZ30V', '1HZ90V'].includes(symbol)) {
                            // console.log(`[RelayStoreBrowser] RX: ${symbol} @ ${quote}`);
                        }

                        // DEDUPLICATION LOGIC
                        // Optimization: Check existing state before setting to avoid unnecessary updates/duplicates
                        const currentState = get();
                        const lastQuote = currentState.lastQuotes[symbol];
                        const existingTicks = currentState.ticks[symbol] || [];
                        const lastDigit = existingTicks[existingTicks.length - 1];

                        // If identical to last known state, skip
                        if (lastQuote === quote && lastDigit === digit) {
                            return;
                        }

                        // Update Relay State
                        set((state) => {
                            const marketTicks = state.ticks[symbol] || [];
                            const newTicks = [...marketTicks, digit].slice(-5000);

                            const lastTick = {
                                epoch: serverTime || Date.now() / 1000,
                                quote,
                                symbol,
                                pip_size: msg.pip_size || 0,
                                id: 'relay',
                                ask: quote,
                                bid: quote
                            };

                            if (state.onTickCallback) {
                                state.onTickCallback(lastTick);
                            }

                            return {
                                ticks: { ...state.ticks, [symbol]: newTicks },
                                lastQuotes: { ...state.lastQuotes, [symbol]: quote },
                                lastTick
                            };
                        });

                        // Pipe to Scanner Store (Deduped)
                        import('./useScannerStore').then(({ useScannerStore }) => {
                            useScannerStore.getState().handleBackendTick({
                                symbol,
                                quote,
                                digit,
                                epoch: serverTime || Date.now() / 1000 // Fallback if missing
                            });
                        });
                    }

                    if (msg.type === 'stats') {
                        set({ relayStats: msg });
                    }
                } catch (e) {
                    console.error('[RelayStore] Parse error:', e);
                }
            };

            newSocket.onerror = (err) => {
                // onclose will handle redistribution
                set({ status: 'disconnected' });
            };

        } catch (e) {
            console.error('[RelayStore] Connection initial failed:', e);
            setTimeout(() => get().connect(), 10000);
        }
    },

    disconnect: () => {
        const { socket } = get();
        if (socket) {
            socket.onclose = null; // Prevent onclose from triggering reconnect
            socket.close();
        }
        set({ status: 'disconnected', socket: null });
    },

    reconnect: () => {
        get().disconnect();
        set({ reconnectAttempts: 0 }); // Reset attempts on explicit reconnect
        setTimeout(() => get().connect(), 100);
    }
}));
