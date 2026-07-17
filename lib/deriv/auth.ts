// App ID: used for WebSocket connections (Deriv-App-ID header, etc.)
export const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || '33BxSv2MzUXBDltrSkyrZ';

// OAuth Client ID: the UUID used in the OAuth 2.0 authorize URL as client_id
// This is DIFFERENT from the App ID — get it from developers.deriv.com -> your app -> OAuth Details
export const DERIV_OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_DERIV_CLIENT_ID || '019ed919-f321-75b6-adc3-4a718492656f';

export const DERIV_AUTH_URL = 'https://oauth.deriv.com/oauth2/authorize';
export const DERIV_TOKEN_URL = 'https://oauth.deriv.com/oauth2/token';

// This MUST exactly match the Redirect URI registered in your Deriv API Dashboard
// Set NEXT_PUBLIC_DERIV_REDIRECT_URI in .env.local to override
export function getRedirectUri(): string {
    if (process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI) {
        return process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI;
    }
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return '';
}

// Generate a random string for the code verifier
function generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
    }
    return result;
}

// Hash the code verifier using SHA-256
async function sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

// Base64-urlencode the hash
function base64urlencode(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function initiateOAuth2Login() {
    const codeVerifier = generateRandomString(64);
    
    // Store code_verifier in both sessionStorage AND localStorage as a fallback.
    // Some browsers may clear sessionStorage after a cross-origin redirect.
    sessionStorage.setItem('deriv_code_verifier', codeVerifier);
    localStorage.setItem('deriv_code_verifier', codeVerifier);

    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64urlencode(hashed);

    const redirectUri = getRedirectUri();
    console.log('[DerivAuth] Initiating OAuth2 login. redirect_uri =', redirectUri);

    const authUrl = new URL(DERIV_AUTH_URL);
    // response_type=code is REQUIRED for the OAuth 2.0 Authorization Code flow.
    // client_id must be the OAuth UUID (from developers.deriv.com -> your app -> OAuth Details),
    // NOT the alphanumeric App ID (which is only for WebSocket connections).
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', DERIV_OAUTH_CLIENT_ID);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.searchParams.append('redirect_uri', redirectUri);

    console.log('[DerivAuth] OAuth URL:', authUrl.toString());
    // Redirect user to the auth page
    window.location.href = authUrl.toString();
}

export async function exchangeCodeForToken(code: string): Promise<string | null> {
    // Try sessionStorage first, fall back to localStorage
    const codeVerifier = sessionStorage.getItem('deriv_code_verifier') 
        || localStorage.getItem('deriv_code_verifier');
    const redirectUri = getRedirectUri();
    console.log('[DerivAuth] Exchanging code for token. redirect_uri =', redirectUri, '| verifier found:', !!codeVerifier);

    if (!codeVerifier) {
        console.error('[DerivAuth] No code verifier found in session storage.');
        return null;
    }

    try {
        const body = new URLSearchParams();
        body.append('grant_type', 'authorization_code');
        body.append('code', code);
        body.append('redirect_uri', redirectUri);
        body.append('client_id', DERIV_OAUTH_CLIENT_ID); // Must use OAuth UUID, not App ID
        body.append('code_verifier', codeVerifier);

        const response = await fetch(DERIV_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            console.error('[DerivAuth] Token exchange failed:', data);
            return null;
        }

        // Cleanup from both storages
        sessionStorage.removeItem('deriv_code_verifier');
        localStorage.removeItem('deriv_code_verifier');
        
        // Deriv Token endpoint returns `access_token`
        return data.access_token || null;
    } catch (error) {
        console.error('[DerivAuth] Error exchanging code for token:', error);
        return null;
    }
}

export async function fetchAccounts(token: string): Promise<any[]> {
    console.log(`[Auth] Attempting to fetch accounts with token: ${token.substring(0, 4)}...`);
    try {
        const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            method: 'GET',
            headers: {
                'Deriv-App-ID': DERIV_APP_ID,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`[Auth] fetchAccounts response status: ${response.status}`);
        const text = await response.text();
        console.log(`[Auth] fetchAccounts response body:`, text);

        if (!response.ok) {
            console.error(`[Auth] fetchAccounts failed:`, response.statusText);
            return [];
        }

        const data = JSON.parse(text);
        if (Array.isArray(data)) return data;
        if (data.accounts && Array.isArray(data.accounts)) return data.accounts;
        if (data.data && Array.isArray(data.data)) return data.data;
        return [];
    } catch (error) {
        console.error('[Auth] Error fetching accounts:', error);
        return [];
    }
}

export async function fetchOTP(token: string, accountId: string): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
        const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
            method: 'POST',
            headers: {
                'Deriv-App-ID': DERIV_APP_ID,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({}),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await response.json();
        if (!response.ok || data.error) {
            console.error(`[DerivAuth] fetchOTP failed for account ${accountId}:`, data);
            return null;
        }
        return data.url || data.data?.url || data.data?.otp_url || data.otp_url || null;
    } catch (e: any) {
        clearTimeout(timeoutId);
        if (e?.name === 'AbortError') {
            console.warn('[DerivAuth] fetchOTP timed out after 10s. Falling back to public endpoint.');
        } else {
            console.error('[DerivAuth] Error fetching OTP:', e);
        }
        return null;
    }
}
