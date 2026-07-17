import { DerivMessage, ConnectionStatus } from '../deriv/types';

const ENDPOINT = 'wss://api.derivws.com/trading/v1/options/ws/public';

class ScannerWS {
    private socket: WebSocket | null = null;
    private appId = '123618'; // Default, can be updated
    private activeSubscriptions: Set<string> = new Set();
    private onMessageCallbacks: ((message: DerivMessage) => void)[] = [];
    private onStatusChangeCallbacks: ((status: ConnectionStatus) => void)[] = [];
    private messageQueue: object[] = [];
    public status: ConnectionStatus = 'disconnected';

    constructor() { }

    public connect(appId?: string) {
        if (appId) this.appId = appId;

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.updateStatus('connecting');
        const url = `${ENDPOINT}?app_id=${this.appId}`;

        try {
            this.socket = new WebSocket(url);

            this.socket.onopen = () => {
                console.log('[ScannerWS] Connected');
                this.updateStatus('connected');
                this.resubscribeAll();
                this.flushQueue();
            };

            this.socket.onclose = () => {
                console.log('[ScannerWS] Disconnected');
                this.updateStatus('disconnected');
                this.socket = null;
                setTimeout(() => this.connect(), 2000); // Auto-reconnect
            };

            this.socket.onerror = (err) => {
                console.error('[ScannerWS] Error:', err);
                this.updateStatus('error');
            };

            this.socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    // Normalize Tick
                    if (message.msg_type === 'tick' && message.tick) {
                        message.tick = {
                            ...message.tick,
                            pip_size: message.tick.pip_size // Ensure pass-through
                        };
                    }

                    this.onMessageCallbacks.forEach(cb => cb(message));
                } catch (e) {
                    console.error('[ScannerWS] Parse Error', e);
                }
            };

        } catch (e) {
            console.error('[ScannerWS] Connection Failed', e);
            this.updateStatus('error');
        }
    }

    public subscribe(market: string) {
        if (!this.activeSubscriptions.has(market)) {
            this.activeSubscriptions.add(market);
            this.send({ ticks: market, subscribe: 1 });
        }
    }

    public getHistory(market: string, count: number = 5000) {
        // Request history but convert to 'ticks_history' format
        // end: 'latest', count: count, style: 'ticks'
        this.send({
            ticks_history: market,
            end: 'latest',
            count: count,
            style: 'ticks',
            adjust_start_time: 1
        });
    }

    private resubscribeAll() {
        if (this.activeSubscriptions.size > 0) {
            console.log(`[ScannerWS] Resubscribing to ${this.activeSubscriptions.size} markets`);
            this.activeSubscriptions.forEach(market => {
                this.send({ ticks: market, subscribe: 1 });
            });
        }
    }

    private send(data: any) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            this.messageQueue.push(data);
        }
    }

    private flushQueue() {
        while (this.messageQueue.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
            const data = this.messageQueue.shift();
            this.socket.send(JSON.stringify(data));
        }
    }

    private updateStatus(status: ConnectionStatus) {
        this.status = status;
        this.onStatusChangeCallbacks.forEach(cb => cb(status));
    }

    public onMessage(cb: (msg: DerivMessage) => void) {
        this.onMessageCallbacks.push(cb);
        return () => {
            this.onMessageCallbacks = this.onMessageCallbacks.filter(c => c !== cb);
        };
    }

    public onStatusChange(cb: (status: ConnectionStatus) => void) {
        this.onStatusChangeCallbacks.push(cb);
        return () => {
            this.onStatusChangeCallbacks = this.onStatusChangeCallbacks.filter(c => c !== cb);
        };
    }
}

export const scannerWS = new ScannerWS();
