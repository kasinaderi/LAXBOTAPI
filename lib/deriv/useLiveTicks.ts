'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface TickData {
    id: string;
    digit: number;
    timestamp: number;
    symbol: string;
    quote: number;
}

export function useLiveTicks() {
    const [ticks, setTicks] = useState<Record<string, TickData[]>>({});
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const wsRef = useRef<WebSocket | null>(null);
    const subscriptionsRef = useRef<Record<string, string>>({});
    const pendingRef = useRef<Set<string>>(new Set());
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

        setStatus('connecting');
        const endpoint = 'wss://api.derivws.com/trading/v1/options/ws/public';
        console.log('[useLiveTicks] Connecting to:', endpoint);
        const ws = new WebSocket(endpoint);

        ws.onopen = () => {
            console.log('[useLiveTicks] WebSocket Connected');
            setStatus('connected');
            
            // Heartbeat/Keep-alive
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ping: 1 }));
                }
            }, 30000);

            // Process pending subscriptions
            pendingRef.current.forEach(symbol => {
                const msg = JSON.stringify({ ticks: symbol, subscribe: 1 });
                console.log('[useLiveTicks] Sending Pending Sub (Always-On):', msg);
                ws.send(msg);
            });
            pendingRef.current.clear();
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('[useLiveTicks] RX:', data.msg_type || data.error?.code || 'msg', data);
            
            if (data.msg_type === 'tick') {
                const tick = data.tick;
                const symbol = tick.symbol;
                const quote = tick.quote;
                
                // Adaptive Pip Size Detection
                const getPipSize = (q: number) => {
                    const str = q.toFixed(8).replace(/\.?0+$/, ''); // Handle precision safely
                    if (str.includes('.')) return str.split('.')[1].length;
                    return 0;
                };

                const pipSize = tick.pip_size || getPipSize(quote);
                
                // User provided helper for last digit extraction
                const getLastDigit = (q: number, ps: number): number => {
                  const quoteStr = q.toFixed(ps);
                  return parseInt(quoteStr[quoteStr.length - 1], 10);
                };

                const newTick: TickData = {
                    id: tick.id,
                    digit: getLastDigit(quote, pipSize),
                    timestamp: tick.epoch,
                    symbol: symbol,
                    quote: quote
                };

                setTicks(prev => {
                    const currentSymbolTicks = prev[symbol] || [];
                    // Avoid duplicates if same timestamp/id
                    if (currentSymbolTicks.length > 0 && currentSymbolTicks[currentSymbolTicks.length - 1].timestamp === newTick.timestamp) {
                        return prev;
                    }
                    return {
                        ...prev,
                        [symbol]: [...currentSymbolTicks, newTick].slice(-5000)
                    };
                });

                if (data.subscription) {
                    subscriptionsRef.current[symbol] = data.subscription.id;
                }
            }

            if (data.error) {
                console.error('[useLiveTicks] WS Error:', data.error);
            }

            if (data.msg_type === 'history') {
                const symbol = data.echo_req.ticks_history;
                const history = data.history.prices.map((p: number, i: number) => {
                    const getPipSize = (q: number) => {
                        const str = q.toFixed(8).replace(/\.?0+$/, '');
                        if (str.includes('.')) return str.split('.')[1].length;
                        return 0;
                    };
                    const ps = getPipSize(p);
                    const quoteStr = p.toFixed(ps);
                    return {
                        id: `hist-${i}`,
                        digit: parseInt(quoteStr[quoteStr.length - 1], 10),
                        timestamp: data.history.times[i],
                        symbol: symbol,
                        quote: p
                    };
                });
                
                setTicks(prev => ({
                    ...prev,
                    [symbol]: history
                }));
            }
        };

        ws.onerror = (e) => {
            console.error('[useLiveTicks] Connection Error:', e);
            setStatus('disconnected');
        };
        
        ws.onclose = () => {
            console.log('[useLiveTicks] WebSocket Closed - Auto-Reconnect in 5s');
            setStatus('disconnected');
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            
            // Auto-reconnect logic
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = setTimeout(() => {
                console.log('[useLiveTicks] Attempting Always-On Reconnect...');
                connect();
            }, 5000);
        };

        wsRef.current = ws;
    }, []);

    const subscribe = useCallback((symbol: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const msg = JSON.stringify({ ticks: symbol, subscribe: 1 });
            console.log('[useLiveTicks] TX SUBSCRIBE:', symbol);
            wsRef.current.send(msg);
        } else {
            console.log('[useLiveTicks] QUEUEING SUB (Socket not open):', symbol);
            pendingRef.current.add(symbol);
        }
    }, []);

    const unsubscribe = useCallback((symbol: string) => {
        const subId = subscriptionsRef.current[symbol];
        if (subId && wsRef.current?.readyState === WebSocket.OPEN) {
            console.log('[useLiveTicks] TX FORGET:', symbol, subId);
            wsRef.current.send(JSON.stringify({ forget: subId }));
            delete subscriptionsRef.current[symbol];
        }
    }, []);

    const fetchHistory = useCallback((symbol: string, count: number = 100) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ 
                ticks_history: symbol, 
                count: count, 
                end: 'latest', 
                style: 'ticks' 
            }));
        }
    }, []);

    const clearTicks = useCallback((symbol?: string) => {
        if (symbol) {
            setTicks(prev => ({ ...prev, [symbol]: [] }));
        } else {
            setTicks({});
        }
    }, []);

    const refreshSymbol = useCallback((symbol: string) => {
        unsubscribe(symbol);
        clearTicks(symbol);
        subscribe(symbol);
    }, [unsubscribe, clearTicks, subscribe]);

    const reconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        connect();
    }, [connect]);

    useEffect(() => {
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    return {
        ticks,
        status,
        connect,
        reconnect,
        subscribe,
        unsubscribe,
        clearTicks,
        refreshSymbol,
        fetchHistory
    };
}
