# API & Trading Architecture Guide

This document captures the configuration and safeguards for the Direct API connection (`DerivWS`) and the Trading Engine. This complements `RELAY_CONFIGURATION.md`.

## 1. Architecture Overview

The application treats the API connection strictly for **Account Action** and **Execution**, separating it from the High-Speed Tick Data stream (which comes from the Relay).

### Separation of Concerns
- **`DerivWS` (lib/deriv/websocket.ts)**:
  - Responsible for: Login, Re-Login, Buying, Selling, Subscribing to trade updates (Proposal Open Contract).
  - **Does NOT** handle tick streaming for the UI (this is piped from Relay).
- **`TradeEngine` (lib/deriv/trade-engine.ts)**:
  - Receives ticks *synchronously* from the Store (via pipe).
  - Executes trades via `DerivWS`.

## 2. safeguards & Strict Logic

To prevent "ghost trades" or "runaway bots", we implemented several layers of protection:

### A. The "Market Guard" (`store/useDerivStore.ts`)
Before any tick reaches the Trading Engine, it passes through `addTick()`:
```typescript
if (tick.symbol !== state.market) {
    return state; // REJECT ticks from old markets
}
```
This prevents the bot from trading on "R_10" logic if the Relay is still sending "R_10" ticks but the User switched to "R_100".

### B. The "Timestamp Guard"
```typescript
if (state.lastTick && tick.epoch === state.lastTick.epoch && tick.quote === state.lastTick.quote) {
    return state; // IGNORE duplicates
}
```
Ensures the bot decision engine only runs once per unique tick.

### C. Strict Sequence (`TradeEngine`)
The bot strictly follows the `tradePattern` (e.g., Trade, Skip, Skip, Trade).
- **Busy Logic**: If the bot is supposed to trade but is already in a trade, it records a "MISSED" opportunity and **advances the step**. It does NOT queue the trade. This maintains sequence alignment.

## 3. Authentication & Persistence

- **Token Storage**: `localStorage.getItem('deriv_token')`.
- **Auto-Auth**: On connection open, if a token exists, `DerivWS` automatically sends `{"authorize": token}`.
- **Zombie Killer**: If the connection drops, the Store clears the `account` state to force the UI to show a "Disconnected" state, preventing the user from seeing stale balance data.

## 4. Disaster Recovery

If the API stops connecting:
1.  **Check App ID**: In `lib/deriv/websocket.ts` or `.env.local`. Default is `123448`.
2.  **Force Reconnect**: The `ConnectionInitializer` has a watchdog that retries if status stays 'disconnected' for > 60s.
3.  **Local Storage**: Clear your browser's Local Storage to remove corrupted tokens.

---
*Last Updated: 2026-01-29*
