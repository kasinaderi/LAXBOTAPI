// @ts-nocheck
import { tradeEngine } from '../lib/deriv/trade-engine';
import { useDerivStore } from '../store/useDerivStore';

// Simple mock for DerivWS
jest.mock('../lib/deriv/websocket', () => ({
    derivWS: {
        buy: jest.fn().mockResolvedValue({ contract_id: 12345 })
    }
}));

describe('TradeEngine Tests', () => {
    beforeEach(() => {
        useDerivStore.setState({
            isRunning: false,
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
            tradeLogs: []
        });
        tradeEngine.stop();
    });

    test('should not execute if bot is stopped', () => {
        const mockTick = { quote: 100.12, time: Date.now(), symbol: 'R_100' };
        tradeEngine.onTick(mockTick);
        expect(useDerivStore.getState().stats.totalTrades).toBe(0);
    });

    test('should advance step on skip action', () => {
        useDerivStore.setState({
            isRunning: true,
            tradePattern: ['skip', 'trade'],
            currentStep: 1,
            triggers: {
                entryDigit: { enabled: false } // No triggers, always pass for test
            }
        });

        const mockTick = { quote: 100.12, time: Date.now(), symbol: 'R_100' };
        tradeEngine.onTick(mockTick);

        expect(useDerivStore.getState().currentStep).toBe(2);
    });
});
