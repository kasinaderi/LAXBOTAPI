export type TriggerType = 'entry_digit' | 'digit_pattern';

export interface EntryDigitTrigger {
    enabled: boolean;
    entryDigit: number;
    triggerOnEntry: boolean;
    monitorTicks: number;
    consecutive: number;
    type: 'Over' | 'Under' | 'Even' | 'Odd' | 'Match' | 'Diff';
    targetValue: number;
    multiDigits?: number[];
    useMulti?: boolean;
}

export type PatternStep = 'E' | 'O' | 'D' | 'M' | 'V' | 'U' | 'SE' | 'SO' | 'R' | 'F';

export interface DigitPatternTrigger {
    enabled: boolean;
    pattern: PatternStep[];
    compareDigit: number;
    waitForOpposite: boolean;
    rfStream?: ('R' | 'F')[];   // injected at evaluation time for R/F pattern steps
    multiEntry?: {
        enabled: boolean;
        showSettings: boolean;
        useCustomContracts: boolean;
        patterns: string[];
        contracts: string[];
        predictions: string[];
        currentIndex: number;
    };
}

export interface TriggerState {
    entryDigit: EntryDigitTrigger;
    digitPattern: DigitPatternTrigger;
}
