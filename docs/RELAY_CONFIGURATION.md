# Relay & API Configuration Guide

This document captures the working configuration for the "Dual-Source" architecture (Direct API + Relay Ticks) implemented to solve tick streaming latency and circular dependency issues.

## 1. Architecture Overview

### The Problem
- **Direct Connection (`DerivWS`)**: Good for trading actions (Buy/Sell) but can be slow for tick streaming if the UI renders too much.
- **Relay Connection (`RelayStore`)**: Dedicated high-speed WebSocket that only handles ticks.
- **Issue**: Connecting both independently created "Split Brain" issues where the Bot Logic didn't see the Relay ticks.

### The Solution: "Application-Layer Piping"
We implemented a **Unidirectional Pipe** using a **Callback Pattern**.
1. `RelayStore` connects to the Relay Server.
2. `RelayStore` exposes a `registerTickCallback` method.
3. `ConnectionInitializer` registers a callback that injects ticks directly into `useDerivStore.addTick()`.

**Data Flow:**
`Relay Server` -> `useRelayStore (WebSocket)` -> `registerTickCallback` -> `connectionInitializer` -> `useDerivStore (addTick)` -> `TradeEngine`

This avoids circular dependencies (RelayStore doesn't need to know about DerivStore).

## 2. Configuration (`.env.local`)

To maintain flexibility for local vs remote hosting, we use:

```bash
NEXT_PUBLIC_RELAY_URL=ws://127.0.0.1:8081
```

- **Local Machine**: `ws://127.0.0.1:8081`
- **LAN / Remote**: `ws://<YOUR_PC_IP>:8081`

## 3. Key Files & Logic

### `store/useRelayStore.ts`
- **Role**: Manages the raw WebSocket connection to the Relay.
- **Key Logic**:
  ```typescript
  // Inside ws.onmessage
  const nextState = { ... }; // Calculates new state
  if (state.onTickCallback) {
      state.onTickCallback(nextState.lastTick); // <--- CRITICAL: Pipes tick before returning
  }
  return nextState;
  ```
- **Constraint**: Must NOT import `useDerivStore`.

### `components/ConnectionInitializer.tsx`
- **Role**: The "Bridge" component.
- **Key Logic**:
  ```typescript
  useRelayStore.getState().registerTickCallback((tick) => {
      useDerivStore.getState().addTick(tick);
  });
  ```

### `lib/deriv/constants.ts`
- **Role**: Defines tick precision.
- **Recent Fix**: Volatility Indices (R_10, R_25) set to **3 decimals**. Others as defined.

## 4. Troubleshooting "No Ticks"
If the Relay shows "Connected" but the Bot isn't trading:
1. **Check the Pipe**: Look at `useRelayStore.ts`. Ensure the `onTickCallback` is being called.
2. **Check the Guard**: `useDerivStore.ts` has a guard `if (tick.symbol !== state.market)`. Ensure the UI Market matches the Relay Market.
3. **Check Reachability**: Verify `NEXT_PUBLIC_RELAY_URL` is correct.

---
*Last Updated: 2026-01-29*
