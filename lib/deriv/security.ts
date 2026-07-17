/**
 * Simple security utility for client-side protection
 */

// Obfuscation for tokens stored in localState (simple Base64 + key)
const SECRET = 'LAX_LX_SECURE';

export const obfuscate = (text: string): string => {
    if (!text) return '';
    return btoa(text.split('').map((c, i) =>
        String.fromCharCode(c.charCodeAt(0) ^ SECRET.charCodeAt(i % SECRET.length))
    ).join(''));
};

export const deobfuscate = (encoded: string): string => {
    if (!encoded) return '';
    try {
        const decoded = atob(encoded);
        return decoded.split('').map((c, i) =>
            String.fromCharCode(c.charCodeAt(0) ^ SECRET.charCodeAt(i % SECRET.length))
        ).join('');
    } catch (e) {
        return '';
    }
};

export const sanitizeStake = (value: number | string): number => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return 0.35;
    // Enforce 2 decimal places strictly to prevent "Invalid Price" API errors
    const rounded = Math.round(num * 100) / 100;
    return Math.max(0.35, Math.min(1000, rounded)); // Min 0.35, Max 1000 for safety
};

export const validateToken = (token: string): boolean => {
    // Deriv tokens are usually 15 or 19 characters alphanumeric
    return /^[a-zA-Z0-9]{15,19}$/.test(token);
};
