import { DerivMessage, ConnectionStatus } from './types';

const PUBLIC_ENDPOINT = 'wss://api.derivws.com/trading/v1/options/ws/public';

class DerivWS {
    private socket: WebSocket | null = null;
    private appId: string;
    private token: string | null = null;
    private onMessageCallbacks: ((message: DerivMessage) => void)[] = [];
    private onStatusChangeCallbacks: ((status: ConnectionStatus) => void)[] = [];
    private getState: (() => any) | null = null;

    public init(getState: () => any) {
        this.getState = getState;
    }

    public clearCallbacks() {
        this.onMessageCallbacks = [];
        this.onStatusChangeCallbacks = [];
    }
    private messageQueue: object[] = [];
    private currentSubscription: string | null = null;

    // HA State
    public status: ConnectionStatus = 'disconnected';
    private reconnectAttempts = 0;
    private shouldReconnect = true; // Set to false by explicit disconnect()
    public isUsingPublicEndpoint = true;
    private backoffSchedule = [1000, 2000, 5000, 10000, 30000, 60000];
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private heartbeatTimeout: NodeJS.Timeout | null = null;
    private stableHeartbeatCount = 0;
    public isStable = false;

    // Latency Tracking
    public lastPingTime = 0;
    public rtt = 0;

    // Request Tracking
    private reqIdCounter = 0;
    private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }> = new Map();

    private getNextReqId(): number {
        return ++this.reqIdCounter;
    }

    private debugLog(msg: string, data?: any) {
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        if (data) {
            console.log(`[DerivWS ${time}] ${msg}`, data);
        } else {
            console.log(`[DerivWS ${time}] ${msg}`);
        }
    }

    constructor() {
        this.appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '33BxSv2MzUXBDltrSkyrZ';
    }

    private async getUrl(): Promise<string> {
        const store = this.getState ? this.getState() : null;
        const token = store?.token || this.token;
        const accountId = store?.account?.loginid;

        if (token && accountId) {
            try {
                const { fetchOTP } = await import('./auth');
                const otpUrl = await fetchOTP(token, accountId);
                if (otpUrl) {
                    console.log(`[DerivWS] Obtained OTP WebSocket URL for account ${accountId}`);
                    this.isUsingPublicEndpoint = false;
                    return otpUrl;
                }
            } catch (e) {
                console.error(`[DerivWS] Failed to fetch OTP for ${accountId}:`, e);
            }
        }
        this.isUsingPublicEndpoint = true;
        return PUBLIC_ENDPOINT;
    }

    public setAppId(id: string) {
        if (this.appId === id) return;
        this.appId = id;
        console.log(`[DerivWS] App ID updated to: ${id}. Reconnecting...`);
        this.disconnect();
        this.connect();
    }

    public setToken(token: string) {
        if (this.token === token) return;
        this.token = token;
        console.log(`[DerivWS] Token updated.`);
        // Only force-reconnect if currently open; otherwise just update the token
        // so the next connect() call picks it up automatically.
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log(`[DerivWS] Socket is open — reconnecting with new token...`);
            this.disconnect();
            this.connect();
        }
    }

    public async connect() {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.shouldReconnect = true; // Allow reconnects when we explicitly connect
        this.updateStatus('connecting');
        try {
            const url = await this.getUrl();
            this.socket = new WebSocket(url);
        } catch (e) {
            console.error('[DerivWS] Critical error creating WebSocket:', e);
            this.updateStatus('error');
            this.handleReconnect();
            return;
        }

        this.socket.onopen = () => {
            console.log(`Connected to Options API WebSocket`);
            this.updateStatus('connected');
            this.reconnectAttempts = 0;

            const store = this.getState ? this.getState() : null;
            const tokenToUse = store?.token || this.token;

            if (store?.account) {
                // Store already has account data (set by authorize() REST call).
                // Emit a synthetic auth message — do NOT send a raw authorize frame to the
                // public Options API endpoint since it rejects plain API tokens.
                console.log('[DerivWS] Account present in store — emitting stored auth.');
                this.emitAuthFromStore();
            } else if (this.isUsingPublicEndpoint && tokenToUse) {
                // No account yet (e.g. app refresh with persisted token but no account).
                // The store's connect() onStatusChange handler will call authorize() which
                // re-fetches accounts via REST and then calls connect() again.
                console.log('[DerivWS] Public endpoint — no account in store yet. Waiting for authorize() call.');
            } else {
                this.emitAuthFromStore();
            }

            this.startHeartbeat();
            this.flushQueue();
        };

        this.socket.onclose = (event) => {
            this.debugLog(`Disconnected. Code: ${event.code}, Reason: ${event.reason || 'No Reason'}, WasClean: ${event.wasClean}`);
            this.updateStatus('disconnected');
            this.stopHeartbeat();
            this.currentSubscription = null;
            this.pendingRequests.forEach((p) => p.reject(new Error('Connection failed')));
            this.pendingRequests.clear();
            if (this.shouldReconnect) {
                this.handleReconnect();
            }
        };

        this.socket.onerror = (error) => {
            this.updateStatus('error');
            this.debugLog('Socket Error Event:', error);
            this.handleReconnect();
        };

        this.socket.onmessage = (event) => {
            try {
                const message: DerivMessage = JSON.parse(event.data);

                if (message.msg_type === 'authorize' && !message.error) {
                    // console.log('[DerivWS] Authorized successfully. Subscribing to Balance...');
                    this.send({ balance: 1, subscribe: 1 });
                }

                // Handle Request Id matching
                if (message.req_id) {
                    const pending = this.pendingRequests.get(message.req_id);
                    if (pending) {
                        if (message.error) {
                            pending.reject(message.error);
                        } else {
                            pending.resolve(message);
                        }
                        this.pendingRequests.delete(message.req_id);
                        return; // Done with this message
                    }
                }

                if (message.msg_type === 'ping' || message.msg_type === 'pong' || message.ping === 'pong') {
                    // console.log('[DerivWS] Pong received');
                    this.rtt = Date.now() - this.lastPingTime;
                    if (this.rtt > 1000) {
                        console.warn(`[DerivWS] High Latency detected: ${this.rtt}ms`);
                    }
                    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);

                    this.stableHeartbeatCount++;
                    if (this.stableHeartbeatCount >= 3 && !this.isStable) {
                        this.isStable = true;
                    }
                }

                if (message.msg_type === 'tick' && message.tick) {
                    // Normalize the tick data to include pip_size explicitly
                    const normalizedTick = {
                        ...message.tick,
                        pip_size: message.tick.pip_size
                    };

                    // ACTIVITY PROOF: If we are getting ticks, the connection is stable enough to trade.
                    if (!this.isStable) {
                        this.isStable = true;
                        this.debugLog('Stability confirmed via Tick data');
                    }

                    this.onMessageCallbacks.forEach((cb) => cb({ ...message, tick: normalizedTick }));
                    return;
                }

                if (message.msg_type === 'proposal_open_contract' && message.proposal_open_contract) {
                    this.onMessageCallbacks.forEach((cb) => cb(message));
                    return;
                }

                this.onMessageCallbacks.forEach((cb) => cb(message));
            } catch (e) {
                console.error('Error parsing WS message:', e);
            }
        };
    }

    /**
     * Emits a synthetic 'authorize' message using the account data already
     * present in the store (set by the store's authorize() action).
     * This avoids a duplicate fetchAccounts REST call on every WS reconnect.
     */
    private emitAuthFromStore() {
        const store = this.getState ? this.getState() : null;
        if (!store?.token || !store?.account) {
            // No account in store yet — store's authorize() wasn't called first.
            // This can happen on app init reconnect; the store will call authorize() separately.
            return;
        }

        const { account, accounts, token } = store;

        // Build account_list from the store's accounts array
        const accountList = (accounts || []).map((acc: any) => ({
            loginid: acc.loginid,
            currency: acc.currency || 'USD',
            is_virtual: acc.is_virtual ? 1 : 0,
            token: token
        }));

        const mockAuthMessage: DerivMessage = {
            msg_type: 'authorize',
            authorize: {
                balance: (account.balance || 0).toString(),
                currency: account.currency || 'USD',
                loginid: account.loginid,
                email: account.email || '',
                account_list: accountList.length > 0 ? accountList : [{
                    loginid: account.loginid,
                    currency: account.currency || 'USD',
                    is_virtual: account.loginid?.includes('VR') || account.loginid?.startsWith('VRTC') ? 1 : 0,
                    token: token
                }]
            }
        };

        console.log(`[DerivWS] Emitting stored auth for account: ${account.loginid}`);
        this.onMessageCallbacks.forEach(cb => cb(mockAuthMessage));
        this.send({ balance: 1, subscribe: 1 });
    }

    private handleReconnect() {
        this.socket = null;

        // User's requested reconnect logic: Linear backoff capped at 10s
        this.reconnectAttempts++;
        const delay = Math.min(1000 * this.reconnectAttempts, 10000);

        console.log(`Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);

        setTimeout(() => this.connect(), delay);
    }

    private startHeartbeat() {
        this.stopHeartbeat(); // SAFETY: Ensure no previous timer exists
        this.debugLog('Starting Heartbeat Timer (15s interval)');

        this.heartbeatInterval = setInterval(() => {
            this.ping();
        }, 15000); // 15s standard heartbeat
    }

    private stopHeartbeat() {
        if (this.heartbeatInterval) {
            this.debugLog('Stopping Heartbeat Timer');
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }

    private ping() {
        if (this.socket?.readyState === WebSocket.OPEN) {
            // console.log('[DerivWS] Sending Ping...');
            this.lastPingTime = Date.now();
            this.socket.send(JSON.stringify({ ping: 1 }));

            // 30s timeout for pong (Relaxed)
            // SAFETY: Clear any existing timeout to prevent "zombie" timers if ping is called swiftly
            if (this.heartbeatTimeout) {
                clearTimeout(this.heartbeatTimeout);
            }

            // 30s timeout for pong (Relaxed)
            this.heartbeatTimeout = setTimeout(() => {
                this.debugLog('Heartbeat TIMEOUT (30s). Connection Dead. Closing socket...');
                this.isStable = false;
                this.stableHeartbeatCount = 0;
                this.updateStatus('error');

                // Force close to trigger onclose -> handleReconnect
                if (this.socket) {
                    this.socket.close(4000, 'Heartbeat Timeout');
                }
            }, 30000);
        }
    }

    public disconnect() {
        this.shouldReconnect = false; // Prevent auto-reconnect on intentional disconnect
        this.reconnectAttempts = 0;
        if (this.socket) {
            this.socket.close();
        }
        this.stopHeartbeat();
        this.currentSubscription = null; // Clear tracking
    }

    public async waitReady(timeoutMs = 10000): Promise<void> {
        if (this.socket?.readyState === WebSocket.OPEN) return;

        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (this.socket?.readyState === WebSocket.OPEN) {
                    resolve();
                } else if (Date.now() - start > timeoutMs) {
                    reject(new Error('WebSocket connection timed out'));
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    private flushQueue() {
        while (this.messageQueue.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
            const data = this.messageQueue.shift();
            if (data) this.socket.send(JSON.stringify(data));
        }
    }

    public send(data: any) {
        // Queue Deduplication: Remove existing 'forget_all' or 'ticks' if this is a new switch
        if (data.forget_all === 'ticks' || data.ticks) {
            this.messageQueue = this.messageQueue.filter((m: any) => !m.forget_all && !m.ticks);
        }

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            console.log('[DerivWS] Socket not ready, queuing message:', data);
            this.messageQueue.push(data);
            if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
                this.connect();
            }
        }
    }

    public authorize(token: string) {
        this.setToken(token);
    }
    public forgetTicks() {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.send({ forget_all: 'ticks' });
        }
        // Don't nullify currentSubscription here, let subscribeTicks handle it
    }

    public subscribeTicks(symbol: string) {
        if (this.currentSubscription === symbol && this.socket?.readyState === WebSocket.OPEN) {
            return;
        }

        console.log(`[DerivWS] Switching market: ${this.currentSubscription || 'None'} -> ${symbol}`);

        // GUARANTEED: Always send/queue these commands regardless of socket state
        this.send({ forget_all: 'ticks' });
        this.send({ ticks: symbol, subscribe: 1 });

        this.currentSubscription = symbol;
    }

    public subscribeProposalOpenContract(contractId: number) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1
            });
        }
    }

    public async buy(params: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return reject(new Error('Socket not connected'));
            }

            const req_id = this.getNextReqId();
            this.pendingRequests.set(req_id, { resolve, reject });

            // Fix for DIGITDIFF/DIGITMATCH: Use 'barrier' instead of 'prediction'
            const parameters: any = {
                amount: params.amount,
                basis: params.basis || 'stake',
                contract_type: params.contract_type,
                currency: params.currency || 'USD',
                duration: params.duration,
                duration_unit: params.duration_unit,
                symbol: params.symbol,
            };

            // Only map prediction to barrier for Digit types that require it
            if (['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER'].includes(params.contract_type)) {
                parameters.barrier = params.prediction;
            }

            this.socket.send(JSON.stringify({
                buy: 1,
                price: params.amount,
                parameters,
                req_id
            }));
        });
    }

    public async getTickHistory(symbol: string, count: number = 1000): Promise<any> {
        // Wait for connection (max 5s)
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            let attempts = 0;
            while ((!this.socket || this.socket.readyState !== WebSocket.OPEN) && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }
        }

        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return reject(new Error('Socket not connected'));
            }

            const req_id = this.getNextReqId();
            this.pendingRequests.set(req_id, { resolve, reject });

            this.socket.send(JSON.stringify({
                ticks_history: symbol,
                count: count,
                end: 'latest',
                style: 'ticks',
                req_id
            }));
        });
    }

    public onMessage(callback: (message: DerivMessage) => void) {
        this.onMessageCallbacks.push(callback);
        return () => {
            this.onMessageCallbacks = this.onMessageCallbacks.filter((cb) => cb !== callback);
        };
    }

    public onStatusChange(callback: (status: ConnectionStatus) => void) {
        this.onStatusChangeCallbacks.push(callback);
        // CRITICAL: Emit current status immediately so store state is in sync
        callback(this.status);

        return () => {
            this.onStatusChangeCallbacks = this.onStatusChangeCallbacks.filter((cb) => cb !== callback);
        };
    }

    private updateStatus(status: ConnectionStatus) {
        this.status = status;
        this.onStatusChangeCallbacks.forEach((cb) => cb(status));
    }

    public getLatency(): number {
        return this.rtt;
    }
}

const G = globalThis as any;
if (!G.__derivWS) {
    G.__derivWS = new DerivWS();
}
export const derivWS = G.__derivWS as DerivWS;
