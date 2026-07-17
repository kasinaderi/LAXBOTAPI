import { TickData } from '../deriv/types';

export interface ScannerConfig {
    shortWindow: number; // 20
    mediumWindow: number; // 50
    longWindow: number; // 100
    historySize: number; // 5000
}

export type Dominance = 'Even' | 'Odd' | 'Neutral';

export interface Fingerprint {
    dominance: Dominance;
    dominanceStrength: number; // 0-100%
    slope: number;
    entropy: number;
    alternationRate: number; // Frequency of switches
    avgStreakLength: number;
    streakDecay: number; // Positive = decaying
    clusterCount: number; // Micro-clusters of opposite digit
    ticksUntilReversal?: number; // Only for historical fingerprints
}

export interface ReversalSetup {
    market: string;
    probability: number; // 0-100%
    horizon: number; // estimated ticks
    confidence: 'Low' | 'Medium' | 'High';
    matchedFingerprintId?: string;
}

export interface MarketState {
    market: string;
    ticks: number[]; // Last 5000 digits
    currentFingerprint: Fingerprint;
    reversalSetup?: ReversalSetup;
    lastUpdated: number;
}
