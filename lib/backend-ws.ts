/**
 * BackendWS — STUBBED
 *
 * The backend WebSocket (wss://backend.laxdollar.pro/ui) is no longer used.
 * Auth and trade execution now go directly through Deriv's API via OTP WebSocket URLs.
 *
 * This stub preserves the public interface so all existing store imports continue to compile.
 */
class BackendWS {
    public isConnected = false;
    public isAuthorized = false;

    public init(_getState: () => any): void { /* no-op */ }

    /** No-op — backend WS is retired. */
    public connect(): void {
        console.debug('[BackendWS] connect() called but backend WS is disabled (stub).');
    }

    public disconnect(): void { /* no-op */ }

    public subscribeToMarket(_symbol: string): void { /* no-op */ }
}

const G = globalThis as any;
if (!G.__backendWS) {
    G.__backendWS = new BackendWS();
}
export const backendWS = G.__backendWS as BackendWS;
