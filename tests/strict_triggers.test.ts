// @ts-nocheck
import { evaluateDigitPatternTrigger, evaluateEntryDigitStateful, EntryTriggerState } from '../lib/triggers/evaluator';
import { DigitPatternTrigger, EntryDigitTrigger } from '../lib/triggers/types';

// Mock Configs
const MOCK_PATTERN_SE: DigitPatternTrigger = {
    enabled: true,
    pattern: ['SE', 'O', 'SE'],
    compareDigit: 5
};

const MOCK_ENTRY: EntryDigitTrigger = {
    enabled: true,
    entryDigit: 5,
    monitorTicks: 5,
    consecutive: 2,
    type: 'Even',
    targetValue: 0
};

function runTests() {
    console.log('--- STARTING STRICTNESS VERIFICATION ---\n');

    // 1. Verify SE Logic
    console.log('1. Testing SE (Same Even) Strictness: Pattern [SE, O, SE]');

    const validTicks = [8, 3, 8];
    const invalidIdentity = [8, 3, 6]; // 6 != 8
    const invalidParity = [7, 3, 7]; // 7 is Odd

    const res1 = evaluateDigitPatternTrigger(validTicks, MOCK_PATTERN_SE);
    console.log(`[8, 3, 8] Expected TRUE: ${res1 ? 'PASS' : 'FAIL'}`);

    const res2 = evaluateDigitPatternTrigger(invalidIdentity, MOCK_PATTERN_SE);
    console.log(`[8, 3, 6] Expected FALSE: ${!res2 ? 'PASS' : 'FAIL'}`);

    const res3 = evaluateDigitPatternTrigger(invalidParity, MOCK_PATTERN_SE);
    console.log(`[7, 3, 7] Expected FALSE: ${!res3 ? 'PASS' : 'FAIL'}`);

    // 2. Verify SO Logic
    console.log('\n2. Testing SO (Same Odd) Strictness: Pattern [SO, SO]');
    const configSO: DigitPatternTrigger = { enabled: true, pattern: ['SO', 'SO'], compareDigit: 0 };

    console.log(`[3, 3] Expected TRUE: ${evaluateDigitPatternTrigger([3, 3], configSO) ? 'PASS' : 'FAIL'}`);
    console.log(`[3, 5] Expected FALSE: ${!evaluateDigitPatternTrigger([3, 5], configSO) ? 'PASS' : 'FAIL'}`);
    console.log(`[2, 2] Expected FALSE: ${!evaluateDigitPatternTrigger([2, 2], configSO) ? 'PASS' : 'FAIL'}`);


    // 3. Verify Entry Digit Stateful Logic
    console.log('\n3. Testing Entry Digit Strictness (Window & Reset)');
    // Entry 5. Monitor 5 ticks. Consec 2 Even.

    let state: EntryTriggerState = { isActive: false, searchBuffer: [] };

    // Tick 1: 5 (Entry) -> Should Lock
    let res = evaluateEntryDigitStateful(5, MOCK_ENTRY, state);
    state = res.newState;
    console.log(`Tick 5 (Entry): Active? ${state.isActive} (Expected true) -> ${state.isActive === true ? 'PASS' : 'FAIL'}`);

    // Tick 2: 2 (Even) -> Buffer [2]
    res = evaluateEntryDigitStateful(2, MOCK_ENTRY, state);
    state = res.newState;
    console.log(`Tick 2: Triggered? ${res.isTriggered} (Expected false) -> ${res.isTriggered === false ? 'PASS' : 'FAIL'}`);

    // Tick 3: 4 (Even) -> Buffer [2, 4] -> Match! -> Reset
    res = evaluateEntryDigitStateful(4, MOCK_ENTRY, state);
    state = res.newState;
    console.log(`Tick 4: Triggered? ${res.isTriggered} (Expected true) -> ${res.isTriggered === true ? 'PASS' : 'FAIL'}`);
    console.log(`Tick 4: Reset? ${!state.isActive} (Expected true) -> ${state.isActive === false ? 'PASS' : 'FAIL'}`);

    console.log('\n--- VERIFICATION COMPLETE ---');
}

runTests();
