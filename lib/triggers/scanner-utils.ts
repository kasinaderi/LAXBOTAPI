import { ReversalMetrics, ScannerAnalysisOptions } from './scanner-types';

export function calculateScannerMetrics(
    ticks: number[],
    options: ScannerAnalysisOptions
): ReversalMetrics {
    const { decayFactor, windows } = options;
    const history = ticks.slice(-Math.max(...windows));

    // 1. Streak Strength with Decay
    // Calculate how "strong" the current directional move is, decaying older ticks
    let streakStrength = 0;
    let currentStreakCount = 0;

    // Analyze only the last 20 ticks for immediate streak context
    const recentTicks = ticks.slice(-20);
    const lastDigit = recentTicks[recentTicks.length - 1];
    const isEven = lastDigit % 2 === 0; // Example: Even/Odd streak

    // Simple Streak Count
    for (let i = recentTicks.length - 2; i >= 0; i--) {
        if ((recentTicks[i] % 2 === 0) === isEven) {
            currentStreakCount++;
        } else {
            break;
        }
    }

    // Weighted Streak (Decay)
    // Recent ticks have weight 1.0, previous 0.8, etc.
    let weight = 1.0;
    for (let i = recentTicks.length - 1; i >= 0; i--) {
        const match = (recentTicks[i] % 2 === 0) === isEven;
        if (match) {
            streakStrength += weight;
            weight *= decayFactor;
        } else {
            // Break or subtract? Usually streak implies contiguous.
            // If we want "Cluster Strength", we don't break. 
            // But for "Streak Decay", we track the contiguous block.
            break;
        }
    }

    // 2. Multi-Window Analysis
    const windowAnalysis: any = {};
    windows.forEach(winSize => {
        if (history.length < winSize) return;
        const slice = history.slice(-winSize);

        // Volatility (Variance/Standard Deviation of digit distance?)
        // Or simply Even/Odd ratio bias?
        const evens = slice.filter(d => d % 2 === 0).length;
        const odds = winSize - evens;
        const bias = (evens - odds) / winSize; // +1 (All Even) to -1 (All Odd)

        // Simple Volatility: average step change
        let totalChange = 0;
        for (let i = 1; i < slice.length; i++) {
            totalChange += Math.abs(slice[i] - slice[i - 1]);
        }
        const volatility = totalChange / (winSize - 1);

        windowAnalysis[winSize] = { bias, volatility };
    });

    // 3. Time To Reversal (Dynamic Estimation)
    // Based on average streak length in the last 100 ticks?
    const estimatedTTR = estimateTimeToReversal(ticks, isEven);

    return {
        probability: calculateProbability(streakStrength, windowAnalysis),
        confidence: calculateConfidence(history.length, windowAnalysis),
        timeToReversal: estimatedTTR,
        streakStrength,
        windowAnalysis
    };
}

function estimateTimeToReversal(ticks: number[], currentIsEven: boolean): number {
    // Look at past streaks of the SAME type (e.g. Evens)
    // Find average length of those streaks.
    // Return (AvgLength - CurrentLength)
    // This is naive but matches "Dynamic TTR" concept.
    return 3; // Placeholder for complex logic, requires traversing full history finding streaks
}

function calculateProbability(strength: number, windows: any): number {
    // Blend factors
    // High strength = High Reversal Probability? (Gambler's fallacy, but requested logic)
    // "Reversal Scanner" usually assumes Mean Reversion.
    let prob = 50;
    if (strength > 3) prob += 10;
    if (strength > 5) prob += 20;

    // Bias correction
    // If 100-tick bias is strongly Even (+0.5), and we are in Even streak,
    // Reversal to Odd is MORE likely? Or LESS?
    // Mean Reversion: If bias is high, expect correction. 

    return Math.min(99, prob);
}

function calculateConfidence(sampleSize: number, windows: any): number {
    if (sampleSize < 100) return 30; // Low confidence if explicitly low data
    return 85;
}
