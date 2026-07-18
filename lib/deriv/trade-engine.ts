import { derivWS } from './websocket';
import { DominanceFilter } from '../triggers/dominance-filter'; // Import
import { evaluateDigitPatternTrigger, evaluateEntryDigitStateful, EntryTriggerState } from '../triggers/evaluator';
import { TickData, DerivMessage } from './types';
import { sanitizeStake } from './security';
import { ticksToDecimals } from './constants';
import { tradeWS } from './trade-ws';

class TradeEngine {
    private currentStake = 0;
    private lossCount = 0;
    private hasFirstTriggerHit = false;
    private cumulativeSessionLoss = 0; // Tracks loss for Recovery Mode
    private originalSettingsBeforeRecovery: any = null;

    // Filters
    private dominanceFilter = new DominanceFilter(); // Persistent Instance

    // Concurrent Trade Tracking
    private activeContracts = new Map<number, {
        stake: number;
        prediction: number;
        contractType: string;
        startTime: number;
    }>();

    private virtualTrades: any[] = [];
    private currentProposalParams: string | null = null;
    // Dependency Injection for Circular Fix
    private getState: (() => any) | null = null;
    private setState: ((state: any) => void) | null = null;

    // Stateful Trigger State
    private entryTriggerState: EntryTriggerState = { isActive: false, hasMatched: false, searchBuffer: [] };
    private isWaitingForOpposite: boolean = false;
    private lastExecutedContract: string | null = null;
    private lastExecutedPrediction: number | null = null;
    private contradictionWaitCounter: number = 0;
    private isRunning: boolean = false;
    private lastProcessedTickId: string | null = null;
    private recoveryWinsCount = 0;

    // Price & Rise/Fall history for triggers
    private priceHistory: number[] = [];
    private rfHistory: ('R' | 'F')[] = [];

    constructor() {
        // Registration moved to init for singleton stability
    }

    public init(getState: () => any, setState: (state: any) => void) {
        this.getState = getState;
        this.setState = setState;

        // Re-register with tradeWS (Listeners are cleared in useDerivStore.connect)
        tradeWS.onEvent((type, data) => this.handleInternalEvent(type, data));
    }

    /**
     * Reset all internal mutable state when the bot is stopped.
     * CRITICAL: Without this, stale entryTriggerState / hasFirstTriggerHit
     * carries over to the next run and can block entries entirely.
     */
    public stop(state?: any) {
        this.isRunning = false;
        this.currentStake = 0;
        this.lossCount = 0;
        this.hasFirstTriggerHit = false;
        this.cumulativeSessionLoss = 0;
        this.originalSettingsBeforeRecovery = null;
        this.activeContracts.clear();
        this.entryTriggerState = { isActive: false, hasMatched: false, searchBuffer: [] };
        this.virtualTrades = [];
        this.isWaitingForOpposite = false;
        this.lastExecutedContract = null;
        this.lastExecutedPrediction = null;
        this.contradictionWaitCounter = 0;
        this.currentProposalParams = null; // Clear cached params
        
        tradeWS.forgetProposals();
        if (state && state.setActiveProposal) {
            state.setActiveProposal(null as any, null);
        }
        
        this.lastProcessedTickId = null;
        this.recoveryWinsCount = 0;
        this.priceHistory = [];
        this.rfHistory = [];
        
        console.log('[TradeEngine] Engine state fully reset (stop called).');
    }

    private refreshProposal(state: any) {
        if (state.executionMode !== 'standard' || !state.isRunning) return;

        const { initialStake, martingaleMultiplier, maxMartingaleSteps, compoundProfits, isRecoveryActive, recoverySettings, activeProposal } = state;

        // 1. Calculate the THREE possible stakes we might need NEXT
        const currentStake = isRecoveryActive ? recoverySettings.recoveryStake : (this.currentStake || initialStake);
        
        // Speculative Win Stake
        let nextWinStake = initialStake;
        if (compoundProfits) {
            nextWinStake = currentStake + (currentStake * 0.95);
        }

        // Speculative Loss Stake
        let nextLossStake = currentStake * martingaleMultiplier;
        if (this.lossCount + 1 > maxMartingaleSteps) {
            nextLossStake = initialStake;
        }

        const stakesToFetch = [currentStake, nextWinStake, nextLossStake];

        // Format and safely unique the necessary stakes
        const formattedStakesToFetch = Array.from(new Set(stakesToFetch.map(s => sanitizeStake(s))));

        // NEW: Holistically prune any orphaned backend API stakes BEFORE iterating
        tradeWS.pruneUnusedProposals(formattedStakesToFetch);

        // 2. Refresh each one if missing or stale
        formattedStakesToFetch.forEach(formattedStake => {
            const isDTrader = state.tradingApp === 'dtrader';
            let contract_type = isDTrader ? state.manualContractType : state.contractType;
            let prediction = isDTrader ? state.manualPrediction : state.prediction;

            if (state.triggers?.digitPattern?.multiEntry?.enabled && state.triggers.digitPattern.multiEntry.useCustomContracts) {
                const multi = state.triggers.digitPattern.multiEntry;
                const customContract = multi.contracts[multi.currentIndex];
                if (customContract) {
                    contract_type = customContract;
                    prediction = parseInt(multi.predictions[multi.currentIndex]);
                    if (isNaN(prediction)) prediction = 0;
                }
            }

            if (state.triggers?.adaptiveEvenOdd?.enabled) {
                const activeContract = state.getActiveAdaptiveContract();
                contract_type = activeContract.type;
                prediction = activeContract.prediction;
            }

            if (isRecoveryActive) {
                contract_type = recoverySettings.recoveryContractType;
                prediction = recoverySettings.recoveryPrediction;
            }

            const symbol = isRecoveryActive ? recoverySettings.recoveryMarket : (isDTrader ? state.manualMarket : state.market);
            const barrier = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contract_type) ? String(prediction) : undefined;
            
            const stakeKey = `${formattedStake}_${contract_type}`;
            
            const paramsKey = JSON.stringify({ stake: formattedStake, contract_type, symbol, barrier });
            const existingProposal = activeProposal ? activeProposal[stakeKey] : null;

            // Reduce refresh window to 45s for safety margin.
            // Also refresh if the symbol doesn't match the current market.
            if (!existingProposal || existingProposal.symbol !== symbol || existingProposal.receivedAt < Date.now() - 45000) {
                // If it's the CURRENT stake, log it. Speculative ones are silent.
                if (formattedStake === currentStake) {
                    // console.log(`[TradeEngine] Refreshing Proposal for ${symbol}: ${stakeKey}`);
                }

                tradeWS.subscribeToProposal({
                    stake: formattedStake,
                    contract_type,
                    symbol,
                    barrier,
                    duration: 1,
                    currency: state.account?.currency || 'USD'
                });
            }
        });
    }

    private evaluateMultiEntry(ticks: number[], patternStr: string): boolean {
        if (!patternStr) return false;
        // Normalize split delimiters: support both '-' and ','
        const normalized = patternStr.replace(/,/g, '-');
        const steps = normalized.split('-').map(s => s.trim()).filter(s => s.length > 0);
        if (steps.length === 0) return false;
        if (ticks.length < steps.length) return false;
        
        const lastDigits = ticks.slice(-steps.length);
        const lastRf = this.rfHistory.slice(-steps.length);
        
        return steps.every((step, idx) => {
            const digit = lastDigits[idx];
            const type = step.charAt(0).toUpperCase();
            const valueStr = step.substring(1);
            const value = valueStr ? parseInt(valueStr) : 0;

            switch (type) {
                case 'U': return digit < value;
                case 'V': return digit > value;
                case 'M': return digit === value;
                case 'D': return digit !== value;
                case 'E': return digit % 2 === 0;
                case 'O': return digit % 2 !== 0;
                case 'R': return lastRf.length === steps.length && lastRf[idx] === 'R';
                case 'F': return lastRf.length === steps.length && lastRf[idx] === 'F';
                default: return false;
            }
        });
    }

    private isDigitALoss(digit: number, state: any): boolean {
        // Priority: Last Executed Contract (for Multi-Entry Box support) > Global Contract
        const contract = this.lastExecutedContract || state.contractType;
        const pred = this.lastExecutedPrediction !== null ? this.lastExecutedPrediction : state.prediction;

        switch (contract) {
            case 'DIGITOVER': return digit <= pred;
            case 'DIGITUNDER': return digit >= pred;
            case 'DIGITEVEN': return digit % 2 !== 0;
            case 'DIGITODD': return digit % 2 === 0;
            case 'DIGITMATCH': return digit !== pred;
            case 'DIGITDIFF': return digit === pred;
            default: return false;
        }
    }

    public onTick(tick: TickData, state: any) {
        // 0. Global Safety (Bot Stopped or Disconnected)
        if (!state.isRunning) return;

        if (!derivWS.isStable) {
            console.warn(`[TradeEngine Debug] Skipping tick ${tick.quote} because derivWS connection is not stable yet.`);
            state.setTriggerStatus("Wait: Ticks connecting...");
            return;
        }

        const tickId = `${tick.epoch}_${tick.quote}`;
        if (this.lastProcessedTickId === tickId) return;
        this.lastProcessedTickId = tickId;

        let virtualJustSettled = false;
        if (state.virtualSettings.isVirtualMode) {
            const beforeCount = this.virtualTrades.length;
            this.processVirtualTrades(tick, state);
            if (beforeCount > 0 && this.virtualTrades.length === 0) {
                virtualJustSettled = true;
            }
        }

        this.refreshProposal(state);

        // Track price history and derived Rise/Fall signal
        if (this.priceHistory.length > 0) {
            const prevPrice = this.priceHistory[this.priceHistory.length - 1];
            const signal: 'R' | 'F' = tick.quote > prevPrice ? 'R' : 'F';
            this.rfHistory.push(signal);
            if (this.rfHistory.length > 5000) this.rfHistory.shift();
        }
        this.priceHistory.push(tick.quote);
        if (this.priceHistory.length > 5000) this.priceHistory.shift();

        // Safety: ensure triggers are fully hydrated (prevents crash on stale localStorage)
        if (!state.triggers?.entryDigit || !state.triggers?.digitPattern || !state.triggers?.adaptiveEvenOdd) {
            console.warn('[TradeEngine] triggers not fully hydrated yet, skipping tick.');
            return;
        }

        const {
            ticks,
            triggers,
            tradePattern,
            currentStep,
            tradingMode,
            initialStake,
            takeProfit,
            stopLoss,
            stats
        } = state;

        // CRITICAL SYNC FIX: 
        // The store calls onTick() BEFORE updating its 'ticks' state.
        // So 'state.ticks' is lagging by 1 tick.
        // We must calculate the current digit from the raw 'tick' object here.

        const activeMarket = state.tradingApp === 'dtrader' ? state.manualMarket : state.market;
        const precision = (tick.pip_size !== undefined && tick.pip_size > 0 && tick.pip_size < 1)
            ? Math.abs(Math.log10(1 / tick.pip_size))
            : (tick.pip_size || ticksToDecimals(activeMarket));
        const factor = Math.pow(10, precision);
        const roundedPrice = Math.round(tick.quote * factor) / factor;
        const priceString = roundedPrice.toFixed(precision);
        const currentDigit = parseInt(priceString[priceString.length - 1]);


        // Construct the TRUE history including the potential new digit
        // We handle the array generically to match store limit (though only last N matter for patterns)
        const latestTicks = [...ticks, currentDigit];

        const domState = this.dominanceFilter.update(currentDigit);

        // --- WAIT FOR OPPOSITE (NO CONTRADICTION) RESET ---
        if (this.isWaitingForOpposite) {
            const isMatch = this.lastExecutedContract === 'DIGITMATCH';
            
            if (isMatch) {
                // For Matches, we enforce a mandatory 2-tick gap after the trade
                if (this.contradictionWaitCounter > 0) {
                    this.contradictionWaitCounter--;
                } else {
                    this.isWaitingForOpposite = false;
                    console.log(`[TradeEngine] 🔄 2-Tick Gap Complete for Match. Resuming Pattern Detection.`);
                }
            } else if (this.isDigitALoss(currentDigit, state)) {
                // For others, we wait for an actual "Loss" digit (e.g. Even -> Odd)
                this.isWaitingForOpposite = false;
                console.log(`[TradeEngine] 🔄 Contradiction Cleared: ${currentDigit}. Resuming Pattern Detection.`);
            }
        }

        // 1. Evaluate Triggers (Stateful)
        let triggersPassed = false;
        let isVirtualReady = false;
        let patternPassed = false; // Track if pattern matched in this tick
        let statusMsg = '';

        const { triggerSequence, triggerMode } = state;
        let { currentPipelineStep } = state;

        // Ensure triggers are properly instantiated
        const isEntryEnabled = triggers.entryDigit.enabled;
        const isPatternEnabled = triggers.digitPattern.enabled;
        const isVirtualEnabled = state.virtualSettings.isVirtualMode;

        // Filter out disabled modules from the theoretical sequence
        const activeSequence = triggerSequence.filter((mod: string) => {
            if (mod === 'entry') return isEntryEnabled;
            if (mod === 'pattern') return isPatternEnabled;
            if (mod === 'virtual') return isVirtualEnabled;
            return false;
        });

        // Pipeline Evaluation Loop (Allows multiple steps to clear in one tick)
        let loopLimit = 0;
        let loopStep = currentPipelineStep;

        if (tradingMode === 'after_first' && this.hasFirstTriggerHit) {
            triggersPassed = true;
            loopStep = activeSequence.length;
            statusMsg = `[Seq] Continuous Loop Active (Step ${currentStep})`;
        } else if (activeSequence.length === 0) {
            triggersPassed = true;
            statusMsg = "Pattern Mode (No Triggers)";
        } else if (triggerMode === 'sequential') {
            while (loopStep < activeSequence.length && loopLimit < 3) {
                loopLimit++;
                const currentModule = activeSequence[loopStep];

                if (currentModule === 'entry') {
                    const entryResult = evaluateEntryDigitStateful(currentDigit, triggers.entryDigit, this.entryTriggerState);
                    this.entryTriggerState = entryResult.newState;
                    if (entryResult.isTriggered) {
                        loopStep++;
                        state.setPipelineStep(loopStep);
                        statusMsg = `[Seq] Entry MATCH! Advancing...`;
                        continue;
                    } else {
                        const bufferLen = this.entryTriggerState.searchBuffer.length;
                        const remaining = triggers.entryDigit.monitorTicks - bufferLen;
                        statusMsg = this.entryTriggerState.isActive 
                            ? `[Seq] Entry [${triggers.entryDigit.entryDigit}] Found! Expires in ${remaining}t`
                            : `[Seq ${loopStep + 1}/${activeSequence.length}] Wait: ENTRY`;
                        break;
                    }
                } else if (currentModule === 'pattern') {
                    if (triggers.digitPattern.multiEntry?.enabled) {
                        const multi = triggers.digitPattern.multiEntry;
                        let activeIndex = multi.currentIndex;
                        
                        // If current box is empty, find next non-empty one
                        if (!multi.patterns[activeIndex]) {
                            for (let i = 0; i < 4; i++) {
                                activeIndex = (activeIndex + 1) % 4;
                                if (multi.patterns[activeIndex]) break;
                            }
                            // Sync store if we moved
                            if (activeIndex !== multi.currentIndex) {
                                state.setMultiEntryIndex(activeIndex);
                            }
                        }

                        const pattern = multi.patterns[activeIndex];
                        patternPassed = this.evaluateMultiEntry(latestTicks, pattern);
                    } else {
                        patternPassed = evaluateDigitPatternTrigger(latestTicks, {
                            ...triggers.digitPattern,
                            rfStream: this.rfHistory
                        } as any);
                    }
                    
                    // Blocking logic for Wait for Opposite
                    if (patternPassed && triggers.digitPattern.waitForOpposite && this.isWaitingForOpposite) {
                        patternPassed = false; // Block match until reset
                        statusMsg = `Wait: Waiting for Opposite (${state.contractType})...`;
                    }

                    if (patternPassed) {
                        console.log(`[TradeEngine] ✅ Pattern Trigger MATCHED for Step ${currentStep}`);
                        loopStep++;
                        state.setPipelineStep(loopStep);
                        statusMsg = `Pattern Mod ${currentStep} Done`;
                        continue;
                    } else {
                        if (!statusMsg) statusMsg = `Waiting for Pattern Step ${currentStep}...`;
                        break;
                    }
                } else if (currentModule === 'virtual') {
                    isVirtualReady = true;
                    // Advance to next step in sequence without firing yet
                    loopStep++;
                    state.setPipelineStep(loopStep);
                    statusMsg = `[Seq] Virtual Tracking Active...`;
                    continue; 
                }
            }
            if (loopStep >= activeSequence.length) {
                triggersPassed = true;
                statusMsg = `[Seq] SEQUENCE COMPLETE! Evaluating Action...`;
            }
        } else {
            // SIMULTANEOUS LOGIC (AND gate)
            const entryResult = evaluateEntryDigitStateful(currentDigit, triggers.entryDigit, this.entryTriggerState);
            this.entryTriggerState = entryResult.newState;
            const entryDigitPassed = entryResult.isTriggered;
            
            if (triggers.digitPattern.multiEntry?.enabled) {
                const multi = triggers.digitPattern.multiEntry;
                let activeIndex = multi.currentIndex;
                
                // If current box is empty, find next non-empty one
                if (!multi.patterns[activeIndex]) {
                    for (let i = 0; i < 4; i++) {
                        activeIndex = (activeIndex + 1) % 4;
                        if (multi.patterns[activeIndex]) break;
                    }
                    if (activeIndex !== multi.currentIndex) {
                        state.setMultiEntryIndex(activeIndex);
                    }
                }

                const pattern = multi.patterns[activeIndex];
                patternPassed = this.evaluateMultiEntry(latestTicks, pattern);
            } else {
                patternPassed = evaluateDigitPatternTrigger(latestTicks, {
                    ...triggers.digitPattern,
                    rfStream: this.rfHistory
                } as any);
            }

            // Wait for Opposite in Simul Mode
            if (patternPassed && triggers.digitPattern.waitForOpposite && this.isWaitingForOpposite) {
                patternPassed = false;
            }

            const passes = activeSequence.every((mod: string) => {
                if (mod === 'entry') return entryDigitPassed;
                if (mod === 'pattern') return patternPassed;
                if (mod === 'virtual') return isVirtualEnabled;
                return false;
            });

            if (passes) {
                triggersPassed = true;
                loopStep = activeSequence.length;
                if (isVirtualEnabled) isVirtualReady = true;
                statusMsg = `[Simul] ALL Triggers Matched! Trading...`;
            } else {
                statusMsg = `[Simul] Waiting for conditions... ${entryDigitPassed ? 'E:(X)' : 'E:( )'} ${patternPassed ? 'P:(X)' : 'P:( )'}`;
            }
        }

        const isVirtual = state.virtualSettings.isVirtualMode;
        const isContinuous = state.tradingMode === 'continuous_check';

        if (isVirtual && isContinuous && triggersPassed && this.virtualTrades.length > 0) {
            state.setTriggerStatus(`Wait: Virtual Trade Active...`);
            return;
        }

        // --- DOMINANCE FILTER DISABLED ---
        const isFilteredByDominance = false;

        // --- TRIGGER-TICK EXCLUSION LOGIC (VIRTUAL ONLY) ---
        const wasAlreadyArmed = this.hasFirstTriggerHit;
        let justTriggered = false;

        if (!wasAlreadyArmed && triggersPassed && loopStep >= activeSequence.length) {
            this.hasFirstTriggerHit = true;
            justTriggered = true;
        }

        // Final status update
        if (!statusMsg) statusMsg = 'Analyzing Market...';
        state.setTriggerStatus(statusMsg);

        // Sequence Mode 'after_first' adherence
        if (tradingMode === 'after_first') {
            if (this.hasFirstTriggerHit) {
                triggersPassed = true;
            }
        } else {
            // Continuous check mode: Pipeline complete logic
            if (loopStep >= activeSequence.length) {
                // The pattern module already blocked patternPassed/loopStep progress above,
                // so triggersPassed will only be true here if patternPassed was true.
                triggersPassed = true;
            }
        }

        // (Virtual Trade Processing moved to end of function to mirror Real buy/sell delay)

        // --- STRICT PATTERN ADHERENCE BLOCK ---
        if (!triggersPassed) return;

        // 2. Execute Pattern Action
        const currentAction = tradePattern[currentStep - 1];

        if (currentAction === 'trade') {
            const isVirtual = state.virtualSettings.isVirtualMode;
            const isContinuous = state.tradingMode === 'continuous_check';

            if (isVirtual) {
                // Mirror Real behavior: Block if a virtual trade is running.
                if (isContinuous && this.virtualTrades.length > 0) {
                    state.setTriggerStatus("Wait: Virtual Trade Running...");
                    return;
                }
            } else {
                // Real Execution: Only block if a real trade is pending and we are in continuous check mode.
                if (isContinuous && tradeWS.hasPendingTrade()) {
                    state.setTriggerStatus("Wait: Trade Pending...");
                    return;
                }
            }

            // Risk Checks
            if (stats.totalProfit >= takeProfit || stats.totalProfit <= -stopLoss) {
                state.stopBot();
                return;
            }

            if (state.stopAfterTotalWins.enabled && stats.won >= state.stopAfterTotalWins.value) {
                state.stopBot();
                return;
            }

            // Calculate Stake
            if (this.currentStake === 0) this.currentStake = initialStake;

            // Override with recovery stake if active (unless configured to use martingale stake)
            let tradeStake = (state.isRecoveryActive && !state.recoverySettings.useMartingaleStake)
                ? state.recoverySettings.recoveryStake
                : sanitizeStake(this.currentStake);

            // Execute
            this.executeTrade(state, tradeStake, currentDigit);
            
            // Mark virtual trigger as used to prevent multi-firing on persistent match
            // (Removed as duration-based blocking satisfies mirroring)
        }
 
         // 3. Always Advance Step (Since we passed triggers or executed an action)
         state.advanceStep();

         // Multi-Entry Loop Advancement
         if (triggersPassed && triggers.digitPattern.multiEntry?.enabled) {
             const multi = triggers.digitPattern.multiEntry;
             let nextIndex = (multi.currentIndex + 1) % 4;
             // Skip empty boxes (circular check)
             for (let i = 0; i < 4; i++) {
                 if (multi.patterns[nextIndex]) break;
                 nextIndex = (nextIndex + 1) % 4;
             }
             state.setMultiEntryIndex(nextIndex);
         }

        // Contradiction flag is now set directly in executeTrade to handle multi-stage pipelines correctly.

        // 4. Pipeline Reset after trade fires
        // After the full sequence is complete and a trade/skip action fires, reset the
        // pipeline step so the next pattern step re-evaluates conditions fresh.
        // This ensures NO entries are skipped in after_first mode.
        if (triggersPassed && loopStep >= activeSequence.length) {
            // Pipeline was complete - reset for next cycle
            if (tradingMode === 'continuous_check') {
                state.setPipelineStep(0);
                this.entryTriggerState = { isActive: false, hasMatched: false, searchBuffer: [] };
                this.hasFirstTriggerHit = false; // Reset for next trigger cycle
            }
            // In after_first mode: hasFirstTriggerHit keeps it open, no reset needed
        }
    }

    private async executeTrade(state: any, stake: number, triggerDigit?: number) {
        // Snapshot current values
        const { virtualSettings } = state;
        const tradeStake = stake;
        const isDTrader = state.tradingApp === 'dtrader';
        let tradeContractType = isDTrader ? state.manualContractType : state.contractType;
        let tradePrediction = isDTrader ? (state.manualPrediction !== undefined ? state.manualPrediction : state.prediction) : state.prediction;
        const symbol = isDTrader ? state.manualMarket : state.market;


        // Multi-Entry Custom Contract Override
        if (state.triggers?.digitPattern?.multiEntry?.enabled && state.triggers.digitPattern.multiEntry.useCustomContracts) {
            const multi = state.triggers.digitPattern.multiEntry;
            const customContract = multi.contracts[multi.currentIndex];
            if (customContract) {
                tradeContractType = customContract;
                tradePrediction = parseInt(multi.predictions[multi.currentIndex]);
                if (isNaN(tradePrediction)) tradePrediction = 0;
                console.log(`[TradeEngine] Multi-Entry Overriding: Contract=${tradeContractType}, Prediction=${tradePrediction}`);
            }
        }

        // Adaptive Switching logic (with null guard)
        if (state.triggers?.adaptiveEvenOdd?.enabled) {
            const activeContract = state.getActiveAdaptiveContract();
            tradeContractType = activeContract.type;
            tradePrediction = activeContract.prediction;
        }

        // Store for "Wait for Opposite" logic
        this.lastExecutedContract = tradeContractType;
        this.lastExecutedPrediction = tradePrediction;
        
        if (state.triggers?.digitPattern?.waitForOpposite && state.tradingMode !== 'after_first') {
            this.isWaitingForOpposite = true;
            this.contradictionWaitCounter = tradeContractType === 'DIGITMATCH' ? 2 : 0;
        }

        // Digit contracts always settle on the next tick (1T). Only timed contracts
        // (Rise/Fall, High/Low, Touch/No Touch) read the duration from the trade section.
        const DIGIT_CONTRACTS = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD'];
        const isDigitContract = DIGIT_CONTRACTS.includes(tradeContractType);
        const resolvedDuration = isDigitContract
            ? 1
            : (state.manualDurationValue !== undefined && state.manualDurationValue > 0 ? state.manualDurationValue : 1);
        const resolvedDurationUnit = isDigitContract
            ? 't'
            : (state.manualDurationUnit || 't');

        if (virtualSettings.isVirtualMode) {
            const vRequestId = `v_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            this.virtualTrades.push({
                requestId: vRequestId,
                startTime: Date.now(),
                contractType: tradeContractType,
                prediction: tradePrediction,
                stake: tradeStake,
                symbol: symbol,
                // Digit contracts settle on tick 1; timed contracts wait resolvedDuration ticks
                duration: resolvedDuration,
                currentTick: 0,
                isSettled: false,
                entryTickQuote: state.lastTick?.quote
            });

            // Log that the trade was PLACED (result follows on settlement tick)
            state.addTradeLog({
                requestId: vRequestId,
                isVirtual: true,
                time: Date.now(),
                contract: tradeContractType,
                digit: tradePrediction,
                stake: tradeStake,
                currency: state.account?.currency || 'USD',
                profit: 0,
                result: '...V...',
                exit: null
            });

            return; // Exit out of Real execution path
        }

        // Real mode path continues...

        const payload: any = {
            symbol: state.isRecoveryActive ? state.recoverySettings.recoveryMarket : symbol,
            contract_type: state.triggers?.adaptiveEvenOdd?.enabled ? tradeContractType : (state.isRecoveryActive ? state.recoverySettings.recoveryContractType : tradeContractType),
            // Digit contracts always use 1t; timed contracts (Rise/Fall etc.) use trade section settings
            duration: resolvedDuration,
            duration_unit: resolvedDurationUnit,
            stake: Number(tradeStake.toFixed(2)),
            currency: state.account?.currency || 'USD',
        };

        const BARRIER_TYPES = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'];
        const PREDICTION_TYPES = ['DIGITEVEN', 'DIGITODD']; // types that should NOT have prediction or barrier

        const activeContractType = payload.contract_type;
        const activePrediction = state.isRecoveryActive ? state.recoverySettings.recoveryPrediction : tradePrediction;

        if (BARRIER_TYPES.includes(activeContractType)) {
            payload.barrier = activePrediction;
        } else if (!PREDICTION_TYPES.includes(activeContractType)) {
            // For standard Rise/Fall or others, we don't send prediction digits.
        }

        if (state.executionMode === 'standard') {
            const stakeKey = `${Number(tradeStake).toFixed(2)}_${payload.contract_type}`;
            const proposal = state.activeProposal ? state.activeProposal[stakeKey] : null;

            // CRITICAL: Only Use Fast Buy if Symbol Matches
            if (proposal && proposal.symbol === state.market) {
                const proposalPrice = parseFloat(proposal.askPrice);
                const targetPrice = tradeStake;

                // Price Match Check
                if (Math.abs(proposalPrice - targetPrice) > 0.01) {
                    console.warn(`[TradeEngine] Proposal Price Mismatch for ${stakeKey}! Have: ${proposalPrice}, Need: ${targetPrice}.`);
                    // Fallback to one-time if mismatch is too high, but usually we just want to hit the ID
                }

                // Executing via STANDARD
                const requestId = Date.now().toString();
                
                state.addTradeLog({
                    requestId,
                    time: Date.now(),
                    contract: payload.contract_type,
                    result: 'BUYING...',
                    stake: tradeStake.toString(),
                    profit: null,
                    digit: payload.barrier || '-',
                    exit: '-',
                    currency: payload.currency || 'USD'
                });

                tradeWS.executeProposalBuy(requestId, proposal.id, proposal.askPrice, payload);
            } else {
                console.warn(`[TradeEngine] No active proposal for stake ${stakeKey}. Firing AUTO-BUY.`);
                const requestId = Date.now().toString();
                
                state.addTradeLog({
                    requestId,
                    time: Date.now(),
                    contract: payload.contract_type,
                    result: 'PROPOSING...', // Will turn into BUYING... once ID arrives
                    stake: tradeStake.toString(),
                    profit: null,
                    digit: payload.barrier || '-',
                    exit: '-',
                    currency: payload.currency || 'USD'
                });

                tradeWS.subscribeToProposal({
                    stake: tradeStake,
                    contract_type: payload.contract_type,
                    symbol: payload.symbol,
                    barrier: payload.barrier,
                    duration: 1,
                    currency: payload.currency || 'USD',
                    buyAfterRec: true,
                    requestId: requestId
                });
            }
        } else {
            // 'fast' mode — buy directly by parameters (no proposal roundtrip) for microsecond execution
            tradeWS.executeDirectTrade(payload);
        }
    }

    /**
     * Internal Event Contract - Driven by TradeWS
     */
    public handleInternalEvent(type: string, data: any) {
        const state = this.getState ? this.getState() : null;
        if (!state) return;

        switch (type) {
            case 'TRADE_STARTED':
                break;

            case 'CONTRACT_UPDATE':
                // Live updates if we want to show current price/spot
                break;

            case 'TRADE_RESULT':
                this.handleTradeResult(data.isWin, data.profit);
                break;
        }
    }

    private processVirtualTrades(tick: TickData, state: any) {
        if (this.virtualTrades.length === 0) return;

        this.virtualTrades = this.virtualTrades.filter(vt => {
            vt.currentTick++;

            // 1. Settlement (UI Update) happens on the target duration tick
            if (!vt.isSettled && vt.currentTick === vt.duration) {
                const { isWin, exitDigit } = this.calculateVirtualResult(vt, tick);
                this.handleVirtualResult(isWin, vt.stake); // This updates streaks/stats

                const profit = isWin ? vt.stake * 0.95 : -vt.stake;
                state.updateTradeLog(vt.requestId, {
                    profit: profit,
                    result: isWin ? 'WON' : 'LOST',
                    exit: exitDigit >= 0 ? exitDigit : '-'
                });
                vt.isSettled = true;
            }

            // 2. Removal happens after the target duration is reached
            if (vt.currentTick >= vt.duration) {
                return false; // Remove from pending list
            }
            return true;
        });
    }

    private calculateVirtualResult(vt: any, exitTick: TickData): { isWin: boolean, exitDigit: number } {
        const exitQuote = exitTick.quote;
        const entryQuote = vt.entryTickQuote || 0;

        // Robust precision: convert pip_size multiplier (e.g. 0.001) to decimal count (3)
        // Same formula used in onTick() to guarantee consistency across all markets
        const rawPipSize = exitTick.pip_size;
        const precision = (rawPipSize !== undefined && rawPipSize > 0 && rawPipSize < 1)
            ? Math.abs(Math.round(Math.log10(1 / rawPipSize)))
            : (rawPipSize || ticksToDecimals(vt.symbol));

        const priceString = exitQuote.toFixed(precision);
        const exitDigit = parseInt(priceString.charAt(priceString.length - 1), 10);

        console.log(`[TradeEngine] Virtual Settlement: Quote=${exitQuote} EntryQuote=${entryQuote} Precision=${precision} ExitDigit=${exitDigit} Prediction=${vt.prediction} Type=${vt.contractType}`);

        let isWin = false;
        switch (vt.contractType) {
            case 'DIGITOVER': isWin = exitDigit > vt.prediction; break;
            case 'DIGITUNDER': isWin = exitDigit < vt.prediction; break;
            case 'DIGITMATCH': isWin = exitDigit === vt.prediction; break;
            case 'DIGITDIFF': isWin = exitDigit !== vt.prediction; break;
            case 'DIGITEVEN': isWin = exitDigit % 2 === 0; break;
            case 'DIGITODD': isWin = exitDigit % 2 !== 0; break;
            case 'CALL': isWin = exitQuote > entryQuote; break;
            case 'PUT': isWin = exitQuote < entryQuote; break;
        }
        
        return { isWin, exitDigit: ['CALL', 'PUT'].includes(vt.contractType) ? -1 : exitDigit };
    }

    private handleVirtualResult(isWin: boolean, stake: number) {
        if (!this.getState || !this.setState) return;
        const state = this.getState();
        const { virtualSettings, setVirtualSettings } = state;

        let {
            virtualWins,
            virtualLosses,
            vConsecWins,
            vConsecLosses,
            vResultHistory,
            vSmartStage,
            vSmartCount
        } = virtualSettings;

        if (isWin) {
            vConsecWins++;
            vConsecLosses = 0;
            virtualWins++;
        } else {
            vConsecWins = 0;
            vConsecLosses++;
            virtualLosses++;
        }

        const currentRes = isWin ? 'W' : 'L';
        const newHistory = [...(vResultHistory || []), currentRes].slice(-20);

        console.log(`[TradeEngine] Virtual Result: ${isWin ? 'WIN' : 'LOSS'}. Streak: W:${vConsecWins} L:${vConsecLosses}`);

        let shouldSwitch = false;
        const smart = virtualSettings.smartSettings;

        if (smart?.enabled) {
            if (smart.type === 'sequence' && smart.sequence) {
                const step1Req = smart.sequence.step1Type === 'Wins' ? 'W' : 'L';
                const step2Req = smart.sequence.step2Type === 'Wins' ? 'W' : 'L';

                if (vSmartStage === 1) {
                    if (currentRes === step1Req) {
                        vSmartCount++;
                        if (vSmartCount >= smart.sequence.step1Qty) {
                            vSmartStage = 2;
                            vSmartCount = 0;
                        }
                    } else {
                        vSmartCount = 0;
                    }
                } else {
                    // Stage 2
                    if (currentRes === step2Req) {
                        vSmartCount++;
                        if (vSmartCount >= smart.sequence.step2Qty) {
                            shouldSwitch = true;
                            vSmartStage = 1;
                            vSmartCount = 0;
                        }
                    } else {
                        // Strict sequence reset
                        vSmartStage = 1;
                        vSmartCount = (currentRes === step1Req) ? 1 : 0;
                        // If it immediately met Step 1 Qty on the reset (e.g. Qty=1)
                        if (vSmartCount >= (smart.sequence.step1Qty || 1)) {
                            vSmartStage = 2;
                            vSmartCount = 0;
                        }
                    }
                }
            } else if (smart.type === 'alternating' && smart.alternating) {
                const count = smart.alternating.count || 2;
                const reqLength = count * 2;
                if (newHistory.length >= reqLength) {
                    const pattern = newHistory.slice(-reqLength);
                    let isAlternating = true;
                    for (let i = 0; i < pattern.length - 1; i++) {
                        if (pattern[i] === pattern[i+1]) {
                            isAlternating = false;
                            break;
                        }
                    }
                    if (isAlternating) shouldSwitch = true;
                }
            }
        } else {
            // Legacy/Standard Threshold Logic
            if (virtualSettings.startVirtualToReal) {
                const threshold = virtualSettings.vThreshold;
                const mode = virtualSettings.vTriggerMode;
                const type = virtualSettings.vTriggerType;

                if (type === 'wins') {
                    const val = (mode === 'consec') ? vConsecWins : virtualWins;
                    if (val >= threshold) shouldSwitch = true;
                } else {
                    const val = (mode === 'consec') ? vConsecLosses : virtualLosses;
                    if (val >= threshold) shouldSwitch = true;
                }
            }
        }

        // Update state including transient matcher progress
        setVirtualSettings({ 
            virtualWins, 
            virtualLosses, 
            vConsecWins, 
            vConsecLosses, 
            vResultHistory: newHistory,
            vSmartStage,
            vSmartCount
        });

        if (state.triggers?.adaptiveEvenOdd?.enabled) {
            state.updateAdaptiveState(isWin);
        }

        // Check Switch to Real
        if (shouldSwitch && virtualSettings.isVirtualMode) {
            console.log(`[TradeEngine] 🚀 SMART SWITCH TRIGGERED: Switching to REAL Mode.`);
            setVirtualSettings({
                isVirtualMode: false,
                realWins: 0,
                realLosses: 0,
                rConsecWins: 0,
                rConsecLosses: 0,
                vResultHistory: [], // Clear on switch
                vSmartStage: 1,
                vSmartCount: 0
            });
            
                // Pipeline Advancement Logic
                if (state.triggerMode === 'sequential') {
                    // Re-calculate active sequence assuming virtual WAS enabled to find our index
                    const activeSequence = state.triggerSequence.filter((mod: string) => {
                        if (mod === 'entry') return state.triggers.entryDigit.enabled;
                        if (mod === 'pattern') return state.triggers.digitPattern.enabled;
                        if (mod === 'virtual') return true; // It was enabled a millisecond ago
                        return false;
                    });

                    if (state.currentPipelineStep < activeSequence.length && activeSequence[state.currentPipelineStep] === 'virtual') {
                        state.setPipelineStep(state.currentPipelineStep + 1);
                        console.log(`[TradeEngine] Pipeline advanced past VIRTUAL.`);
                    }
                }
                
                // Mode switch complete - we preserve trigger state and current step 
                // to allow seamless transition between Virtual and Real tracking.
            }
        }


    public handleTradeResult(isWin: boolean, actualProfit: number) {
        if (!this.getState || !this.setState) return;
        const state = this.getState();
        const {
            initialStake,
            martingaleMultiplier,
            maxMartingaleSteps,
            compoundProfits,
            stopAfterTotalWins,
            stopAfterTotalLosses,
            stopAfterConsecutiveLosses,
            stats,
            virtualSettings,
            setVirtualSettings,
            takeProfit,
            stopLoss,
            stopOnMaxSteps
        } = state;

        let profitToRecord = actualProfit;

        // ⚡ PROFIT FALLBACK: 
        // If it's a loss but the profit is 0 (or positive?), force it to -stake to ensure accuracy in Net Profit.
        if (!isWin && profitToRecord >= 0) {
            const currentStakeValue = this.currentStake || initialStake;
            console.warn(`[TradeEngine] Loss detected with non-negative profit [${profitToRecord}]. Falling back to -stake [-${currentStakeValue}]`);
            profitToRecord = -currentStakeValue;
        }

        console.log(`[TradeEngine] Result received: ${isWin ? 'WIN' : 'LOSS'}. Recorded Profit: ${profitToRecord}`);

        // Track Cumulative Session Loss for Recovery Mode
        if (!isWin) {
            this.cumulativeSessionLoss += Math.abs(profitToRecord);
        } else {
            this.cumulativeSessionLoss -= profitToRecord;
            if (this.cumulativeSessionLoss < 0) this.cumulativeSessionLoss = 0;
        }

        const isTradeWin = isWin; // Standardize win detection

        // 1. Calculate Next Stake (Original Fast Logic)
        if (isTradeWin) {
            this.lossCount = 0;
            if (compoundProfits) {
                this.currentStake = (this.currentStake || initialStake) + profitToRecord;
            } else {
                this.currentStake = initialStake;
            }
        } else {
            this.lossCount++;
            if (this.lossCount > maxMartingaleSteps) {
                if (stopOnMaxSteps) {
                    console.log(`[TradeEngine] 🛑 HALTING BOT: Max Martingale Steps [${maxMartingaleSteps}] reached.`);
                    state.stopBot();
                    return;
                }
                this.currentStake = initialStake;
                this.lossCount = 0;
            } else {
                this.currentStake = (this.currentStake || initialStake) * martingaleMultiplier;
            }
        }

        this.currentStake = sanitizeStake(this.currentStake);

        // --- RECOVERY MODE LOGIC (New Additions Kept) ---
        if (state.recoverySettings.enabled) {
            if (!state.isRecoveryActive && this.lossCount >= state.recoverySettings.lossThreshold) {
                console.log(`[TradeEngine] 🚨 RECOVERY MODE ACTIVATED! Loss Threshold [${state.recoverySettings.lossThreshold}] hit.`);
                this.recoveryWinsCount = 0;
                state.toggleRecovery(true);
            } else if (state.isRecoveryActive) {
                if (isTradeWin) {
                    this.recoveryWinsCount++;
                } else {
                    this.recoveryWinsCount = 0;
                }

                const isLossRecovered = this.cumulativeSessionLoss <= 0;
                const isWinThresholdMet = state.recoverySettings.winThreshold > 0 && this.recoveryWinsCount >= state.recoverySettings.winThreshold;

                if (isLossRecovered || isWinThresholdMet) {
                    console.log(`[TradeEngine] ✅ RECOVERY COMPLETE! (LossRecovered: ${isLossRecovered}, WinThresholdMet: ${isWinThresholdMet})`);
                    state.toggleRecovery(false);
                    this.lossCount = 0; // Reset loss count once recovered
                    this.currentStake = initialStake;
                    this.recoveryWinsCount = 0;
                }
            }
        }

        this.currentStake = sanitizeStake(this.currentStake);

        // 2. Update Store Statistics (Original Atomic Update)
        this.setState((state: any) => {
            const currentStats = state.stats;
            const newTotalTrades = currentStats.totalTrades + 1;
            const newWon = currentStats.won + (isTradeWin ? 1 : 0);
            const newLost = currentStats.lost + (isTradeWin ? 0 : 1);
            const newTotalProfit = currentStats.totalProfit + profitToRecord;

            return {
                stats: {
                    ...currentStats,
                    totalTrades: newTotalTrades,
                    won: newWon,
                    lost: newLost,
                    totalProfit: newTotalProfit,
                    maxStake: Math.max(currentStats.maxStake, this.currentStake),
                    winRate: Math.round((newWon / newTotalTrades) * 100)
                }
            };
        });

        // 3. ⚡ INSTANT STOP CONDITIONS
        // We fetch the state again to get the LATEST limits and the updated stats
        const finalState = this.getState();
        const finalStats = finalState.stats;

        const isStopLossHit = finalStats.totalProfit <= -stopLoss;
        const isTakeProfitHit = finalStats.totalProfit >= takeProfit;
        const isTotalWinsHit = stopAfterTotalWins.enabled && finalStats.won >= stopAfterTotalWins.value;
        const isTotalLossesHit = stopAfterTotalLosses?.enabled && finalStats.lost >= stopAfterTotalLosses.value;
        const isConsecutiveLossesHit = stopAfterConsecutiveLosses.enabled && this.lossCount >= stopAfterConsecutiveLosses.value;

        // Adaptive Switching (Handle BEFORE instant stop to ensure next start is on correct side)
        // Null guard required: triggers may not be fully hydrated from old localStorage
        if (finalState.triggers?.adaptiveEvenOdd?.enabled) {
            console.log(`[TradeEngine] Adaptive Switch: Updating adaptive state with result (Win: ${isTradeWin}).`);
            finalState.updateAdaptiveState(isTradeWin);
        }

        if (isStopLossHit || isTakeProfitHit || isTotalWinsHit || isTotalLossesHit || isConsecutiveLossesHit) {
            let reason = 'Stop limit reached';
            if (isStopLossHit) reason = `Stop Loss [${stopLoss}] reached`;
            if (isTakeProfitHit) reason = `Take Profit [${takeProfit}] reached`;
            if (isTotalWinsHit) reason = `Total Wins [${stopAfterTotalWins.value}] reached`;
            if (isTotalLossesHit) reason = `Total Losses [${stopAfterTotalLosses.value}] reached`;
            if (isConsecutiveLossesHit) reason = `Consecutive Losses [${stopAfterConsecutiveLosses.value}] reached`;

            console.log(`[TradeEngine] 🛑 HALTING BOT: ${reason}. Total Profit: ${finalStats.totalProfit}`);
            state.stopBot();
            return;
        }

        // 4. Track Virtual Stats (Original Logic)
        if (!virtualSettings.isVirtualMode) {
            let { realWins, realLosses, rConsecWins, rConsecLosses } = virtualSettings;
            if (isWin) {
                rConsecWins++;
                rConsecLosses = 0;
                realWins++;
            } else {
                rConsecWins = 0;
                rConsecLosses++;
                realLosses++;
            }
            setVirtualSettings({ realWins, realLosses, rConsecWins, rConsecLosses });
            
            // Check Switch to Virtual
            if (virtualSettings.startRealToVirtual) {
                const threshold = virtualSettings.rThreshold;
                const mode = virtualSettings.rTriggerMode;
                const type = virtualSettings.rTriggerType;
                let shouldSwitch = false;

                if (type === 'wins') {
                    const val = (mode === 'consec') ? rConsecWins : realWins;
                    if (val >= threshold) shouldSwitch = true;
                } else {
                    const val = (mode === 'consec') ? rConsecLosses : realLosses;
                    if (val >= threshold) shouldSwitch = true;
                }

                if (shouldSwitch) {
                    console.log(`[TradeEngine] 🛸 REAL THRESHOLD MET: Switching back to VIRTUAL Mode.`);
                    setVirtualSettings({
                        isVirtualMode: true,
                        virtualWins: 0,
                        virtualLosses: 0,
                        vConsecWins: 0,
                        vConsecLosses: 0
                    });
                    if (state.executionMode === 'standard') {
                        state.setPipelineStep(0);
                    }
                    
                    // Mode switch complete - we preserve trigger state and current step 
                    // to allow seamless transition between Real and Virtual tracking.
                }
            }
        }

        // --- FINAL PROPOSAL REFRESH (Standard Mode Only) ---
        // Fetch fresh state to ensure the proposal respects newly enabled Adaptive E/O and Recovery sides
        const postToggleState = this.getState();
        if (postToggleState.executionMode === 'standard') {
            this.refreshProposal(postToggleState);
        }
    }
}
const G = globalThis as any;
if (!G.__tradeEngine) {
    G.__tradeEngine = new TradeEngine();
}
export const tradeEngine = G.__tradeEngine as TradeEngine;
