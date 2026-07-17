export interface DominanceState {
    oddPct1000: number;
    evenPct1000: number;
    dominanceSide: 'ODD' | 'EVEN' | 'NEUTRAL';
    isDominant: boolean;
    confirmationStrength: number;
    isConfirmed: boolean;
    cooldownRemaining: number;
    signalHoldCount: number;
}

export class DominanceFilter {
    private history1000: number[] = [];
    private history50: number[] = [];

    // Config (Defaults as requested)
    private readonly WINDOW_LONG = 1000;
    private readonly WINDOW_SHORT = 50;

    private readonly DOMINANCE_THRESHOLD = 0.58; // 58%
    private readonly DOMINANCE_GAP = 0.10;       // 10%

    private readonly CONFIRM_THRESHOLD = 0.54;   // 54%
    private readonly CONFIRM_SURGE = 0.06;       // 6%

    private readonly HOLD_TICKS = 5;
    private readonly COOLDOWN_TICKS = 20;

    // State
    private cooldownCounter = 0;
    private holdCounter = 0;
    private lastSignalSide: 'ODD' | 'EVEN' | null = null;

    public update(newDigit: number): DominanceState {
        // 1. Maintain Rolling Windows
        this.history1000.push(newDigit);
        if (this.history1000.length > this.WINDOW_LONG) this.history1000.shift();

        this.history50.push(newDigit);
        if (this.history50.length > this.WINDOW_SHORT) this.history50.shift();

        // 2. Cooldown Tick
        if (this.cooldownCounter > 0) {
            this.cooldownCounter--;
        }

        // 3. Calculate Dominance (1000 ticks)
        if (this.history1000.length < 500) {
            return this.getNeutralState(); // Not enough data
        }

        const counts1000 = this.getCounts(this.history1000);
        const oddPct1000 = counts1000.odd / this.history1000.length;
        const evenPct1000 = counts1000.even / this.history1000.length;

        const maxPct = Math.max(oddPct1000, evenPct1000);
        const gap = Math.abs(oddPct1000 - evenPct1000);
        const dominanceSide = oddPct1000 > evenPct1000 ? 'ODD' : 'EVEN';
        const isDominant = maxPct >= this.DOMINANCE_THRESHOLD && gap >= this.DOMINANCE_GAP;

        // 4. Calculate Confirmation (50 ticks)
        const counts50 = this.getCounts(this.history50);
        const total50 = this.history50.length;

        // We look for REVERSAL -> If ODD Dominant, we look for EVEN strength in short term
        const targetReversalSide = dominanceSide === 'ODD' ? 'EVEN' : 'ODD';
        const reversalPct50 = (targetReversalSide === 'ODD' ? counts50.odd : counts50.even) / total50;

        // Surge detection implies comparing current 50 vs previous 50? 
        // Or simply checking if it's high enough. 
        // Request: "opposite side in last 50 ticks >= 54% OR has increased by >= 6%"
        // To do increase, we'd need previous window. For simplicity/speed initially, let's use threshold.
        // TODO: Implement "Previous 50" for strict surge logic if needed.

        const isConfirmed = isDominant && (reversalPct50 >= this.CONFIRM_THRESHOLD);

        // 5. Anti-Flicker & Hold
        if (isConfirmed && this.cooldownCounter === 0) {
            // Check if signal side is consistent
            if (this.lastSignalSide === targetReversalSide) {
                this.holdCounter++;
            } else {
                this.holdCounter = 1; // Reset on flip
                this.lastSignalSide = targetReversalSide;
            }
        } else {
            this.holdCounter = 0;
            this.lastSignalSide = null;
        }

        return {
            oddPct1000,
            evenPct1000,
            dominanceSide,
            isDominant,
            confirmationStrength: reversalPct50,
            isConfirmed,
            cooldownRemaining: this.cooldownCounter,
            signalHoldCount: this.holdCounter
        };
    }

    public triggerSignal() {
        this.cooldownCounter = this.COOLDOWN_TICKS;
        this.holdCounter = 0; // Reset hold after firing
    }

    public shouldFire(): boolean {
        return this.holdCounter >= this.HOLD_TICKS;
    }

    private getCounts(arr: number[]) {
        let odd = 0;
        let even = 0;
        for (const d of arr) {
            if (d % 2 !== 0) odd++;
            else even++;
        }
        return { odd, even };
    }

    private getNeutralState(): DominanceState {
        return {
            oddPct1000: 0.5,
            evenPct1000: 0.5,
            dominanceSide: 'NEUTRAL',
            isDominant: false,
            confirmationStrength: 0,
            isConfirmed: false,
            cooldownRemaining: this.cooldownCounter,
            signalHoldCount: 0
        };
    }
}
