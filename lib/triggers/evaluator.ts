import { DigitPatternTrigger, EntryDigitTrigger } from './types';

export interface EntryTriggerState {
    isActive: boolean;
    hasMatched: boolean; // Persists within the window once condition met
    searchBuffer: number[];
}

/**
 * Stateful Evaluator for Entry Digit
 * - Locks onto the Entry Digit.
 * - Monitors the NEXT 'monitorTicks' ticks.
 * - If conditions met within window -> 'hasMatched' becomes true.
 * - If window expires -> Resets everything.
 */
export function evaluateEntryDigitStateful(
    currentTick: number,
    config: EntryDigitTrigger,
    state: EntryTriggerState
): { isTriggered: boolean; newState: EntryTriggerState } {

    if (!config.enabled) {
        return { isTriggered: true, newState: state };
    }

    let { isActive, hasMatched, searchBuffer } = state;

    // 1. If NOT active, look for Entry Digit
    if (!isActive) {
        const isEntryMatched = config.useMulti && config.multiDigits 
            ? config.multiDigits.includes(currentTick)
            : currentTick === config.entryDigit;

        if (isEntryMatched) {
            // NEW: If user just wants to trigger ON the entry digit itself!
            if (config.triggerOnEntry) {
                return {
                    isTriggered: true,
                    newState: { isActive: false, hasMatched: false, searchBuffer: [] }
                };
            }

            // Standard: Start monitoring window
            return {
                isTriggered: false,
                newState: { isActive: true, hasMatched: false, searchBuffer: [] }
            };
        }
        return { isTriggered: false, newState: state };
    }

    // 2. If Active, add tick to buffer
    const newBuffer = [...searchBuffer, currentTick];
    let newHasMatched = hasMatched;

    // 3. Check for condition in the buffer (if not already matched)
    if (!newHasMatched && newBuffer.length >= config.consecutive) {
        const checkTicks = newBuffer.slice(-config.consecutive);
        const match = checkTicks.every(digit => {
            switch (config.type) {
                case 'Over': return digit > config.targetValue;
                case 'Under': return digit < config.targetValue;
                case 'Even': return digit % 2 === 0;
                case 'Odd': return digit % 2 !== 0;
                case 'Match': return digit === config.targetValue;
                case 'Diff': return digit !== config.targetValue;
                default: return false;
            }
        });

        if (match) {
            newHasMatched = true;
        }
    }

    // 4. Check Expiry
    if (newBuffer.length >= config.monitorTicks) {
        return {
            isTriggered: newHasMatched,
            newState: { isActive: false, hasMatched: false, searchBuffer: [] }
        };
    }

    // 5. Return state
    return {
        isTriggered: newHasMatched,
        newState: { isActive: true, hasMatched: newHasMatched, searchBuffer: newBuffer }
    };
}

/**
 * Frequency helper for 1000-tick statistical pattern tokens:
 * - HE: Highest Even digit in 1000 ticks (most frequent even digit)
 * - LE: Least Even digit in 1000 ticks (least frequent even digit)
 * - HO: Highest Odd digit in 1000 ticks (most frequent odd digit)
 * - LO: Least Odd digit in 1000 ticks (least frequent odd digit)
 */
export function match1000FreqToken(token: string, d: number, digits: number[], idx: number, symbol?: string): boolean {
    if (idx < 0 || idx >= digits.length) return false;

    // Strict parity check upfront: HE/LE must be even; HO/LO must be odd
    if ((token === 'HE' || token === 'LE') && d % 2 !== 0) return false;
    if ((token === 'HO' || token === 'LO') && d % 2 === 0) return false;

    // Window of up to 1000 ticks BEFORE the current tick (exclusive of idx).
    const startIdx = Math.max(0, idx - 1000);
    const windowDigits = digits.slice(startIdx, idx);
    if (windowDigits.length < 20) return false;

    const freq: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < windowDigits.length; i++) {
        const dig = windowDigits[i];
        if (dig >= 0 && dig <= 9) {
            freq[dig]++;
        }
    }

    const evens = [0, 2, 4, 6, 8];
    const odds  = [1, 3, 5, 7, 9];

    if (token === 'LE') {
        let minFreq = Infinity;
        let leDigit = -1;
        for (const e of evens) {
            if (freq[e] < minFreq) {
                minFreq = freq[e];
                leDigit = e;
            }
        }
        const matched = (d === leDigit);
        if (matched) {
            console.log(`[1000FreqToken LE] Market: ${symbol || "unknown"} | Digit: ${d} | LE: ${leDigit} (${minFreq}/${windowDigits.length}t) | Evens: {0:${freq[0]}, 2:${freq[2]}, 4:${freq[4]}, 6:${freq[6]}, 8:${freq[8]}}`);
        }
        return matched;
    }

    if (token === 'HE') {
        let maxFreq = -1;
        let heDigit = -1;
        for (const e of [8, 6, 4, 2, 0]) {
            if (freq[e] > maxFreq) {
                maxFreq = freq[e];
                heDigit = e;
            }
        }
        const matched = (maxFreq > 0 && d === heDigit);
        if (matched) {
            console.log(`[1000FreqToken HE] Market: ${symbol || "unknown"} | Digit: ${d} | HE: ${heDigit} (${maxFreq}/${windowDigits.length}t) | Evens: {0:${freq[0]}, 2:${freq[2]}, 4:${freq[4]}, 6:${freq[6]}, 8:${freq[8]}}`);
        }
        return matched;
    }

    if (token === 'LO') {
        let minFreq = Infinity;
        let loDigit = -1;
        for (const o of odds) {
            if (freq[o] < minFreq) {
                minFreq = freq[o];
                loDigit = o;
            }
        }
        const matched = (d === loDigit);
        if (matched) {
            console.log(`[1000FreqToken LO] Market: ${symbol || "unknown"} | Digit: ${d} | LO: ${loDigit} (${minFreq}/${windowDigits.length}t) | Odds: {1:${freq[1]}, 3:${freq[3]}, 5:${freq[5]}, 7:${freq[7]}, 9:${freq[9]}}`);
        }
        return matched;
    }

    if (token === 'HO') {
        let maxFreq = -1;
        let hoDigit = -1;
        for (const o of [9, 7, 5, 3, 1]) {
            if (freq[o] > maxFreq) {
                maxFreq = freq[o];
                hoDigit = o;
            }
        }
        const matched = (maxFreq > 0 && d === hoDigit);
        if (matched) {
            console.log(`[1000FreqToken HO] Market: ${symbol || "unknown"} | Digit: ${d} | HO: ${hoDigit} (${maxFreq}/${windowDigits.length}t) | Odds: {1:${freq[1]}, 3:${freq[3]}, 5:${freq[5]}, 7:${freq[7]}, 9:${freq[9]}}`);
        }
        return matched;
    }

    return false;
}

export function evaluateDigitPatternTrigger(ticks: number[], config: DigitPatternTrigger): boolean {
    if (!config.enabled) return true;
    if (ticks.length < config.pattern.length) return false;

    const lastDigits = ticks.slice(-config.pattern.length);
    const compareDigit = config.compareDigit;

    // Stateful tracking for "Same Even" (SE) and "Same Odd" (SO) binding
    // These are reset per evaluation call (stateless between ticks - we re-evaluate the window each time)
    let capturedSE: number | null = null;
    let capturedSO: number | null = null;

    let failedAtStep = -1;

    const result = config.pattern.every((step, i) => {
        const digit = lastDigits[i];
        let stepRes = false;

        switch (step) {
            case 'E': stepRes = digit % 2 === 0; break;
            case 'O': stepRes = digit % 2 !== 0; break;
            case 'D': stepRes = digit !== compareDigit; break;
            case 'M': stepRes = digit === compareDigit; break;
            case 'V': stepRes = digit > compareDigit; break;
            case 'U': stepRes = digit < compareDigit; break;

            case 'SE': // Same Even (Variable Binding)
                if (digit % 2 !== 0) { stepRes = false; break; } // Must be even
                if (capturedSE === null) {
                    capturedSE = digit; // Bind on first occurrence
                    stepRes = true;
                } else {
                    stepRes = digit === capturedSE; // Subsequent must match bound value
                }
                break;

            case 'SO': // Same Odd (Variable Binding)
                if (digit % 2 === 0) { stepRes = false; break; } // Must be odd
                if (capturedSO === null) {
                    capturedSO = digit; // Bind on first occurrence
                    stepRes = true;
                } else {
                    stepRes = digit === capturedSO; // Subsequent must match bound value
                }
                break;

            case 'R': // Rise
                {
                    const rfStream = config.rfStream || [];
                    if (rfStream.length < config.pattern.length) { stepRes = false; break; }
                    const lastRf = rfStream.slice(-config.pattern.length);
                    stepRes = lastRf[i] === 'R';
                }
                break;

            case 'F': // Fall
                {
                    const rfStream = config.rfStream || [];
                    if (rfStream.length < config.pattern.length) { stepRes = false; break; }
                    const lastRf = rfStream.slice(-config.pattern.length);
                    stepRes = lastRf[i] === 'F';
                }
                break;

            case 'HE':
            case 'LE':
            case 'HO':
            case 'LO': {
                const tickIdx = ticks.length - config.pattern.length + i;
                stepRes = match1000FreqToken(step, digit, ticks, tickIdx);
                break;
            }

            default: stepRes = false;
        }

        if (!stepRes && failedAtStep === -1) {
            failedAtStep = i;
        }

        return stepRes;
    });

    if (result) {
        console.log(`[Evaluator] ✅ MATCH! Pattern:[${config.pattern.join(',')}] Ticks:[${lastDigits}] SE:${capturedSE} SO:${capturedSO}`);
    } else {
        // Always log failures for SE/SO patterns so user can diagnose missed triggers
        const patternStr = config.pattern.join(',');
        const failStep = failedAtStep !== -1 ? `Step ${failedAtStep} (${config.pattern[failedAtStep]}=${lastDigits[failedAtStep]})` : 'Unknown';
        console.log(`[Evaluator] ❌ NO MATCH. Pattern:[${patternStr}] Ticks:[${lastDigits}] | Failed at: ${failStep} | SE:${capturedSE} SO:${capturedSO}`);
    }

    return result;
}
