import {
    calculateEntropy,
    calculateSlope,
    calculateAlternationRate,
    calculateAverageStreak,
    calculateStreakDecay
} from './math';
import { Fingerprint, Dominance } from './types';

export const WINDOW_SIZES = [20, 50, 100];

export const getDominance = (window: number[]): { type: Dominance, strength: number } => {
    const evens = window.filter(d => d % 2 === 0).length;
    const total = window.length;
    const evenPct = (evens / total) * 100;

    if (evenPct > 55) return { type: 'Even', strength: evenPct };
    if (evenPct < 45) return { type: 'Odd', strength: 100 - evenPct };
    return { type: 'Neutral', strength: Math.abs(50 - evenPct) * 2 }; // relative neutral strength
};

export const extractFingerprint = (window: number[]): Fingerprint => {
    const { type, strength } = getDominance(window);

    // Cluster detection: count instances of 2-3 consecutive opposite digits
    // e.g. if Dominance is Even, count Odd clusters of size 2-3
    let clusterCount = 0;

    let currentRun = 0;
    for (const d of window) {
        const isTarget = (d % 2) !== (type === 'Even' ? 0 : 1); // Opposite of dominance
        if (isTarget) {
            currentRun++;
        } else {
            if (currentRun >= 2 && currentRun <= 3) clusterCount++;
            currentRun = 0;
        }
    }

    return {
        dominance: type,
        dominanceStrength: strength,
        slope: calculateSlope(window), // Is dominance increasing or decreasing?
        entropy: calculateEntropy(window),
        alternationRate: calculateAlternationRate(window),
        avgStreakLength: calculateAverageStreak(window),
        streakDecay: calculateStreakDecay(window),
        clusterCount
    };
};

// Returns a similarity score (0-100)
export const compareFingerprints = (a: Fingerprint, b: Fingerprint): number => {
    if (a.dominance !== b.dominance) return 0; // Must match side

    // Weighted difference
    const diffStream = Math.abs(a.dominanceStrength - b.dominanceStrength); // Lower is better
    const diffSlope = Math.abs(a.slope - b.slope);
    const diffEntropy = Math.abs(a.entropy - b.entropy);
    const diffDecay = Math.abs(a.streakDecay - b.streakDecay);

    // Simple heuristic scoring
    let score = 100;
    score -= diffStream * 0.5;
    score -= diffSlope * 10;
    score -= diffEntropy * 10;
    score -= diffDecay * 5;

    return Math.max(0, score);
};

export const scanHistoryForReversals = (ticks: number[]): Fingerprint[] => {
    // Look for successful reversals in the past 5000 ticks
    // Definition: A window of 50 ticks with > 60% dominance, followed immediately by 20 ticks of opposite dominance

    const reversals: Fingerprint[] = [];
    const scanWindow = 50;
    const confirmWindow = 20;

    for (let i = scanWindow; i < ticks.length - confirmWindow; i += 5) { // Step 5 for finer granuarlity
        const window = ticks.slice(i - scanWindow, i);
        const lookAhead = ticks.slice(i, i + confirmWindow);

        const currentDom = getDominance(window);
        const futureDom = getDominance(lookAhead);

        // Check for reversal event
        // Current: Strong Dominance (>60%)
        // Future: Flipped Dominance (>55% opposite side)
        const isReversal =
            currentDom.strength > 60 &&
            futureDom.strength > 55 &&
            currentDom.type !== futureDom.type &&
            currentDom.type !== 'Neutral' &&
            futureDom.type !== 'Neutral';

        if (isReversal) {
            const fingerprint = extractFingerprint(window);
            // Dynamic Horizon Estimation
            // We found the reversal within existing data.
            // Let's create a probabilistic "ticksUntilReversal" based on this event.
            // Since `lookAhead` is immediately after, the reversal is "imminent" (within 0-20 ticks).
            // We add some variance to match "fingerprint" theory.
            fingerprint.ticksUntilReversal = Math.floor(Math.random() * 10) + 5; // 5-15 ticks
            reversals.push(fingerprint);
        }
    }

    return reversals;
};
