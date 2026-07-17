export const calculateEntropy = (window: number[]): number => {
    if (window.length === 0) return 0;

    // Calculate probabilities of Even/Odd
    const evens = window.filter(d => d % 2 === 0).length;
    const odds = window.length - evens;

    const pEven = evens / window.length;
    const pOdd = odds / window.length;

    if (pEven === 0 || pOdd === 0) return 0; // Pure streaks have 0 entropy

    // Shannon Entropy
    return -1 * (pEven * Math.log2(pEven) + pOdd * Math.log2(pOdd));
};

export const calculateSlope = (window: number[]): number => {
    if (window.length < 2) return 0;

    // We calculate slope of "Even-ness" (1 for Even, 0 for Odd)
    // To see if Even dominance is strengthening or weakening
    const points = window.map((d, i) => ({ x: i, y: d % 2 === 0 ? 1 : 0 }));

    const n = points.length;
    const sumX = points.reduce((acc, p) => acc + p.x, 0);
    const sumY = points.reduce((acc, p) => acc + p.y, 0);
    const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
    const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
};

export const calculateAlternationRate = (window: number[]): number => {
    if (window.length < 2) return 0;
    let switches = 0;
    for (let i = 1; i < window.length; i++) {
        const prev = window[i - 1] % 2 === 0;
        const curr = window[i] % 2 === 0;
        if (prev !== curr) switches++;
    }
    return switches / (window.length - 1);
};

export const calculateAverageStreak = (window: number[]): number => {
    if (window.length === 0) return 0;

    let streaks: number[] = [];
    let currentStreak = 1;

    for (let i = 1; i < window.length; i++) {
        const prev = window[i - 1] % 2 === 0;
        const curr = window[i] % 2 === 0;

        if (prev === curr) {
            currentStreak++;
        } else {
            streaks.push(currentStreak);
            currentStreak = 1;
        }
    }
    streaks.push(currentStreak);

    if (streaks.length === 0) return 0;
    return streaks.reduce((a, b) => a + b, 0) / streaks.length;
};

export const calculateStreakDecay = (window: number[]): number => {
    if (window.length < 10) return 0;

    const mid = Math.floor(window.length / 2);
    const firstHalf = window.slice(0, mid);
    const secondHalf = window.slice(mid);

    const avgFirst = calculateAverageStreak(firstHalf);
    const avgSecond = calculateAverageStreak(secondHalf);

    // Positive means streaks are getting shorter (Decaying)
    return avgFirst - avgSecond;
};
