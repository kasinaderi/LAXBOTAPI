// @ts-nocheck
import { tradeEngine } from '../lib/deriv/trade-engine';
import { useDerivStore } from '../store/useDerivStore';

// Reset the store to match the user's "no triggers" condition
useDerivStore.setState({
    isRunning: true,
    ticks: [],
    market: 'R_100',
    contractType: 'DIGITOVER',
    prediction: 4,
    stats: {
        totalTrades: 0,
        won: 0,
        lost: 0,
        winRate: 0,
        totalProfit: 0,
        maxStake: 0,
        currentStep: 1,
    },
    tradingMode: 'after_first',
    tradePattern: ['trade', 'skip'],
    currentStep: 1,
    triggerMode: 'sequential',
    currentPipelineStep: 0,
    triggerSequence: [], // Zero triggers!
    triggers: {
        entryDigit: { enabled: false, entryDigit: 5, triggerOnEntry: false, monitorTicks: 5, consecutive: 2, type: 'Under', targetValue: 4 },
        digitPattern: { enabled: false, pattern: ['D'], compareDigit: 2 }
    },
    virtualSettings: {
        isVirtualMode: false,
        startVirtualToReal: false,
        vThreshold: 0,
        vTriggerMode: 'consec',
        vTriggerType: 'wins',
        startRealToVirtual: false,
        rThreshold: 0,
        rTriggerMode: 'consec',
        rTriggerType: 'losses',
        virtualWins: 0,
        virtualLosses: 0,
        vConsecWins: 0,
        vConsecLosses: 0,
        realWins: 0,
        realLosses: 0,
        rConsecWins: 0,
        rConsecLosses: 0
    }
});

console.log("--- TEST: NO TRIGGERS ENABLED ---");
tradeEngine.onTick({ quote: 100.12, epoch: 1, pip_size: 2, symbol: 'R_100' });
console.log("PIPELINE END STATE:", useDerivStore.getState().currentPipelineStep);
console.log("CURRENT ACTION STEP:", useDerivStore.getState().currentStep);
console.log("STATUS MESSAGE:", useDerivStore.getState().triggerStatus);
