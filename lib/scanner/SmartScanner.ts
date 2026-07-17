export interface ScannerSignal {
    symbol: string;
    regime: 'ODD' | 'EVEN' | 'NEUTRAL';
    confidence: number; // 0-100
    label: string;
    details: {
        dominantSide: 'ODD' | 'EVEN';
        dominantPct: number;
        gap: number;
        top3Digits: { digit: number; pct: number }[];
        otherPct50: number;
        otherPct200: number;
        otherRise50: number; // For UI
        otherRise20: number; // For UI
        horizon: number;
    };
    timestamp: number;
}

export interface ScannerTick {
    epoch: number;
    quote: number;
    digit: number;
}

export class SmartScanner {
    private symbol: string;
    // The exact 1000 ticks buffer
    private ticksBuffer: ScannerTick[] = [];
    public historyReady: boolean = false;
    private lastEpoch: number = 0;

    // Regime State
    private regime: 'ODD' | 'EVEN' | 'NEUTRAL' = 'NEUTRAL';
    private regimeHoldTicks = 0;

    // Signal State
    private signalHoldTicks = 0;
    private cooldownTicks = 0;
    public currentSignal: ScannerSignal | null = null;

    constructor(symbol: string) {
        this.symbol = symbol;
    }

    public loadHistory(ticks: ScannerTick[]) {
        // Sort by time ascending just in case
        this.ticksBuffer = ticks.sort((a, b) => a.epoch - b.epoch).slice(-1000);
        if (this.ticksBuffer.length > 0) {
            this.lastEpoch = this.ticksBuffer[this.ticksBuffer.length - 1].epoch;
        }
        this.historyReady = true;
        console.log(`[SmartScanner] ${this.symbol} History Loaded: ${this.ticksBuffer.length} ticks`);
    }

    public update(tick: ScannerTick): ScannerSignal | null {
        if (!this.historyReady) return null;

        // 1. Validations: Deduplication
        if (tick.epoch <= this.lastEpoch) {
            return this.currentSignal; // Ignore duplicates/out-of-order
        }

        // 2. Rolling Update
        this.ticksBuffer.push(tick);
        if (this.ticksBuffer.length > 1000) {
            this.ticksBuffer.shift(); // Remove oldest
        }
        this.lastEpoch = tick.epoch;

        // Need FULL 1000 ticks to start strict/exact analysis? 
        // Or at least a significant amount. Requirement implies exact 1000 window.
        // History bootstrap gives 1000.
        if (this.ticksBuffer.length < 1000) return null;

        // 3. Cooldown logic
        if (this.cooldownTicks > 0) {
            this.cooldownTicks--;
            if (this.cooldownTicks > 0) {
                // If cooling down, we do NOT emit signals.
                this.currentSignal = null;
                return null;
            }
        }

        // 4. Analyze Regime (Exact 1000)
        const digits1000 = this.ticksBuffer.map(t => t.digit);
        const stats1000 = this.getStats(digits1000);
        const { oddPct, evenPct, top3Sum, top3Digits } = stats1000;

        const dominantPct1000 = Math.max(oddPct, evenPct);
        const dominanceGap1000 = Math.abs(oddPct - evenPct);

        // Core Requirement: Strong Regime
        // ODD: oddPct >= 58%, Gap >= 10%, Top3Sum >= 38%
        const isStrongOdd = oddPct >= 0.58 && dominanceGap1000 >= 0.10 && top3Sum >= 0.38;
        const isStrongEven = evenPct >= 0.58 && dominanceGap1000 >= 0.10 && top3Sum >= 0.38;

        let nextRegime = this.regime;

        if (this.regime === 'NEUTRAL') {
            if (isStrongOdd) nextRegime = 'ODD';
            else if (isStrongEven) nextRegime = 'EVEN';
        } else {
            // Hysteresis Exit
            // Keep until: Pct < 55% OR Gap < 6%
            const currentPct = this.regime === 'ODD' ? oddPct : evenPct;
            if (currentPct < 0.55 || dominanceGap1000 < 0.06) {
                nextRegime = 'NEUTRAL';
            }
        }

        // Regime Hold Time (20 ticks) - Only for CHANGING regime
        if (nextRegime !== this.regime) {
            this.regimeHoldTicks++;
            if (this.regimeHoldTicks >= 20) {
                this.regime = nextRegime;
                this.regimeHoldTicks = 0;
            }
        } else {
            this.regimeHoldTicks = 0;
        }

        // 5. Reversal Logic (The "NOW" Signal)
        if (this.regime === 'NEUTRAL') {
            this.currentSignal = null;
            this.signalHoldTicks = 0;
            return null;
        }

        const targetSide = this.regime === 'ODD' ? 'EVEN' : 'ODD';

        // Windows
        // ticks50 = last 50
        // ticks20 = last 20
        // ticks200 = last 200
        const digits50 = this.ticksBuffer.slice(-50).map(t => t.digit);
        const digits20 = this.ticksBuffer.slice(-20).map(t => t.digit);
        const digits200 = this.ticksBuffer.slice(-200).map(t => t.digit);

        // Previous Windows
        // prevTicks50 = ticks 51..100 from end (index: -100 to -50)
        const digits50_prev = this.ticksBuffer.slice(-100, -50).map(t => t.digit);
        const digits20_prev = this.ticksBuffer.slice(-40, -20).map(t => t.digit);
        const digits200_prev = this.ticksBuffer.slice(-400, -200).map(t => t.digit);

        const stats50 = this.getStats(digits50);
        const stats20 = this.getStats(digits20);
        const stats200 = this.getStats(digits200);

        const stats50_prev = this.getStats(digits50_prev);
        const stats20_prev = this.getStats(digits20_prev);
        const stats200_prev = this.getStats(digits200_prev);

        const oppPct50 = targetSide === 'ODD' ? stats50.oddPct : stats50.evenPct;
        const oppPct20 = targetSide === 'ODD' ? stats20.oddPct : stats20.evenPct;
        const oppPct200 = targetSide === 'ODD' ? stats200.oddPct : stats200.evenPct;

        const oppPct50_prev = targetSide === 'ODD' ? stats50_prev.oddPct : stats50_prev.evenPct;
        const oppPct20_prev = targetSide === 'ODD' ? stats20_prev.oddPct : stats20_prev.evenPct;
        const oppPct200_prev = targetSide === 'ODD' ? stats200_prev.oddPct : stats200_prev.evenPct;

        const oppRise50 = oppPct50 - oppPct50_prev;
        const oppRise20 = oppPct20 - oppPct20_prev;
        const oppRise200 = oppPct200 - oppPct200_prev;

        // D1) Reversal NOW Core Confirmation
        // Short Takeover
        const condShort = oppPct20 >= 0.55 && oppPct50 >= 0.52;
        // Momentum
        const condMomentum = oppRise50 >= 0.04 && oppRise20 >= 0.06;
        // Mid Support
        const condMid = oppRise200 >= 0.02 || oppPct200 >= 0.49;

        // D2) Optional Extra Filter
        // A) Dominant Cluster Breakdown OR B) Opposite Digit Breakout
        // A: dominant top3 in short window
        const dominantTop3Digits = top3Digits.map(d => d.digit); // from 1000 stats
        const top3SumShort = stats50.top3Digits
            .filter(d => dominantTop3Digits.includes(d.digit))
            .reduce((sum, d) => sum + d.pct, 0);
        const condFilterA = top3SumShort <= (top3Sum - 0.06);

        // B: Opposite digit breakout in 50
        const top3Digits50 = stats50.top3Digits;
        const oppositeDigitsInTop3 = top3Digits50.filter(d =>
            (targetSide === 'ODD' && d.digit % 2 !== 0) ||
            (targetSide === 'EVEN' && d.digit % 2 === 0)
        ).length;
        const condFilterB = oppositeDigitsInTop3 >= 2;

        const condFilter = condFilterA || condFilterB;

        const isReversal = condShort && condMomentum && condMid && condFilter;

        if (isReversal) {
            this.signalHoldTicks++;
        } else {
            this.signalHoldTicks = 0;
        }

        // E) Anti-Flicker & Display Rules
        if (this.signalHoldTicks >= 5) {
            // Signal Confirmed

            // F) Confidence Score
            // dominanceStrength = clamp(dominanceGap1000 / 20, 0..1)
            const dominanceStrength = Math.min(1, Math.max(0, dominanceGap1000 / 0.20));

            // clusteringStrength = clamp((top3SumPct1000 - 30) / 20, 0..1)
            const clusteringStrength = Math.min(1, Math.max(0, (top3Sum - 0.30) / 0.20));

            // reversalStrength = clamp(oppositeRise50 / 8, 0..1) + clamp((oppositePct50 - 50) / 10, 0..1)
            const revStrA = Math.min(1, Math.max(0, oppRise50 / 0.08));
            const revStrB = Math.min(1, Math.max(0, (oppPct50 - 0.50) / 0.10));
            const reversalStrength = revStrA + revStrB;

            const stabilityBonus = this.signalHoldTicks >= 5 ? 0.1 : 0;

            const scoreRaw = (0.35 * dominanceStrength) + (0.25 * clusteringStrength) + (0.35 * (reversalStrength / 2)) + stabilityBonus;

            const confidence = Math.round(Math.min(100, Math.max(0, scoreRaw * 100)));

            if (confidence >= 75) {
                // FIRE SIGNAL
                this.currentSignal = {
                    symbol: this.symbol,
                    regime: this.regime,
                    confidence,
                    label: "Reversal Happening NOW",
                    details: {
                        dominantSide: this.regime,
                        dominantPct: dominantPct1000,
                        gap: dominanceGap1000,
                        top3Digits: top3Digits,
                        otherPct50: oppPct50,
                        otherPct200: oppPct200,
                        otherRise50: oppRise50,
                        otherRise20: oppRise20,
                        horizon: 3
                    },
                    timestamp: Date.now()
                };

                return this.currentSignal;
            }
        }

        if (this.currentSignal) {
            // We had a signal, now we lost it. Start cooldown.
            this.cooldownTicks = 30;
        }

        this.currentSignal = null;
        return null; // No signal or strictly cooling/holding
    }

    public getStatus() {
        if (this.ticksBuffer.length === 0) {
            return {
                symbol: this.symbol,
                regime: 'NEUTRAL',
                historySize: 0,
                historyReady: this.historyReady,
                lastEpoch: 0,
                digits: [],
                details: null
            };
        }

        const digits1000 = this.ticksBuffer.map(t => t.digit);
        const stats1000 = this.getStats(digits1000);

        // Calculate "Live" stats for UI visibility even if no signal
        const targetSide = this.regime === 'ODD' ? 'EVEN' : 'ODD';
        const digits50 = this.ticksBuffer.slice(-50).map(t => t.digit);
        const stats50 = this.getStats(digits50);
        const digits20 = this.ticksBuffer.slice(-20).map(t => t.digit);
        const stats20 = this.getStats(digits20);

        // Previous
        const digits50_prev = this.ticksBuffer.slice(-100, -50).map(t => t.digit);
        const stats50_prev = this.getStats(digits50_prev);
        const digits20_prev = this.ticksBuffer.slice(-40, -20).map(t => t.digit);
        const stats20_prev = this.getStats(digits20_prev);

        const oppPct50 = targetSide === 'ODD' ? stats50.oddPct : stats50.evenPct;
        const oppPct20 = targetSide === 'ODD' ? stats20.oddPct : stats20.evenPct;

        const oppPct50_prev = targetSide === 'ODD' ? stats50_prev.oddPct : stats50_prev.evenPct;
        const oppPct20_prev = targetSide === 'ODD' ? stats20_prev.oddPct : stats20_prev.evenPct;

        return {
            symbol: this.symbol,
            regime: this.regime,
            historySize: this.ticksBuffer.length,
            historyReady: this.historyReady,
            lastEpoch: this.lastEpoch,
            digits: digits1000,
            details: {
                dominantSide: stats1000.oddPct > stats1000.evenPct ? 'ODD' : 'EVEN',
                oddPct: stats1000.oddPct,
                evenPct: stats1000.evenPct,
                gap: Math.abs(stats1000.oddPct - stats1000.evenPct),
                top3Digits: stats1000.top3Digits,
                top3Sum: stats1000.top3Sum,
                // Extra UI Stats
                oppPct50,
                oppRise50: oppPct50 - oppPct50_prev,
                oppPct20,
                oppRise20: oppPct20 - oppPct20_prev
            }
        };
    }

    private getStats(arr: number[]) {
        const counts = new Array(10).fill(0);
        let odd = 0;
        let even = 0;

        for (const d of arr) {
            counts[d]++;
            if (d % 2 !== 0) odd++; else even++;
        }

        const total = arr.length || 1;

        const digitStats = counts.map((count, digit) => ({ digit, pct: count / total }));
        digitStats.sort((a, b) => b.pct - a.pct);
        const top3 = digitStats.slice(0, 3);
        const top3Sum = top3.reduce((sum, item) => sum + item.pct, 0);

        return {
            oddPct: odd / total,
            evenPct: even / total,
            top3Sum,
            top3Digits: top3
        };
    }
}
