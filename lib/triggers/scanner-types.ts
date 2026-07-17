
export interface ScannerAnalysisOptions {
    entryDigit: number;
    decayFactor: number; // 0.0 - 1.0 (e.g. 0.8 means streak weight decays by 20% per tick)
    windows: number[]; // [20, 50, 100]
}

export interface ReversalMetrics {
    probability: number; // 0-100%
    confidence: number;  // 0-100%
    timeToReversal: number; // Estimated ticks
    streakStrength: number;
    windowAnalysis: {
        [key: number]: { // 20, 50, 100
            bias: number; // + for streak, - for reversal
            volatility: number;
        }
    };
}
