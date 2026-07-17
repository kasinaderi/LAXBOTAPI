'use client';

import { useEffect } from 'react';
import { useRelayStore } from '@/store/useRelayStore';
import { useDerivStore } from '@/store/useDerivStore';
import { backendWS } from '@/lib/backend-ws';
import { tradeWS } from '@/lib/deriv/trade-ws';

export function ConnectionInitializer() {
    const connectRelay = useRelayStore(state => state.connect);
    const connectDeriv = useDerivStore(state => state.connect);

    useEffect(() => {
        // Initialize singletons with store state access (Client Side Only)
        tradeWS.init(useDerivStore.getState);
        backendWS.init(useDerivStore.getState);

        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code) {
            console.log('[ConnectionInitializer] Detected Auth 2.0 code. Exchanging for token...');
            
            // We need to exchange asynchronously
            import('@/lib/deriv/auth').then(({ exchangeCodeForToken }) => {
                exchangeCodeForToken(code).then((token) => {
                    if (token) {
                        // For Auth 2.0, the websocket authorize will return the account list
                        useDerivStore.getState().authorize(token);
                    }
                });
            });

            // Clean URL
            const url = new URL(window.location.href);
            url.searchParams.delete('code');
            url.searchParams.delete('state'); // If state is ever added
            window.history.replaceState({}, '', url.toString());
        } else {
            // Fallback for Auth 1.0 logic or refresh
            const tokens: string[] = [];
            const accounts: any[] = [];
            let i = 1;
            while (params.has(`token${i}`)) {
                const token = params.get(`token${i}`)!;
                const loginid = params.get(`acct${i}`)!;
                const currency = params.get(`cur${i}`) || 'USD';
                
                tokens.push(token);
                accounts.push({
                    token,
                    loginid,
                    currency,
                    balance: 0,
                    is_virtual: loginid.startsWith('VRTC') || loginid.includes('VR')
                });
                i++;
            }

            if (tokens.length > 0) {
                console.log(`[ConnectionInitializer] Detected ${tokens.length} accounts from OAuth 1.0.`);
                useDerivStore.getState().authorize(tokens[0], accounts);

                const url = new URL(window.location.href);
                url.search = '';
                window.history.replaceState({}, '', url.toString());
            }
        }

        connectRelay();
        connectDeriv();

        return () => { };
    }, [connectRelay, connectDeriv]);

    return null;
}
