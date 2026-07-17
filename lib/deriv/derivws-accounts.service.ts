/**
 * DerivWSAccountsService
 *
 * Ported from trading-bot-template pattern.
 * Uses Authorization: Bearer <access_token> exclusively — no Deriv-App-ID header.
 *
 * Responsibilities:
 *  - Fetch accounts list  → GET  /options/accounts
 *  - Fetch OTP WS URL     → POST /options/accounts/{id}/otp
 *  - Full authenticated WS URL flow (accounts → resolve active account → OTP)
 *  - sessionStorage helpers for storing / reading accounts between page loads
 */

const DERIV_WS_BASE = 'https://api.derivws.com/trading/v1/';

export interface DerivAccount {
    account_id: string;
    balance: string;
    currency: string;
    group: string;
    status: string;
    account_type: 'demo' | 'real';
}

interface AccountsResponse {
    data: DerivAccount[];
}

interface OTPResponse {
    data: {
        url: string;
    };
}

export class DerivWSAccountsService {
    // Singleton promise caches — prevent duplicate API calls on concurrent requests
    private static accountsFetchPromise: Promise<DerivAccount[]> | null = null;
    private static otpFetchPromises: Map<string, Promise<string>> = new Map();

    // ── Storage helpers ──────────────────────────────────────────────────────

    static storeAccounts(accounts: DerivAccount[]): void {
        try {
            sessionStorage.setItem('deriv_accounts', JSON.stringify(accounts));
        } catch (_) { /* ignore quota errors */ }
    }

    static getStoredAccounts(): DerivAccount[] | null {
        try {
            const raw = sessionStorage.getItem('deriv_accounts');
            if (!raw) return null;
            return JSON.parse(raw) as DerivAccount[];
        } catch {
            return null;
        }
    }

    static getDefaultAccount(): DerivAccount | null {
        const accounts = this.getStoredAccounts();
        return accounts && accounts.length > 0 ? accounts[0] : null;
    }

    static clearStoredAccounts(): void {
        sessionStorage.removeItem('deriv_accounts');
    }

    /** Clear all promise caches (useful after logout or forced refresh) */
    static clearCache(): void {
        this.accountsFetchPromise = null;
        this.otpFetchPromises.clear();
    }

    // ── REST API calls ───────────────────────────────────────────────────────

    /**
     * Fetch the list of trading accounts for the authenticated user.
     * Uses a singleton promise to prevent duplicate parallel calls.
     *
     * @param accessToken  OAuth2 Bearer access token
     */
    static async fetchAccountsList(accessToken: string): Promise<DerivAccount[]> {
        if (this.accountsFetchPromise) {
            return this.accountsFetchPromise;
        }

        this.accountsFetchPromise = (async () => {
            try {
                const endpoint = `${DERIV_WS_BASE}options/accounts`;
                console.log('[DerivWSAccounts] Fetching accounts from:', endpoint);

                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                });

                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch accounts: ${response.status} ${response.statusText}`
                    );
                }

                const data: AccountsResponse = await response.json();
                const accounts = data?.data ?? [];

                if (accounts.length === 0) {
                    console.warn('[DerivWSAccounts] No accounts returned from API');
                } else {
                    console.log(`[DerivWSAccounts] Fetched ${accounts.length} account(s)`);
                }

                this.storeAccounts(accounts);
                return accounts;
            } catch (error) {
                console.error('[DerivWSAccounts] Error fetching accounts:', error);
                this.accountsFetchPromise = null;
                throw error;
            } finally {
                // Allow fresh fetches 100 ms after this one resolves
                setTimeout(() => {
                    this.accountsFetchPromise = null;
                }, 100);
            }
        })();

        return this.accountsFetchPromise;
    }

    /**
     * Fetch an OTP-embedded WebSocket URL for a specific account.
     * The returned URL already encodes authentication — connect directly with `new WebSocket(url)`.
     *
     * @param accessToken  OAuth2 Bearer access token
     * @param accountId    Account ID (e.g. CR1234567 or VRTC1234567)
     */
    static async fetchOTPWebSocketURL(
        accessToken: string,
        accountId: string
    ): Promise<string> {
        if (this.otpFetchPromises.has(accountId)) {
            return this.otpFetchPromises.get(accountId)!;
        }

        const otpPromise = (async () => {
            try {
                const endpoint = `${DERIV_WS_BASE}options/accounts/${accountId}/otp`;
                console.log(`[DerivWSAccounts] Fetching OTP WebSocket URL for account: ${accountId}`);

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                });

                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch OTP: ${response.status} ${response.statusText}`
                    );
                }

                const otpResponse: OTPResponse = await response.json();
                const websocketURL = otpResponse?.data?.url;

                if (!websocketURL) {
                    throw new Error('WebSocket URL not found in OTP response');
                }

                console.log(`[DerivWSAccounts] OTP WebSocket URL obtained for ${accountId}`);
                return websocketURL;
            } catch (error) {
                console.error('[DerivWSAccounts] Error fetching OTP:', error);
                this.otpFetchPromises.delete(accountId);
                throw error;
            } finally {
                setTimeout(() => {
                    this.otpFetchPromises.delete(accountId);
                }, 100);
            }
        })();

        this.otpFetchPromises.set(accountId, otpPromise);
        return otpPromise;
    }

    // ── Full authenticated WS URL flow ───────────────────────────────────────

    /**
     * Complete flow to obtain an authenticated WebSocket URL:
     *  1. Use stored accounts (avoids re-fetching on reconnect) — or fetch fresh
     *  2. Resolve the active account (respects localStorage "active_loginid" for account switching)
     *  3. Fetch OTP URL for that account
     *
     * @param accessToken  OAuth2 Bearer access token from sessionStorage("auth_info")
     */
    static async getAuthenticatedWebSocketURL(accessToken: string): Promise<string> {
        try {
            // Step 1: prefer cached accounts for speed
            let accounts: DerivAccount[] | null = this.getStoredAccounts();
            if (!accounts || accounts.length === 0) {
                accounts = await this.fetchAccountsList(accessToken);
                if (!accounts || accounts.length === 0) {
                    throw new Error('[DerivWSAccounts] No accounts available');
                }
            }

            // Step 2: honour active_loginid (account switch scenario)
            const activeLoginId =
                typeof window !== 'undefined'
                    ? localStorage.getItem('active_loginid')
                    : null;

            const targetAccount =
                (activeLoginId && accounts.find(a => a.account_id === activeLoginId)) ||
                accounts[0];

            // Step 3: fresh OTP URL for the resolved account
            return await this.fetchOTPWebSocketURL(accessToken, targetAccount.account_id);
        } catch (error) {
            console.error('[DerivWSAccounts] Error in authenticated WebSocket URL flow:', error);
            throw error;
        }
    }

    // ── Auth token helpers ───────────────────────────────────────────────────

    /**
     * Read the OAuth access token from sessionStorage.
     * Returns null if the session has expired or no token is stored.
     */
    static getStoredAccessToken(): string | null {
        try {
            const raw = sessionStorage.getItem('auth_info');
            if (!raw) return null;
            const authInfo = JSON.parse(raw);
            if (authInfo?.expires_at && Date.now() >= authInfo.expires_at) {
                sessionStorage.removeItem('auth_info');
                return null;
            }
            return authInfo?.access_token ?? null;
        } catch {
            return null;
        }
    }

    /** True when a valid, non-expired OAuth token is in sessionStorage. */
    static isAuthenticated(): boolean {
        return this.getStoredAccessToken() !== null;
    }
}
