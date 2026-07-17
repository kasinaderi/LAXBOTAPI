import { WebSocket, WebSocketServer } from 'ws';

const APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
const DERIV_WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${APP_ID}`; // Match client endpoint
const RELAY_PORT = 8081;
const MARKETS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V', '1HZ50V', '1HZ75V', '1HZ90V', '1HZ100V',
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];
const MAX_CACHE_SIZE = 5000;

interface TickData {
    epoch: number;
    quote: number;
    symbol: string;
    pip_size: number;
}

class TickRelayService {
    private derivSocket: WebSocket | null = null;
    private relayServer: WebSocketServer;
    private tickCache: Record<string, number[]> = {};
    private clients: Set<WebSocket> = new Set();
    private reconnectAttempts = 0;
    private backoffSchedule = [1000, 2000, 5000, 10000, 30000, 60000];
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private startTime: number = Date.now();
    private statsInterval: NodeJS.Timeout | null = null;
    private totalTicksReceived = 0;
    private trackedSymbols: Set<string> = new Set();

    constructor() {
        this.relayServer = new WebSocketServer({ port: RELAY_PORT });
        this.setupRelayServer();
        this.connectToDeriv();
        this.startStatsBroadcast();

        // Initialize cache
        MARKETS.forEach(m => this.tickCache[m] = []);

        console.log(`[Relay] Server started on port ${RELAY_PORT} | Markets: ${MARKETS.length} | Cache: ${MAX_CACHE_SIZE}`);
    }

    private startStatsBroadcast() {
        this.statsInterval = setInterval(() => {
            const stats = {
                type: 'stats',
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
                reconnects: this.reconnectAttempts,
                clients: this.clients.size,
                markets: MARKETS.length,
                status: this.derivSocket?.readyState === WebSocket.OPEN ? 'online' : 'offline',
                totalTicks: this.totalTicksReceived
            };
            this.broadcast(JSON.stringify(stats));

            if (this.derivSocket?.readyState === WebSocket.OPEN) {
                process.stdout.write(`\r[Relay] Status: OK | Ticks: ${this.totalTicksReceived} | Clients: ${this.clients.size} | Uptime: ${stats.uptime}s      `);
            }
        }, 5000);
    }

    private broadcast(payload: string) {
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    private setupRelayServer() {
        this.relayServer.on('connection', (ws) => {
            this.clients.add(ws);
            console.log(`[Relay] New client connected. Total: ${this.clients.size}`);

            // Send initial snapshot
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'snapshot', data: this.tickCache }));
            }

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log(`[Relay] Client disconnected. Total: ${this.clients.size}`);
            });

            ws.on('error', (err) => {
                console.error('[Relay] Client connection error:', err.message);
                this.clients.delete(ws);
            });
        });

        this.relayServer.on('error', (err) => {
            console.error('[Relay] Server Critical Error:', err);
        });
    }

    private connectToDeriv() {
        console.log('[Relay] Connecting to Deriv...');
        this.derivSocket = new WebSocket(DERIV_WS_URL);

        this.derivSocket.on('open', () => {
            console.log('[Relay] Connected to Deriv backbone.');
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.subscribeToMarkets();
        });

        this.derivSocket.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.msg_type === 'ping') {
                    this.clearHeartbeatTimeout();
                }
                if (message.msg_type === 'tick' && message.tick) {
                    // Debug: Log first tick of each type to confirm subscription
                    if (!this.trackedSymbols.has(message.tick.symbol)) {
                        console.log(`[Relay] ✅ First Tick Received: ${message.tick.symbol}`);
                        this.trackedSymbols.add(message.tick.symbol);
                    }
                    this.handleTick(message.tick);
                }
            } catch (e) {
                console.error('[Relay] Error parsing message:', e);
            }
        });

        this.derivSocket.on('close', () => {
            console.log('[Relay] Deriv connection closed.');
            this.stopHeartbeat();
            this.handleReconnect();
        });

        this.derivSocket.on('error', (err) => {
            console.error('[Relay] Deriv error:', err.message);
        });
    }

    private heartbeatTimeout: NodeJS.Timeout | null = null;
    private startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.derivSocket?.readyState === WebSocket.OPEN) {
                this.heartbeatTimeout = setTimeout(() => {
                    console.log('[Relay] Heartbeat timeout (10s) - Reconnecting...');
                    this.derivSocket?.terminate();
                }, 10000);

                this.derivSocket.send(JSON.stringify({ ping: 1 }));
            }
        }, 10000);
    }

    private clearHeartbeatTimeout() {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }

    private stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.clearHeartbeatTimeout();
    }

    private handleReconnect() {
        const delay = this.backoffSchedule[Math.min(this.reconnectAttempts, this.backoffSchedule.length - 1)];
        console.log(`[Relay] Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts + 1})`);
        this.reconnectAttempts++;
        setTimeout(() => this.connectToDeriv(), delay);
    }

    private subscribeToMarkets() {
        MARKETS.forEach(symbol => {
            this.derivSocket?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        });
    }

    private handleTick(tick: TickData) {
        const { symbol, quote, pip_size } = tick;
        this.totalTicksReceived++;

        // Extract digit at precision (Robust)
        const precision = (pip_size !== undefined && pip_size > 0 && pip_size < 1)
            ? Math.abs(Math.round(Math.log10(1 / pip_size)))
            : (pip_size || 2);

        const quoteStr = quote.toFixed(precision);
        const digit = parseInt(quoteStr.charAt(quoteStr.length - 1), 10);

        // Update cache
        if (this.tickCache[symbol]) {
            this.tickCache[symbol].push(digit);
            if (this.tickCache[symbol].length > MAX_CACHE_SIZE) {
                this.tickCache[symbol].shift();
            }
        }

        // Broadcast to all clients with server timestamp for latency tracking
        const payload = JSON.stringify({
            type: 'tick',
            symbol,
            digit,
            quote,
            pip_size, // Passthrough pip_size
            serverTime: Date.now()
        });
        this.broadcast(payload);
    }
}

new TickRelayService();
