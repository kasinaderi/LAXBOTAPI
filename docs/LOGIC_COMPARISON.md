# Logic Analysis: Current vs Reference

This document compares the current `Masterbot` logic with the "Reference Logic" provided.

## 1. Trade Pattern & Continuous Mode

| Feature | Reference Logic | Current `Masterbot` Logic | Status |
| :--- | :--- | :--- | :--- |
| **No Reentry** | After 1st trigger, ignores triggers and advances pattern on **EVERY** tick. | `tradingMode: 'after_first'` sets `triggersPassed = true` permanently. Calls `state.advanceStep()` on every tick. | ✅ **MATCH** |
| **Pattern Advance** | "Pattern MUST advance on EVERY single tick... like trade->skip->skip" | `state.advanceStep()` is called at the end of `onTick` regardless of trade output. | ✅ **MATCH** |
| **With Reentry** | "Requires entry condition on EACH tick" | `tradingMode: 'continuous_check'` evaluates triggers every tick. | ✅ **MATCH** |

## 2. Trigger Logic: Entry Digit

| Feature | Reference Logic | Current `Masterbot` Logic | Status |
| :--- | :--- | :--- | :--- |
| **Mechanism** | **Stateful Window** (`useRef`). "Locks on" to entry digit, then monitors subsequent ticks. Resets on trigger. | **Stateless Sliding Window**. Slices last `N` ticks. Checks if Entry Digit exists and is followed by matches. | ⚠️ **DIFFERENCE** |
| **Behavior** | Strictly waits for `ticksToMonitor`. If condition met early, fires and resets. | Scans history. If the pattern appears in the last `monitorTicks`, it returns true. | **Similar but not identical** |

### Implication of Difference
- **Reference**: Prevents "overlapping" triggers. Once a window starts, it must finish or fire.
- **Current**: Could theoretically fire on consecutive ticks if the "Entry Digit" and subsequent matches "slide" together through the window (though `after_first` mode essentially ignores subsequent fires anyway).

## 3. Trigger Logic: Digit Pattern

| Feature | Reference Logic | Current `Masterbot` Logic | Status |
| :--- | :--- | :--- | :--- |
| **Mechanism** | Slices last `len` digits and compares with pattern. | Checks `ticks.slice(-len)` against pattern. | ✅ **MATCH** |

## Conclusion
The **Trading Engine** core (Sequence, Continuous Mode) is perfectly aligned with the reference. The **Trigger Evaluator** is functionally equivalent for most cases, with the main difference being the implementation style (Stateful vs Stateless) of the Entry Window.
