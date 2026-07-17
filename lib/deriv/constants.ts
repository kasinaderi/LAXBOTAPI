export const VOLATILITY_INDICES = [
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ15V', label: 'Volatility 15 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ30V', label: 'Volatility 30 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ90V', label: 'Volatility 90 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
];

export const JUMP_INDICES = [
    { value: 'JD10', label: 'Jump 10 Index' },
    { value: 'JD25', label: 'Jump 25 Index' },
    { value: 'JD50', label: 'Jump 50 Index' },
    { value: 'JD75', label: 'Jump 75 Index' },
    { value: 'JD100', label: 'Jump 100 Index' },
];

export const ALL_MARKETS = [...VOLATILITY_INDICES, ...JUMP_INDICES];

export const CONTRACT_TYPES = [
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
];

export const DIGIT_VALUES = Array.from({ length: 10 }, (_, i) => ({
    value: i.toString(),
    label: i.toString(),
}));

export function ticksToDecimals(market: string): number {
    switch (market) {
        case 'R_10':
        case 'R_25':
            return 3;
        case 'R_50':
        case 'R_75':
            return 4;
        case 'R_100':
        case '1HZ100V':
        case '1HZ10V':
        case '1HZ25V':
        case '1HZ50V':
        case '1HZ75V':
        case 'JD10':
        case 'JD25':
        case 'JD50':
        case 'JD75':
        case 'JD100':
            return 2;
        case '1HZ15V':
        case '1HZ30V':
        case '1HZ90V':
            return 3;
        case 'frxEURUSD':
        case 'frxGBPUSD':
        case 'frxAUDUSD':
        case 'frxUSDCAD':
        case 'frxEURGBP':
            return 5;
        case 'frxUSDJPY':
            return 3;
        case 'frxXAUUSD':
        case 'CRASH300':
        case 'CRASH500':
        case 'CRASH1000':
        case 'BOOM300':
        case 'BOOM500':
        case 'BOOM1000':
        case 'STPIDX10':
            return 2;
        case 'frxXAGUSD':
            return 4;
        default:
            return 2;
    }
}
