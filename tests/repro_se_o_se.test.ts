
import { evaluateDigitPatternTrigger } from '../lib/triggers/evaluator';
import { DigitPatternTrigger } from '../lib/triggers/types';

// Mock Config
const PATTERN: DigitPatternTrigger = {
    enabled: true,
    pattern: ['SE', 'O', 'SE'],
    compareDigit: 5
};

console.log('--- REPRO TEST: SE-O-SE ---');

// Case 1: 8-3-8 (Valid)
// 8 (Even, SE=8)
// 3 (Odd)
// 8 (Even, == SE)
const ticksValid = [8, 3, 8];
const res1 = evaluateDigitPatternTrigger(ticksValid, PATTERN);
console.log(`[8, 3, 8] Result: ${res1} (Expected: true)`);

// Case 2: 8-6-8 (REPORTED FAILURE)
// 8 (Then, SE=8)
// 6 (Even -> should FAIL 'O')
// 8 (Even, == SE)
const ticksReported = [8, 6, 8];
const res2 = evaluateDigitPatternTrigger(ticksReported, PATTERN);
console.log(`[8, 6, 8] Result: ${res2} (Expected: false)`);

// Case 3: 8-3-6 (Invalid SE match)
// 8 (SE=8)
// 3 (Odd)
// 6 (Even, != 8)
const ticksMismatch = [8, 3, 6];
const res3 = evaluateDigitPatternTrigger(ticksMismatch, PATTERN);
console.log(`[8, 3, 6] Result: ${res3} (Expected: false)`);

console.log('--- END TEST ---');
