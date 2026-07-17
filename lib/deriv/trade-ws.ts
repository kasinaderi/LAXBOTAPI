import { ConnectionStatus, TickData, DerivMessage } from './types';

/**
 * TradeWS - Dedicated WebSocket for Direct Trade Execution
 * 
 * Rules:
 * 1. Proposal -> Buy -> POC (Subscribe)
 * 2. Instant Results (is_sold === 1)
 * 3. Heartbeat: 15s
 * 4. Reconnect: 1s -> 2s -> 4s -> 8s -> 15s (cap 30s)
 */
class TradeWS {
    private socket: WebSocket | null = null;
    private appId: string = '33BxSv2MzUXBDltrSkyrZ';
    private token: string | null = null;
    private status: ConnectionStatus = 'disconnected';
    private isAuthorized = false;
    private isAuthorizing = false;
    private forgottenProposalIds = new Set<string>();
    private eventListeners: ((type: string, data: any) => void)[] = [];
    private onMessageCallbacks: ((msg: any) => void)[] = [];
    private getState: (() => any) | null = null;
    private proposalSubscriptions = new Map<string, string>(); // stakeKey -> subscription_id
    private pendingAutoBuys = new Map<string, string>(); // stakeKey -> requestId
    private isForgetting: boolean = false;
    public isUsingPublicEndpoint = true;

    public init(getState: () => any) {
        this.getState = getState;
    }

    public clearListeners() {
        this.eventListeners = [];
        this.onMessageCallbacks = [];
    }

    public send(payload: any) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(payload));
        } else {
            console.warn('[TradeWS] Socket not ready, cannot send:', payload);
        }
    }

    public onMessage(callback: (msg: any) => void) {
        this.onMessageCallbacks.push(callback);
        return () => {
            this.onMessageCallbacks = this.onMessageCallbacks.filter(cb => cb !== callback);
        };
    }

    // Trade Pool: Support Concurrent Execution & Recovery
    private tradePool = new Map<string, {
        requestId: string;
        startTime: number;
        params?: any; // Original trade parameters for retry/recovery
        proposalSentTime?: number;
        proposalRecvTime?: number;
        buySentTime?: number;
        buyRecvTime?: number;
        settleRecvTime?: number;
        contractId?: number;
    }>();

    // Reconnection State
    private reconnectAttempts = 0;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private shouldReconnect = true; // Set to false on explicit disconnect()

    constructor() {
        if (typeof window !== 'undefined') {
            this.appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '33BxSv2MzUXBDltrSkyrZ';
        }
    }

    public disconnect() {
        this.shouldReconnect = false; // Prevent auto-reconnect on intentional disconnect
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.onclose = null; // Prevent reconnect loop
            this.socket.close();
            this.socket = null;
        }
        this.status = 'disconnected';
        this.isAuthorized = false;
        this.isAuthorizing = false;

        // Mark pending trades as ERROR before clearing
        const store = this.getState ? this.getState() : null;
        if (store) {
            this.tradePool.forEach((trade, id) => {
                store.updateTradeLog(id, { result: 'ERROR', error: 'Disconnected manually' });
            });
        }
        this.tradePool.clear();

        if (store) {
            store.setTradeWsStatus('disconnected');
            store.setTradeAuthorized(false);
        }
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
                    console.log(`[TradeWS] Obtained OTP WebSocket URL for account ${accountId}`);
                    this.isUsingPublicEndpoint = false;
                    return otpUrl;
                }
            } catch (e) {
                console.error(`[TradeWS] Failed to fetch OTP for ${accountId}:`, e);
            }
        }
        this.isUsingPublicEndpoint = true;
        return `wss://api.derivws.com/trading/v1/options/ws/public`;
    }

    public async connect() {
        const store = this.getState ? this.getState() : null;
        const hasCredentials = !!(store?.token && store?.account?.loginid);

        if (this.socket && this.isUsingPublicEndpoint && hasCredentials) {
            console.log('[TradeWS] Switch detected: upgrading public connection to secure OTP URL...');
            this.disconnect();
        }

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.shouldReconnect = true; // Allow reconnects when we explicitly connect
        this.updateStatus('connecting');

        try {
            const url = await this.getUrl();
            this.socket = new WebSocket(url);

            this.socket.onopen = () => {
                this.updateStatus('connected');
                this.reconnectAttempts = 0;
                this.startHeartbeat();

                // OTP url handles authentication at connection level
                this.isAuthorized = !this.isUsingPublicEndpoint;
                this.isAuthorizing = false;
                
                const store = this.getState ? this.getState() : null;
                const tokenToUse = store?.token || this.token;

                if (this.isUsingPublicEndpoint && tokenToUse) {
                    console.log('[TradeWS] Public endpoint active. Sending authorize request...');
                    this.isAuthorizing = true;
                    this.socket?.send(JSON.stringify({ authorize: tokenToUse }));
                } else {
                    if (store) {
                        store.setTradeAuthorized(this.isAuthorized);
                    }
                }
            };

            this.socket.onmessage = (event) => this.handleMessage(JSON.parse(event.data));

            this.socket.onclose = (e) => {
                console.warn(`[TradeWS] Connection Closed. Code: ${e.code}, Reason: ${e.reason || 'None'}`);
                this.updateStatus('disconnected');
                this.isAuthorized = false;
                this.isAuthorizing = false;

                // Mark pending trades as ERROR before clearing
                const store = this.getState ? this.getState() : null;
                if (store) {
                    this.tradePool.forEach((trade, id) => {
                        store.updateTradeLog(id, { result: 'ERROR', error: 'Connection Lost' });
                    });
                }

                this.tradePool.clear();
                this.stopHeartbeat();
                if (this.shouldReconnect) {
                    this.handleReconnect();
                }
            };

            this.socket.onerror = (err: any) => {
                if (err && err.message) {
                    console.warn('[TradeWS] Socket Error:', err.message);
                }
                this.updateStatus('error');
            };

        } catch (e) {
            console.error('[TradeWS] Failed to create socket:', e);
            this.handleReconnect();
        }
    }

    public forceReconnect() {
        this.disconnect();
        setTimeout(() => this.connect(), 1000);
    }
    
    private handleReconnect() {
        const delays = [1000, 2000, 4000, 8000, 15000];
        const delay = delays[this.reconnectAttempts] || 30000;

        if (this.reconnectAttempts % 5 === 0) {
            console.warn(`[TradeWS] Connection failed. Retrying in ${delay}ms... (Attempt ${this.reconnectAttempts + 1})`);
        }

        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ ping: 1 }));
            }
        }, 15000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    private updateStatus(status: ConnectionStatus) {
        this.status = status;
        // Sync with store
        const store = this.getState ? this.getState() : null;
        if (store) {
            store.setTradeWsStatus(status);
        }
    }


    public onEvent(callback: (type: string, data: any) => void) {
        this.eventListeners.push(callback);
    }

    private emitEvent(type: string, data: any) {
        this.eventListeners.forEach(cb => cb(type, data));
    }


    public authorize(token: string) {
        if (!token || typeof token !== 'string' || token.trim().length < 8) {
            console.warn('[TradeWS] Aborted Authorize: Token is empty or invalid.');
            return;
        }
        if (this.token === token && this.isAuthorized) return;

        console.log('[TradeWS] Token updated. Reconnecting trade WS...');
        this.token = token;
        this.disconnect();
        this.connect();
    }

    private getStakeKey(stake: number | string, contractType: string): string {
        return `${Number(stake).toFixed(2)}_${contractType}`;
    }

    private handleMessage(msg: any) {
        // Dispatch to any external listeners first (e.g. DTrader TradeForm)
        this.onMessageCallbacks.forEach(cb => cb(msg));

        const store = this.getState ? this.getState() : null;
        if (!store) return;

        // Log basic info for all responses
        if (msg.error) {
            // Detailed message for UI log
            const errorMsg = msg.error.message || msg.error.code || 'Unknown Deriv Error';

            // Handle recoverable errors silently (SMART RECOVERY will handle them)
            const recoverableErrors = ['AlreadySubscribed', 'InvalidContractProposal'];
            const isWrongAuthRes = msg.msg_type === 'authorize' && msg.error.code === 'WrongResponse';
            
            if (!recoverableErrors.includes(msg.error.code) && !isWrongAuthRes) {
                console.error(`[TradeWS RX ERROR] ${msg.msg_type}:`, JSON.stringify(msg.error, null, 2));
            }
            
            // Log non-critical proposal errors as warnings if needed (for internal tracking)
            if (msg.error.code === 'InvalidContractProposal') {
                // console.warn(`[TradeWS] Recoverable: InvalidContractProposal for ${msg.msg_type}`);
            }

            if (msg.error.code === 'AlreadySubscribed') {
                if (msg.msg_type === 'proposal' && msg.echo_req?.passthrough?.buyAfterRec) {
                    const stake = msg.echo_req?.amount ?? msg.echo_req?.parameters?.amount;
                    const contractType = msg.echo_req?.contract_type || msg.echo_req?.parameters?.contract_type || "";
                    const passthrough = msg.echo_req.passthrough;
                    const stakeKey = this.getStakeKey(stake, contractType);
                    const existingProposal = store.activeProposal ? store.activeProposal[stakeKey] : null;

                    if (existingProposal) {
                        this.executeProposalBuy(passthrough.requestId, existingProposal.id, existingProposal.askPrice, msg.echo_req);
                    } else {
                        // Not in store yet, but Deriv says we are subscribed. 
                        // It must be in flight. Mark it for auto-buy.
                        this.pendingAutoBuys.set(stakeKey, passthrough.requestId);
                    }
                }
                return;
            }

            // SMART BUY RECOVERY: Handle Stale/Invalid Proposal IDs
            if (msg.error.code === 'InvalidContractProposal' && (msg.msg_type === 'buy' || msg.msg_type === 'proposal')) {
                const errReqId = msg.echo_req?.passthrough?.requestId;
                const poolItem = errReqId ? this.tradePool.get(String(errReqId)) : null;

                if (poolItem && poolItem.params) {
                    console.warn(`[TradeWS] Stale ID Detected (InvalidContractProposal). Triggering SMART RECOVERY for Req: ${errReqId}`);
                    
                    // 1. Clear the stale ID from store immediately
                    const stakeKey = this.getStakeKey(poolItem.params.stake, poolItem.params.contract_type);
                    store.setActiveProposal(stakeKey, null);

                    // 2. UI Feedback
                    store.updateTradeLog(String(errReqId), { result: 'RENEWING ID...' });

                    // 3. Trigger fresh proposal + buy cycle
                    this.subscribeToProposal({
                        ...poolItem.params,
                        buyAfterRec: true,
                        requestId: errReqId
                    });
                    return; // Prevent standard error cleanup
                }
            }

            // Report to UI if we have a pending trade
            // Report to UI if we can identify the trade
            const errReqId = msg.echo_req?.passthrough?.requestId || msg.echo_req?.req_id;
            if (errReqId) {
                store.updateTradeLog(errReqId, {
                    result: 'ERROR',
                    error: errorMsg
                });
                this.tradePool.delete(String(errReqId));
            }

            if (msg.msg_type === 'proposal') {
                console.error(`[TradeWS] Proposal Error: ${errorMsg}`);
            }

            if (msg.msg_type === 'authorize') {
                this.isAuthorizing = false;
                store.setTradeAuthorized(false);
            }
            return;
        }

        if (msg.msg_type === 'authorize') {
            this.isAuthorizing = false;
            this.isAuthorized = true;
            store.setTradeAuthorized(true);
            return;
        }

        // 2. Proposal Success
        if (msg.msg_type === 'proposal') {
            const proposal = msg.proposal;
            
            // ZOMBIE PROTECTION: Ignore in-flight ticks that arrive after a forget/buy
            if (this.forgottenProposalIds.has(proposal.id)) {
                return;
            }
            
            const recvTime = Date.now();
            // Prioritize flat fields from proposal request (amount, contract_type, underlying_symbol)
            const stake = msg.echo_req?.amount ?? msg.echo_req?.parameters?.amount;
            const contractType = msg.echo_req?.contract_type || msg.echo_req?.parameters?.contract_type || "";
            const symbol = msg.echo_req?.underlying_symbol || msg.echo_req?.parameters?.underlying_symbol
                        || msg.echo_req?.parameters?.underlying || msg.echo_req?.underlying
                        || msg.echo_req?.parameters?.symbol || msg.echo_req?.symbol || "";
            const stakeKey = this.getStakeKey(stake, contractType);

            if (stakeKey) this.proposalSubscriptions.set(stakeKey, proposal.id);
            
            const passthrough = msg.echo_req?.passthrough;
            if (passthrough?.buyAfterRec && passthrough?.requestId) {
                this.executeProposalBuy(passthrough.requestId, proposal.id, proposal.ask_price);
                return;
            }

            // Check if there's a pending Auto-Buy for this key
            const pendingRequestId = this.pendingAutoBuys.get(stakeKey);
            if (pendingRequestId) {
                this.pendingAutoBuys.delete(stakeKey);
                this.executeProposalBuy(pendingRequestId, proposal.id, proposal.ask_price);
                return;
            }

            store.setActiveProposal(stakeKey, {
                id: proposal.id,
                askPrice: proposal.ask_price,
                receivedAt: recvTime,
                symbol
            });
            return;
        }

        // Correlation via req_id or echo_req.passthrough
        const reqId = msg.req_id || msg.echo_req?.req_id;
        const passthrough = msg.echo_req?.passthrough;
        const requestId = passthrough?.requestId;

        // --- GLOBAL POC HANDLING (If not mapped via pass through) ---
        if (msg.msg_type === 'proposal_open_contract' && !requestId) {
            const poc = msg.proposal_open_contract;

            // Find Trade in Pool by contract_id
            let matchedTrade = null;
            for (const [id, trade] of this.tradePool.entries()) {
                if (trade.contractId === poc.contract_id) {
                    matchedTrade = trade;
                    break;
                }
            }

            if (!matchedTrade) return;

            // STREAM EVENT
            this.emitEvent('CONTRACT_UPDATE', {
                requestId: matchedTrade.requestId,
                data: poc
            });

            // Always update UI log for real-time "flicker" feedback
            let runningExit = '-';
            const spotToUse = poc.exit_spot ?? poc.current_spot;
            if (spotToUse !== undefined && spotToUse !== null) {
                const spotStr = spotToUse.toString().trim();
                if (spotStr.length > 0) runningExit = spotStr.charAt(spotStr.length - 1);
            } else {
                const tickToUse = poc.exit_tick_display_value ?? poc.exit_tick_display;
                if (tickToUse !== undefined && tickToUse !== null) {
                    const tickStr = tickToUse.toString().trim();
                    runningExit = tickStr.charAt(tickStr.length - 1);
                }
            }
            store.updateTradeLog(matchedTrade.requestId, {
                profit: parseFloat(poc.profit),
                exit: runningExit,
                result: (poc.status === 'won' || poc.status === 'lost' || poc.is_sold === 1)
                    ? (poc.status === 'won' ? 'WON' : 'LOST')
                    : 'RUNNING...'
            });

            const rawProfit = parseFloat(poc.profit);
            const stake = parseFloat(poc.buy_price);
            const payout = parseFloat(poc.payout);

            // RESOLUTION LOGIC:
            // 1. Profit matches full loss (negative stake) -> Final Loss
            // 2. Profit is positive -> Final Win
            // 3. Status is final (won/lost) or is_sold -> Final Result
            const isFinalWin = rawProfit > 0 || poc.status === 'won';
            const isFinalLoss = (stake > 0 && Math.abs(rawProfit + stake) < 0.01) || poc.status === 'lost';
            const isResolved = isFinalWin || isFinalLoss || poc.is_sold === 1;

            if (isResolved) {
                matchedTrade.settleRecvTime = Date.now();
                const settlementLatency = matchedTrade.settleRecvTime - matchedTrade.buyRecvTime!;

                store.updateTradeMetrics({ settlementLatency });

                const isWin = isFinalWin;
                
                // NORMALIZE PROFIT for the FINAL result log and logic
                let finalProfit = rawProfit;
                if (isWin) {
                    finalProfit = (payout && stake) ? (payout - stake) : rawProfit;
                } else {
                    finalProfit = stake ? -stake : rawProfit;
                }

                // EMIT FINAL RESULT INSTANTLY (to TradeEngine for Martingale)
                this.emitEvent('TRADE_RESULT', {
                    requestId: matchedTrade.requestId,
                    contractId: poc.contract_id,
                    isWin,
                    profit: finalProfit,
                    poc
                });

                const existingLog = store.tradeLogs?.find((l: any) => l.requestId === matchedTrade.requestId);
                let finalExit = poc.exit_spot?.toString().trim().slice(-1) ||
                    poc.exit_tick_display_value?.toString().trim().slice(-1) ||
                    poc.exit_tick_display?.toString().trim().slice(-1) || '-';
                if (finalExit === '-' && existingLog && existingLog.exit && existingLog.exit !== '-') finalExit = existingLog.exit;

                // FINAL UI update
                store.updateTradeLog(matchedTrade.requestId, {
                    result: isWin ? 'WON' : 'LOST',
                    profit: finalProfit,
                    exit: finalExit
                });

                this.tradePool.delete(matchedTrade.requestId);
            }
            return;
        }


        if (!this.tradePool.has(String(requestId))) {
            return;
        }

        const pendingTrade = this.tradePool.get(String(requestId))!;

        // 3. Buy Response (Direct Execution)
        if (msg.msg_type === 'buy') {
            pendingTrade.buyRecvTime = Date.now();
            pendingTrade.contractId = msg.buy.contract_id;
            
            // Latency Calculation: from whenever the specific action was triggered
            const latency = pendingTrade.buySentTime 
                ? (pendingTrade.buyRecvTime - pendingTrade.buySentTime)
                : (pendingTrade.buyRecvTime - pendingTrade.proposalSentTime!); 

            store.updateTradeMetrics({ buyLatency: latency });
            store.updateTradeLog(pendingTrade.requestId, { result: 'BUYING...' });

            // TRACE START EVENT
            this.emitEvent('TRADE_STARTED', {
                requestId: pendingTrade.requestId,
                contractId: pendingTrade.contractId
            });

            // NOTE: Manual POC subscription is no longer needed because we used 'subscribe: 1' in the buy command.
            return;
        }

        // 3. POC (Targeted via matching passthrough)
        if (msg.msg_type === 'proposal_open_contract' && requestId) {
            const poc = msg.proposal_open_contract;

            // STREAM EVENT
            this.emitEvent('CONTRACT_UPDATE', {
                requestId: pendingTrade.requestId,
                data: poc
            });

            // Always update UI log for real-time "flicker" feedback
            let runningExitT = '-';
            const spotToUseT = poc.exit_spot ?? poc.current_spot;
            if (spotToUseT !== undefined && spotToUseT !== null) {
                const spotStrT = spotToUseT.toString().trim();
                if (spotStrT.length > 0) runningExitT = spotStrT.charAt(spotStrT.length - 1);
            } else {
                const tickToUseT = poc.exit_tick_display_value ?? poc.exit_tick_display;
                if (tickToUseT !== undefined && tickToUseT !== null) {
                    const tickStrT = tickToUseT.toString().trim();
                    runningExitT = tickStrT.charAt(tickStrT.length - 1);
                }
            }
            store.updateTradeLog(pendingTrade.requestId, {
                profit: parseFloat(poc.profit),
                exit: runningExitT,
                result: (poc.status === 'won' || poc.status === 'lost' || poc.is_sold === 1)
                    ? (poc.status === 'won' ? 'WON' : 'LOST')
                    : 'RUNNING...'
            });

            const rawProfit = parseFloat(poc.profit);
            const stake = parseFloat(poc.buy_price);
            const payout = parseFloat(poc.payout);

            const isFinalWin = rawProfit > 0 || poc.status === 'won';
            const isFinalLoss = (stake > 0 && Math.abs(rawProfit + stake) < 0.01) || poc.status === 'lost';
            const isResolved = isFinalWin || isFinalLoss || poc.is_sold === 1;

            if (isResolved) {
                pendingTrade.settleRecvTime = Date.now();
                const settlementLatency = pendingTrade.settleRecvTime - pendingTrade.buyRecvTime!;

                store.updateTradeMetrics({ settlementLatency });

                const isWin = isFinalWin;
                
                let finalProfit = rawProfit;
                if (isWin) {
                    finalProfit = (payout && stake) ? (payout - stake) : rawProfit;
                } else {
                    finalProfit = stake ? -stake : rawProfit;
                }

                // EMIT FINAL RESULT INSTANTLY
                this.emitEvent('TRADE_RESULT', {
                    requestId: pendingTrade.requestId,
                    contractId: poc.contract_id,
                    isWin,
                    profit: finalProfit,
                    poc
                });

                const existingLog = store.tradeLogs?.find((l: any) => l.requestId === pendingTrade.requestId);
                let finalExit = poc.exit_spot?.toString().trim().slice(-1) ||
                    poc.exit_tick_display_value?.toString().trim().slice(-1) ||
                    poc.exit_tick_display?.toString().trim().slice(-1) || '-';
                if (finalExit === '-' && existingLog && existingLog.exit && existingLog.exit !== '-') finalExit = existingLog.exit;

                // FINAL UI update
                store.updateTradeLog(pendingTrade.requestId, {
                    result: isWin ? 'WON' : 'LOST',
                    profit: finalProfit,
                    exit: finalExit
                });

                this.tradePool.delete(pendingTrade.requestId);
            }
            return;
        }
    }

    public executeDirectTrade(payload: any) {
        if (this.tradePool.size >= 5) {
            return;
        }

        const requestId = Date.now(); // MUST BE INTEGER
        const pendingTrade = {
            requestId: String(requestId),
            startTime: Date.now(),
            proposalSentTime: Date.now()
        };
        this.tradePool.set(pendingTrade.requestId, pendingTrade);

        // STEP 1: DIRECT BUY WITH PARAMETERS
        // Options API buy uses nested `parameters` object with `underlying` (not `symbol`)
        const buyReq: any = {
            buy: 1,
            price: Number(payload.stake),
            parameters: {
                amount: Number(payload.stake),
                basis: 'stake',
                contract_type: payload.contract_type,
                currency: payload.currency || 'USD',
                duration: payload.duration || 1,
                duration_unit: payload.duration_unit || 't',
                underlying_symbol: payload.symbol || payload.underlying || payload.underlying_symbol,
            },
            subscribe: 1,
            passthrough: { requestId: pendingTrade.requestId },
            req_id: requestId
        };

        // barrier goes inside parameters if provided
        if (payload.barrier !== undefined && payload.barrier !== null) {
            buyReq.parameters.barrier = String(payload.barrier);
        }

        this.socket?.send(JSON.stringify(buyReq));

        // UI Feedback
        const store = this.getState ? this.getState() : null;
        if (store) {
            store.addTradeLog({
                requestId,
                time: Date.now(),
                contract: payload.contract_type,
                result: '',
                stake: payload.stake.toString(),
                profit: null, // null = Pending (No flickering 0.00)
                digit: (payload.barrier !== undefined && payload.barrier !== null) ? payload.barrier : '-',
                exit: '-',
                currency: payload.currency || 'USD'
            });
        }
    }

    public forgetProposalByStake(stake: number, contractType?: string) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            // If contractType provided, forget specific. Otherwise forget all for this stake value.
            const keysToForget: string[] = [];
            if (contractType) {
                keysToForget.push(this.getStakeKey(stake, contractType));
            } else {
                for (const key of this.proposalSubscriptions.keys()) {
                    if (key.startsWith(Number(stake).toFixed(2))) {
                        keysToForget.push(key);
                    }
                }
            }

            keysToForget.forEach(key => {
                const subId = this.proposalSubscriptions.get(key);
                if (subId) {
                    this.forgottenProposalIds.add(subId);
                    setTimeout(() => this.forgottenProposalIds.delete(subId), 3000);
                    this.socket?.send(JSON.stringify({ forget: subId }));
                    this.proposalSubscriptions.delete(key);
                    
                    // Clear from activeProposal properly
                    const store = this.getState ? this.getState() : null;
                    if (store) {
                        store.setActiveProposal(key, null as any);
                    }
                }
            });
        }
    }

    public forgetProposals() {
        if (this.socket?.readyState === WebSocket.OPEN) {
            const store = this.getState ? this.getState() : null;
            for (const subId of this.proposalSubscriptions.values()) {
                this.forgottenProposalIds.add(subId);
                setTimeout(() => this.forgottenProposalIds.delete(subId), 3000);
                this.socket?.send(JSON.stringify({ forget: subId }));
                if (store) {
                    const activeProposals = store.activeProposal || {};
                    const usedStake = Object.keys(activeProposals).find(k => activeProposals[k].id === subId);
                    if (usedStake) store.setActiveProposal(usedStake, null as any);
                }
            }
            this.proposalSubscriptions.clear();
        }
    }

    public pruneUnusedProposals(activeStakes: number[]) {
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        
        const store = this.getState ? this.getState() : null;
        const activeStakeKeys = activeStakes.map(s => Number(s).toFixed(2));

        for (const [stakeKey, subId] of this.proposalSubscriptions.entries()) {
            const stakeValue = stakeKey.split('_')[0];
            if (!activeStakeKeys.includes(stakeValue)) {
                this.forgottenProposalIds.add(subId);
                setTimeout(() => this.forgottenProposalIds.delete(subId), 3000);
                this.socket?.send(JSON.stringify({ forget: subId }));
                this.proposalSubscriptions.delete(stakeKey);
                
                if (store) {
                    store.setActiveProposal(stakeKey, null as any);
                }
            }
        }
    }

    public subscribeToProposal(payload: any) {
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        if (!this.isAuthorized) {
            console.warn('[TradeWS] subscribeToProposal: Not authorized (OTP endpoint required for trading). Skipping proposal request.');
            return;
        }


        const stakeKey = this.getStakeKey(payload.stake, payload.contract_type);

        // Optimization: If we already have a subscription for this key in the store, we can use it.
        // But we don't return early here because if the store is empty, we NEED to send the request.
        if (payload.buyAfterRec) {
            const store = this.getState ? this.getState() : null;
            const existingProposal = store?.activeProposal ? store.activeProposal[stakeKey] : null;

            if (existingProposal) {
                this.executeProposalBuy(payload.requestId, existingProposal.id, existingProposal.askPrice, payload);
                return;
            }

            // Store params in pool for potential retry if this is the first attempt
            if (!this.tradePool.has(payload.requestId)) {
                this.tradePool.set(payload.requestId, {
                    requestId: payload.requestId,
                    startTime: Date.now(),
                    params: payload,
                    proposalSentTime: Date.now()
                });
            }
        }

        // Options API proposal: flat fields, market is 'underlying' (NOT 'symbol', NOT nested)
        const proposalReq: any = {
            proposal: 1,
            amount: Number(payload.stake),
            basis: 'stake',
            contract_type: payload.contract_type,
            currency: payload.currency || 'USD',
            duration: payload.duration || 1,
            duration_unit: 't',
            underlying_symbol: payload.symbol || payload.underlying || payload.underlying_symbol,
            subscribe: 1,
            passthrough: {
                requestId: payload.requestId,
                buyAfterRec: payload.buyAfterRec
            },
            req_id: payload.req_id || Date.now() % 1000000
        };

        // barrier goes at root level (same level as other proposal fields)
        if (payload.barrier !== undefined && payload.barrier !== null) {
            proposalReq.barrier = String(payload.barrier);
        }

        // console.log(`[TradeWS] Subscribing to Proposal: ${payload.contract_type} @ ${payload.stake}${payload.buyAfterRec ? ' (AUTO-BUY MODE)' : ''}`);
        this.socket?.send(JSON.stringify(proposalReq));
    }

    public hasPendingTrade() {
        return this.tradePool.size > 0;
    }

    public executeProposalBuy(requestId: string, proposalId: string, askPrice: string, params?: any) {
        if (this.socket?.readyState !== WebSocket.OPEN || !this.isAuthorized) return;

        const sentTime = Date.now();
        const existingEntry = this.tradePool.get(requestId);

        const pendingTrade = {
            requestId: requestId,
            startTime: existingEntry?.startTime || sentTime,
            buySentTime: sentTime,
            proposalId: proposalId, // Track which ID we used
            params: params || existingEntry?.params // Ensure params are preserved/updated
        };
        this.tradePool.set(requestId, pendingTrade);

        const buyReq = {
            buy: proposalId,
            price: parseFloat(askPrice), 
            subscribe: 1, // AUTO-SUBSCRIBE for fastest results
            passthrough: { requestId, proposalId },
            req_id: Number(requestId)
        };

        // console.log(`[TradeWS] <SEND> Buy Request | ID: ${proposalId} | Price: ${askPrice} | Req: ${requestId} | Time: ${new Date(sentTime).toISOString().split('T')[1].slice(0, -1)}`);
        this.socket?.send(JSON.stringify(buyReq));

        // UI Feedback
        const store = this.getState ? this.getState() : null;
        if (store) {
            // Log as BUYING... (already done by engine, but for redundancy)
            store.updateTradeLog(requestId, { result: 'BUYING...' });
            
            // CRITICAL: Clear only the specific proposal we just used!
            // We find it by finding the key in activeProposal that matches this proposalId
            const activeProposals = store.activeProposal || {};
            const usedStakeKey = Object.keys(activeProposals).find(k => activeProposals[k].id === proposalId);
            if (usedStakeKey) {
                store.setActiveProposal(usedStakeKey, null as any);
                this.proposalSubscriptions.delete(usedStakeKey); // CRITICAL: Clean up internal map too
            }
            
            // CRITICAL GHOST STREAM FIX:
            // Deriv will continue pushing live ticks to this proposal.id stream even after you successfully buy it.
            // If those ticks arrive, our generic proposal handler will identically re-cache this dead ID!
            // We MUST forcefully execute a targeted forget to stop the zombie stream natively mapping into the UI.
            this.forgottenProposalIds.add(proposalId);
            setTimeout(() => this.forgottenProposalIds.delete(proposalId), 3000);
            this.socket?.send(JSON.stringify({ forget: proposalId }));
        }
    }

}

const G = globalThis as any;
if (!G.__tradeWS) {
    G.__tradeWS = new TradeWS();
}
export const tradeWS = G.__tradeWS as TradeWS;
