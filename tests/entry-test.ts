import { tradeEngine } from '../lib/deriv/trade-engine';
import { useDerivStore } from '../store/useDerivStore';

// Mock WS interactions
jest.mock('../lib/backend-ws', () => {
    return {
        backendWS: {
            sendTrade: jest.fn()
        }
    };
});

describe('Entry Digit Execution Test', () => {
    beforeEach(() => {
        useDerivStore.setState({
            isRunning: true,
            ticks: [],
            stats: {
                totalTrades: 0,
                won: 0,
                lost: 0,
                winRate: 0,
                totalProfit: 0,
                maxStake: 0,
                currentStep: 1,
            },
            triggerSequence: ['entry'],
            triggerMode: 'sequential',
            currentPipelineStep: 0,
            triggers: {
                entryDigit: {
                    enabled: true,
                    triggerOnEntry: true, // INSTANT MODE
                    entryDigit: 5,
                },
                digitPattern: {
                    enabled: false
                }
            },
            virtualSettings: {
                isVirtualMode: false
            }
        });
    });

    test('should instantly execute on Entry Digit 5', () => {
        const state = useDerivStore.getState();

        // 1. Tick 1 - No match (Digit 2)
        tradeEngine.onTick({ quote: 100.12, time: Date.now(), symbol: 'R_100', pip_size: 2 });
        expect(useDerivStore.getState().currentPipelineStep).toBe(0); // Still waiting

        // 2. Tick 2 - MATCH (Digit 5)
        tradeEngine.onTick({ quote: 100.55, time: Date.now(), symbol: 'R_100', pip_size: 2 });

        // Pipeline should have bypassed 
        // tradeEngine should have dispatched 'backendWS.sendTrade'
    });
});
