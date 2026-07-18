import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ConnectionStatus, AccountInfo, TickData, DerivMessage } from '../lib/deriv/types';
import { derivWS } from '../lib/deriv/websocket';
import { ticksToDecimals } from '../lib/deriv/constants';
import { tradeEngine } from '../lib/deriv/trade-engine';
import { tradeWS } from '../lib/deriv/trade-ws';
import { backendWS } from '../lib/backend-ws';
import { EntryDigitTrigger, DigitPatternTrigger } from '../lib/triggers/types';
import { fetchAccounts } from '../lib/deriv/auth';

interface DerivState {
    status: ConnectionStatus;
    token: string;
    account: AccountInfo | null;
    accounts: AccountInfo[];
    lastTick: TickData | null;
    ticks: number[];
    priceHistory: number[];
    rfHistory: ('R' | 'F')[];
    market: string;
    contractType: string;
    prediction: number;
    manualMarket: string;
    manualContractType: string;
    manualPrediction: number;
    manualDurationUnit: string;
    manualDurationValue: number;
    manualPositions: any[];
    sidebarView: 'markets' | 'logs';
    isRunning: boolean;
    isSwitchingMarket: boolean;
    rtt: number;
    tradingApp: 'laxsniper' | 'dtrader';
    setTradingApp: (app: 'laxsniper' | 'dtrader') => void;
    triggers: {
        entryDigit: EntryDigitTrigger;
        digitPattern: DigitPatternTrigger;
        adaptiveEvenOdd: {
            enabled: boolean;
            currentSide: 'Even' | 'Odd' | 'Over' | 'Under' | 'Rise' | 'Fall' | 'Higher' | 'Lower';
            initialSide: 'Even' | 'Odd' | 'Over' | 'Under' | 'Rise' | 'Fall' | 'Higher' | 'Lower';
            showAdvancedSettings: boolean;
            advancedEnabled: boolean;
            mode: 'adaptive_contracts' | 'custom_pattern';
            adaptiveContracts: {
                contractA: { type: string; prediction: number };
                contractB: { type: string; prediction: number };
                activeSide: 'A' | 'B';
                startSide: 'A' | 'B';
            };
            customPattern: {
                steps: Array<{ type: string; prediction: number; repeats: number }>;
                currentStepIndex: number;
                currentRepeatCount: number;
            };
        };
    };
    triggerSequence: ('virtual' | 'entry' | 'pattern')[];
    triggerMode: 'sequential' | 'simultaneous';
    currentPipelineStep: number;
    tradePattern: ('trade' | 'skip')[];
    currentStep: number;
    tradingMode: 'after_first' | 'continuous_check';

    // Admin State
    admin: {
        isKillSwitchActive: boolean;
        totalUsers: number;
        platformVolume: number;
    };

    // Risk Settings
    initialStake: number;
    martingaleMultiplier: number;
    maxMartingaleSteps: number;
    takeProfit: number;
    stopLoss: number;
    stopAfterTotalWins: { enabled: boolean; value: number };
    stopAfterTotalLosses: { enabled: boolean; value: number };
    stopAfterConsecutiveLosses: { enabled: boolean; value: number };
    compoundProfits: boolean;
    stopOnMaxSteps: boolean;

    // Statistics
    stats: {
        totalTrades: number;
        won: number;
        lost: number;
        winRate: number;
        totalProfit: number;
        maxStake: number;
        currentStep: number;
    };
    lastTickReceived: number | null;
    totalTicksReceived: number;
    error: string | null;
    debugInfo: any | null;
    triggerStatus: string | null;

    // Overlay State
    isLogOverlayOpen: boolean;
    isLogOverlayMinimized: boolean;

    // Trade Logs
    tradeLogs: any[];

    // Backend Debug
    backendStatus: 'connected' | 'disconnected' | 'error' | 'handshaking' | 'authenticating' | 'ready';
    isBackendAuthorized: boolean;
    lastBackendMessage: any | null;

    // Direct Execution State
    tradeWsStatus: ConnectionStatus;
    isTradeAuthorized: boolean;
    executionMode: 'fast' | 'standard';
    activeProposal: Record<string, { id: string; askPrice: string; receivedAt: number }> | null;
    tradeMetrics: {
        proposalLatency: number;
        buyLatency: number;
        settlementLatency: number;
    };
    showQuickControls: boolean;
    quickSwitchVirtualBehavior: 'continue_virtual' | 'override_to_real';
    showLogOverlayOnRun: boolean;

    // Actions
    setStatus: (status: ConnectionStatus) => void;
    setToken: (token: string) => void;
    setAccount: (account: AccountInfo | null) => void;
    addTick: (tick: TickData) => void;
    setMarket: (market: string) => void;
    setContractType: (type: string) => void;
    setPrediction: (prediction: number) => void;
    setManualMarket: (market: string) => void;
    setManualContractType: (type: string) => void;
    setManualPrediction: (prediction: number) => void;
    setManualDurationUnit: (unit: string) => void;
    setManualDurationValue: (value: number) => void;
    setManualPositions: (positions: any[] | ((prev: any[]) => any[])) => void;
    setSidebarView: (view: 'markets' | 'logs') => void;
    setTrigger: (type: 'entryDigit' | 'digitPattern', config: any) => void;
    setTriggerSequence: (sequence: ('virtual' | 'entry' | 'pattern')[]) => void;
    setTriggerMode: (mode: 'sequential' | 'simultaneous') => void;
    setPipelineStep: (step: number) => void;
    setTradePattern: (pattern: ('trade' | 'skip')[]) => void;
    setCurrentStep: (step: number) => void;
    setTradingMode: (mode: 'after_first' | 'continuous_check') => void;
    setTriggerStatus: (status: string | null) => void;
    toggleManualMode: () => void;
    setBackendStatus: (status: 'connected' | 'disconnected' | 'error' | 'handshaking' | 'authenticating' | 'ready') => void;
    setIsBackendAuthorized: (isAuthorized: boolean) => void;
    setLastBackendMessage: (message: any) => void;
    toggleKillSwitch: () => void;
    setRiskSettings: (settings: Partial<{
        initialStake: number;
        martingaleMultiplier: number;
        maxMartingaleSteps: number;
        takeProfit: number;
        stopLoss: number;
        stopAfterTotalWins: { enabled: boolean; value: number };
        stopAfterTotalLosses: { enabled: boolean; value: number };
        stopAfterConsecutiveLosses: { enabled: boolean; value: number };
        compoundProfits: boolean;
        stopOnMaxSteps: boolean;
    }>) => void;
    advanceStep: () => void;
    addTradeLog: (log: any) => void;
    updateTradeLog: (requestId: string, updates: any) => void;
    setTradeLogBackendId: (localId: string, backendId: string) => void;
    clearLogs: () => void;
    resetStats: () => void;
    setStats: (stats: any) => void;
    setLogOverlayOpen: (open: boolean) => void;
    setLogOverlayMinimized: (minimized: boolean) => void;
    toggleLogOverlay: () => void;
    startBot: () => void;
    stopBot: () => void;
    connect: () => void;
    disconnect: () => void;
    forceReconnect: () => void;
    authorize: (token: string, allAccounts?: AccountInfo[]) => void;
    switchAccount: (loginid: string) => void;
    subscribeToMarket: (market: string) => void;
    resetTicks: () => void;
    setAppId: (id: string) => void;
    virtualSettings: {
        isVirtualMode: boolean;

        // Virtual -> Real
        startVirtualToReal: boolean;
        vThreshold: number;
        vTriggerMode: 'consec' | 'total';
        vTriggerType: 'wins' | 'losses';

        // Real -> Virtual
        startRealToVirtual: boolean;
        rThreshold: number;
        rTriggerMode: 'consec' | 'total';
        rTriggerType: 'wins' | 'losses';

        // Trackers
        virtualWins: number;
        virtualLosses: number;
        vConsecWins: number;
        vConsecLosses: number;

        realWins: number;
        realLosses: number;
        rConsecWins: number;
        rConsecLosses: number;

        // Smart Switch Settings
        smartSettings: {
            enabled: boolean;
            type: 'sequence' | 'alternating';
            sequence: {
                step1Type: 'Wins' | 'Losses';
                step1Qty: number;
                step2Type: 'Wins' | 'Losses';
                step2Qty: number;
            };
            alternating: {
                count: number;
            };
        };

        // Smart Switch Transient State
        vResultHistory: ('W' | 'L')[];
        vSmartStage: 1 | 2;
        vSmartCount: number;
    };
    setVirtualSettings: (settings: Partial<DerivState['virtualSettings']>) => void;
    recoverySettings: {
        enabled: boolean;
        lossThreshold: number;
        winThreshold: number;
        recoveryMarket: string;
        recoveryContractType: string;
        recoveryPrediction: number;
        recoveryStake: number;
        useMartingaleStake: boolean;
    };
    isRecoveryActive: boolean;
    marketBeforeRecovery: string | null;
    setRecoverySettings: (settings: Partial<DerivState['recoverySettings']>) => void;
    toggleRecovery: (active: boolean) => void;

    // Direct Execution Actions
    setTradeWsStatus: (status: ConnectionStatus) => void;
    setTradeAuthorized: (authorized: boolean) => void;
    setExecutionMode: (mode: 'fast' | 'standard') => void;
    setActiveProposal: (stake: string, proposal: { id: string; askPrice: string; receivedAt: number; symbol: string } | null) => void;
    updateTradeMetrics: (metrics: Partial<DerivState['tradeMetrics']>) => void;

    toggleAdaptiveSide: () => void;
    updateTriggers: (updates: Partial<DerivState['triggers']>) => void;
    setShowQuickControls: (show: boolean) => void;
    setQuickSwitchVirtualBehavior: (behavior: 'continue_virtual' | 'override_to_real') => void;
    setShowLogOverlayOnRun: (show: boolean) => void;
    setMultiEntryIndex: (index: number) => void;
    getActiveAdaptiveContract: () => { type: string; prediction: number };
    updateAdaptiveState: (isWin: boolean) => void;
}

export const useDerivStore = create<DerivState>()(
    persist(
        (set: any, get: any): DerivState => ({
            status: 'disconnected' as ConnectionStatus,
            token: '',
            account: null,
            accounts: [] as AccountInfo[],
            lastTick: null,
            lastTickReceived: null,
            totalTicksReceived: 0,
            error: null,

            triggerStatus: null,
            debugInfo: null,
            ticks: [] as number[],
            priceHistory: [] as number[],
            rfHistory: [] as ('R' | 'F')[],
            market: 'R_100',
            contractType: 'DIGITOVER',
            prediction: 5,
            manualMarket: typeof window !== 'undefined' ? localStorage.getItem('lax_manual_market') || 'R_100' : 'R_100',
            manualContractType: typeof window !== 'undefined' ? localStorage.getItem('lax_manual_contract_type') || 'DIGITOVER' : 'DIGITOVER',
            manualPrediction: typeof window !== 'undefined' ? parseInt(localStorage.getItem('lax_manual_prediction') || '5') : 5,
            manualDurationUnit: typeof window !== 'undefined' ? localStorage.getItem('lax_manual_duration_unit') || 't' : 't',
            manualDurationValue: typeof window !== 'undefined' ? parseInt(localStorage.getItem('lax_manual_duration_value') || '1') : 1,
            manualPositions: [] as any[],
            sidebarView: 'markets' as 'markets' | 'logs',
            isRunning: false,
            isSwitchingMarket: false,
            rtt: 0,
            tradingApp: 'laxsniper',
            isBackendAuthorized: false,

            // Direct Execution Init
            tradeWsStatus: 'disconnected' as ConnectionStatus,
            isTradeAuthorized: false,
            executionMode: 'fast', // Default to fast for microsecond execution
            activeProposal: null,
            tradeMetrics: {
                proposalLatency: 0,
                buyLatency: 0,
                settlementLatency: 0
            },
            showQuickControls: true,
            quickSwitchVirtualBehavior: 'continue_virtual',
            showLogOverlayOnRun: false,

            triggers: {
                entryDigit: {
                    enabled: false,
                    entryDigit: 5,
                    triggerOnEntry: true,
                    monitorTicks: 5,
                    consecutive: 2,
                    type: 'Under',
                    targetValue: 4,
                    multiDigits: [] as number[],
                    useMulti: false,
                },
                digitPattern: {
                    enabled: false,
                    pattern: ['D', 'D', 'M', 'D', 'D'],
                    compareDigit: 2,
                    waitForOpposite: false,
                    multiEntry: {
                        enabled: false,
                        showSettings: false,
                        useCustomContracts: false,
                        patterns: ['U7', 'V2', 'M5', 'V0'], // Now supports sequences like 'E-E'
                        contracts: ['', '', '', ''],
                        predictions: ['0', '0', '0', '0'],
                        currentIndex: 0,
                    }
                },
                adaptiveEvenOdd: {
                    enabled: false,
                    currentSide: 'Even',
                    initialSide: 'Even',
                    showAdvancedSettings: false,
                    advancedEnabled: false,
                    mode: 'adaptive_contracts',
                    adaptiveContracts: {
                        contractA: { type: 'DIGITUNDER', prediction: 4 },
                        contractB: { type: 'DIGITOVER', prediction: 5 },
                        activeSide: 'A',
                        startSide: 'A'
                    },
                    customPattern: {
                        steps: [
                            { type: 'DIGITEVEN', prediction: 0, repeats: 2 },
                            { type: 'DIGITODD', prediction: 0, repeats: 2 }
                        ],
                        currentStepIndex: 0,
                        currentRepeatCount: 0
                    }
                },
            },
            triggerSequence: ['virtual', 'entry', 'pattern'], // Default pipeline
            triggerMode: 'simultaneous',
            currentPipelineStep: 0,
            tradePattern: ['skip', 'trade', 'skip', 'skip', 'skip', 'trade', 'skip', 'skip'],
            currentStep: 1,
            tradingMode: 'after_first',

            admin: {
                isKillSwitchActive: false,
                totalUsers: 1, // Self
                platformVolume: 0,
            },

            initialStake: 0.35,
            martingaleMultiplier: 2.1,
            maxMartingaleSteps: 5,
            takeProfit: 10,
            stopLoss: 30,
            stopAfterTotalWins: { enabled: true, value: 50 },
            stopAfterTotalLosses: { enabled: true, value: 50 },
            stopAfterConsecutiveLosses: { enabled: false, value: 5 },
            compoundProfits: false,
            stopOnMaxSteps: true,

            stats: {
                totalTrades: 0,
                won: 0,
                lost: 0,
                winRate: 0,
                totalProfit: 0,
                maxStake: 0,
                currentStep: 1,
            },
            virtualSettings: {
                isVirtualMode: false,

                startVirtualToReal: false,
                vThreshold: 3,
                vTriggerMode: 'consec',
                vTriggerType: 'wins',

                startRealToVirtual: false,
                rThreshold: 2,
                rTriggerMode: 'consec',
                rTriggerType: 'wins',

                virtualWins: 0,
                virtualLosses: 0,
                vConsecWins: 0,
                vConsecLosses: 0,

                realWins: 0,
                realLosses: 0,
                rConsecWins: 0,
                rConsecLosses: 0,

                smartSettings: {
                    enabled: false,
                    type: 'sequence',
                    sequence: {
                        step1Type: 'Wins',
                        step1Qty: 2,
                        step2Type: 'Losses',
                        step2Qty: 2,
                    },
                    alternating: {
                        count: 2,
                    },
                },
                vResultHistory: [],
                vSmartStage: 1,
                vSmartCount: 0,
            },
            recoverySettings: {
                enabled: false,
                lossThreshold: 3,
                winThreshold: 1,
                recoveryMarket: 'R_100',
                recoveryContractType: 'DIGITEVEN',
                recoveryPrediction: 1,
                recoveryStake: 0.35,
                useMartingaleStake: false
            },
            isRecoveryActive: false,
            marketBeforeRecovery: null as string | null,
            tradeLogs: [] as any[],

            isLogOverlayOpen: false,
            isLogOverlayMinimized: false,

            backendStatus: 'disconnected' as any,
            lastBackendMessage: null,

            setBackendStatus: (status: 'connected' | 'disconnected' | 'error' | 'handshaking' | 'authenticating' | 'ready') => set({ backendStatus: status }),
            setIsBackendAuthorized: (isAuthorized: boolean) => set({ isBackendAuthorized: isAuthorized }),
            setLastBackendMessage: (message: any) => set({ lastBackendMessage: message }),
            setStatus: (status: ConnectionStatus) => set({ status, error: status === 'error' ? (get().error || 'WebSocket Error') : null }),
            setToken: (token: string) => {
                const currentToken = get().token;
                if (currentToken === token && token !== '') return;
                get().authorize(token);
            },

            setTriggerStatus: (triggerStatus: string | null) => set({ triggerStatus }),
            setAccount: (account: AccountInfo | null) => set({ account }),
            setMarket: (market: string) => {
                const currentMarket = get().market;
                if (currentMarket === market && get().ticks.length > 0) {
                    // Already on this market and has data, don't reset
                    get().subscribeToMarket(market);
                    return;
                }
                set({ market, isSwitchingMarket: true, ticks: [] });
                get().subscribeToMarket(market);

                // Watchdog
                setTimeout(() => {
                    if (get().isSwitchingMarket) {
                        console.warn('[DerivStore] Market switch watchdog triggered - clearing syncing state');
                        set({ isSwitchingMarket: false });
                    }
                }, 10000);
            },
            setContractType: (contractType: string) => set({ contractType }),
            setPrediction: (prediction: number) => set({ prediction }),
            setManualMarket: (manualMarket: string) => {
                if (typeof window !== 'undefined') localStorage.setItem('lax_manual_market', manualMarket);
                set({ manualMarket });
            },
            setManualContractType: (manualContractType: string) => {
                if (typeof window !== 'undefined') localStorage.setItem('lax_manual_contract_type', manualContractType);
                set({ manualContractType });
            },
            setManualPrediction: (manualPrediction: number) => {
                if (typeof window !== 'undefined') localStorage.setItem('lax_manual_prediction', String(manualPrediction));
                set({ manualPrediction });
            },
            setManualDurationUnit: (manualDurationUnit: string) => {
                if (typeof window !== 'undefined') localStorage.setItem('lax_manual_duration_unit', manualDurationUnit);
                set({ manualDurationUnit });
            },
            setManualDurationValue: (manualDurationValue: number) => {
                if (typeof window !== 'undefined') localStorage.setItem('lax_manual_duration_value', String(manualDurationValue));
                set({ manualDurationValue });
            },
            setManualPositions: (update: any[] | ((prev: any[]) => any[])) => set((state: DerivState) => ({
                manualPositions: typeof update === 'function' ? update(state.manualPositions) : update
            })),
            setSidebarView: (sidebarView: 'markets' | 'logs') => set({ sidebarView }),
            setTradingApp: (tradingApp: 'laxsniper' | 'dtrader') => set({ tradingApp }),
            setTrigger: (type: 'entryDigit' | 'digitPattern', config: any) => set((state: DerivState) => ({
                triggers: {
                    ...state.triggers,
                    [type]: {
                        ...state.triggers[type as keyof DerivState['triggers']],
                        ...config
                    }
                }
            })),
            setTriggerSequence: (sequence: ('virtual' | 'entry' | 'pattern')[]) => set({ triggerSequence: sequence, currentPipelineStep: 0 }),
            setTriggerMode: (mode: 'sequential' | 'simultaneous') => set({ triggerMode: mode, currentPipelineStep: 0 }),
            setPipelineStep: (step: number) => set({ currentPipelineStep: step }),
            setTradePattern: (tradePattern: ('trade' | 'skip')[]) => set({ tradePattern }),
            setCurrentStep: (currentStep: number) => set({ currentStep }),
            setTradingMode: (tradingMode: 'after_first' | 'continuous_check') => set({ tradingMode }),
            toggleKillSwitch: () => set((state: DerivState) => ({
                admin: { ...state.admin, isKillSwitchActive: !state.admin.isKillSwitchActive }
            })),
            setRiskSettings: (settings: Partial<DerivState>) => set((state: DerivState) => ({
                ...state,
                ...settings
            })),
            advanceStep: () => set((state: DerivState) => {
                const nextStep = (state.currentStep % state.tradePattern.length) + 1;
                return {
                    currentStep: nextStep,
                    stats: { ...state.stats, currentStep: nextStep }
                };
            }),

            addTradeLog: (log: any) => set((state: DerivState) => ({
                tradeLogs: [log, ...state.tradeLogs].slice(0, 100)
            })),

            updateTradeLog: (requestId: string, updates: any) => set((state: DerivState) => ({
                tradeLogs: state.tradeLogs.map(log => 
                    log.requestId === requestId ? { ...log, ...updates } : log
                )
            })),

            toggleManualMode: () => {
                const currentState = get();
                currentState.setVirtualSettings({ isVirtualMode: !currentState.virtualSettings.isVirtualMode });
            },

            setTradeLogBackendId: (localId: string, backendId: string) => set((state: DerivState) => {
                const locIdStr = localId?.toString();
                const backIdStr = backendId?.toString();
                return {
                    tradeLogs: state.tradeLogs.map(log => {
                        if (log.requestId?.toString() === locIdStr) {
                            return { ...log, requestId: backIdStr };
                        }
                        return log;
                    })
                };
            }),

            clearLogs: () => {
                tradeEngine.stop(get()); // Reset internal execution state
                set((state: DerivState) => ({
                    tradeLogs: [],
                    stats: {
                        ...state.stats,
                        totalTrades: 0,
                        won: 0,
                        lost: 0,
                        winRate: 0,
                        totalProfit: 0,
                        maxStake: 0,
                        currentStep: 1,
                    },
                    currentStep: 1,
                    currentPipelineStep: 0,
                    triggers: {
                        ...state.triggers,
                        digitPattern: {
                            ...state.triggers.digitPattern,
                            multiEntry: {
                                ...state.triggers.digitPattern.multiEntry,
                                currentIndex: 0
                            }
                        }
                    },
                    virtualSettings: {
                        ...state.virtualSettings,
                        virtualWins: 0,
                        virtualLosses: 0,
                        vConsecWins: 0,
                        vConsecLosses: 0,
                        realWins: 0,
                        realLosses: 0,
                        rConsecWins: 0,
                        rConsecLosses: 0,
                        vResultHistory: [],
                        vSmartStage: 1,
                        vSmartCount: 0
                    }
                }));
            },

            resetStats: () => {
                tradeEngine.stop(get()); // Reset internal execution state
                set((state: DerivState) => ({
                    stats: {
                        ...state.stats,
                        totalTrades: 0,
                        won: 0,
                        lost: 0,
                        winRate: 0,
                        totalProfit: 0,
                        maxStake: 0,
                        currentStep: 1,
                    },
                    currentStep: 1,
                    currentPipelineStep: 0,
                    tradeLogs: [],
                    triggers: {
                        ...state.triggers,
                        digitPattern: {
                            ...state.triggers.digitPattern,
                            multiEntry: {
                                ...state.triggers.digitPattern.multiEntry,
                                currentIndex: 0
                            }
                        }
                    },
                    virtualSettings: {
                        ...state.virtualSettings,
                        virtualWins: 0,
                        virtualLosses: 0,
                        vConsecWins: 0,
                        vConsecLosses: 0,
                        realWins: 0,
                        realLosses: 0,
                        rConsecWins: 0,
                        rConsecLosses: 0,
                        vResultHistory: [],
                        vSmartStage: 1,
                        vSmartCount: 0
                    }
                }));
            },

            setStats: (stats: any) => set({ stats }),

            setLogOverlayOpen: (isLogOverlayOpen: boolean) => set({ isLogOverlayOpen }),
            setLogOverlayMinimized: (isLogOverlayMinimized: boolean) => set({ isLogOverlayMinimized }),
            toggleLogOverlay: () => set((state: DerivState) => ({ isLogOverlayOpen: !state.isLogOverlayOpen })),

            setVirtualSettings: (settings: Partial<DerivState['virtualSettings']>) => set((state: DerivState) => {
                const newVirtualMode = settings.isVirtualMode;
                const isTogglingMode = newVirtualMode !== undefined && newVirtualMode !== state.virtualSettings.isVirtualMode;
                
                let resetSettings: Partial<DerivState['virtualSettings']> = {};
                if (isTogglingMode) {
                    if (newVirtualMode === true) {
                        // Switching TO Virtual - reset Virtual counters
                        resetSettings = {
                            virtualWins: 0,
                            virtualLosses: 0,
                            vConsecWins: 0,
                            vConsecLosses: 0
                        };
                    } else {
                        // Switching TO Real - reset Real counters and transient Virtual history
                        resetSettings = {
                            realWins: 0,
                            realLosses: 0,
                            rConsecWins: 0,
                            rConsecLosses: 0,
                            vResultHistory: [],
                            vSmartStage: 1,
                            vSmartCount: 0
                        };
                    }
                }

                return {
                    virtualSettings: { 
                        ...state.virtualSettings, 
                        ...resetSettings,
                        ...settings 
                    }
                };
            }),

            setRecoverySettings: (settings: Partial<DerivState['recoverySettings']>) => set((state: DerivState) => ({
                recoverySettings: { ...state.recoverySettings, ...settings }
            })),

            toggleRecovery: (isRecoveryActive: boolean) => set((state: DerivState) => {
                if (isRecoveryActive) {
                    // Entering Recovery: Save current market and switch
                    const currentMarket = state.market;
                    const recoveryMarket = state.recoverySettings.recoveryMarket;
                    console.log(`[DerivStore] 🚨 ACTIVATING RECOVERY: Switching Market ${currentMarket} -> ${recoveryMarket}`);

                    // Direct setMarket to ensure subscription and state updates
                    get().setMarket(recoveryMarket);

                    return {
                        isRecoveryActive,
                        marketBeforeRecovery: currentMarket
                    };
                } else {
                    // Exiting Recovery: Revert to original market
                    const originalMarket = state.marketBeforeRecovery || state.market;
                    console.log(`[DerivStore] ✅ RECOVERY COMPLETE: Reverting Market -> ${originalMarket}`);

                    get().setMarket(originalMarket);

                    return {
                        isRecoveryActive,
                        marketBeforeRecovery: null
                    };
                }
            }),

            startBot: () => set((state: DerivState) => ({
                isRunning: true,
                isLogOverlayOpen: state.showLogOverlayOnRun, // Auto-open based on user setting
                currentStep: 1, // Reset on start
                currentPipelineStep: 0,
                virtualSettings: {
                    ...state.virtualSettings,
                    virtualWins: 0,
                    virtualLosses: 0,
                    vConsecWins: 0,
                    vConsecLosses: 0,
                    realWins: 0,
                    realLosses: 0,
                    rConsecWins: 0,
                    rConsecLosses: 0,
                    vResultHistory: [],
                    vSmartStage: 1,
                    vSmartCount: 0
                },
                stats: { ...state.stats, currentStep: 1 },
                triggers: {
                    ...state.triggers,
                    adaptiveEvenOdd: {
                        ...state.triggers.adaptiveEvenOdd,
                        currentSide: state.triggers.adaptiveEvenOdd.initialSide,
                        adaptiveContracts: {
                            ...state.triggers.adaptiveEvenOdd.adaptiveContracts,
                            activeSide: state.triggers.adaptiveEvenOdd.adaptiveContracts?.startSide || 'A'
                        },
                        customPattern: {
                            ...state.triggers.adaptiveEvenOdd.customPattern,
                            currentStepIndex: 0,
                            currentRepeatCount: 0
                        }
                    }
                }
            })),
            stopBot: () => {
                set((state: DerivState) => ({
                    isRunning: false,
                    currentStep: 1,
                    currentPipelineStep: 0,
                    stats: { ...state.stats, currentStep: 1 }
                }));
                tradeEngine.stop(get());
            },

            addTick: (tick: TickData) => set((state: DerivState) => {
                // Symbol Guard
                if (tick.symbol !== state.market) {
                    return state;
                }

                // Timestamp Guard
                if (state.lastTick && tick.epoch === state.lastTick.epoch && tick.quote === state.lastTick.quote) {
                    return state;
                }

                // Extract Digit
                // Extract Digit (Robust Strategy provided by User)
                const precision = (tick.pip_size !== undefined && tick.pip_size > 0 && tick.pip_size < 1)
                    ? Math.abs(Math.round(Math.log10(1 / tick.pip_size)))
                    : (tick.pip_size || ticksToDecimals(state.market));
                const priceString = tick.quote.toFixed(precision);
                const digit = parseInt(priceString.charAt(priceString.length - 1), 10);

                // console.log(`[DerivStore] Tick: ${tick.quote} (${precision}) -> ${digit}`);

                const newTicks = state.ticks.slice(-99);
                newTicks.push(digit);

                const newPriceHistory = state.priceHistory ? state.priceHistory.slice(-99) : [];
                const newRfHistory = state.rfHistory ? state.rfHistory.slice(-99) : [];

                if (newPriceHistory.length > 0) {
                    const prevPrice = newPriceHistory[newPriceHistory.length - 1];
                    const signal: 'R' | 'F' = tick.quote > prevPrice ? 'R' : 'F';
                    newRfHistory.push(signal);
                }
                newPriceHistory.push(tick.quote);

                // Notify Trade Engine synchronously
                tradeEngine.onTick(tick, state); // PASSING STATE HERE

                // Console log to debug UI issue
                if (['1HZ15V', '1HZ30V', '1HZ90V'].includes(tick.symbol)) {
                    // console.log(`[DerivStore] ADDED TICK: ${tick.symbol} D:${digit} L:${newTicks.length}`);
                }

                return {
                    lastTick: tick,
                    lastTickReceived: Date.now(),
                    totalTicksReceived: state.totalTicksReceived + 1,
                    ticks: newTicks,
                    priceHistory: newPriceHistory,
                    rfHistory: newRfHistory,
                    isSwitchingMarket: false
                };
            }),

            connect: () => {
                const { status } = get();
                // Only skip if truly already connected AND fully initialized
                if (status === 'connected' && (get() as any).isInitialized) {
                    // Even if main is connected, ensure backend is triggered
                    if (backendWS.isConnected === false) backendWS.connect();
                    return;
                }

                if (!(get() as any).isInitialized) {
                    (set as any)({ isInitialized: true });

                    // Cleanup: Clear old callbacks from global sockets
                    derivWS.clearCallbacks();
                    tradeWS.clearListeners();

                    // Initialize DerivWS and Trade Engine with store access (AFTER cleanup)
                    derivWS.init(get);
                    tradeEngine.init(get, set);

                    derivWS.onStatusChange((status: ConnectionStatus) => {
                        const previousStatus = get().status;
                        set({ status });
                        if (status === 'disconnected' || status === 'error') {
                            // NOTE: Do NOT clear account here — we need the loginid to persist
                            // so that getUrl() can fetch the correct OTP on reconnect.
                            set({ isSwitchingMarket: false });
                            if (status === 'error') {
                                set({ error: 'Connection lost. Auto-reconnecting...' });
                            }
                        }
                        if (status === 'connected' && previousStatus !== 'connected') {
                            const state = get();
                            // Only auto-auth if we don't already have a connected account
                            if (state.token && !state.account) {
                                const storedToken = typeof window !== 'undefined' ? localStorage.getItem('deriv_token') : null;
                                if (storedToken) {
                                    get().authorize(storedToken);
                                    return; // authorize will subscribe to market after connecting
                                }
                            }
                            // Subscribe to market ticks once connected
                            if (state.market) {
                                get().subscribeToMarket(state.market);
                            }
                        }
                    });

                    derivWS.onMessage((message: DerivMessage) => {
                        // 1. Handle Errors First
                        if (message.error) {
                            // WrongResponse on authorize is expected when the public Options API
                            // endpoint receives a raw API token authorize frame — suppress silently.
                            const isExpectedError =
                                message.error.code === 'AlreadySubscribed' ||
                                message.msg_type === 'ticks_history' ||
                                (message.msg_type === 'authorize' && message.error.code === 'WrongResponse');

                            if (isExpectedError) {
                                // Silent suppression
                            } else {
                                console.error('[DerivStore] Full Error Message:', JSON.stringify(message, null, 2));

                                if (message.msg_type === 'authorize') {
                                    const errorMsg = message.error.message || message.error.code || 'Unknown Auth Error';
                                    set({
                                        error: `Auth Error: ${errorMsg}`,
                                        debugInfo: message,
                                        status: 'error',
                                        account: null
                                    });
                                }
                            }
                            return;
                        }

                        // 2. Success Conditionals
                        if (message.msg_type === 'ping' || message.msg_type === 'pong' || message.ping === 'pong') {
                            set({ rtt: derivWS.getLatency() });
                            return;
                        }

                        if (message.msg_type === 'authorize' && message.authorize) {
                            const { balance, currency, loginid, email, account_list } = message.authorize;
                            const balanceNum = parseFloat(balance || '0');

                            const accounts = get().accounts;
                            let newAccounts = [...accounts];

                            // Map account_list from Auth 2.0 response
                            if (account_list && Array.isArray(account_list)) {
                                newAccounts = account_list.map((acc: any) => ({
                                    token: acc.token || get().token, // In Auth 2.0, use the same access_token if acc.token is missing
                                    loginid: acc.loginid,
                                    currency: acc.currency || 'USD',
                                    balance: acc.loginid === loginid ? balanceNum : 0,
                                    is_virtual: acc.is_virtual === 1 || String(acc.loginid).startsWith('VRTC') || String(acc.loginid).includes('VR')
                                }));
                            }

                            set({
                                account: {
                                    balance: isNaN(balanceNum) ? 0 : balanceNum,
                                    currency: currency || 'USD',
                                    loginid,
                                    email
                                },
                                accounts: newAccounts.length > 0 ? newAccounts : accounts,
                                error: null,
                                status: 'connected'
                            });

                            if (typeof window !== 'undefined' && get().token) {
                                localStorage.setItem('deriv_token', get().token);
                            }
                            const state = get();
                            if (state.market) {
                                derivWS.subscribeTicks(state.market);
                            }
                            // Subscribe to real-time balance updates separately
                            derivWS.send({ balance: 1, subscribe: 1 });
                            return;
                        }

                        if (message.msg_type === 'tick' && message.tick) {
                            get().addTick(message.tick);
                            return;
                        }

                        if (message.msg_type === 'balance' && message.balance) {
                            set((state: DerivState) => ({
                                account: state.account ? { ...state.account, balance: typeof message.balance.balance === 'number' ? message.balance.balance : parseFloat(message.balance.balance) || 0 } : null
                            }));
                            return;
                        }
                    });

                    setInterval(() => {
                        const state = get();
                        if (state.status === 'disconnected' && (state as any).isInitialized) {
                            console.log('[DerivStore] Watchdog: Detected hung disconnected state. Retrying...');
                            derivWS.connect();
                            tradeWS.connect();
                            backendWS.connect();
                        }
                    }, 15000);
                }

                // These should run every time connect() is called if they are not already active
                derivWS.connect();
                tradeWS.connect();
                backendWS.connect();
            },

            disconnect: () => {
                derivWS.disconnect();
                tradeWS.disconnect();
                backendWS.disconnect(); // Disconnect backend WS too
                if (typeof window !== 'undefined') {
                    localStorage.removeItem('deriv_token');
                }
                set({
                    status: 'disconnected',
                    account: null,
                    token: '',
                    error: null,
                    isTradeAuthorized: false,
                    tradeWsStatus: 'disconnected',
                    backendStatus: 'disconnected'
                });
            },

            forceReconnect: () => {
                console.log('[DerivStore] Manually triggering force reconnect...');
                derivWS.disconnect();
                backendWS.disconnect(); // Disconnect backend WS too
                set({ status: 'disconnected', error: null });
                setTimeout(() => get().connect(), 500);
            },

            authorize: async (token: string, allAccounts?: AccountInfo[]) => {
                console.log('[DerivStore] Unified Authorize -> Forcing Hard Reset...');

                // 1. Safety: Stop Bot instantly
                get().stopBot();

                // 2. Kill ALL existing sessions including derivWS so we reconnect fresh
                //    with the correct OTP-authenticated URL for the new token.
                tradeWS.disconnect();
                const { backendWS } = await import('../lib/backend-ws');
                backendWS.disconnect();
                derivWS.disconnect(); // Must disconnect so connect() re-fetches OTP URL

                // Reset isInitialized so connect() re-registers all handlers fresh
                (set as any)({ isInitialized: false });
                
                // 3. Resolve accounts
                let resolvedAccounts = allAccounts;
                if (!resolvedAccounts || resolvedAccounts.length === 0) {
                    console.log('[DerivStore] Fetching accounts for token via REST...');
                    const fetched = await fetchAccounts(token);
                    resolvedAccounts = fetched.map(a => ({
                        loginid: a.account_id || a.loginid,
                        currency: a.currency,
                        balance: typeof a.balance === 'number' ? a.balance : parseFloat(a.balance || '0') || 0,
                        is_virtual: !!(a.account_type === 'demo' || a.is_virtual || String(a.account_id || a.loginid).startsWith('VRTC') || String(a.account_id || a.loginid).includes('VR'))
                    }));
                }

                if (!resolvedAccounts || resolvedAccounts.length === 0) {
                    set({ error: 'Failed to retrieve accounts. Check your token.', status: 'error' });
                    return;
                }

                const defaultAccount = resolvedAccounts.find(a => a.is_virtual) || resolvedAccounts[0];

                // 4. Clear state for fresh start
                set({
                    token,
                    account: defaultAccount,
                    accounts: resolvedAccounts,
                    status: 'connecting',
                    error: null,
                    debugInfo: null,
                    isTradeAuthorized: false,
                    tradeWsStatus: 'disconnected',
                    backendStatus: 'disconnected',
                    isBackendAuthorized: false
                });

                // 5. Persistence
                if (typeof window !== 'undefined' && token) {
                    localStorage.setItem('deriv_token', token);
                }

                // 6. Give the old sockets ~200ms to fully close, then reconnect everything
                //    via store's connect() so handlers (onStatusChange, onMessage) are registered.
                console.log('[DerivStore] Connecting all trading channels...');
                setTimeout(() => {
                    get().connect();
                    setTimeout(() => {
                        tradeWS.connect();
                        backendWS.connect();
                    }, 300);
                }, 200);
            },

            switchAccount: (loginid: string) => {
                const { accounts, token } = get();
                const targetAccount = accounts.find((a: AccountInfo) => a.loginid === loginid);
                if (targetAccount && token) {
                    console.log(`[DerivStore] Switching to account: ${loginid}`);
                    get().stopBot();
                    // Disconnect all sockets first
                    tradeWS.disconnect();
                    derivWS.disconnect();
                    import('../lib/backend-ws').then(({ backendWS }) => {
                        backendWS.disconnect();
                        // Reset init flag so connect() re-registers handlers with new account context
                        (set as any)({ isInitialized: false });
                        set({
                            account: targetAccount,
                            status: 'connecting',
                            isTradeAuthorized: false,
                            tradeWsStatus: 'disconnected',
                            backendStatus: 'disconnected',
                            isBackendAuthorized: false
                        });
                        setTimeout(() => {
                            get().connect(); // re-registers handlers + fetches new OTP URL
                            setTimeout(() => {
                                tradeWS.connect();
                                backendWS.connect();
                            }, 300);
                        }, 300);
                    });
                }
            },

            setTradeWsStatus: (tradeWsStatus: ConnectionStatus) => set({ tradeWsStatus }),
            setTradeAuthorized: (isTradeAuthorized: boolean) => set({ isTradeAuthorized }),
            setExecutionMode: (executionMode: 'fast' | 'standard') => set({ executionMode, activeProposal: null }),
            setActiveProposal: (stake: string, proposal: { id: string; askPrice: string; receivedAt: number; symbol: string } | null) => set((state: DerivState) => {
                const currentProposals = state.activeProposal || {};
                if (!proposal) {
                    if (!stake) return { activeProposal: null };
                    const newProposals = { ...currentProposals };
                    delete newProposals[stake];
                    return { activeProposal: Object.keys(newProposals).length > 0 ? newProposals : null };
                }
                return { 
                    activeProposal: { 
                        ...currentProposals, 
                        [stake]: {
                            ...proposal,
                            symbol: state.market // Ensure symbol awareness
                        } 
                    } 
                };
            }),
            updateTradeMetrics: (metrics: Partial<DerivState['tradeMetrics']>) => set((state: DerivState) => ({
                tradeMetrics: { ...state.tradeMetrics, ...metrics }
            })),

            subscribeToMarket: (symbol: string) => {
                const { status } = get();

                console.log(`[DerivStore] Requesting Market Switch: ${symbol}`);

                // 1. Subscribe Direct (DerivWS)
                if (status === 'connected') {
                    derivWS.subscribeTicks(symbol);
                    // Guard: only fetch history if socket is genuinely OPEN
                    const fetchHistory = () => {
                        derivWS.getTickHistory(symbol, 100).then((res: any) => {
                            if (res && res.history && res.history.prices) {
                                const rawPipSize = res.pip_size;
                                let decimals = 2;
                                if (rawPipSize !== undefined && rawPipSize > 0 && rawPipSize < 1) {
                                    decimals = Math.abs(Math.round(Math.log10(1 / rawPipSize)));
                                } else if (res.history.prices && res.history.prices.length > 0) {
                                    let maxDecimals = 0;
                                    for (let i = 0; i < Math.min(res.history.prices.length, 100); i++) {
                                        const str = res.history.prices[i].toString();
                                        if (str.includes('.')) {
                                            maxDecimals = Math.max(maxDecimals, str.split('.')[1].length);
                                        }
                                    }
                                    decimals = maxDecimals || ticksToDecimals(symbol);
                                } else {
                                    decimals = ticksToDecimals(symbol);
                                }
                                
                                const factor = Math.pow(10, decimals);
                                const historyDigits = res.history.prices.map((price: number) => {
                                    const roundedPrice = Math.round(price * factor) / factor;
                                    const priceStr = roundedPrice.toFixed(decimals);
                                    const digit = parseInt(priceStr.charAt(priceStr.length - 1), 10);
                                    return isNaN(digit) ? 0 : digit;
                                });
                                const currentState = get();
                                if (currentState.market === symbol) {
                                    set({ ticks: historyDigits });
                                }
                            }
                        }).catch((err: any) => console.warn('[DerivStore] History fetch failed (will retry on reconnect):', err));
                    };
                    fetchHistory();

                }

                // 2. Request via Backend (Execution Engine)
                import('../lib/backend-ws').then(({ backendWS }) => {
                    backendWS.subscribeToMarket(symbol);
                });
            },

            resetTicks: () => set({ ticks: [], lastTick: null, priceHistory: [], rfHistory: [] }),

            setAppId: (id: string) => {
                console.log(`[DerivStore] Manually switching App ID to: ${id}`);
                derivWS.setAppId(id);
            },

            toggleAdaptiveSide: () => set((state: DerivState) => {
                const config = state.triggers.adaptiveEvenOdd;
                if (config.advancedEnabled) {
                    if (config.mode === 'adaptive_contracts') {
                        const activeSide = config.adaptiveContracts?.activeSide || 'A';
                        const nextActiveSide = activeSide === 'A' ? 'B' : 'A';
                        return {
                            triggers: {
                                ...state.triggers,
                                adaptiveEvenOdd: {
                                    ...config,
                                    adaptiveContracts: {
                                        ...config.adaptiveContracts,
                                        activeSide: nextActiveSide
                                    }
                                }
                            }
                        };
                    }
                    if (config.mode === 'custom_pattern') {
                        const pattern = config.customPattern || { steps: [], currentStepIndex: 0, currentRepeatCount: 0 };
                        const steps = pattern.steps || [];
                        if (steps.length === 0) return {};
                        const nextStepIndex = ((pattern.currentStepIndex || 0) + 1) % steps.length;
                        return {
                            triggers: {
                                ...state.triggers,
                                adaptiveEvenOdd: {
                                    ...config,
                                    customPattern: {
                                        ...pattern,
                                        currentStepIndex: nextStepIndex,
                                        currentRepeatCount: 0
                                    }
                                }
                            }
                        };
                    }
                }

                const { currentSide } = config;
                let nextSide = currentSide;

                if (currentSide === 'Even') nextSide = 'Odd';
                else if (currentSide === 'Odd') nextSide = 'Even';
                else if (currentSide === 'Over') nextSide = 'Under';
                else if (currentSide === 'Under') nextSide = 'Over';

                return {
                    triggers: {
                        ...state.triggers,
                        adaptiveEvenOdd: {
                            ...state.triggers.adaptiveEvenOdd,
                            currentSide: nextSide
                        }
                    }
                };
            }),

            updateAdaptiveState: (isWin: boolean) => set((state: DerivState) => {
                const config = state.triggers.adaptiveEvenOdd;
                if (!config.enabled) return {};

                if (!config.advancedEnabled) {
                    if (isWin) return {};
                    const { currentSide } = config;
                    let nextSide = currentSide;
                    if (currentSide === 'Even') nextSide = 'Odd';
                    else if (currentSide === 'Odd') nextSide = 'Even';
                    else if (currentSide === 'Over') nextSide = 'Under';
                    else if (currentSide === 'Under') nextSide = 'Over';
                    return {
                        triggers: {
                            ...state.triggers,
                            adaptiveEvenOdd: {
                                ...config,
                                currentSide: nextSide
                            }
                        }
                    };
                }

                if (config.mode === 'adaptive_contracts') {
                    if (isWin) return {};
                    const activeSide = config.adaptiveContracts?.activeSide || 'A';
                    const nextActiveSide = activeSide === 'A' ? 'B' : 'A';
                    return {
                        triggers: {
                            ...state.triggers,
                            adaptiveEvenOdd: {
                                ...config,
                                adaptiveContracts: {
                                    ...config.adaptiveContracts,
                                    activeSide: nextActiveSide
                                }
                            }
                        }
                    };
                }

                if (config.mode === 'custom_pattern') {
                    const pattern = config.customPattern || { steps: [], currentStepIndex: 0, currentRepeatCount: 0 };
                    const steps = pattern.steps || [];
                    if (steps.length === 0) return {};

                    let nextRepeatCount = (pattern.currentRepeatCount || 0) + 1;
                    let nextStepIndex = pattern.currentStepIndex || 0;
                    const currentStep = steps[nextStepIndex];

                    if (nextRepeatCount >= (currentStep?.repeats || 1)) {
                        nextRepeatCount = 0;
                        nextStepIndex = (nextStepIndex + 1) % steps.length;
                    }

                    return {
                        triggers: {
                            ...state.triggers,
                            adaptiveEvenOdd: {
                                ...config,
                                customPattern: {
                                    ...pattern,
                                    currentStepIndex: nextStepIndex,
                                    currentRepeatCount: nextRepeatCount
                                }
                            }
                        }
                    };
                }

                return {};
            }),

            getActiveAdaptiveContract: () => {
                const state = get();
                const config = state.triggers?.adaptiveEvenOdd;
                const isDTrader = state.tradingApp === 'dtrader';
                const baseContractType = isDTrader ? state.manualContractType : state.contractType;
                const basePrediction = isDTrader ? (state.manualPrediction !== undefined ? state.manualPrediction : state.prediction) : state.prediction;

                if (!config?.enabled) {
                    return { type: baseContractType, prediction: basePrediction };
                }

                if (!config.advancedEnabled) {
                    const side = config.currentSide;
                    let type = baseContractType;
                    if (['CALL', 'PUT'].includes(type)) {
                        if (side === 'Over' || side === 'Even') type = 'CALL';
                        else if (side === 'Under' || side === 'Odd') type = 'PUT';
                    } else {
                        if (side === 'Even') type = 'DIGITEVEN';
                        else if (side === 'Odd') type = 'DIGITODD';
                        else if (side === 'Over') type = 'DIGITOVER';
                        else if (side === 'Under') type = 'DIGITUNDER';
                        else if (side === 'Rise') type = 'CALL';
                        else if (side === 'Fall') type = 'PUT';
                        else if (side === 'Higher') type = 'CALL_HIGHER';
                        else if (side === 'Lower') type = 'CALL_LOWER';
                    }
                    return { type, prediction: basePrediction };
                }

                if (config.mode === 'adaptive_contracts') {
                    const activeSide = config.adaptiveContracts?.activeSide || 'A';
                    const contract = activeSide === 'A' ? config.adaptiveContracts?.contractA : config.adaptiveContracts?.contractB;
                    return {
                        type: contract?.type || 'DIGITUNDER',
                        prediction: contract?.prediction !== undefined ? contract.prediction : 4
                    };
                }

                if (config.mode === 'custom_pattern') {
                    const steps = config.customPattern?.steps || [];
                    const stepIndex = config.customPattern?.currentStepIndex || 0;
                    const step = steps[stepIndex] || { type: 'DIGITEVEN', prediction: 0 };
                    return { type: step.type, prediction: step.prediction };
                }

                return { type: baseContractType, prediction: basePrediction };
            },

            updateTriggers: (updates: Partial<DerivState['triggers']>) => set((state: DerivState) => ({
                triggers: {
                    ...state.triggers,
                    ...updates
                }
            })),
            setShowQuickControls: (show: boolean) => set({ showQuickControls: show }),
            setQuickSwitchVirtualBehavior: (behavior: 'continue_virtual' | 'override_to_real') => set({ quickSwitchVirtualBehavior: behavior }),
            setShowLogOverlayOnRun: (show: boolean) => set({ showLogOverlayOnRun: show }),
            setMultiEntryIndex: (index: number) => set((state: DerivState) => ({
                triggers: {
                    ...state.triggers,
                    digitPattern: {
                        ...state.triggers.digitPattern,
                        multiEntry: {
                            ...state.triggers.digitPattern.multiEntry,
                            currentIndex: index
                        }
                    }
                }
            })),
        }),
        {
            name: 'deriv-store',
            version: 7, // Bump version to clear/migrate old storage data
            storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : {
                getItem: () => null,
                setItem: () => { },
                removeItem: () => { },
            })),
            migrate: (persistedState: any, version: number) => {
                let state = persistedState;
                if (version < 6) {
                    console.log("[DerivStore] 🔄 Migrating state to version 6 (Smart Switch support)");
                    state = {
                        ...state,
                        virtualSettings: {
                            ...state.virtualSettings,
                            smartSettings: state.virtualSettings?.smartSettings || {
                                enabled: false,
                                type: 'sequence',
                                sequence: {
                                    step1Type: 'Wins',
                                    step1Qty: 2,
                                    step2Type: 'Losses',
                                    step2Qty: 2,
                                },
                                alternating: {
                                    count: 2,
                                },
                            },
                            vResultHistory: state.virtualSettings?.vResultHistory || [],
                            vSmartStage: state.virtualSettings?.vSmartStage || 1,
                            vSmartCount: state.virtualSettings?.vSmartCount || 0
                        }
                    };
                }
                if (version < 7) {
                    console.log("[DerivStore] 🔄 Migrating state to version 7 (Advanced Adaptive Switch & Recovery options)");
                    state = {
                        ...state,
                        recoverySettings: {
                            enabled: false,
                            lossThreshold: 3,
                            winThreshold: 1,
                            recoveryMarket: 'R_100',
                            recoveryContractType: 'DIGITEVEN',
                            recoveryPrediction: 1,
                            recoveryStake: 0.35,
                            useMartingaleStake: false,
                            ...state.recoverySettings
                        },
                        triggers: {
                            ...state.triggers,
                            adaptiveEvenOdd: {
                                enabled: false,
                                currentSide: 'Even',
                                initialSide: 'Even',
                                showAdvancedSettings: false,
                                advancedEnabled: false,
                                mode: 'adaptive_contracts',
                                adaptiveContracts: {
                                    contractA: { type: 'DIGITUNDER', prediction: 4 },
                                    contractB: { type: 'DIGITOVER', prediction: 5 },
                                    activeSide: 'A',
                                    startSide: 'A'
                                },
                                customPattern: {
                                    steps: [
                                        { type: 'DIGITEVEN', prediction: 0, repeats: 2 },
                                        { type: 'DIGITODD', prediction: 0, repeats: 2 }
                                    ],
                                    currentStepIndex: 0,
                                    currentRepeatCount: 0
                                },
                                ...state.triggers?.adaptiveEvenOdd
                            }
                        }
                    };
                }
                return state;
            },
            partialize: (state: DerivState) => ({
                token: state.token,
                market: state.market,
                contractType: state.contractType,
                prediction: state.prediction,
                triggerSequence: state.triggerSequence,
                triggerMode: state.triggerMode,
                initialStake: state.initialStake,
                martingaleMultiplier: state.martingaleMultiplier,
                maxMartingaleSteps: state.maxMartingaleSteps,
                takeProfit: state.takeProfit,
                stopLoss: state.stopLoss,
                stopAfterTotalWins: state.stopAfterTotalWins,
                stopAfterConsecutiveLosses: state.stopAfterConsecutiveLosses,
                compoundProfits: state.compoundProfits,
                stopOnMaxSteps: state.stopOnMaxSteps,
                triggers: state.triggers,
                tradePattern: state.tradePattern,
                tradingMode: state.tradingMode,
                virtualSettings: state.virtualSettings,
                recoverySettings: state.recoverySettings,
                showQuickControls: state.showQuickControls,
                quickSwitchVirtualBehavior: state.quickSwitchVirtualBehavior,
                showLogOverlayOnRun: state.showLogOverlayOnRun
            })
        }
    )
);


// Export the store
// (Cleanup: removed top-level init calls to prevent SSR crashes)
