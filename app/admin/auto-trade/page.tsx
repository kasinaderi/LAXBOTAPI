'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Toggle } from '@/components/ui/Toggle';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import {
    Cpu, ShieldAlert, Play, Square, TrendingUp, Activity,
    Clock, TrendingDown, Zap, BookOpen, Plus, Trash2,
    GitMerge, Shuffle, Layers, BarChart3, RefreshCw,
    Check, X, Minus, Search, Filter, Eye, Settings2,
    Target, ChevronRight, ArrowLeftRight, AlertTriangle, FlaskConical,
    Copy, ArrowUp, ArrowDown, Repeat, Timer, ChevronDown, Sliders, Sparkles
} from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { usePageSettings } from '@/store/usePageSettings';
import { useScannerStore } from '@/store/useScannerStore';
import { useBotStore } from '@/store/useBotStore';
import { ticksToDecimals } from '@/lib/deriv/constants';
import { tradeEngine } from '@/lib/deriv/trade-engine';
import { tradeWS } from '@/lib/deriv/trade-ws';

// ── Snapshot field lists (mirrors usePageSettings.ts) ──────────────────────
// Used by LaxPrime/Sniper Sync preset to read saved-settings snapshots.
const SYNC_DERIV_FIELDS = [
    'market','contractType','prediction','triggerSequence','triggerMode',
    'initialStake','martingaleMultiplier','maxMartingaleSteps','takeProfit','stopLoss',
    'stopAfterTotalWins','stopAfterConsecutiveLosses','compoundProfits','stopOnMaxSteps',
    'triggers','tradePattern','tradingMode','virtualSettings','recoverySettings',
    'showQuickControls','quickSwitchVirtualBehavior','showLogOverlayOnRun',
] as const;

const SYNC_BOT_FIELDS = [
    'stake','targetProfit','targetProfitMode','stopLoss','stopLossMode',
    'martingale','tradingMode','strategies','selectedMarkets','crossMarketDelay','adaptiveSwitch',
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PlaylistTradeStep {
    id: string;
    delayMinutes: number;           // Delay in minutes to wait AFTER previous trade settles (0 = immediate)
    source: 'laxprime' | 'laxsniper-xv'; // Which engine/rules to load
    label?: string;                 // e.g. "Step 1"
    marketOverride?: string;        // Optional override (e.g. 'R_100', '1HZ100V', etc.)
    contractOverride?: ContractTypeKey | ''; // Optional override
    digitOverride?: number | null;  // Optional prediction override (0-9)
}

type ContractTypeKey =
    | 'CALL' | 'PUT'
    | 'DIGITEVEN' | 'DIGITODD'
    | 'DIGITDIFF' | 'DIGITMATCH'
    | 'DIGITOVER' | 'DIGITUNDER';

type TriggerMode = 'sequential' | 'simultaneous';
type ContinuousMode = 'after_first' | 'continuous_check';
type PatternBoxType = 'E' | 'O' | 'D' | 'M' | 'V' | 'U' | 'SE' | 'SO';

interface PipelineStep {
    id: string;
    contractType: ContractTypeKey;
    prediction: number;
    reps: number;
}

interface DigitPatternBox {
    id: string;
    type: PatternBoxType;
    digit: number;
    contractType: ContractTypeKey;
}

interface AutoLXTradeRecord {
    id: string;
    time: string;
    market: string;
    contractType: string;
    entrySpot: string;
    exitDigit: number | null;
    stake: number;
    profit: number;
    result: 'WIN' | 'LOSS' | 'PENDING';
    isVirtual?: boolean;
}

interface AuditLog {
    time: string;
    message: string;
    type: 'info' | 'success' | 'warn' | 'error';
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const CONTRACT_OPTIONS = [
    { value: 'CALL',        label: 'Rise (CALL)' },
    { value: 'PUT',         label: 'Fall (PUT)' },
    { value: 'DIGITEVEN',   label: 'Even' },
    { value: 'DIGITODD',    label: 'Odd' },
    { value: 'DIGITDIFF',   label: 'Differs' },
    { value: 'DIGITMATCH',  label: 'Matches' },
    { value: 'DIGITOVER',   label: 'Over' },
    { value: 'DIGITUNDER',  label: 'Under' },
];

const PATTERN_ALL_TYPES: PatternBoxType[] = ['E', 'O', 'D', 'M', 'V', 'U', 'SE', 'SO'];

const PATTERN_LABELS: Record<PatternBoxType, string> = {
    E: 'Even', O: 'Odd', D: 'Differs', M: 'Matches',
    V: 'Over', U: 'Under', SE: 'Same Even', SO: 'Same Odd',
};

const PATTERN_BG: Record<PatternBoxType, string> = {
    E:  'bg-teal-500 shadow-teal-500/30',
    O:  'bg-rose-500 shadow-rose-500/30',
    D:  'bg-indigo-500 shadow-indigo-500/30',
    M:  'bg-amber-500 shadow-amber-500/30',
    V:  'bg-emerald-500 shadow-emerald-500/30',
    U:  'bg-purple-500 shadow-purple-500/30',
    SE: 'bg-cyan-500 shadow-cyan-500/30',
    SO: 'bg-pink-500 shadow-pink-500/30',
};

const PATTERN_DOT: Record<PatternBoxType, string> = {
    E: 'bg-teal-400', O: 'bg-rose-400', D: 'bg-indigo-400', M: 'bg-amber-400',
    V: 'bg-emerald-400', U: 'bg-purple-400', SE: 'bg-cyan-400', SO: 'bg-pink-400',
};

const TARGET_MARKETS = [
    { value: 'R_10',    label: 'Volatility 10 Index' },
    { value: 'R_25',    label: 'Volatility 25 Index' },
    { value: 'R_50',    label: 'Volatility 50 Index' },
    { value: 'R_75',    label: 'Volatility 75 Index' },
    { value: 'R_100',   label: 'Volatility 100 Index' },
    { value: '1HZ10V',  label: 'Vol 10 (1s) Index' },
    { value: '1HZ15V',  label: 'Vol 15 (1s) Index' },
    { value: '1HZ25V',  label: 'Vol 25 (1s) Index' },
    { value: '1HZ30V',  label: 'Vol 30 (1s) Index' },
    { value: '1HZ50V',  label: 'Vol 50 (1s) Index' },
    { value: '1HZ75V',  label: 'Vol 75 (1s) Index' },
    { value: '1HZ90V',  label: 'Vol 90 (1s) Index' },
    { value: '1HZ100V', label: 'Vol 100 (1s) Index' },
];

const uid = () => Math.random().toString(36).slice(2, 9);
const getLastDigit = (price: number, market: string) => {
    const decimals = ticksToDecimals(market);
    const s = price.toFixed(decimals);
    return parseInt(s[s.length - 1], 10);
};

const getTopAlternatingPairAndCount = (digits: number[]) => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < digits.length - 1; i++) {
        const d1 = digits[i];
        const d2 = digits[i + 1];
        if (d1 === d2) continue; // must be two different digits alternating
        const key = d1 < d2 ? `${d1},${d2}` : `${d2},${d1}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    let maxCount = 0;
    let bestPair: [number, number] = [4, 5]; // fallback default
    for (const [key, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            const [a, b] = key.split(',').map(Number);
            bestPair = [a, b];
        }
    }
    return { pair: bestPair, count: maxCount };
};

const getTopOddPair = (digits: number[]) => {
    const counts: Record<number, number> = { 1: 0, 3: 0, 5: 0, 7: 0, 9: 0 };
    digits.forEach(d => {
        if (d % 2 !== 0) {
            counts[d] = (counts[d] || 0) + 1;
        }
    });
    const sorted = [1, 3, 5, 7, 9].sort((a, b) => counts[b] - counts[a]);
    const pair: [number, number] = [sorted[0], sorted[1]];
    const count = counts[sorted[0]] + counts[sorted[1]];
    return { pair, count };
};

const RATING_CLS = {
    EXCELLENT: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    GOOD:      'text-teal-400 bg-teal-500/10 border-teal-500/30',
    NEUTRAL:   'text-gray-400 bg-white/5 border-white/10',
    AVOID:     'text-rose-400 bg-rose-500/10 border-rose-500/30',
};

const DEFAULT_PLAYLIST_STEPS: PlaylistTradeStep[] = [
    { id: 'step-1', delayMinutes: 0,  source: 'laxprime', label: 'Step 1 (Immediate)' },
    { id: 'step-2', delayMinutes: 7,  source: 'laxprime', label: 'Step 2 (+7m delay)' },
    { id: 'step-3', delayMinutes: 15, source: 'laxprime', label: 'Step 3 (+15m delay)' },
    { id: 'step-4', delayMinutes: 6,  source: 'laxprime', label: 'Step 4 (+6m delay)' },
];

const QUICK_DELAY_OPTIONS = [1, 2, 3, 5, 7, 10, 15, 20, 30];

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function AutoTradePage() {
    // ── Store ──────────────────────────────────────────────────────────────
    const {
        account, accounts,
        status: tradingStatus,
        isRunning: isEngineRunning,
        startBot, stopBot,
        setMarket, subscribeToMarket, setContractType, setPrediction,
        setRiskSettings,
        tradeLogs,
        virtualSettings, setVirtualSettings,
        setPipelineMode: setStorePipelineMode,
        setPipelineSteps: setStorePipelineSteps,
        setTrigger,
        setTradePattern: setStoreTradePattern,
        setTradingMode: setStoreTradingMode,
    } = useDerivStore();

    // Isolate this page's settings from all other trading pages.
    // Stake, martingale, triggers, trade pattern, virtual/recovery settings
    // and trade logs are all stored under the 'auto-trade' namespace.
    usePageSettings('auto-trade');
    const { marketRegimes, signals, ensureScanner, startScanning, stopScanning, activeCount } = useScannerStore();

    // ── Admin Guard ────────────────────────────────────────────────────────
    const ADMIN_IDS = [
        (process.env.NEXT_PUBLIC_ADMIN_LOGINID || 'DOT93428953').toUpperCase().trim(),
        'ROT92069817',
    ];
    const isAuthorized =
        accounts.some(a => ADMIN_IDS.includes(a.loginid.toUpperCase())) ||
        ADMIN_IDS.includes(account?.loginid?.toUpperCase() ?? '');

    // ── UI Tabs ────────────────────────────────────────────────────
    const [activeTab,    setActiveTab]    = useState<'strategy' | 'triggers' | 'risk' | 'markets' | 'virtual'>('strategy');
    const [activeLogTab, setActiveLogTab] = useState<'trades' | 'audit'>('trades');

    // ── Pipeline ───────────────────────────────────────────────────────────
    const [pipelineSteps,    setPipelineSteps]    = useState<PipelineStep[]>([
        { id: uid(), contractType: 'DIGITDIFF', prediction: 4, reps: 1 },
        { id: uid(), contractType: 'DIGITDIFF', prediction: 5, reps: 1 },
    ]);
    const [pipelineMode,     setPipelineMode]     = useState<TriggerMode>('sequential');
    const [adaptiveSwitch,   setAdaptiveSwitch]   = useState(true);
    const [curStep,          setCurStep]          = useState(0);
    const [curRep,           setCurRep]           = useState(0);

    // ── Entry Digit ────────────────────────────────────────────────────────
    const [entryDigitEnabled, setEntryDigitEnabled] = useState(true);
    const [entryDigits,       setEntryDigits]       = useState<number[]>([4, 5]);
    const [instantTrigger,    setInstantTrigger]    = useState(true);

    // ── Digit Pattern ──────────────────────────────────────────────────────
    const [digitPatternEnabled, setDigitPatternEnabled] = useState(false);
    const [patternBoxes,        setPatternBoxes]        = useState<DigitPatternBox[]>([
        { id: uid(), type: 'U', digit: 7, contractType: 'DIGITUNDER' },
        { id: uid(), type: 'V', digit: 2, contractType: 'DIGITOVER'  },
        { id: uid(), type: 'M', digit: 5, contractType: 'DIGITMATCH' },
        { id: uid(), type: 'V', digit: 0, contractType: 'DIGITOVER'  },
    ]);
    const [compareDigit,        setCompareDigit]        = useState(2);
    const [useCustomContracts,  setUseCustomContracts]  = useState(false);
    const [noContradiction,     setNoContradiction]     = useState(false);
    const [patternMatchIdx,     setPatternMatchIdx]     = useState(0);

    // ── Trade Pattern ──────────────────────────────────────────────────────
    const [tradePattern,    setTradePattern]    = useState<('trade' | 'skip')[]>(['skip', 'trade']);
    const [patternSlotIdx,  setPatternSlotIdx]  = useState(0);

    // ── Continuous Mode ────────────────────────────────────────────────────
    const [continuousMode, setContinuousMode] = useState<ContinuousMode>('after_first');

    // ── Presets & Cycle ────────────────────────────────────────────────────
    const [selectedPreset,      setSelectedPreset]      = useState('differ_1');
    const [tradesPerCycle,      setTradesPerCycle]      = useState('3');
    const [cycleTradesCount,    setCycleTradesCount]    = useState(0);

    // ── Risk ───────────────────────────────────────────────────────────────
    const [baseStake,           setBaseStake]           = useState('1.00');
    const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
    const [martingaleMul,       setMartingaleMul]       = useState('2.0');
    const [maxMartSteps,        setMaxMartSteps]        = useState('5');
    const [stopOnMaxSteps,      setStopOnMaxSteps]      = useState(true);
    const [takeProfit,          setTakeProfit]          = useState('10.00');
    const [stopLoss,            setStopLoss]            = useState('30.00');
    const [maxWinsCap,          setMaxWinsCap]          = useState('20');
    const [maxTradesCap,        setMaxTradesCap]        = useState('50');
    const [maxTradesPerMarket,  setMaxTradesPerMarket]  = useState('3');
    const [cycleInterval,       setCycleInterval]       = useState('continuous');

    // ── Compounding ────────────────────────────────────────────────────────
    const [isCompounding,       setIsCompounding]       = useState(false);
    const [compoundPct,         setCompoundPct]         = useState('50');
    const [isCapitalCompound,   setIsCapitalCompound]   = useState(false);
    const [capitalPct,          setCapitalPct]          = useState('1.0');

    // ── Session State ──────────────────────────────────────────────────────
    const [isRunningAuto,       setIsRunningAuto]       = useState(false);
    const [uptimeStart,         setUptimeStart]         = useState<number | null>(null);
    const [uptimeDisplay,       setUptimeDisplay]       = useState('00:00:00');
    const [sessionProfit,       setSessionProfit]       = useState(0);
    const [sessionWins,         setSessionWins]         = useState(0);
    const [sessionLosses,       setSessionLosses]       = useState(0);
    const [sessionTrades,       setSessionTrades]       = useState(0);
    const [mktTrades,           setMktTrades]           = useState(0);
    const [selectedMarket,      setSelectedMarket]      = useState('R_100');
    const [currentStake,        setCurrentStake]        = useState('1.00');
    const [nextExecCd,          setNextExecCd]          = useState<string | null>(null);
    const [triggersFired,       setTriggersFired]       = useState(0);
    const [isScannerWarmup,     setIsScannerWarmup]     = useState(false);

    // ── Logs ───────────────────────────────────────────────────────────────
    const [tradeLog,  setTradeLog]  = useState<AutoLXTradeRecord[]>([]);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

    // ── Refs ───────────────────────────────────────────────────────────────
    const watchdogRef   = useRef<NodeJS.Timeout | null>(null);
    const cdRef         = useRef<NodeJS.Timeout | null>(null);
    const cycleEndRef   = useRef<number | null>(null);
    const lastIdRef     = useRef<string | null>(null);
    const isRunningRef  = useRef(false);
    const curStepRef    = useRef(0);
    const curRepRef     = useRef(0);
    const sessionProfRef= useRef(0);
    const sessionWinsRef= useRef(0);
    const sessionTrRef  = useRef(0);
    const cycleTradesCountRef  = useRef(0);
    const marketRatingsRef     = useRef<any[]>([]);
    const selectedPresetRef    = useRef(selectedPreset);
    const scannerWarmupRef     = useRef<NodeJS.Timeout | null>(null);
    const warmupCountRef       = useRef<NodeJS.Timeout | null>(null);
    const lastTradedMarketRef  = useRef<string | null>(null);
    // warmupTriggeredRef: set true when warmup starts, prevents the mode-switch useEffect
    // from starting a duplicate warmup when the watcher already handled it.
    const warmupTriggeredRef   = useRef(false);
    // isScannerWarmupRef: always-current ref so the watchdog interval callback (which
    // captures a stale closure) can still see the live value.
    const isScannerWarmupRef   = useRef(false);
    const cycleIntervalRef     = useRef(cycleInterval);
    const pipelineStepsRef     = useRef<PipelineStep[]>(pipelineSteps);
    const pipelineModeRef      = useRef<TriggerMode>(pipelineMode);

    // ── Autonomous Trade Playlist & Sync State ────────────────────────────
    const [playlistSteps,          setPlaylistSteps]          = useState<PlaylistTradeStep[]>(DEFAULT_PLAYLIST_STEPS);
    const [playlistLoop,           setPlaylistLoop]           = useState<boolean>(false);
    const [playlistCurrentStepIdx, setPlaylistCurrentStepIdx] = useState<number>(0);
    const [playlistStatus,         setPlaylistStatus]         = useState<'idle' | 'countdown' | 'executing' | 'completed'>('idle');
    const [playlistCountdownSecs,  setPlaylistCountdownSecs]  = useState<number>(0);
    const [playlistStepResults,    setPlaylistStepResults]    = useState<Record<string, { result: 'WIN' | 'LOSS'; profit: number; stake: number; exitSpot?: string; time: string }>>({});
    const [expandedStepId,         setExpandedStepId]         = useState<string | null>(null);

    const playlistStepsRef          = useRef<PlaylistTradeStep[]>(playlistSteps);
    const playlistLoopRef           = useRef<boolean>(playlistLoop);
    const playlistCurrentStepIdxRef = useRef<number>(0);
    const playlistStatusRef         = useRef<'idle' | 'countdown' | 'executing' | 'completed'>('idle');
    const playlistCountdownTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastBotLogIdRef           = useRef<string | null>(null);
    const activeStepSourceRef       = useRef<'laxprime' | 'laxsniper-xv' | null>(null);
    const stepLaunchTimeRef         = useRef<number>(0);
    const playlistTargetTimeRef     = useRef<number>(0);

    // Subscribe to LaxPrime (useBotStore) trade logs
    const botTradeLogs = useBotStore(state => state.tradeLogs);

    useEffect(() => { isRunningRef.current       = isRunningAuto;    }, [isRunningAuto]);
    useEffect(() => { curStepRef.current         = curStep;          }, [curStep]);
    useEffect(() => { curRepRef.current          = curRep;           }, [curRep]);
    useEffect(() => { sessionProfRef.current     = sessionProfit;    }, [sessionProfit]);
    useEffect(() => { sessionWinsRef.current     = sessionWins;      }, [sessionWins]);
    useEffect(() => { sessionTrRef.current       = sessionTrades;    }, [sessionTrades]);
    useEffect(() => { cycleTradesCountRef.current  = cycleTradesCount; }, [cycleTradesCount]);
    useEffect(() => { selectedPresetRef.current  = selectedPreset;   }, [selectedPreset]);
    useEffect(() => { isScannerWarmupRef.current = isScannerWarmup;  }, [isScannerWarmup]);
    useEffect(() => { cycleIntervalRef.current   = cycleInterval;    }, [cycleInterval]);
    useEffect(() => { pipelineStepsRef.current   = pipelineSteps;    }, [pipelineSteps]);
    useEffect(() => { pipelineModeRef.current    = pipelineMode;     }, [pipelineMode]);
    useEffect(() => { playlistStepsRef.current   = playlistSteps;    }, [playlistSteps]);
    useEffect(() => { playlistLoopRef.current    = playlistLoop;     }, [playlistLoop]);
    useEffect(() => { playlistStatusRef.current  = playlistStatus;   }, [playlistStatus]);

    // React to virtual ↔ real mode switches triggered by the trade engine
    const prevVirtualModeRef = useRef(virtualSettings.isVirtualMode);
    useEffect(() => {
        if (prevVirtualModeRef.current === virtualSettings.isVirtualMode) return;

        if (virtualSettings.isVirtualMode) {
            // ── Real → Virtual (3-win threshold met by trade engine) ──────────────
            // IMPORTANT: do NOT reset cycleTradesCountRef here. This useEffect runs
            // BEFORE the trade-log watcher (React runs effects top-to-bottom). If we
            // reset the counter here the watcher will see 0+1=1 instead of 3 and
            // will never call stopBot(). The watcher handles its own counter reset.
            addAuditLog('🔄 Real threshold hit. Stopping engine. Reverting to VIRTUAL mode.', 'warn');

            // Stop the engine (idempotent if bail-out already called it).
            if (isRunningRef.current) stopBot();

            // For continuous mode: start 60s warmup to block the watchdog from
            // restarting. The bail-out already stopped the engine; the watcher handles
            // warmup for the cycle-counter path — only trigger here when neither has.
            if (cycleIntervalRef.current === 'continuous' && !warmupTriggeredRef.current && isRunningRef.current) {
                warmupTriggeredRef.current = true;
                const runWarmup = () => {
                    if (scannerWarmupRef.current) clearTimeout(scannerWarmupRef.current);
                    if (warmupCountRef.current)   clearInterval(warmupCountRef.current);
                    setIsScannerWarmup(true);
                    TARGET_MARKETS.forEach(m => ensureScanner(m.value));
                    const WARMUP_SECS = 60;
                    let remaining = WARMUP_SECS;
                    setNextExecCd(`${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`);
                    warmupCountRef.current = setInterval(() => {
                        remaining -= 1;
                        if (remaining <= 0) { if (warmupCountRef.current) clearInterval(warmupCountRef.current); setNextExecCd(null); return; }
                        setNextExecCd(`${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`);
                    }, 1000);
                    scannerWarmupRef.current = setTimeout(() => {
                        if (warmupCountRef.current) clearInterval(warmupCountRef.current);
                        warmupTriggeredRef.current = false;
                        setIsScannerWarmup(false);
                        setNextExecCd(null);
                        cycleTradesCountRef.current = 0;
                        setCycleTradesCount(0);
                        const preset = selectedPresetRef.current;
                        const liveRegimes = useScannerStore.getState().marketRegimes;
                        const ranked = TARGET_MARKETS.map(m => {
                            const r = liveRegimes[m.value];
                            if (!r?.historyReady) return { symbol: m.value, label: m.label, score: -1 };
                            if (preset === 'differ_1') { const { count } = getTopAlternatingPairAndCount((r.digits || []).slice(-100)); return { symbol: m.value, label: m.label, score: count }; }
                            if (preset === 'differ_2') {
                                const digits = r.digits || [];
                                const last100 = digits.slice(-100);
                                if (last100.length === 0) return { symbol: m.value, label: m.label, score: -1 };
                                let consecEvens = 0;
                                for (let i = last100.length - 1; i >= 0; i--) {
                                    if (last100[i] % 2 === 0) consecEvens++;
                                    else break;
                                }
                                if (consecEvens >= 5) {
                                    const oddCount = last100.filter(d => d % 2 !== 0).length;
                                    const pct = (oddCount / last100.length) * 100;
                                    return { symbol: m.value, label: m.label, score: pct };
                                } else {
                                    return { symbol: m.value, label: m.label, score: -1 };
                                }
                            }
                            return { symbol: m.value, label: m.label, score: Math.round((r.details?.gap || 0) * 200) };
                        }).filter(m => m.symbol !== lastTradedMarketRef.current).sort((a, b) => b.score - a.score);
                        const best = ranked[0];
                        if (!best || best.score < 0) {
                            addAuditLog(preset === 'differ_2' ? '⚠️ No market with 5+ consecutive evens found. Restarting scanner warmup…' : '⚠️ No suitable market found after warmup. Restarting warmup…', 'warn');
                            warmupTriggeredRef.current = true;
                            runWarmup();
                            return;
                        }
                        setSelectedMarket(best.symbol); setMarket(best.symbol); subscribeToMarket(best.symbol);
                        if (preset === 'differ_1') {
                            const r = useScannerStore.getState().marketRegimes[best.symbol];
                            const last100 = (r?.digits || []).slice(-100);
                            const { pair, count } = getTopAlternatingPairAndCount(last100);
                            setEntryDigits(pair);
                            setPipelineSteps([{ id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 }, { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 }]);
                            setContractType('DIGITDIFF'); setPrediction(pair[0]);
                            const _s = useDerivStore.getState();
                            _s.setPrediction(pair[0]);
                            _s.setContractType('DIGITDIFF');
                            _s.setPipelineSteps([{ id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 }, { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 }]);
                            _s.setTrigger('entryDigit', { enabled: true, entryDigit: pair[0], multiEnabled: true, multiDigits: pair, monitorTicks: 10, triggerOnEntry: true });
                            _s.setTriggerMode('sequential');
                            addAuditLog(`🔄 Warmup done → ${best.label} | Pair: [${pair.join(', ')}] (${count} patterns)`, 'success');
                        } else if (preset === 'differ_2') {
                            const r = useScannerStore.getState().marketRegimes[best.symbol];
                            const last100 = (r?.digits || []).slice(-100);
                            const { pair, count } = getTopOddPair(last100);
                            setEntryDigits(pair);
                            setPipelineSteps([{ id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 }, { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 }]);
                            setContractType('DIGITDIFF'); setPrediction(pair[0]);
                            const _s = useDerivStore.getState();
                            _s.setPrediction(pair[0]);
                            _s.setContractType('DIGITDIFF');
                            _s.setPipelineSteps([{ id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 }, { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 }]);
                            _s.setTrigger('entryDigit', {
                                enabled: true,
                                entryDigit: pair[0],
                                triggerOnEntry: true,
                                consecutive: 2,
                                type: 'Under',
                                monitorTicks: 10,
                                multiDigits: pair,
                                useMulti: true
                            });
                            _s.setTrigger('digitPattern', { enabled: false });
                            _s.setTriggerMode('sequential');
                            addAuditLog(`🔄 Warmup done → ${best.label} | Top Odds: [${pair.join(', ')}] (${count} hits)`, 'success');
                        } else {
                            addAuditLog(`🔄 Warmup done → ${best.label}`, 'success');
                        }
                        const s = calcStake(); setCurrentStake(s);
                        setRiskSettings({ initialStake: Number(s), maxMartingaleSteps: Number(maxMartSteps), martingaleMultiplier: isMartingaleEnabled ? Number(martingaleMul) : 1.0, stopOnMaxSteps, takeProfit: Number(takeProfit), stopLoss: Number(stopLoss) });
                        setCurStep(0); setCurRep(0); lastIdRef.current = null;
                        startBot();
                    }, WARMUP_SECS * 1000);
                };
                runWarmup();
            }
        } else {
            // ── Virtual → Real (virtual threshold met) ────────────────────────────
            addAuditLog('✅ Virtual requirement met. Switching to REAL trading.', 'success');
            // Reset cycle counter so real trades count from 0 in the new real phase.
            cycleTradesCountRef.current = 0;
            setCycleTradesCount(0);
        }
        prevVirtualModeRef.current = virtualSettings.isVirtualMode;
    }, [virtualSettings.isVirtualMode]);

    // Sync pipeline settings to Zustand store for engine visibility
    useEffect(() => {
        setStorePipelineMode(pipelineMode);
    }, [pipelineMode, setStorePipelineMode]);

    useEffect(() => {
        setStorePipelineSteps(pipelineSteps);
    }, [pipelineSteps, setStorePipelineSteps]);

    // Sync triggers, tradePattern, and continuous/after-first trading mode to store
    useEffect(() => {
        setTrigger('entryDigit', {
            enabled: entryDigitEnabled,
            entryDigit: entryDigits[0] !== undefined ? entryDigits[0] : 5,
            multiDigits: entryDigits,
            useMulti: true,
            triggerOnEntry: instantTrigger
        });
    }, [entryDigitEnabled, entryDigits, instantTrigger, setTrigger]);

    useEffect(() => {
        setTrigger('digitPattern', {
            enabled: digitPatternEnabled,
            pattern: patternBoxes.map(b => b.type),
            compareDigit: compareDigit,
            useCustomContracts: useCustomContracts,
            noContradiction: noContradiction
        });
    }, [digitPatternEnabled, patternBoxes, compareDigit, useCustomContracts, noContradiction, setTrigger]);

    useEffect(() => {
        setStoreTradePattern(tradePattern);
    }, [tradePattern, setStoreTradePattern]);

    useEffect(() => {
        setStoreTradingMode(continuousMode);
    }, [continuousMode, setStoreTradingMode]);

    // ── Scanner ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!isAuthorized || tradingStatus !== 'connected') return;
        startScanning();
        TARGET_MARKETS.forEach(m => ensureScanner(m.value));
        return () => stopScanning();
    }, [isAuthorized, tradingStatus]);

    // ── Persist settings to localStorage ──────────────────────────────────
    const STORAGE_KEY = 'autolx_settings_v1';

    // Load on mount — memory only restores when last-saved preset was 'custom'
    useEffect(() => {
        if (!isAuthorized) return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                // No saved settings → apply differ_1 defaults so the bot is ready
                handlePresetChange('differ_1');
                return;
            }
            const s = JSON.parse(raw);
            const savedPreset = s.selectedPreset || 'differ_1';
            setSelectedPreset(savedPreset);

            // Only restore manual-input memory when the user was last using 'custom'.
            // Every named preset resets itself via handlePresetChange below.
            if (savedPreset === 'custom') {
                if (s.tradesPerCycle)      setTradesPerCycle(s.tradesPerCycle);
                if (s.pipelineSteps)       setPipelineSteps(s.pipelineSteps);
                if (s.pipelineMode)        setPipelineMode(s.pipelineMode);
                if (s.adaptiveSwitch       !== undefined) setAdaptiveSwitch(s.adaptiveSwitch);
                if (s.entryDigitEnabled    !== undefined) setEntryDigitEnabled(s.entryDigitEnabled);
                if (s.entryDigits)         setEntryDigits(s.entryDigits);
                if (s.instantTrigger       !== undefined) setInstantTrigger(s.instantTrigger);
                if (s.digitPatternEnabled  !== undefined) setDigitPatternEnabled(s.digitPatternEnabled);
                if (s.patternBoxes)        setPatternBoxes(s.patternBoxes);
                if (s.compareDigit         !== undefined) setCompareDigit(s.compareDigit);
                if (s.useCustomContracts   !== undefined) setUseCustomContracts(s.useCustomContracts);
                if (s.noContradiction      !== undefined) setNoContradiction(s.noContradiction);
                if (s.tradePattern)        setTradePattern(s.tradePattern);
                if (s.continuousMode)      setContinuousMode(s.continuousMode);
            } else {
                // Re-apply the named preset so all controls match the preset's defaults
                handlePresetChange(savedPreset);
            }

            // Risk & session settings are always restored regardless of preset
            if (s.isMartingaleEnabled  !== undefined) setIsMartingaleEnabled(s.isMartingaleEnabled);
            if (s.martingaleMul)       setMartingaleMul(s.martingaleMul);
            if (s.maxMartSteps)        setMaxMartSteps(s.maxMartSteps);
            if (s.stopOnMaxSteps       !== undefined) setStopOnMaxSteps(s.stopOnMaxSteps);
            if (s.takeProfit)          setTakeProfit(s.takeProfit);
            if (s.stopLoss)            setStopLoss(s.stopLoss);
            if (s.maxWinsCap)          setMaxWinsCap(s.maxWinsCap);
            if (s.maxTradesCap)        setMaxTradesCap(s.maxTradesCap);
            if (s.maxTradesPerMarket)  setMaxTradesPerMarket(s.maxTradesPerMarket);
            if (s.cycleInterval)       setCycleInterval(s.cycleInterval);
            if (s.isCompounding        !== undefined) setIsCompounding(s.isCompounding);
            if (s.compoundPct)         setCompoundPct(s.compoundPct);
            if (s.isCapitalCompound    !== undefined) setIsCapitalCompound(s.isCapitalCompound);
            if (s.capitalPct)          setCapitalPct(s.capitalPct);
            // Autonomous Trade Playlist settings
            if (s.playlistSteps && Array.isArray(s.playlistSteps)) setPlaylistSteps(s.playlistSteps);
            if (s.playlistLoop !== undefined)                      setPlaylistLoop(s.playlistLoop);
        } catch (e) {
            console.warn('AUTO-LX: failed to restore settings', e);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthorized]);

    // Save on every change (debounced via useEffect deps)
    useEffect(() => {
        if (!isAuthorized) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                selectedPreset, tradesPerCycle,
                pipelineSteps, pipelineMode, adaptiveSwitch,
                entryDigitEnabled, entryDigits, instantTrigger,
                digitPatternEnabled, patternBoxes, compareDigit, useCustomContracts, noContradiction,
                tradePattern, continuousMode,
                isMartingaleEnabled, martingaleMul, maxMartSteps, stopOnMaxSteps, takeProfit, stopLoss,
                maxWinsCap, maxTradesCap, maxTradesPerMarket, cycleInterval,
                isCompounding, compoundPct, isCapitalCompound, capitalPct,
                playlistSteps, playlistLoop,
            }));
        } catch (e) { /* quota exceeded — ignore */ }
    }, [
        selectedPreset, tradesPerCycle,
        pipelineSteps, pipelineMode, adaptiveSwitch,
        entryDigitEnabled, entryDigits, instantTrigger,
        digitPatternEnabled, patternBoxes, compareDigit, useCustomContracts, noContradiction,
        tradePattern, continuousMode,
        isMartingaleEnabled, martingaleMul, maxMartSteps, stopOnMaxSteps, takeProfit, stopLoss,
        maxWinsCap, maxTradesCap, maxTradesPerMarket, cycleInterval,
        isCompounding, compoundPct, isCapitalCompound, capitalPct,
        playlistSteps, playlistLoop,
        isAuthorized,
    ]);

    // ── Uptime ─────────────────────────────────────────────────────────────
    useEffect(() => {
        let t: NodeJS.Timeout;
        if (isRunningAuto && uptimeStart) {
            t = setInterval(() => {
                const s = Math.floor((Date.now() - uptimeStart) / 1000);
                const hh = Math.floor(s / 3600).toString().padStart(2, '0');
                const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
                const ss = (s % 60).toString().padStart(2, '0');
                setUptimeDisplay(`${hh}:${mm}:${ss}`);
            }, 1000);
        } else {
            setUptimeDisplay('00:00:00');
        }
        return () => clearInterval(t);
    }, [isRunningAuto, uptimeStart]);

    // ── Audit helper ─────────────────────────────────────────────────────
    const addAuditLog = useCallback((message: string, type: AuditLog['type'] = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour12: false });
        setAuditLogs(prev => [{ time, message, type }, ...prev].slice(0, 200));
    }, []);

    // ── Stake calculator ──────────────────────────────────────────────────
    const calcStake = useCallback((): string => {
        const base = parseFloat(baseStake) || 1.0;
        if (isCapitalCompound) {
            const bal = account?.balance || 0;
            if (bal > 0) return Math.max(0.35, bal * (parseFloat(capitalPct) / 100)).toFixed(2);
        }
        if (isCompounding && sessionProfRef.current > 0) {
            const comp = base + sessionProfRef.current * (parseFloat(compoundPct) / 100);
            return Math.max(base, comp).toFixed(2);
        }
        return base.toFixed(2);
    }, [baseStake, isCapitalCompound, isCompounding, capitalPct, compoundPct, account?.balance]);

    // ── Playlist Execution Handlers ─────────────────────────────────────────
    const startPlaylistCountdown = useCallback((totalSeconds: number, targetStepIdx: number) => {
        if (playlistCountdownTimerRef.current) clearInterval(playlistCountdownTimerRef.current);
        setPlaylistStatus('countdown');
        playlistStatusRef.current = 'countdown';
        activeStepSourceRef.current = null;
        setPlaylistCountdownSecs(totalSeconds);

        const targetMs = Date.now() + totalSeconds * 1000;
        playlistTargetTimeRef.current = targetMs;

        const formatCd = (sec: number) => {
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = (sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };
        setNextExecCd(formatCd(totalSeconds));

        playlistCountdownTimerRef.current = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((playlistTargetTimeRef.current - Date.now()) / 1000));
            setPlaylistCountdownSecs(remaining);
            if (remaining <= 0) {
                if (playlistCountdownTimerRef.current) {
                    clearInterval(playlistCountdownTimerRef.current);
                    playlistCountdownTimerRef.current = null;
                }
                setNextExecCd(null);
                executePlaylistStep(targetStepIdx);
            } else {
                setNextExecCd(formatCd(remaining));
            }
        }, 1000);
    }, []);

    const executePlaylistStep = useCallback((stepIdx: number) => {
        if (!isRunningRef.current) return;
        const currentSteps = playlistStepsRef.current;
        if (!currentSteps || stepIdx >= currentSteps.length) return;

        const step = currentSteps[stepIdx];
        playlistCurrentStepIdxRef.current = stepIdx;
        setPlaylistCurrentStepIdx(stepIdx);
        setPlaylistStatus('executing');
        playlistStatusRef.current = 'executing';
        activeStepSourceRef.current = step.source;
        stepLaunchTimeRef.current = Date.now();

        // Snapshot current latest trade log IDs so we ONLY process new trades settled AFTER this instant
        const currentBotLogs = useBotStore.getState().tradeLogs;
        const currentDerivLogs = useDerivStore.getState().tradeLogs;
        lastBotLogIdRef.current = currentBotLogs[0] ? `${currentBotLogs[0].id}::${currentBotLogs[0].result}` : '__INIT__';
        lastIdRef.current = currentDerivLogs[0] ? `${currentDerivLogs[0].requestId}::${currentDerivLogs[0].result}` : '__INIT__';

        // Check global take profit & stop loss limits
        const curProfit = sessionProfRef.current;
        if (Number(takeProfit) > 0 && curProfit >= Number(takeProfit)) {
            addAuditLog(`🎯 Global Take Profit reached ($${curProfit.toFixed(2)} >= $${takeProfit})! Session completed.`, 'success');
            handleStop();
            return;
        }
        if (Number(stopLoss) > 0 && curProfit <= -Math.abs(Number(stopLoss))) {
            addAuditLog(`🛑 Global Stop Loss hit ($${curProfit.toFixed(2)} <= -$${stopLoss})! Session halted.`, 'error');
            handleStop();
            return;
        }

        // Calculate compounded stake
        const base = parseFloat(baseStake) || 1.0;
        let nextStakeVal = base;
        if (isCapitalCompound) {
            const bal = account?.balance || 0;
            if (bal > 0) nextStakeVal = Math.max(0.35, bal * (parseFloat(capitalPct) / 100));
        } else if (isCompounding && curProfit > 0) {
            const comp = base + curProfit * (parseFloat(compoundPct) / 100);
            nextStakeVal = Math.max(base, comp);
        }
        const stakeStr = nextStakeVal.toFixed(2);
        setCurrentStake(stakeStr);

        if (step.source === 'laxprime') {
            try {
                // Read live LaxPrime store state (contains all strategies, multi-entry boxes, custom contracts, and selected markets)
                const currentBotState = useBotStore.getState();
                const patch: any = {
                    stake: stakeStr,
                    targetProfit: takeProfit,
                    stopLoss: stopLoss,
                };
                if (step.marketOverride) {
                    patch.selectedMarkets = [step.marketOverride];
                }
                useBotStore.setState(patch);

                const activeMkts = patch.selectedMarkets || currentBotState.selectedMarkets || [];
                addAuditLog(`🚀 [Step ${stepIdx + 1}/${currentSteps.length}] Starting LaxPrime | Stake: $${stakeStr} (${currentBotState.strategies?.length || 0} strategies on ${activeMkts.length} markets)`, 'info');
                useBotStore.getState().startBot();
            } catch (err) {
                addAuditLog(`❌ Error starting LaxPrime step: ${String(err)}`, 'error');
            }
        } else {
            try {
                // Read live LaxSniper XV store state
                const patch: any = {
                    initialStake: Number(stakeStr),
                    takeProfit: Number(takeProfit),
                    stopLoss: Number(stopLoss),
                };
                if (step.marketOverride) patch.market = step.marketOverride;
                if (step.contractOverride) patch.contractType = step.contractOverride;
                if (step.digitOverride !== null && step.digitOverride !== undefined) patch.prediction = step.digitOverride;

                useDerivStore.setState(patch);

                addAuditLog(`🚀 [Step ${stepIdx + 1}/${currentSteps.length}] Starting LaxSniper XV | Stake: $${stakeStr} (Compounded)`, 'info');
                useDerivStore.getState().startBot();
            } catch (err) {
                addAuditLog(`❌ Error starting LaxSniper XV step: ${String(err)}`, 'error');
            }
        }
    }, [account?.balance, baseStake, isCapitalCompound, isCompounding, capitalPct, compoundPct, takeProfit, stopLoss, addAuditLog]);

    const handlePlaylistTradeSettled = useCallback((profit: number, stakeVal: number, isWon: boolean, exitSpot: string | null, contractType: string) => {
        // Stop bot engines immediately
        useBotStore.getState().stopBot();
        stopBot();
        activeStepSourceRef.current = null;

        const currentSteps = playlistStepsRef.current;
        const currentIdx = playlistCurrentStepIdxRef.current;
        const currentStep = currentSteps[currentIdx];
        const stepKey = currentStep?.id || `step-${currentIdx}`;

        // Save step result for visual roadmap
        setPlaylistStepResults(prev => ({
            ...prev,
            [stepKey]: {
                result: isWon ? 'WIN' : 'LOSS',
                profit,
                stake: stakeVal,
                exitSpot: exitSpot ? String(exitSpot) : undefined,
                time: new Date().toLocaleTimeString([], { hour12: false })
            }
        }));

        // Check global take profit & stop loss limits
        const curProfit = sessionProfRef.current;
        if (Number(takeProfit) > 0 && curProfit >= Number(takeProfit)) {
            addAuditLog(`🎯 Global Take Profit reached ($${curProfit.toFixed(2)} >= $${takeProfit})! Session completed.`, 'success');
            setPlaylistStatus('completed');
            handleStop();
            return;
        }
        if (Number(stopLoss) > 0 && curProfit <= -Math.abs(Number(stopLoss))) {
            addAuditLog(`🛑 Global Stop Loss hit ($${curProfit.toFixed(2)} <= -$${stopLoss})! Session halted.`, 'error');
            setPlaylistStatus('completed');
            handleStop();
            return;
        }

        // Determine next step
        const nextIdx = currentIdx + 1;
        if (nextIdx < currentSteps.length) {
            playlistCurrentStepIdxRef.current = nextIdx;
            setPlaylistCurrentStepIdx(nextIdx);
            const nextStep = currentSteps[nextIdx];
            const delaySec = Math.max(1, (nextStep.delayMinutes || 0) * 60);
            addAuditLog(`⏳ Step ${currentIdx + 1} settled (${isWon ? 'WIN' : 'LOSS'} | ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}). Cooling down for ${nextStep.delayMinutes}m before Step ${nextIdx + 1}...`, 'info');
            startPlaylistCountdown(delaySec, nextIdx);
        } else if (playlistLoopRef.current) {
            playlistCurrentStepIdxRef.current = 0;
            setPlaylistCurrentStepIdx(0);
            const step0 = currentSteps[0];
            const delaySec = Math.max(1, (step0.delayMinutes || 0) * 60);
            addAuditLog(`🔄 Playlist cycle completed! Looping to Step 1 in ${step0.delayMinutes}m...`, 'info');
            startPlaylistCountdown(delaySec, 0);
        } else {
            setPlaylistStatus('completed');
            addAuditLog(`🏁 All ${currentSteps.length} Playlist steps successfully executed. Session finished.`, 'success');
            handleStop();
        }
    }, [takeProfit, stopLoss, startPlaylistCountdown, addAuditLog]);

    // ── Playlist Step Management Helpers ────────────────────────────────────
    const addPlaylistStep = (delayMinutes: number = 5, source: 'laxprime' | 'laxsniper-xv' = 'laxprime') => {
        const newStep: PlaylistTradeStep = {
            id: uid(),
            delayMinutes,
            source,
            label: `Step ${playlistSteps.length + 1} (+${delayMinutes}m delay)`,
        };
        setPlaylistSteps(prev => [...prev, newStep]);
    };

    const duplicatePlaylistStep = (id: string) => {
        setPlaylistSteps(prev => {
            const idx = prev.findIndex(s => s.id === id);
            if (idx === -1) return prev;
            const original = prev[idx];
            const clone: PlaylistTradeStep = {
                ...original,
                id: uid(),
                label: `${original.label || `Step ${idx + 1}`} (Copy)`,
            };
            const updated = [...prev];
            updated.splice(idx + 1, 0, clone);
            return updated;
        });
    };

    const deletePlaylistStep = (id: string) => {
        setPlaylistSteps(prev => {
            if (prev.length <= 1) return prev;
            return prev.filter(s => s.id !== id);
        });
    };

    const updatePlaylistStep = (id: string, patch: Partial<PlaylistTradeStep>) => {
        setPlaylistSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    };

    const movePlaylistStep = (idx: number, dir: -1 | 1) => {
        setPlaylistSteps(prev => {
            const targetIdx = idx + dir;
            if (targetIdx < 0 || targetIdx >= prev.length) return prev;
            const copy = [...prev];
            const temp = copy[idx];
            copy[idx] = copy[targetIdx];
            copy[targetIdx] = temp;
            return copy;
        });
    };

    // ── Adaptive switch helper ────────────────────────────────────────────
    const doAdaptiveSwitch = useCallback((lastContract: string) => {
        const uc = lastContract.toUpperCase();
        if (uc.includes('OVER')) {
            addAuditLog('Adaptive: OVER lost → switching to UNDER', 'warn');
            setContractType('DIGITUNDER');
        } else if (uc.includes('UNDER')) {
            addAuditLog('Adaptive: UNDER lost → switching to OVER', 'warn');
            setContractType('DIGITOVER');
        } else if (uc === 'CALL' || uc.includes('RISE')) {
            addAuditLog('Adaptive: RISE lost → switching to FALL', 'warn');
            setContractType('PUT');
        } else if (uc === 'PUT' || uc.includes('FALL')) {
            addAuditLog('Adaptive: FALL lost → switching to RISE', 'warn');
            setContractType('CALL');
        }
    }, [addAuditLog, setContractType]);

    // ── Pipeline step applier ──────────────────────────────────────────────
    const applyStep = useCallback((stepIdx: number, explicitPrediction?: number, explicitContractType?: string, explicitSteps?: PipelineStep[]) => {
        // Always prefer explicitly-passed values so callers that set pipeline steps
        // via React state (async) can bypass the stale closure.
        const steps = explicitSteps ?? pipelineStepsRef.current;
        const step = steps[stepIdx];
        const prediction = explicitPrediction !== undefined ? explicitPrediction : step?.prediction;
        const contractType = explicitContractType ?? step?.contractType;
        if (prediction === undefined || !contractType) return;
        setContractType(contractType as any);
        setPrediction(prediction);
        // Also push directly to the Zustand store so the engine sees it immediately
        // without waiting for a React render cycle.
        useDerivStore.getState().setPrediction(prediction);
        useDerivStore.getState().setContractType(contractType as any);
        addAuditLog(`Pipeline → Step ${stepIdx + 1}: ${contractType} (Digit ${prediction})`, 'info');
    }, [setContractType, setPrediction, addAuditLog]);

    // ── Advance pipeline after each settled trade ──────────────────────────
    const advancePipeline = useCallback(() => {
        const currentMode = pipelineModeRef.current;
        const currentSteps = pipelineStepsRef.current;
        if (currentMode !== 'sequential' || currentSteps.length === 0) return;
        const step = currentSteps[curStepRef.current];
        if (!step) return;
        const nextRep = curRepRef.current + 1;
        if (nextRep >= step.reps) {
            const nextStep = (curStepRef.current + 1) % currentSteps.length;
            setCurStep(nextStep);
            setCurRep(0);
            curStepRef.current = nextStep;
            curRepRef.current = 0;
            applyStep(nextStep, undefined, undefined, currentSteps);
        } else {
            setCurRep(nextRep);
            curRepRef.current = nextRep;
        }
    }, [applyStep]);

    // ── Trade log watcher (LaxSniper XV trades) ──────────────────────────────
    useEffect(() => {
        if (!isRunningAuto) return;
        // In trade_playlist preset, strictly ignore tradeLogs unless the currently executing step is LaxSniper XV
        if (selectedPreset === 'trade_playlist' && (activeStepSourceRef.current !== 'laxsniper-xv' || playlistStatusRef.current !== 'executing')) {
            return;
        }

        const autoLogs = tradeLogs.filter((l: any) => !l.pageId || l.pageId === 'auto-trade');
        if (autoLogs.length === 0) return;
        const latest = autoLogs[0] as any;
        if (!latest) return;

        const isWon  = latest.result?.includes('WIN')  || latest.result === 'WON';
        const isLost = latest.result?.includes('LOSS') || latest.result === 'LOST';
        if (!isWon && !isLost) return;

        const logKey = `${latest.requestId}::${latest.result}`;
        if (lastIdRef.current === logKey) return;
        lastIdRef.current = logKey;

        const isVirtual = !!latest.isVirtual;
        const profit    = Number(latest.profit) || 0;
        const rawExit   = latest.exitTick ?? latest.exit;
        let exitDigit: number | null = null;
        if (rawExit != null && rawExit !== '-' && rawExit !== '') {
            const num = Number(rawExit);
            if (!isNaN(num)) {
                // If it is already a single digit (0-9), use it directly.
                // Otherwise, extract the last digit from the full price.
                if (num >= 0 && num <= 9 && Number.isInteger(num)) {
                    exitDigit = num;
                } else {
                    exitDigit = getLastDigit(num, latest.symbol || latest.market || selectedMarket);
                }
            }
        }

        const cType    = latest.contract || latest.contractType || '—';
        const entrySpot = latest.entrySpot || latest.entry_spot || '—';
        const stakeVal  = Number(latest.stake) || Number(currentStake);
        const actualMarket = latest.symbol || latest.market || selectedMarket;

        // Only count real trades in the stats header — virtual trades are excluded
        if (!isVirtual) {
            setSessionTrades(p => p + 1);
            if (isWon) setSessionWins(p => p + 1); else setSessionLosses(p => p + 1);
        }
        
        let nextProfit = sessionProfRef.current;
        if (!isVirtual) {
            nextProfit = sessionProfRef.current + profit;
            sessionProfRef.current = nextProfit;
            setSessionProfit(nextProfit);
        }
        
        // Calculate the next compounded stake immediately to prevent lag on the next execution
        const base = parseFloat(baseStake) || 1.0;
        let nextStakeVal = base;
        if (isCapitalCompound) {
            const bal = account?.balance || 0;
            if (bal > 0) nextStakeVal = Math.max(0.35, bal * (parseFloat(capitalPct) / 100));
        } else if (isCompounding && nextProfit > 0) {
            const comp = base + nextProfit * (parseFloat(compoundPct) / 100);
            nextStakeVal = Math.max(base, comp);
        }
        
        const nextStakeStr = nextStakeVal.toFixed(2);
        setCurrentStake(nextStakeStr);
        setRiskSettings({
            initialStake: Number(nextStakeStr)
        });

        setMktTrades(p => p + 1);
        setTriggersFired(p => p + 1);

        const record: AutoLXTradeRecord = {
            id:           latest.requestId || uid(),
            time:         new Date().toLocaleTimeString([], { hour12: false }),
            market:       actualMarket,
            contractType: cType,
            entrySpot,
            exitDigit,
            stake:        stakeVal,
            profit:       isVirtual ? profit : profit,
            result:       isWon ? 'WIN' : 'LOSS',
            isVirtual,
        };
        setTradeLog(prev => {
            if (prev.some(r => String(r.id) === String(record.id))) return prev;
            return [record, ...prev].slice(0, 300);
        });
        addAuditLog(
            `${isVirtual ? '[VIRTUAL] ' : ''}[${cType}] ${isWon ? '✓ WIN' : '✗ LOSS'} | Exit: ${exitDigit ?? '?'} | P/L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`,
            isWon ? 'success' : 'error'
        );

        // ── Autonomous Trade Playlist mode settlement (LaxSniper XV) ─────
        if (selectedPreset === 'trade_playlist') {
            if (activeStepSourceRef.current === 'laxsniper-xv' && playlistStatusRef.current === 'executing' && !isVirtual) {
                handlePlaylistTradeSettled(profit, stakeVal, isWon, exitDigit !== null ? String(exitDigit) : null, cType);
            }
            return; // In playlist preset, playlist manager handles sequence transitions
        }



        // ── Advance pipeline (real trades only) ───────────────────────────
        if (!isVirtual) {
            if (adaptiveSwitch && isLost) doAdaptiveSwitch(cType);
            advancePipeline();
        }

        // ── Real-loss bail-out ────────────────────────────────────────────
        // When in real mode with a win-based Real→Virtual trigger, any real
        // loss aborts the current cycle immediately: stop the engine, switch
        // back to Virtual mode, reset the cycle counter, and let the interval
        // timer kick off the next cycle fresh.
        if (!isVirtual && isLost) {
            // Read live virtualSettings from the store to avoid stale closure
            const liveVS = useDerivStore.getState().virtualSettings;
            if (liveVS.startRealToVirtual && liveVS.rTriggerType === 'wins') {
                stopBot();
                lastTradedMarketRef.current = selectedMarket;
                cycleTradesCountRef.current = 0;
                setCycleTradesCount(0);
                // Revert to virtual mode so the next cycle starts with validation
                setVirtualSettings({
                    isVirtualMode: true,
                    virtualWins: 0, virtualLosses: 0,
                    vConsecWins: 0, vConsecLosses: 0,
                    realWins: 0,    realLosses: 0,
                    rConsecWins: 0, rConsecLosses: 0,
                });
                setCurStep(0);
                setCurRep(0);
                curStepRef.current = 0;
                curRepRef.current = 0;
                addAuditLog('🛑 Real loss — aborting cycle. Returning to VIRTUAL mode for next interval.', 'warn');
                return;
            }
        }

        // ── Cycle counter (real trades only) ─────────────────────────────
        // Virtual trades are NEVER counted toward tradesPerCycle.
        // Only completed real trades advance the cycle counter.
        if (!isVirtual) {
            {
                // If pipeline mode is simultaneous, check if there are other open trades in the batch
                const hasMoreActive = tradeWS.hasPendingTrade();

                if (pipelineMode === 'simultaneous' && hasMoreActive) {
                    // Wait for the other trades in the batch to settle before processing cycle counts
                    return;
                }

                const nextCycleTradesCount = cycleTradesCountRef.current + 1;
                cycleTradesCountRef.current = nextCycleTradesCount; // update ref immediately (not just via useEffect) to avoid stale reads on rapid trade completions
                setCycleTradesCount(nextCycleTradesCount);

                const limit = Number(tradesPerCycle) || 1;
                if (nextCycleTradesCount >= limit) {
                    if (cycleInterval !== 'continuous') {
                        stopBot();
                        lastTradedMarketRef.current = selectedMarket;
                        // Reset cycle counter immediately so display shows 0/N while waiting for next interval
                        cycleTradesCountRef.current = 0;
                        setCycleTradesCount(0);
                        // Revert to virtual mode so the next cycle starts with validation
                        setVirtualSettings({
                            isVirtualMode: true,
                            virtualWins: 0, virtualLosses: 0,
                            vConsecWins: 0, vConsecLosses: 0,
                            realWins: 0,    realLosses: 0,
                            rConsecWins: 0, rConsecLosses: 0,
                        });
                        setCurStep(0);
                        setCurRep(0);
                        curStepRef.current = 0;
                        curRepRef.current = 0;
                        addAuditLog(`Cycle complete (${nextCycleTradesCount}/${limit} real trades). Stopping for next interval.`, 'success');
                    } else {
                    // ── Continuous cycle-end: 60s scanner warmup then pick best market ──
                    stopBot();
                    lastTradedMarketRef.current = selectedMarket;
                    cycleTradesCountRef.current = 0;
                    setCycleTradesCount(0);
                    warmupTriggeredRef.current = true;
                    // Revert to virtual mode so the next cycle starts with validation
                    setVirtualSettings({
                        isVirtualMode: true,
                        virtualWins: 0, virtualLosses: 0,
                        vConsecWins: 0, vConsecLosses: 0,
                        realWins: 0,    realLosses: 0,
                        rConsecWins: 0, rConsecLosses: 0,
                    });
                    setCurStep(0);
                    setCurRep(0);
                    curStepRef.current = 0;
                    curRepRef.current = 0;

                    // Clear any previous warmup timers
                    if (scannerWarmupRef.current) clearTimeout(scannerWarmupRef.current);
                    if (warmupCountRef.current)   clearInterval(warmupCountRef.current);

                    setIsScannerWarmup(true);
                    addAuditLog('Cycle complete. Scanner warming up for 60s before next cycle…', 'info');

                    // Re-subscribe all markets so scanner gets fresh ticks
                    TARGET_MARKETS.forEach(m => ensureScanner(m.value));

                    // Countdown display
                    const WARMUP_SECS = 60;
                    let remaining = WARMUP_SECS;
                    setNextExecCd(`${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`);

                    warmupCountRef.current = setInterval(() => {
                        remaining -= 1;
                        if (remaining <= 0) {
                            if (warmupCountRef.current) clearInterval(warmupCountRef.current);
                            setNextExecCd(null);
                            return;
                        }
                        const m = Math.floor(remaining / 60).toString().padStart(2, '0');
                        const s = (remaining % 60).toString().padStart(2, '0');
                        setNextExecCd(`${m}:${s}`);
                    }, 1000);

                    // After warmup fires: pick best market and restart engine
                    scannerWarmupRef.current = setTimeout(() => {
                        if (warmupCountRef.current) clearInterval(warmupCountRef.current);
                        warmupTriggeredRef.current = false;
                        setIsScannerWarmup(false);
                        setNextExecCd(null);

                        const preset = selectedPresetRef.current;
                        const liveRegimes = useScannerStore.getState().marketRegimes;
                        const ranked = TARGET_MARKETS.map(m => {
                            const r = liveRegimes[m.value];
                            if (!r?.historyReady) return { symbol: m.value, label: m.label, score: -1 };
                            if (preset === 'differ_1') {
                                const { count } = getTopAlternatingPairAndCount((r.digits || []).slice(-100));
                                return { symbol: m.value, label: m.label, score: count };
                            }
                            if (preset === 'differ_2') {
                                const digits = r.digits || [];
                                const last100 = digits.slice(-100);
                                if (last100.length === 0) return { symbol: m.value, label: m.label, score: -1 };
                                let consecEvens = 0;
                                for (let i = last100.length - 1; i >= 0; i--) {
                                    if (last100[i] % 2 === 0) consecEvens++;
                                    else break;
                                }
                                if (consecEvens < 5) return { symbol: m.value, label: m.label, score: consecEvens - 100 };
                                const oddCount = last100.filter(d => d % 2 !== 0).length;
                                const pct = (oddCount / last100.length) * 100;
                                return { symbol: m.value, label: m.label, score: pct };
                            }
                            const gap = r.details?.gap || 0;
                            return { symbol: m.value, label: m.label, score: Math.round(gap * 200) };
                        })
                        .filter(m => m.symbol !== lastTradedMarketRef.current)
                        .sort((a, b) => b.score - a.score);

                        const best = ranked[0];
                        if (!best || best.score < 0) {
                            addAuditLog('⚠️ No suitable market found after warmup. Retrying next cycle.', 'warn');
                            return;
                        }

                        // Apply best market
                        setSelectedMarket(best.symbol);
                        setMarket(best.symbol);
                        subscribeToMarket(best.symbol);

                        if (preset === 'differ_1') {
                            const freshRegimes = useScannerStore.getState().marketRegimes;
                            const r = freshRegimes[best.symbol];
                            const last100 = (r?.digits || []).slice(-100);
                            const { pair, count } = getTopAlternatingPairAndCount(last100);
                            // ── React state (UI sync) ────────────────────────────
                            setEntryDigits(pair);
                            setPipelineMode('sequential');
                            setStorePipelineMode('sequential');
                            setPipelineSteps([
                                { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                                { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                            ]);
                            setContractType('DIGITDIFF');
                            setPrediction(pair[0]);
                            // ── Zustand store (engine sync — synchronous, no React render needed) ──
                            const store = useDerivStore.getState();
                            store.setPrediction(pair[0]);
                            store.setContractType('DIGITDIFF');
                            store.setPipelineSteps([
                                { id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 },
                                { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 },
                            ]);
                            store.setTrigger('entryDigit', {
                                enabled: true,
                                entryDigit: pair[0],
                                triggerOnEntry: true,
                                consecutive: 2,
                                type: 'Under',
                                monitorTicks: 10,
                                multiDigits: pair,
                                useMulti: true
                            });
                            store.setTriggerMode('sequential');
                            addAuditLog(`🔄 Warmup done → ${best.label} | Pair: [${pair.join(', ')}] (${count} patterns)`, 'success');
                        } else if (preset === 'differ_2') {
                            const freshRegimes = useScannerStore.getState().marketRegimes;
                            const r = freshRegimes[best.symbol];
                            const last100 = (r?.digits || []).slice(-100);
                            const { pair, count } = getTopOddPair(last100);
                            // ── React state (UI sync) ────────────────────────────
                            setEntryDigits(pair);
                            setPipelineMode('sequential');
                            setStorePipelineMode('sequential');
                            setPipelineSteps([
                                { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                                { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                            ]);
                            setContractType('DIGITDIFF');
                            setPrediction(pair[0]);
                            // ── Zustand store (engine sync — synchronous, no React render needed) ──
                            const store = useDerivStore.getState();
                            store.setPrediction(pair[0]);
                            store.setContractType('DIGITDIFF');
                            store.setPipelineSteps([
                                { id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 },
                                { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 },
                            ]);
                            store.setTrigger('entryDigit', {
                                enabled: true,
                                entryDigit: pair[0],
                                triggerOnEntry: false,
                                consecutive: 5,
                                type: 'Even',
                                monitorTicks: 10,
                                multiDigits: pair,
                                useMulti: true
                            });
                            store.setTriggerMode('sequential');
                            addAuditLog(`🔄 Warmup done → ${best.label} | Top Odds: [${pair.join(', ')}]`, 'success');
                        } else {
                            addAuditLog(`🔄 Warmup done → Best: ${best.label} (Score: ${best.score})`, 'success');
                        }

                        const s = calcStake();
                        setCurrentStake(s);
                        setRiskSettings({
                            initialStake: Number(s),
                            maxMartingaleSteps: Number(maxMartSteps),
                            martingaleMultiplier: isMartingaleEnabled ? Number(martingaleMul) : 1.0,
                            stopOnMaxSteps: stopOnMaxSteps,
                            takeProfit: Number(takeProfit),
                            stopLoss: Number(stopLoss),
                        });
                        setCurStep(0);
                        setCurRep(0);
                        curStepRef.current = 0;
                        curRepRef.current = 0;
                        lastIdRef.current = null;
                        startBot();
                    }, WARMUP_SECS * 1000);
                }
            }
        }
    }

    }, [tradeLogs, isRunningAuto, cycleInterval, tradesPerCycle, isMartingaleEnabled, martingaleMul, maxMartSteps, stopOnMaxSteps, takeProfit, stopLoss, selectedPreset, marketRegimes, handlePlaylistTradeSettled]);

    // ── LaxPrime Trade Log Watcher ──────────────────────────────────────────
    useEffect(() => {
        if (!isRunningAuto) return;
        // In trade_playlist preset, strictly ignore botTradeLogs unless the currently executing step is LaxPrime
        if (selectedPreset === 'trade_playlist' && (activeStepSourceRef.current !== 'laxprime' || playlistStatusRef.current !== 'executing')) {
            return;
        }
        if (botTradeLogs.length === 0) return;

        const latest = botTradeLogs[0];
        if (!latest) return;

        const isWon = latest.result === 'WON';
        const isLost = latest.result === 'LOST';
        if (!isWon && !isLost) return; // Only process settled real trades

        const logKey = `${latest.id}::${latest.result}`;
        if (lastBotLogIdRef.current === logKey) return;
        lastBotLogIdRef.current = logKey;

        const profit   = Number(latest.profit) || 0;
        const stakeVal = Number(latest.stake) || Number(currentStake);

        setSessionTrades(p => p + 1);
        if (isWon) setSessionWins(p => p + 1); else setSessionLosses(p => p + 1);

        const nextProfit = sessionProfRef.current + profit;
        sessionProfRef.current = nextProfit;
        setSessionProfit(nextProfit);

        // Update compounded stake immediately for next step
        const base = parseFloat(baseStake) || 1.0;
        let nextStakeVal = base;
        if (isCapitalCompound) {
            const bal = account?.balance || 0;
            if (bal > 0) nextStakeVal = Math.max(0.35, bal * (parseFloat(capitalPct) / 100));
        } else if (isCompounding && nextProfit > 0) {
            const comp = base + nextProfit * (parseFloat(compoundPct) / 100);
            nextStakeVal = Math.max(base, comp);
        }
        const nextStakeStr = nextStakeVal.toFixed(2);
        setCurrentStake(nextStakeStr);

        setMktTrades(p => p + 1);
        setTriggersFired(p => p + 1);

        const actualMarket = latest.symbol || 'LaxPrime';
        const mktLabel = TARGET_MARKETS.find(m => m.value === latest.symbol)?.label.replace(' Index', '') || actualMarket;

        const record: AutoLXTradeRecord = {
            id:           latest.id || uid(),
            time:         new Date(latest.time || Date.now()).toLocaleTimeString([], { hour12: false }),
            market:       actualMarket,
            contractType: latest.contract || '—',
            entrySpot:    latest.entrySpot || '—',
            exitDigit:    latest.exitSpot ? Number(String(latest.exitSpot).slice(-1)) : null,
            stake:        stakeVal,
            profit,
            result:       isWon ? 'WIN' : 'LOSS',
            isVirtual:    false,
        };

        setTradeLog(prev => {
            if (prev.some(r => String(r.id) === String(record.id))) return prev;
            return [record, ...prev].slice(0, 300);
        });

        addAuditLog(
            `[${mktLabel}] [${latest.contract || 'TRADE'}] ${isWon ? '✓ WIN' : '✗ LOSS'} | Exit: ${latest.exitSpot ?? '?'} | P/L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`,
            isWon ? 'success' : 'error'
        );

        // ── Autonomous Trade Playlist mode settlement (LaxPrime) ──────────
        if (selectedPreset === 'trade_playlist') {
            if (activeStepSourceRef.current === 'laxprime' && playlistStatusRef.current === 'executing') {
                handlePlaylistTradeSettled(profit, stakeVal, isWon, latest.exitSpot ? String(latest.exitSpot) : null, latest.contract || 'DIGITDIFF');
            }
            return;
        }
    }, [botTradeLogs, isRunningAuto, selectedPreset, isCompounding, compoundPct, isCapitalCompound, capitalPct, baseStake, account?.balance, currentStake, handlePlaylistTradeSettled, addAuditLog]);




    // ── Market ratings ─────────────────────────────────────────────────────
    const marketRatings = useMemo(() => {
        return TARGET_MARKETS.map(m => {
            const r = marketRegimes[m.value];
            const s = signals[m.value];
            let score = 0, rating: 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'AVOID' = 'NEUTRAL', rationale = 'Scanning...';
            
            if (r?.historyReady) {
                if (selectedPreset === 'differ_1') {
                    const digits = r.digits || [];
                    const last100 = digits.slice(-100);
                    const { pair, count } = getTopAlternatingPairAndCount(last100);
                    score = count;
                    rating = count >= 12 ? 'EXCELLENT' : count >= 8 ? 'GOOD' : count >= 5 ? 'NEUTRAL' : 'AVOID';
                    rationale = `Top Pair: {${pair.join(', ')}} (Alternation Count: ${count})`;
                } else if (selectedPreset === 'differ_2') {
                    const digits = r.digits || [];
                    const last100 = digits.slice(-100);
                    if (last100.length > 0) {
                        let consecEvens = 0;
                        for (let i = last100.length - 1; i >= 0; i--) {
                            if (last100[i] % 2 === 0) consecEvens++;
                            else break;
                        }
                        const oddCount = last100.filter((d: number) => d % 2 !== 0).length;
                        const pct = (oddCount / last100.length) * 100;
                        const { pair } = getTopOddPair(last100);
                        if (consecEvens >= 5) {
                            score = Math.round(pct * 10);
                            rating = pct >= 55 ? 'EXCELLENT' : pct >= 50 ? 'GOOD' : pct >= 45 ? 'NEUTRAL' : 'AVOID';
                            rationale = `Evens: ${consecEvens} | Odd%: ${pct.toFixed(1)}% | Top Odds: [${pair.join(', ')}]`;
                        } else {
                            score = consecEvens;
                            rating = 'AVOID';
                            rationale = `Waiting for 5 evens (Current: ${consecEvens}/5) | Odd%: ${pct.toFixed(1)}%`;
                        }
                    }
                } else if (r.details) {
                    score = Math.round(r.details.gap * 200 + r.details.top3Sum * 100);
                    if (r.regime !== 'NEUTRAL') {
                        score += 50;
                        rating = r.details.gap >= 0.08 ? 'EXCELLENT' : 'GOOD';
                        rationale = `${r.regime} (Gap: ${(r.details.gap * 100).toFixed(1)}%)`;
                    } else if (r.details.gap >= 0.05) {
                        rating = 'GOOD'; rationale = `Imbalance forming (${(r.details.gap * 100).toFixed(1)}%)`;
                    } else {
                        rationale = 'Symmetric distribution';
                    }
                    if (s != null && s.confidence != null && s.confidence >= 75) { score += 80; rating = 'EXCELLENT'; rationale = `Reversal signal (${s.confidence}%)`; }
                }
            }

            return { symbol: m.value, label: m.label, score, rating, rationale, gap: r?.details?.gap || 0 };
        }).sort((a, b) => b.score - a.score);
    }, [marketRegimes, signals, selectedPreset]);

    useEffect(() => {
        marketRatingsRef.current = marketRatings;
    }, [marketRatings]);

    // ── Watchdog loop ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!isRunningAuto) {
            if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
            if (cdRef.current)       { clearInterval(cdRef.current);       cdRef.current = null;       }
            cycleEndRef.current = null;
            setNextExecCd(null);
            return;
        }

        watchdogRef.current = setInterval(() => {
            if (tradingStatus === 'disconnected') {
                addAuditLog('Watchdog: Connection lost. Awaiting recovery…', 'warn');
                return;
            }
            const tp = parseFloat(takeProfit), sl = parseFloat(stopLoss);
            const curPL = sessionProfRef.current;
            if (curPL >= tp)                          { addAuditLog(`TP Hit! +$${curPL.toFixed(2)}`, 'success');  handleStop(); return; }
            if (curPL <= -sl)                         { addAuditLog(`SL Hit! -$${Math.abs(curPL).toFixed(2)}`, 'error');     handleStop(); return; }
            if (sessionWinsRef.current >= Number(maxWinsCap))   { addAuditLog(`Win cap hit (${sessionWinsRef.current})`, 'success'); handleStop(); return; }
            if (sessionTrRef.current   >= Number(maxTradesCap)) { addAuditLog(`Trade cap hit (${sessionTrRef.current})`, 'warn');    handleStop(); return; }

            if (cycleInterval === 'continuous' && !isEngineRunning && !isScannerWarmup && tradingStatus === 'connected') {
                const s = calcStake(); setCurrentStake(s);
                setRiskSettings({ initialStake: Number(s) });
                startBot();
            }
        }, 8000);

        if (cycleInterval !== 'continuous') {
            let intervalMs = 3_600_000;
            if (cycleInterval === '15m')  intervalMs = 900_000;
            else if (cycleInterval === '30m') intervalMs = 1_800_000;
            else if (cycleInterval === '2h')  intervalMs = 7_200_000;
            if (!cycleEndRef.current) {
                cycleEndRef.current = Date.now() + intervalMs;
            }
            if (cdRef.current) clearInterval(cdRef.current);
            cdRef.current = setInterval(() => {
                if (!cycleEndRef.current) return;
                const diff = cycleEndRef.current - Date.now();
                if (diff <= 0) {
                    stopBot();
                    lastTradedMarketRef.current = selectedMarket;

                    // Clear any previous warmup timers
                    if (scannerWarmupRef.current) clearTimeout(scannerWarmupRef.current);
                    if (warmupCountRef.current)   clearInterval(warmupCountRef.current);

                    setIsScannerWarmup(true);
                    addAuditLog('Interval complete. Scanner warming up for 60s before next cycle…', 'info');

                    // Re-subscribe all markets so scanner gets fresh ticks
                    TARGET_MARKETS.forEach(m => ensureScanner(m.value));

                    // Countdown display
                    const WARMUP_SECS = 60;
                    let remaining = WARMUP_SECS;
                    setNextExecCd(`${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`);

                    warmupCountRef.current = setInterval(() => {
                        remaining -= 1;
                        if (remaining <= 0) {
                            if (warmupCountRef.current) clearInterval(warmupCountRef.current);
                            setNextExecCd(null);
                            return;
                        }
                        const m = Math.floor(remaining / 60).toString().padStart(2, '0');
                        const s = (remaining % 60).toString().padStart(2, '0');
                        setNextExecCd(`${m}:${s}`);
                    }, 1000);

                    // Set the next cycle end time now (add warmup seconds so interval remains constant)
                    cycleEndRef.current = Date.now() + intervalMs + (WARMUP_SECS * 1000);

                    scannerWarmupRef.current = setTimeout(() => {
                        if (warmupCountRef.current) clearInterval(warmupCountRef.current);
                        setIsScannerWarmup(false);
                        setNextExecCd(null);

                        const preset = selectedPresetRef.current;
                        const liveRegimes = useScannerStore.getState().marketRegimes;
                        const ranked = TARGET_MARKETS.map(m => {
                            const r = liveRegimes[m.value];
                            if (!r?.historyReady) return { symbol: m.value, label: m.label, score: -1 };
                            if (preset === 'differ_1') {
                                const { count } = getTopAlternatingPairAndCount((r.digits || []).slice(-100));
                                return { symbol: m.value, label: m.label, score: count };
                            }
                            if (preset === 'differ_2') {
                                const digits = r.digits || [];
                                const last100 = digits.slice(-100);
                                if (last100.length === 0) return { symbol: m.value, label: m.label, score: -1 };
                                let consecEvens = 0;
                                for (let i = last100.length - 1; i >= 0; i--) {
                                    if (last100[i] % 2 === 0) consecEvens++;
                                    else break;
                                }
                                if (consecEvens < 5) return { symbol: m.value, label: m.label, score: consecEvens - 100 };
                                const oddCount = last100.filter(d => d % 2 !== 0).length;
                                const pct = (oddCount / last100.length) * 100;
                                return { symbol: m.value, label: m.label, score: pct };
                            }

                            const gap = r.details?.gap || 0;
                            return { symbol: m.value, label: m.label, score: Math.round(gap * 200) };
                        })
                        .filter(m => m.symbol !== lastTradedMarketRef.current)
                        .sort((a, b) => b.score - a.score);

                        const best = ranked[0];
                        if (best && best.score >= 0) {
                            setSelectedMarket(best.symbol);
                            setMarket(best.symbol);
                            subscribeToMarket(best.symbol);

                            if (preset === 'differ_1') {
                                const freshRegimes = useScannerStore.getState().marketRegimes;
                                const r = freshRegimes[best.symbol];
                                const last100 = (r?.digits || []).slice(-100);
                                const { pair, count } = getTopAlternatingPairAndCount(last100);
                                // ── React state (UI sync) ────────────────────────────
                                setEntryDigits(pair);
                                setPipelineMode('sequential');
                                setStorePipelineMode('sequential');
                                const newSteps = [
                                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                                ];
                                setPipelineSteps(newSteps);
                                setContractType('DIGITDIFF');
                                setPrediction(pair[0]);
                                // ── Zustand store (engine sync — synchronous, no React render needed) ──
                                const store = useDerivStore.getState();
                                store.setPrediction(pair[0]);
                                store.setContractType('DIGITDIFF');
                                store.setPipelineSteps([
                                    { id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 },
                                    { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 },
                                ]);
                                store.setTrigger('entryDigit', {
                                    enabled: true,
                                    entryDigit: pair[0],
                                    triggerOnEntry: true,
                                    consecutive: 2,
                                    type: 'Under',
                                    monitorTicks: 10,
                                    multiDigits: pair,
                                    useMulti: true
                                });
                                store.setTriggerMode('sequential');
                                addAuditLog(`🔄 Interval warmup done → ${best.label} | Pair: [${pair.join(', ')}] (${count} patterns)`, 'success');
                            } else if (preset === 'differ_2') {
                                const freshRegimes = useScannerStore.getState().marketRegimes;
                                const r = freshRegimes[best.symbol];
                                const last100 = (r?.digits || []).slice(-100);
                                const { pair, count } = getTopOddPair(last100);
                                // ── React state (UI sync) ────────────────────────────
                                setEntryDigits(pair);
                                setPipelineMode('sequential');
                                setStorePipelineMode('sequential');
                                const newSteps = [
                                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                                ];
                                setPipelineSteps(newSteps);
                                setContractType('DIGITDIFF');
                                setPrediction(pair[0]);
                                // ── Zustand store (engine sync — synchronous, no React render needed) ──
                                const store = useDerivStore.getState();
                                store.setPrediction(pair[0]);
                                store.setContractType('DIGITDIFF');
                                store.setPipelineSteps([
                                    { id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 },
                                    { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 },
                                ]);
                                store.setTrigger('entryDigit', {
                                    enabled: true,
                                    entryDigit: pair[0],
                                    triggerOnEntry: false,
                                    consecutive: 5,
                                    type: 'Even',
                                    monitorTicks: 10,
                                    multiDigits: pair,
                                    useMulti: true
                                });
                                store.setTriggerMode('sequential');
                                addAuditLog(`🔄 Interval warmup done → ${best.label} | Top Odds: [${pair.join(', ')}]`, 'success');
                            } else {
                                addAuditLog(`🔄 Interval warmup done → Best: ${best.label} (Score: ${best.score})`, 'success');
                            }
                        }

                        cycleTradesCountRef.current = 0;
                        setCycleTradesCount(0);
                        const s = calcStake(); setCurrentStake(s);
                        setRiskSettings({
                            initialStake: Number(s),
                            maxMartingaleSteps: Number(maxMartSteps),
                            martingaleMultiplier: isMartingaleEnabled ? Number(martingaleMul) : 1.0,
                            stopOnMaxSteps: stopOnMaxSteps,
                            takeProfit: Number(takeProfit),
                            stopLoss: Number(stopLoss),
                        });
                        setCurStep(0); setCurRep(0);
                        curStepRef.current = 0;
                        curRepRef.current = 0;
                        lastIdRef.current = null;
                        startBot();
                    }, WARMUP_SECS * 1000);
                } else {
                    const m = Math.floor(diff / 60000).toString().padStart(2, '0');
                    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                    setNextExecCd(`${m}:${s}`);
                }
            }, 1000);
        }

        return () => {
            if (watchdogRef.current) clearInterval(watchdogRef.current);
            if (cdRef.current)       clearInterval(cdRef.current);
        };
    // isScannerWarmup is in the dep array so the watchdog closure is never stale
    // — without it the watchdog would always read the initial false value and would
    // restart the engine even during warmup.
    }, [isRunningAuto, tradingStatus, isEngineRunning, cycleInterval, isScannerWarmup, takeProfit, stopLoss, maxWinsCap, maxTradesCap, tradesPerCycle, isMartingaleEnabled, martingaleMul, maxMartSteps, stopOnMaxSteps, selectedPreset, marketRegimes]);

    // ── Start ──────────────────────────────────────────────────────────────
    const handleStart = () => {
        if (tradingStatus !== 'connected') { alert('Connect the Deriv trading hook first.'); return; }

        setCurStep(0); setCurRep(0);
        setIsRunningAuto(true);
        setUptimeStart(Date.now());
        setSessionProfit(0); setSessionWins(0); setSessionLosses(0); setSessionTrades(0);
        setMktTrades(0); setTriggersFired(0);
        setTradeLog([]); setAuditLogs([]);
        cycleTradesCountRef.current = 0;
        setCycleTradesCount(0);
        lastIdRef.current = null;
        sessionProfRef.current = 0;

        // ── Autonomous Trade Playlist mode ────────────────────────────────────
        if (selectedPreset === 'trade_playlist') {
            setPlaylistStepResults({});
            playlistCurrentStepIdxRef.current = 0;
            setPlaylistCurrentStepIdx(0);
            activeStepSourceRef.current = null;
            stepLaunchTimeRef.current = Date.now();

            // Snapshot existing trade logs so historical logs are never treated as new settlements
            const currentBotLogs = useBotStore.getState().tradeLogs;
            const currentDerivLogs = useDerivStore.getState().tradeLogs;
            lastBotLogIdRef.current = currentBotLogs[0] ? `${currentBotLogs[0].id}::${currentBotLogs[0].result}` : '__INIT__';
            lastIdRef.current = currentDerivLogs[0] ? `${currentDerivLogs[0].requestId}::${currentDerivLogs[0].result}` : '__INIT__';

            const steps = playlistStepsRef.current;
            if (!steps || steps.length === 0) {
                addAuditLog('⚠️ Playlist is empty! Please add at least 1 trade step.', 'warn');
                return;
            }
            const step0 = steps[0];
            const srcLabel = step0.source === 'laxprime' ? 'LaxPrime' : 'LaxSniper XV';
            addAuditLog('⚡ Autonomous Trade Playlist launched.', 'success');
            addAuditLog(`📋 Playlist contains ${steps.length} steps · Loop: ${playlistLoopRef.current ? 'ENABLED' : 'DISABLED'} · Compounding: ACTIVE`, 'info');

            if (step0.delayMinutes <= 0) {
                addAuditLog(`🚀 Step 1 starting immediately using ${srcLabel}...`, 'info');
                setTimeout(() => executePlaylistStep(0), 500);
            } else {
                addAuditLog(`⏳ Step 1 initial countdown: ${step0.delayMinutes} min before execution...`, 'info');
                startPlaylistCountdown(step0.delayMinutes * 60, 0);
            }
            return;
        }

        // ── Standard presets: apply stake / market / pipeline now ─────────────
        const s = calcStake();
        setCurrentStake(s);
        setRiskSettings({
            initialStake: Number(s),
            maxMartingaleSteps: Number(maxMartSteps),
            martingaleMultiplier: isMartingaleEnabled ? Number(martingaleMul) : 1.0,
            stopOnMaxSteps: stopOnMaxSteps,
            takeProfit: Number(takeProfit),
            stopLoss: Number(stopLoss),
        });
        const best = marketRatings[0];
        if (best) {
            setMarket(best.symbol);
            setSelectedMarket(best.symbol);
            
            // differ_1: dynamic pair setup on session manual launch
            if (selectedPreset === 'differ_1') {
                const r = marketRegimes[best.symbol];
                const last100 = (r?.digits || []).slice(-100);
                const { pair, count } = getTopAlternatingPairAndCount(last100);
                const newSteps = [
                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                ];
                setEntryDigits(pair);
                setPipelineMode('sequential');
                setStorePipelineMode('sequential');
                setPipelineSteps(newSteps);
                // Synchronously push to Zustand so the engine reads the correct pair
                // on the very first tick (before React re-renders applyStep's closure)
                const _s = useDerivStore.getState();
                _s.setPrediction(pair[0]);
                _s.setContractType('DIGITDIFF');
                _s.setPipelineSteps(newSteps);
                _s.setTrigger('entryDigit', { enabled: false, entryDigit: pair[0], multiEnabled: true, multiDigits: pair, monitorTicks: 10 });
                _s.setTriggerMode('sequential');
                addAuditLog(`differ 1 launch setup: Selected entry digits ${pair.join(', ')} for market ${best.label} (Pattern Count: ${count})`, 'info');
                // applyStep with explicit pair so stale closure is bypassed
                applyStep(0, pair[0], 'DIGITDIFF');
            } else if (selectedPreset === 'differ_2') {
                // differ_2: pick highest-odd-% market, extract top 2 odd digits
                const r = marketRegimes[best.symbol];
                const last100 = (r?.digits || []).slice(-100);
                const { pair, count } = getTopOddPair(last100);
                const newSteps = [
                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                ];
                setPipelineMode('sequential');
                setStorePipelineMode('sequential');
                setPipelineSteps(newSteps);
                setEntryDigits(pair);
                setEntryDigitEnabled(true);
                setInstantTrigger(true);
                setDigitPatternEnabled(false);

                // Push to Zustand synchronously so engine sees it on tick 1
                const _s2 = useDerivStore.getState();
                _s2.setPrediction(pair[0]);
                _s2.setContractType('DIGITDIFF');
                _s2.setPipelineSteps(newSteps);
                _s2.setTrigger('entryDigit', {
                    enabled: true,
                    entryDigit: pair[0],
                    multiDigits: pair,
                    useMulti: true,
                    triggerOnEntry: true,
                    consecutive: 2,
                    type: 'Under',
                    monitorTicks: 10
                });
                _s2.setTrigger('digitPattern', { enabled: false });
                _s2.setTriggerMode('sequential');
                addAuditLog(`differ 2 launch: Market=${best.label} | Top odd pair: [${pair.join(', ')}] (${count} odd hits)`, 'info');
                applyStep(0, pair[0], 'DIGITDIFF', newSteps);
            } else {
                applyStep(0);
            }
        }
        if (virtualSettings.startVirtualToReal) {
            setVirtualSettings({
                isVirtualMode: true,
                virtualWins: 0, virtualLosses: 0,
                vConsecWins: 0, vConsecLosses: 0,
                realWins: 0,    realLosses: 0,
                rConsecWins: 0, rConsecLosses: 0,
            });
        }
        addAuditLog('AUTO-LX Session launched.', 'success');
        addAuditLog(`Market: ${best?.label || selectedMarket} | Stake: $${s} | Mode: ${pipelineMode}`, 'info');
        if (entryDigitEnabled) {
            const displayDigits = selectedPreset === 'differ_1' && best ? (
                getTopAlternatingPairAndCount((marketRegimes[best.symbol]?.digits || []).slice(-100)).pair
            ) : entryDigits;
            addAuditLog(`Entry Digits: [${displayDigits.join(', ')}]${instantTrigger ? ' · Instant' : ''}`, 'info');
        }
        if (digitPatternEnabled) addAuditLog(`Digit Pattern: ${patternBoxes.length} boxes active`, 'info');
        setTimeout(() => startBot(), 1500);
    };

    // ── Stop ───────────────────────────────────────────────────────────────
    const handleStop = () => {
        setIsRunningAuto(false);
        setUptimeStart(null);
        // Cancel any pending scanner warmup so it doesn't restart the engine
        if (scannerWarmupRef.current) { clearTimeout(scannerWarmupRef.current);  scannerWarmupRef.current = null; }
        if (warmupCountRef.current)   { clearInterval(warmupCountRef.current);    warmupCountRef.current   = null; }
        setIsScannerWarmup(false);
        setNextExecCd(null);
        stopBot();
        useBotStore.getState().stopBot();

        if (playlistCountdownTimerRef.current) {
            clearInterval(playlistCountdownTimerRef.current);
            playlistCountdownTimerRef.current = null;
        }
        setPlaylistCountdownSecs(0);
        setPlaylistStatus('idle');

        addAuditLog('AUTO-LX Session terminated.', 'warn');
    };

    // ── Presets Handler ─────────────────────────────────────────────────────
    const handlePresetChange = (preset: string) => {
        setSelectedPreset(preset);
        if (preset === 'custom') return;

        addAuditLog(`Applying preset: ${preset.toUpperCase()}`, 'info');

        if (preset === 'rise_fall') {
            setPipelineSteps([
                { id: uid(), contractType: 'CALL', prediction: 0, reps: 1 },
                { id: uid(), contractType: 'PUT', prediction: 0, reps: 1 },
            ]);
            setPipelineMode('sequential');
            setAdaptiveSwitch(true);
            setEntryDigitEnabled(true);
            setEntryDigits([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            setInstantTrigger(true);
            setDigitPatternEnabled(false);
            setTradePattern(['trade']);
            setIsCompounding(false);
            setIsCapitalCompound(true);
            setCapitalPct('2.0');
        } else if (preset === 'even_odd') {
            setPipelineSteps([
                { id: uid(), contractType: 'DIGITEVEN', prediction: 0, reps: 1 },
                { id: uid(), contractType: 'DIGITODD', prediction: 0, reps: 1 },
            ]);
            setPipelineMode('sequential');
            setAdaptiveSwitch(false);
            setEntryDigitEnabled(true);
            setEntryDigits([2, 4, 6, 8]);
            setInstantTrigger(true);
            setDigitPatternEnabled(false);
            setTradePattern(['trade']);
            setIsCompounding(true);
            setCompoundPct('50.0');
            setIsCapitalCompound(false);
        } else if (preset === 'differs') {
            setPipelineSteps([
                { id: uid(), contractType: 'DIGITDIFF', prediction: 4, reps: 1 },
                { id: uid(), contractType: 'DIGITDIFF', prediction: 5, reps: 1 },
            ]);
            setPipelineMode('sequential');
            setAdaptiveSwitch(false);
            setEntryDigitEnabled(true);
            setEntryDigits([4, 5]);
            setInstantTrigger(true);
            setDigitPatternEnabled(false);
            setTradePattern(['skip', 'trade']);
            setIsCompounding(true);
            setCompoundPct('25.0');
            setIsCapitalCompound(false);
        } else if (preset === 'over_under') {
            setPipelineSteps([
                { id: uid(), contractType: 'DIGITOVER', prediction: 2, reps: 1 },
                { id: uid(), contractType: 'DIGITUNDER', prediction: 7, reps: 1 },
            ]);
            setPipelineMode('sequential');
            setAdaptiveSwitch(true);
            setEntryDigitEnabled(false);
            setDigitPatternEnabled(true);
            setPatternBoxes([
                { id: uid(), type: 'U', digit: 7, contractType: 'DIGITUNDER' },
                { id: uid(), type: 'V', digit: 2, contractType: 'DIGITOVER'  },
                { id: uid(), type: 'M', digit: 5, contractType: 'DIGITMATCH' },
                { id: uid(), type: 'V', digit: 0, contractType: 'DIGITOVER'  },
            ]);
            setCompareDigit(2);
            setTradePattern(['trade']);
            setIsCompounding(false);
            setIsCapitalCompound(true);
            setCapitalPct('1.5');
        } else if (preset === 'differ_1') {
            // ── Pipeline: both Differ contracts fire simultaneously on trigger ──
            // Immediately compute the top alternating pair from live scanner data;
            // fall back to [4,5] placeholder if history is not yet ready.
            const allMarketData = useScannerStore.getState().marketRegimes;
            let initialPair: [number, number] = [4, 5];
            let bestScore = -1;
            for (const [sym, r] of Object.entries(allMarketData)) {
                if (!r.historyReady) continue;
                const last100 = (r.digits || []).slice(-100);
                const { pair, count } = getTopAlternatingPairAndCount(last100);
                if (count > bestScore) { bestScore = count; initialPair = pair; }
            }

            setPipelineSteps([
                { id: uid(), contractType: 'DIGITDIFF', prediction: initialPair[0], reps: 1 },
                { id: uid(), contractType: 'DIGITDIFF', prediction: initialPair[1], reps: 1 },
            ]);
            setPipelineMode('sequential'); // default to sequential, user can toggle in UI
            setAdaptiveSwitch(false);

            // ── Triggers ──
            setEntryDigitEnabled(true);
            setEntryDigits(initialPair); // updated dynamically at each session launch / cycle end
            setInstantTrigger(true);
            setDigitPatternEnabled(false);

            // ── Trade Pattern: 3 skips then 1 trade ──
            setTradePattern(['skip', 'skip', 'skip', 'trade']);

            // ── Continuous Mode: simultaneous tick + trigger monitoring ──
            setContinuousMode('continuous_check');

            // ── Risk: no Martingale, stop on 1st loss ──
            setIsMartingaleEnabled(false);
            setStopLoss('1.00');

            // ── Compounding: profit compounding 50% ──
            setIsCompounding(true);
            setCompoundPct('50.0');
            setIsCapitalCompound(false);

            // ── Virtual: start virtual → real after 1 loss; real → virtual after 3 wins ──
            setVirtualSettings({
                isVirtualMode: true,           // start in virtual mode
                startVirtualToReal: true,
                vTriggerType: 'losses',
                vTriggerMode: 'consec',
                vThreshold: 1,                 // switch to real after 1 consecutive loss
                startRealToVirtual: true,
                rTriggerType: 'wins',
                rTriggerMode: 'consec',
                rThreshold: 3,                 // retreat to virtual after 3 consecutive wins
            });
        } else if (preset === 'differ_2') {
            // ── differ 2: Highest odd-% market with 5+ consecutive evens, ──
            // ── trade DIGITDIFF with top 2 most-frequent odd digits          ──

            // Compute top odd pair from live scanner data.
            // Score each market: must have >= 5 consecutive evens at the end, then rank by odd-digit %.
            const allMarketData = useScannerStore.getState().marketRegimes;
            let initialPair: [number, number] = [1, 3]; // safe fallback
            let bestOddPct = -1;
            let bestSym = '';
            
            // First try matching markets with >= 5 evens
            for (const [sym, r] of Object.entries(allMarketData)) {
                if (!r.historyReady) continue;
                const last100 = (r.digits || []).slice(-100);
                if (last100.length === 0) continue;
                
                let consecEvens = 0;
                for (let i = last100.length - 1; i >= 0; i--) {
                    if (last100[i] % 2 === 0) consecEvens++;
                    else break;
                }
                
                if (consecEvens >= 5) {
                    const oddCount = last100.filter(d => d % 2 !== 0).length;
                    const pct = (oddCount / last100.length) * 100;
                    if (pct > bestOddPct) {
                        bestOddPct = pct;
                        bestSym = sym;
                        const { pair } = getTopOddPair(last100);
                        initialPair = pair;
                    }
                }
            }
            
            // Fallback if no market currently has 5+ consecutive evens
            if (bestOddPct === -1) {
                for (const [sym, r] of Object.entries(allMarketData)) {
                    if (!r.historyReady) continue;
                    const last100 = (r.digits || []).slice(-100);
                    if (last100.length === 0) continue;
                    const oddCount = last100.filter(d => d % 2 !== 0).length;
                    const pct = (oddCount / last100.length) * 100;
                    if (pct > bestOddPct) {
                        bestOddPct = pct;
                        bestSym = sym;
                        const { pair } = getTopOddPair(last100);
                        initialPair = pair;
                    }
                }
            }

            // ── Pipeline: alternating Differ contracts on the two top odd digits ──
            setPipelineSteps([
                { id: uid(), contractType: 'DIGITDIFF', prediction: initialPair[0], reps: 1 },
                { id: uid(), contractType: 'DIGITDIFF', prediction: initialPair[1], reps: 1 },
            ]);
            setPipelineMode('sequential');
            setAdaptiveSwitch(false);

            // ── Triggers: Entry digit trigger A and B, trigger immediately on entry ──
            setEntryDigitEnabled(true);
            setEntryDigits(initialPair);
            setInstantTrigger(true);
            setDigitPatternEnabled(false);

            // ── Trade Pattern ──
            setTradePattern(['trade']);

            // ── Continuous Mode ──
            setContinuousMode('continuous_check');

            // ── Risk ──
            setIsMartingaleEnabled(false);
            setStopLoss('1.00');

            // ── Compounding ──
            setIsCompounding(true);
            setCompoundPct('50.0');
            setIsCapitalCompound(false);

            // ── Virtual: same ladder as differ_1 ──
            setVirtualSettings({
                isVirtualMode: true,
                startVirtualToReal: true,
                vTriggerType: 'losses',
                vTriggerMode: 'consec',
                vThreshold: 1,
                startRealToVirtual: true,
                rTriggerType: 'wins',
                rTriggerMode: 'consec',
                rThreshold: 3,
            });

            addAuditLog(
                `differ 2 preset loaded | Best market: ${bestSym || 'scanning…'} (odd%: ${bestOddPct >= 0 ? bestOddPct.toFixed(1) : '?'}%) | Top odd pair: [${initialPair.join(', ')}]`,
                'info'
            );
        } else if (preset === 'trade_playlist') {
            // ── Autonomous Trade Playlist ─────────────────────────────────────
            // Inherits triggers, strategies, and virtual rules from LaxPrime or
            // LaxSniper XV per step, with customizable inter-trade delays and
            // seamless compounding across all sequential trades.
            setIsCompounding(true);
            setCompoundPct('50.0');
            setIsCapitalCompound(false);
            addAuditLog('⚡ Autonomous Trade Playlist preset loaded. Build your delay chain below.', 'info');
        }
    };

    // ── Pipeline step helpers ──────────────────────────────────────────────
    const addPipelineStep = () => setPipelineSteps(p => [...p, { id: uid(), contractType: 'DIGITDIFF', prediction: 5, reps: 1 }]);
    const delPipelineStep = (id: string) => setPipelineSteps(p => p.filter(s => s.id !== id));
    const updPipelineStep = (id: string, field: keyof PipelineStep, val: any) =>
        setPipelineSteps(p => p.map(s => s.id === id ? { ...s, [field]: val } : s));

    // ── Pattern box helpers ────────────────────────────────────────────────
    const addPatternBox = () => setPatternBoxes(p => [...p, { id: uid(), type: 'D', digit: 5, contractType: 'DIGITDIFF' }]);
    const delPatternBox = (id: string) => setPatternBoxes(p => p.filter(b => b.id !== id));
    const updPatternBox = (id: string, field: keyof DigitPatternBox, val: any) =>
        setPatternBoxes(p => p.map(b => b.id === id ? { ...b, [field]: val } : b));
    const cyclePatternBoxType = (id: string, dir: 1 | -1 = 1) => {
        setPatternBoxes(p => p.map(b => {
            if (b.id !== id) return b;
            const idx = PATTERN_ALL_TYPES.indexOf(b.type);
            const next = PATTERN_ALL_TYPES[(idx + dir + PATTERN_ALL_TYPES.length) % PATTERN_ALL_TYPES.length];
            return { ...b, type: next };
        }));
    };

    // ── Entry digit toggle ─────────────────────────────────────────────────
    const toggleEntryDigit = (d: number) =>
        setEntryDigits(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

    // ── Trade pattern ──────────────────────────────────────────────────────
    const toggleTradeSlot = (i: number) =>
        setTradePattern(p => { const n = [...p]; n[i] = n[i] === 'trade' ? 'skip' : 'trade'; return n; });

    // ── Live stake preview ─────────────────────────────────────────────────
    const capitalPreview = isCapitalCompound
        ? Math.max(0.35, (account?.balance || 0) * (parseFloat(capitalPct) / 100)).toFixed(2)
        : null;

    const winRate = sessionTrades > 0 ? ((sessionWins / sessionTrades) * 100).toFixed(1) : '0.0';

    // ═════════════════════════════════════════════════════════════════════
    // ACCESS DENIED
    // ═════════════════════════════════════════════════════════════════════
    if (!isAuthorized) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4 p-8">
                <div className="w-20 h-20 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                    <ShieldAlert className="w-9 h-9 text-rose-500" />
                </div>
                <h1 className="text-2xl font-black text-white tracking-tight">ACCESS RESTRICTED</h1>
                <p className="text-sm text-gray-400 max-w-md">
                    This interface requires an admin account:{' '}
                    <span className="font-mono text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded">{ADMIN_IDS.join(' / ')}</span>{' '}
                    to be connected.
                </p>
                <div className="mt-2 px-5 py-2.5 bg-white/5 rounded-xl border border-white/10 font-mono text-xs text-gray-500">
                    Currently connected: {account?.loginid || 'Not connected'}
                </div>
            </div>
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // MAIN RENDER
    // ═════════════════════════════════════════════════════════════════════
    return (
        <div className="space-y-5">

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500/20 to-indigo-600/20 border border-teal-500/30 flex items-center justify-center shadow-lg shadow-teal-500/10">
                            <Cpu className="w-5 h-5 text-teal-400" />
                        </div>
                        {isRunningAuto && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-teal-400 border-2 border-[#0e0e14] animate-pulse" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl font-black tracking-tight leading-none">
                                AUTO<span className="text-teal-400">-LX</span>
                            </h1>
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${isRunningAuto ? 'text-teal-400 bg-teal-500/15 border-teal-500/30' : 'text-gray-500 bg-white/5 border-white/10'}`}>
                                {isRunningAuto ? '● ACTIVE' : '○ IDLE'}
                            </span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5 font-medium">Autonomous Execution Engine · Admin Only</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-xl border border-white/5">
                        <span className={`w-1.5 h-1.5 rounded-full ${tradingStatus === 'connected' ? 'bg-teal-400 animate-pulse' : 'bg-rose-500'}`} />
                        <span className="text-[10px] text-gray-400 font-mono font-bold">{tradingStatus.toUpperCase()}</span>
                    </div>
                    {isRunningAuto ? (
                        <button onClick={handleStop}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 font-black text-[10px] uppercase tracking-widest transition-all">
                            <Square className="w-3.5 h-3.5" /> Stop Session
                        </button>
                    ) : (
                        <button onClick={handleStart}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-[#0a0a10] font-black text-[10px] uppercase tracking-widest shadow-lg shadow-teal-500/25 transition-all hover:scale-105 active:scale-95">
                            <Play className="w-3.5 h-3.5" /> Launch AUTO-LX
                        </button>
                    )}
                </div>
            </div>

            {/* ── Stats Strip ────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                    { label: 'P/L',     value: `${sessionProfit >= 0 ? '+' : ''}$${sessionProfit.toFixed(2)}`, color: sessionProfit >= 0 ? 'text-teal-400' : 'text-rose-400', bg: sessionProfit >= 0 ? 'from-teal-500/10' : 'from-rose-500/10' },
                    { label: 'Wins',    value: `${sessionWins}`, color: 'text-emerald-400', bg: 'from-emerald-500/10' },
                    { label: 'Losses',  value: `${sessionLosses}`, color: 'text-rose-400', bg: 'from-rose-500/10' },
                    { label: 'Win %',   value: `${winRate}%`, color: 'text-indigo-400', bg: 'from-indigo-500/10' },
                    { label: 'Stake',   value: `$${currentStake}`, color: 'text-amber-400', bg: 'from-amber-500/10' },
                    { label: 'Uptime',  value: uptimeDisplay, color: 'text-purple-400', bg: 'from-purple-500/10' },
                ].map((s, i) => (
                    <div key={i} className={`bg-gradient-to-br ${s.bg} to-transparent rounded-xl border border-white/5 p-3`}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">{s.label}</p>
                        <p className={`text-base font-black font-mono ${s.color}`}>{s.value}</p>
                    </div>
                ))}
            </div>

            {/* ── Main Layout ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

                {/* ── Left: Config Tabs ──────────────────────────────────── */}
                <div className="xl:col-span-2 space-y-4">

                    {/* Strategy Preset Selector Card */}
                    <div className="bg-white/2 rounded-2xl border border-white/8 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-teal-400" />
                            <div>
                                <p className="text-xs font-bold text-white">Strategy Preset</p>
                                <p className="text-[10px] text-gray-500">Apply a pre-configured trade profile</p>
                            </div>
                        </div>
                        <div className="w-full sm:w-60">
                            <Select
                                value={selectedPreset}
                                onChange={handlePresetChange}
                                disabled={isRunningAuto}
                                options={[
                                    { value: 'trade_playlist', label: '⚡ Autonomous Trade Playlist' },
                                    { value: 'custom', label: 'Custom (Manual)' },
                                    { value: 'differ_1', label: 'differ 1' },
                                    { value: 'differ_2', label: 'differ 2' },
                                    { value: 'rise_fall', label: 'Rise/Fall Follower' },
                                    { value: 'even_odd', label: 'Even/Odd Sequence' },
                                    { value: 'differs', label: 'Differs Shield' },
                                    { value: 'over_under', label: 'Over/Under Trend' },
                                ]}
                            />
                        </div>
                    </div>

                    {/* Tab Bar */}
                    <div className="flex gap-1 bg-white/3 rounded-2xl p-1 border border-white/5">
                        {([
                            { id: 'strategy', label: selectedPreset === 'trade_playlist' ? 'Playlist' : 'Strategy',   icon: <Layers className="w-3.5 h-3.5" /> },
                            { id: 'triggers', label: 'Triggers',   icon: <Target className="w-3.5 h-3.5" /> },
                            { id: 'risk',     label: 'Risk',       icon: <Settings2 className="w-3.5 h-3.5" /> },
                            { id: 'markets',  label: 'Markets',    icon: <BarChart3 className="w-3.5 h-3.5" /> },
                            { id: 'virtual',  label: 'Virtual',    icon: <FlaskConical className="w-3.5 h-3.5" /> },
                        ] as const).map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[11px] font-bold transition-all ${
                                    activeTab === tab.id
                                        ? 'bg-teal-500 text-[#0a0a10] shadow-md shadow-teal-500/25'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                }`}>
                                {tab.icon}
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* ─── STRATEGY TAB ───────────────────────────────────── */}
                    {activeTab === 'strategy' && (
                        <div className="space-y-4">
                            {selectedPreset === 'trade_playlist' ? (
                                <div className="space-y-4">
                                    {/* ── Status & Live Control Bar ── */}
                                    <div className="bg-white/2 rounded-2xl border border-indigo-500/25 p-5 space-y-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                                            <div className="flex items-center gap-2.5">
                                                <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
                                                    <Timer className="w-5 h-5 text-indigo-400" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-bold text-white">Autonomous Trade Playlist</p>
                                                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-black text-indigo-300">
                                                            {playlistSteps.length} STEPS
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-gray-400">Sequential inter-trade delay chain with continuous compounding</p>
                                                </div>
                                            </div>

                                            {/* Live Status Badge */}
                                            {isRunningAuto ? (
                                                <div className="flex items-center gap-2">
                                                    {playlistStatus === 'countdown' && (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[10px] font-black uppercase tracking-wider animate-pulse">
                                                            <Clock className="w-3.5 h-3.5" />
                                                            Cooldown: {nextExecCd || '00:00'} (Step {playlistCurrentStepIdx + 1})
                                                        </span>
                                                    )}
                                                    {playlistStatus === 'executing' && (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-black uppercase tracking-wider animate-pulse">
                                                            <Zap className="w-3.5 h-3.5" />
                                                            Executing Step {playlistCurrentStepIdx + 1}/{playlistSteps.length}
                                                        </span>
                                                    )}
                                                    {playlistStatus === 'completed' && (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-teal-500/30 bg-teal-500/10 text-teal-300 text-[10px] font-black uppercase tracking-wider">
                                                            <Check className="w-3.5 h-3.5" />
                                                            Playlist Completed
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/10 bg-white/5 text-gray-400 text-[10px] font-black uppercase tracking-wider">
                                                    Ready to Launch
                                                </span>
                                            )}
                                        </div>

                                        {/* Loop & Compounding Settings Bar */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                            <div className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                                                <div className="space-y-0.5">
                                                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                                        <Repeat className="w-3.5 h-3.5 text-indigo-400" />
                                                        Continuous Playlist Loop
                                                    </span>
                                                    <p className="text-[9px] text-gray-400">Restart from Step 1 after last step until TP or SL is hit</p>
                                                </div>
                                                <Toggle enabled={playlistLoop} onChange={setPlaylistLoop} disabled={isRunningAuto} />
                                            </div>

                                            <div className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                                                <div className="space-y-0.5">
                                                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                                        Next Stake (Compounded)
                                                    </span>
                                                    <p className="text-[9px] text-gray-400">Current running stake: <span className="font-mono text-emerald-400 font-bold">${currentStake}</span></p>
                                                </div>
                                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-black font-mono text-emerald-400">
                                                    ${currentStake}
                                                </span>
                                            </div>
                                        </div>

                                        {/* ── Quick-Add Delay Badges Bar ── */}
                                        <div className="pt-2">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                                                    <Plus className="w-3.5 h-3.5 text-teal-400" />
                                                    Quick-Add Step with Delay (Starts after previous trade closes):
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {QUICK_DELAY_OPTIONS.map(mins => (
                                                    <button
                                                        key={mins}
                                                        onClick={() => addPlaylistStep(mins)}
                                                        disabled={isRunningAuto}
                                                        className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/30 text-gray-300 hover:text-indigo-300 text-xs font-black font-mono transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                                                    >
                                                        +{mins}m
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => addPlaylistStep(0)}
                                                    disabled={isRunningAuto}
                                                    className="px-3 py-1.5 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 text-teal-300 text-xs font-black transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
                                                >
                                                    +Immediate (0m)
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── Playlist Step Cards (Interactive Sequence List) ── */}
                                    <div className="space-y-3">
                                        {playlistSteps.map((step, idx) => {
                                            const isActive = isRunningAuto && playlistCurrentStepIdx === idx && playlistStatus === 'executing';
                                            const isCountingDown = isRunningAuto && playlistCurrentStepIdx === idx && playlistStatus === 'countdown';
                                            const stepResult = playlistStepResults[step.id];
                                            const isExpanded = expandedStepId === step.id;

                                            return (
                                                <div
                                                    key={step.id}
                                                    className={`rounded-2xl border transition-all ${
                                                        isActive
                                                            ? 'border-emerald-500/50 bg-emerald-500/5 shadow-lg shadow-emerald-500/10'
                                                            : isCountingDown
                                                            ? 'border-amber-500/50 bg-amber-500/5 shadow-lg shadow-amber-500/10 animate-pulse'
                                                            : stepResult
                                                            ? stepResult.result === 'WIN'
                                                                ? 'border-emerald-500/20 bg-white/2'
                                                                : 'border-rose-500/20 bg-white/2'
                                                            : 'border-white/8 bg-white/2 hover:border-white/15'
                                                    }`}
                                                >
                                                    <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3">
                                                            {/* Step Number */}
                                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black font-mono transition-all ${
                                                                isActive
                                                                    ? 'bg-emerald-500 text-[#0a0a10] shadow-md shadow-emerald-500/30'
                                                                    : isCountingDown
                                                                    ? 'bg-amber-500 text-[#0a0a10] shadow-md shadow-amber-500/30'
                                                                    : stepResult?.result === 'WIN'
                                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                                    : stepResult?.result === 'LOSS'
                                                                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                                                    : 'bg-white/8 text-gray-400'
                                                            }`}>
                                                                {idx + 1}
                                                            </div>

                                                            {/* Step Info */}
                                                            <div>
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-xs font-black text-white">{step.label || `Step ${idx + 1}`}</span>
                                                                    <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-bold text-indigo-300 uppercase">
                                                                        {step.source === 'laxprime' ? 'LaxPrime' : 'LaxSniper XV'}
                                                                    </span>
                                                                    <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] font-mono font-bold text-gray-300">
                                                                        ⏱️ {step.delayMinutes > 0 ? `${step.delayMinutes}m delay` : 'Immediate'}
                                                                    </span>
                                                                    {step.marketOverride && (
                                                                        <span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 text-[9px] font-mono">
                                                                            {step.marketOverride}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {/* Status Result Preview */}
                                                                {stepResult && (
                                                                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                                                                        <span className={`font-black ${stepResult.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                            {stepResult.result === 'WIN' ? '✓ WON' : '✗ LOST'}
                                                                        </span>
                                                                        <span className="font-mono text-gray-300">
                                                                            {stepResult.profit >= 0 ? '+' : ''}${stepResult.profit.toFixed(2)}
                                                                        </span>
                                                                        {stepResult.exitSpot && (
                                                                            <span className="text-gray-500">· Exit: {stepResult.exitSpot}</span>
                                                                        )}
                                                                        <span className="text-gray-600">· {stepResult.time}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Step Actions */}
                                                        <div className="flex items-center gap-1.5 self-end md:self-auto">
                                                            {/* Delay Input */}
                                                            <div className="flex items-center gap-1 bg-white/5 border border-white/8 rounded-xl px-2 py-1">
                                                                <span className="text-[9px] font-bold text-gray-500 uppercase">Delay</span>
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={120}
                                                                    value={step.delayMinutes}
                                                                    onChange={e => updatePlaylistStep(step.id, { delayMinutes: Math.max(0, Number(e.target.value)) })}
                                                                    disabled={isRunningAuto}
                                                                    className="w-10 text-center bg-transparent text-xs font-black font-mono text-white focus:outline-none"
                                                                />
                                                                <span className="text-[9px] text-gray-500">m</span>
                                                            </div>

                                                            {/* Engine Source Selector */}
                                                            <select
                                                                value={step.source}
                                                                onChange={e => updatePlaylistStep(step.id, { source: e.target.value as any })}
                                                                disabled={isRunningAuto}
                                                                className="bg-white/5 border border-white/8 rounded-xl px-2 py-1 text-xs font-bold text-white focus:outline-none"
                                                            >
                                                                <option value="laxprime">LaxPrime</option>
                                                                <option value="laxsniper-xv">LaxSniper XV</option>
                                                            </select>

                                                            {/* Move up / down */}
                                                            <button
                                                                onClick={() => movePlaylistStep(idx, -1)}
                                                                disabled={isRunningAuto || idx === 0}
                                                                title="Move Step Up"
                                                                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-20 transition-all"
                                                            >
                                                                <ArrowUp className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={() => movePlaylistStep(idx, 1)}
                                                                disabled={isRunningAuto || idx === playlistSteps.length - 1}
                                                                title="Move Step Down"
                                                                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-20 transition-all"
                                                            >
                                                                <ArrowDown className="w-3.5 h-3.5" />
                                                            </button>

                                                            {/* Clone / Duplicate */}
                                                            <button
                                                                onClick={() => duplicatePlaylistStep(step.id)}
                                                                disabled={isRunningAuto}
                                                                title="Duplicate Step"
                                                                className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-20 transition-all"
                                                            >
                                                                <Copy className="w-3.5 h-3.5" />
                                                            </button>

                                                            {/* Toggle Expand fine-tune */}
                                                            <button
                                                                onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                                                                title="Fine-tune Step Overrides"
                                                                className={`p-1.5 rounded-lg transition-all ${isExpanded ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                                                            >
                                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                            </button>

                                                            {/* Delete */}
                                                            <button
                                                                onClick={() => deletePlaylistStep(step.id)}
                                                                disabled={isRunningAuto || playlistSteps.length <= 1}
                                                                title="Delete Step"
                                                                className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20 transition-all"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Optional Expandable Overrides */}
                                                    {isExpanded && (
                                                        <div className="p-4 pt-0 border-t border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                                                            <div>
                                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Market Override</span>
                                                                <select
                                                                    value={step.marketOverride || ''}
                                                                    onChange={e => updatePlaylistStep(step.id, { marketOverride: e.target.value })}
                                                                    disabled={isRunningAuto}
                                                                    className="w-full bg-white/5 border border-white/8 rounded-xl px-2.5 py-1.5 text-xs text-white"
                                                                >
                                                                    <option value="">(Inherit from {step.source})</option>
                                                                    {TARGET_MARKETS.map(m => (
                                                                        <option key={m.value} value={m.value}>{m.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Contract Override</span>
                                                                <select
                                                                    value={step.contractOverride || ''}
                                                                    onChange={e => updatePlaylistStep(step.id, { contractOverride: e.target.value as any })}
                                                                    disabled={isRunningAuto}
                                                                    className="w-full bg-white/5 border border-white/8 rounded-xl px-2.5 py-1.5 text-xs text-white"
                                                                >
                                                                    <option value="">(Inherit from {step.source})</option>
                                                                    {CONTRACT_OPTIONS.map(c => (
                                                                        <option key={c.value} value={c.value}>{c.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Digit Prediction</span>
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={9}
                                                                    placeholder="(Inherit)"
                                                                    value={step.digitOverride !== undefined && step.digitOverride !== null ? step.digitOverride : ''}
                                                                    onChange={e => updatePlaylistStep(step.id, { digitOverride: e.target.value === '' ? null : Number(e.target.value) })}
                                                                    disabled={isRunningAuto}
                                                                    className="w-full bg-white/5 border border-white/8 rounded-xl px-2.5 py-1.5 text-xs text-white"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Add Step Button */}
                                    <button
                                        onClick={() => addPlaylistStep(5)}
                                        disabled={isRunningAuto}
                                        className="w-full py-3 rounded-2xl border-2 border-dashed border-white/10 hover:border-indigo-500/40 text-gray-400 hover:text-indigo-300 text-xs font-black flex items-center justify-center gap-2 transition-all hover:bg-indigo-500/5 disabled:opacity-30"
                                    >
                                        <Plus className="w-4 h-4" /> Add Custom Trade Step (+5m delay)
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* Pipeline Sequence */}
                                    <div className="bg-white/2 rounded-2xl border border-white/8 p-5">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                                                    <Layers className="w-4 h-4 text-indigo-400" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">Pipeline Sequence</p>
                                                    <p className="text-[10px] text-gray-500">{pipelineSteps.length} active steps · {pipelineMode}</p>
                                                </div>
                                            </div>
                                            {/* Mode Switcher */}
                                            <div className="flex bg-white/5 rounded-xl p-0.5 gap-0.5">
                                                {(['sequential', 'simultaneous'] as TriggerMode[]).map(m => (
                                                    <button key={m} onClick={() => setPipelineMode(m)} disabled={isRunningAuto}
                                                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${pipelineMode === m ? 'bg-indigo-500 text-white shadow' : 'text-gray-500 hover:text-white'}`}>
                                                        {m === 'sequential' ? 'Sequential' : 'Simultaneous'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Steps */}
                                        <div className="space-y-2.5">
                                            {pipelineSteps.map((step, idx) => {
                                                const isActive = isRunningAuto && pipelineMode === 'sequential' && curStep === idx;
                                                return (
                                                    <div key={step.id}
                                                        className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${isActive ? 'border-teal-500/40 bg-teal-500/5 shadow-sm shadow-teal-500/10' : 'border-white/5 bg-white/2 hover:border-white/10'}`}>
                                                        {/* Step number */}
                                                        <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black transition-all ${isActive ? 'bg-teal-500 text-[#0a0a10]' : 'bg-white/8 text-gray-400'}`}>
                                                            {idx + 1}
                                                        </div>

                                                        {/* Contract Type */}
                                                        <div className="flex-1 min-w-0">
                                                            <Select
                                                                options={CONTRACT_OPTIONS}
                                                                value={step.contractType}
                                                                onChange={v => updPipelineStep(step.id, 'contractType', v as ContractTypeKey)}
                                                                disabled={isRunningAuto}
                                                            />
                                                        </div>

                                                        {/* Digit */}
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <span className="text-[9px] text-gray-500 font-bold uppercase">Digit</span>
                                                            <input type="number" min={0} max={9} value={step.prediction}
                                                                onChange={e => updPipelineStep(step.id, 'prediction', Number(e.target.value))}
                                                                disabled={isRunningAuto}
                                                                className="w-12 text-center bg-white/5 border border-white/10 rounded-lg text-xs font-black text-white py-1.5 focus:outline-none focus:border-teal-500/50 disabled:opacity-40" />
                                                        </div>

                                                        {/* Reps */}
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <span className="text-[9px] text-gray-500 font-bold uppercase">Reps</span>
                                                            <input type="number" min={1} value={step.reps}
                                                                onChange={e => updPipelineStep(step.id, 'reps', Number(e.target.value))}
                                                                disabled={isRunningAuto}
                                                                className="w-12 text-center bg-white/5 border border-white/10 rounded-lg text-xs font-black text-white py-1.5 focus:outline-none focus:border-teal-500/50 disabled:opacity-40" />
                                                        </div>

                                                        {/* LIVE badge */}
                                                        {isActive && (
                                                            <span className="shrink-0 text-[9px] font-black bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded-md">
                                                                {curRep + 1}/{step.reps}
                                                            </span>
                                                        )}

                                                        {/* Delete */}
                                                        <button onClick={() => delPipelineStep(step.id)}
                                                            disabled={isRunningAuto || pipelineSteps.length <= 1}
                                                            className="shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all disabled:opacity-20">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <button onClick={addPipelineStep} disabled={isRunningAuto}
                                            className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-white/10 hover:border-white/20 text-gray-500 hover:text-white text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-30">
                                            <Plus className="w-3.5 h-3.5" /> Add Step
                                        </button>
                                    </div>

                                    {/* Adaptive Switch */}
                                    <div className={`rounded-2xl border p-4 transition-all ${adaptiveSwitch ? 'border-amber-500/25 bg-amber-500/5' : 'border-white/5 bg-white/2'}`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <div className={`p-1.5 rounded-lg ${adaptiveSwitch ? 'bg-amber-500/15 border border-amber-500/25' : 'bg-white/5'}`}>
                                                    <Shuffle className={`w-4 h-4 ${adaptiveSwitch ? 'text-amber-400' : 'text-gray-500'}`} />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">Adaptive Switch</p>
                                                    <p className="text-[10px] text-gray-500 mt-0.5">On loss → auto-swap Over↔Under · Rise↔Fall</p>
                                                </div>
                                            </div>
                                            <Toggle enabled={adaptiveSwitch} onChange={setAdaptiveSwitch} disabled={isRunningAuto} />
                                        </div>
                                        {adaptiveSwitch && (
                                            <div className="mt-3 flex gap-2 text-[10px]">
                                                {[['OVER → UNDER', 'text-purple-400'], ['RISE → FALL', 'text-amber-400']].map(([label, cls]) => (
                                                    <div key={label} className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/5">
                                                        <ArrowLeftRight className={`w-3 h-3 ${cls}`} />
                                                        <span className="text-gray-400 font-bold">{label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ─── TRIGGERS TAB ──────────────────────────────────── */}
                    {activeTab === 'triggers' && (
                        <div className="space-y-4">
                            {selectedPreset === 'trade_playlist' && (
                                <div className="p-4 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                                        <Sparkles className="w-5 h-5" />
                                    </div>
                                    <div className="text-xs text-indigo-200 leading-relaxed">
                                        <span className="font-bold text-white">Autonomous Trade Playlist Active: </span>
                                        Triggers and entry conditions are dynamically inherited per step from each step's configured engine (<span className="font-semibold text-indigo-300">LaxPrime</span> or <span className="font-semibold text-indigo-300">LaxSniper XV</span>).
                                    </div>
                                </div>
                            )}

                            {/* Entry Digit Detection */}
                            <div className="bg-white/2 rounded-2xl border border-white/8 p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`p-1.5 rounded-lg ${entryDigitEnabled ? 'bg-teal-500/10 border border-teal-500/20' : 'bg-white/5'}`}>
                                            <Eye className={`w-4 h-4 ${entryDigitEnabled ? 'text-teal-400' : 'text-gray-500'}`} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-white">Entry Digit Detection</p>
                                            <p className="text-[10px] text-gray-500">Fire trade when last digit matches selected</p>
                                        </div>
                                    </div>
                                    <Toggle enabled={entryDigitEnabled} onChange={setEntryDigitEnabled} />
                                </div>

                                {entryDigitEnabled && (<>
                                    {/* Digit selector 0-9 */}
                                    <div className="flex gap-1.5 flex-wrap mb-4">
                                        {Array.from({ length: 10 }, (_, d) => d).map(d => (
                                            <button key={d} onClick={() => toggleEntryDigit(d)}
                                                className={`w-9 h-9 rounded-xl text-sm font-black transition-all border ${
                                                    entryDigits.includes(d)
                                                        ? 'bg-teal-500 text-[#0a0a10] border-teal-400 shadow-md shadow-teal-500/30'
                                                        : 'bg-white/5 text-gray-400 border-white/8 hover:border-teal-500/30 hover:text-white'
                                                }`}>
                                                {d}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Instant Trigger Mode */}
                                    <div className="flex items-center justify-between p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl">
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-4 h-4 text-amber-400" />
                                            <div>
                                                <p className="text-xs font-bold text-white">Instant Trigger Mode</p>
                                                <p className="text-[10px] text-gray-500">Fire immediately on digit match · bypass delay</p>
                                            </div>
                                        </div>
                                        <Toggle enabled={instantTrigger} onChange={setInstantTrigger} />
                                    </div>

                                    <p className="mt-2.5 text-[10px] text-gray-500">
                                        {entryDigits.length > 0
                                            ? `Watching for: ${entryDigits.map(d => `[${d}]`).join(' or ')}`
                                            : 'No digits selected — trigger disabled'}
                                    </p>
                                </>)}
                            </div>

                            {/* Digit Pattern */}
                            <div className="bg-white/2 rounded-2xl border border-white/8 p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`p-1.5 rounded-lg ${digitPatternEnabled ? 'bg-indigo-500/10 border border-indigo-500/20' : 'bg-white/5'}`}>
                                            <Filter className={`w-4 h-4 ${digitPatternEnabled ? 'text-indigo-400' : 'text-gray-500'}`} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-white">Digit Pattern Sequence</p>
                                            <p className="text-[10px] text-gray-500">Multi-step digit recognition — fires on full match</p>
                                        </div>
                                    </div>
                                    <Toggle enabled={digitPatternEnabled} onChange={setDigitPatternEnabled} />
                                </div>

                                {digitPatternEnabled && (<>
                                    {/* Pattern boxes */}
                                    <div className="flex flex-wrap gap-2.5 mb-4">
                                        {patternBoxes.map((box, boxIdx) => (
                                            <div key={box.id} className="relative group flex flex-col items-center gap-1.5">
                                                <span className="text-[9px] text-gray-600 font-bold">#{boxIdx + 1}</span>
                                                {/* Type badge (click to cycle) */}
                                                <div
                                                    onClick={() => cyclePatternBoxType(box.id, 1)}
                                                    onContextMenu={e => { e.preventDefault(); cyclePatternBoxType(box.id, -1); }}
                                                    title={PATTERN_LABELS[box.type]}
                                                    className={`w-12 h-12 rounded-xl ${PATTERN_BG[box.type]} flex items-center justify-center text-sm font-black text-white shadow-md cursor-pointer select-none hover:scale-110 active:scale-95 transition-all`}>
                                                    {box.type}
                                                </div>
                                                {/* Digit input */}
                                                <input type="number" min={0} max={9} value={box.digit}
                                                    onChange={e => updPatternBox(box.id, 'digit', Number(e.target.value))}
                                                    className="w-12 text-center bg-white/5 border border-white/10 rounded-lg text-xs font-black text-white py-1 focus:outline-none focus:border-indigo-500/50" />
                                                {/* Remove button */}
                                                <button onClick={() => delPatternBox(box.id)}
                                                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                        <div className="flex flex-col items-center gap-1.5">
                                            <span className="text-[9px] text-transparent">##</span>
                                            <button onClick={addPatternBox}
                                                className="w-12 h-12 rounded-xl border-2 border-dashed border-white/10 hover:border-indigo-500/40 flex items-center justify-center text-gray-600 hover:text-indigo-400 transition-all">
                                                <Plus className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Pattern legend */}
                                    <div className="flex flex-wrap gap-1.5 mb-4 p-3 bg-white/2 rounded-xl border border-white/5">
                                        {PATTERN_ALL_TYPES.map(t => (
                                            <div key={t} className="flex items-center gap-1 text-[9px] text-gray-400 font-bold">
                                                <span className={`w-2.5 h-2.5 rounded-sm ${PATTERN_DOT[t]}`} />
                                                <span className="text-gray-500">{t}</span>=<span>{PATTERN_LABELS[t]}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Compare digit + options */}
                                    <div className="flex flex-wrap gap-4 items-end">
                                        <div>
                                            <p className="text-[10px] text-gray-500 font-bold mb-1.5">Compare Digit (for D/M/V/U)</p>
                                            <input type="number" min={0} max={9} value={compareDigit}
                                                onChange={e => setCompareDigit(Number(e.target.value))}
                                                className="w-16 text-center bg-white/5 border border-white/10 rounded-xl text-sm font-black text-white py-2 focus:outline-none focus:border-indigo-500/50" />
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <Toggle enabled={noContradiction} onChange={setNoContradiction} />
                                            <div>
                                                <p className="text-xs font-bold text-white">No Contradiction</p>
                                                <p className="text-[9px] text-gray-500">Wait for opposite digit before re-triggering</p>
                                            </div>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <Toggle enabled={useCustomContracts} onChange={setUseCustomContracts} />
                                            <div>
                                                <p className="text-xs font-bold text-white">Custom Contracts per Box</p>
                                                <p className="text-[9px] text-gray-500">Each box uses its own contract type</p>
                                            </div>
                                        </label>
                                    </div>

                                    {/* Pattern readout */}
                                    <div className="mt-3 p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl">
                                        <p className="text-[10px] text-gray-500 font-bold mb-1">Detected Pattern Sequence</p>
                                        <p className="text-[11px] text-indigo-300 font-mono">
                                            {patternBoxes.map(b => `${PATTERN_LABELS[b.type]} (vs ${b.digit})`).join(' → ')}
                                        </p>
                                    </div>
                                </>)}
                            </div>

                            {/* Trade Pattern */}
                            <div className="bg-white/2 rounded-2xl border border-white/8 p-5">
                                <div className="flex items-center gap-2.5 mb-4">
                                    <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                                        <ChevronRight className="w-4 h-4 text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">Trade Pattern</p>
                                        <p className="text-[10px] text-gray-500">Click to toggle each slot between trade / skip</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2 mb-3">
                                    {tradePattern.map((slot, idx) => (
                                        <button key={idx} onClick={() => toggleTradeSlot(idx)} disabled={isRunningAuto}
                                            className="flex flex-col items-center gap-1 group">
                                            <div className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${
                                                patternSlotIdx === idx && isRunningAuto ? 'ring-2 ring-offset-1 ring-offset-[#0a0a10] ring-teal-400' : ''
                                            } ${slot === 'trade'
                                                ? 'bg-teal-500/15 border-teal-500/40 text-teal-400 hover:bg-teal-500/25'
                                                : 'bg-rose-500/10  border-rose-500/25  text-rose-400  hover:bg-rose-500/20'
                                            }`}>
                                                {slot === 'trade' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                            </div>
                                            <span className="text-[9px] font-bold text-gray-600">{idx + 1}</span>
                                        </button>
                                    ))}

                                    {/* Add/Remove slot buttons */}
                                    <div className="flex flex-col gap-1">
                                        <button onClick={() => setTradePattern(p => [...p, 'trade'])} disabled={isRunningAuto}
                                            className="w-10 h-10 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center text-gray-600 hover:text-teal-400 hover:border-teal-500/30 transition-all disabled:opacity-30">
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => setTradePattern(p => p.length > 1 ? p.slice(0, -1) : p)} disabled={isRunningAuto}
                                            className="w-10 h-10 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center text-gray-600 hover:text-rose-400 hover:border-rose-500/30 transition-all disabled:opacity-30">
                                            <Minus className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-500 font-mono">
                                    Pattern: {tradePattern.join(' → ')}
                                </p>
                            </div>

                            {/* Continuous Trading Mode */}
                            <div className="bg-white/2 rounded-2xl border border-white/8 p-5">
                                <div className="flex items-center gap-2.5 mb-4">
                                    <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                        <RefreshCw className="w-4 h-4 text-amber-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">Continuous Trading Mode</p>
                                        <p className="text-[10px] text-gray-500">Controls how the engine re-triggers after each trade</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2.5">
                                    {([
                                        { value: 'after_first',    label: 'After 1st Entry',        desc: 'Fires trade after first trigger, then loops continuously without re-checking' },
                                        { value: 'continuous_check', label: 'Continuous + Check',   desc: 'Trades each tick AND simultaneously monitors all active triggers' },
                                    ] as { value: ContinuousMode; label: string; desc: string }[]).map(opt => (
                                        <button key={opt.value} onClick={() => setContinuousMode(opt.value)} disabled={isRunningAuto}
                                            className={`p-4 rounded-xl border text-left transition-all hover:scale-[1.01] active:scale-[0.99] ${
                                                continuousMode === opt.value
                                                    ? 'border-amber-500/35 bg-amber-500/8 shadow-sm shadow-amber-500/10'
                                                    : 'border-white/5 bg-white/2 hover:border-white/10'
                                            }`}>
                                            <div className={`flex items-center gap-2 mb-1.5 ${continuousMode === opt.value ? 'text-amber-400' : 'text-white'}`}>
                                                <div className={`w-2 h-2 rounded-full ${continuousMode === opt.value ? 'bg-amber-400 animate-pulse' : 'bg-gray-600'}`} />
                                                <span className="text-xs font-black">{opt.label}</span>
                                            </div>
                                            <p className="text-[10px] text-gray-500 leading-snug">{opt.desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── RISK TAB ────────────────────────────────────────── */}
                    {activeTab === 'risk' && (
                        <div className="bg-white/2 rounded-2xl border border-white/8 p-5 space-y-5">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
                                <Input label="Base Stake ($)" type="number" value={baseStake} onChange={e => setBaseStake(e.target.value)} disabled={isRunningAuto} />
                                <Input label="Take Profit ($)" type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunningAuto} />
                                <Input label="Stop Loss ($)" type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunningAuto} />
                                <Input label="Max Trades / Market" type="number" value={maxTradesPerMarket} onChange={e => setMaxTradesPerMarket(e.target.value)} disabled={isRunningAuto} />
                                <Input label="Session Win Cap" type="number" value={maxWinsCap} onChange={e => setMaxWinsCap(e.target.value)} disabled={isRunningAuto} />
                                <Input label="Session Max Trades" type="number" value={maxTradesCap} onChange={e => setMaxTradesCap(e.target.value)} disabled={isRunningAuto} />
                                <Input label="Trades Per Cycle" type="number" value={tradesPerCycle} onChange={e => setTradesPerCycle(e.target.value)} disabled={isRunningAuto} />
                                <Select label="Cycle Interval" value={cycleInterval} onChange={setCycleInterval} disabled={isRunningAuto}
                                    options={[
                                        { value: 'continuous', label: 'Continuous' },
                                        { value: '15m', label: 'Every 15 min' },
                                        { value: '30m', label: 'Every 30 min' },
                                        { value: '1h',  label: 'Every 1 hour' },
                                        { value: '2h',  label: 'Every 2 hours' },
                                    ]} />
                            </div>

                            {/* Martingale System */}
                            <div className="p-4 rounded-xl border border-white/8 bg-white/2 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-white">Martingale System</p>
                                        <p className="text-[10px] text-gray-500">Multiply stake on consecutive losses to recover deficits</p>
                                    </div>
                                    <Toggle enabled={isMartingaleEnabled} onChange={setIsMartingaleEnabled} disabled={isRunningAuto} />
                                </div>

                                {isMartingaleEnabled && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5">
                                        <Input label="Martingale Multiplier" type="number" value={martingaleMul} onChange={e => setMartingaleMul(e.target.value)} disabled={isRunningAuto} />
                                        <Input label="Max Martingale Steps" type="number" value={maxMartSteps} onChange={e => setMaxMartSteps(e.target.value)} disabled={isRunningAuto} />
                                        
                                        <div className="md:col-span-2 flex items-center justify-between p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle className="w-4 h-4 text-rose-400" />
                                                <div>
                                                    <p className="text-xs font-bold text-white">Stop on Max Steps</p>
                                                    <p className="text-[10px] text-gray-500">Stop bot execution completely when max steps threshold is hit</p>
                                                </div>
                                            </div>
                                            <Toggle enabled={stopOnMaxSteps} onChange={setStopOnMaxSteps} disabled={isRunningAuto} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Profit Compounding */}
                            <div className={`p-4 rounded-xl border transition-all ${isCompounding && !isCapitalCompound ? 'border-teal-500/25 bg-teal-500/5' : 'border-white/8 bg-white/2'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <p className="text-sm font-bold text-white">Profit Compounding</p>
                                        <p className="text-[10px] text-gray-500">Adds X% of session profit to the base stake</p>
                                    </div>
                                    <Toggle enabled={isCompounding && !isCapitalCompound} onChange={v => { setIsCompounding(v); if (v) setIsCapitalCompound(false); }} disabled={isRunningAuto || isCapitalCompound} />
                                </div>
                                {isCompounding && !isCapitalCompound && (
                                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                                        <input type="number" value={compoundPct} onChange={e => setCompoundPct(e.target.value)} disabled={isRunningAuto}
                                            className="w-20 text-center bg-white/5 border border-white/10 rounded-lg text-sm font-black text-white py-1.5 focus:outline-none focus:border-teal-500/50 disabled:opacity-40" />
                                        <span className="text-xs text-gray-500 font-bold">% of session profit added to stake</span>
                                    </div>
                                )}
                            </div>

                            {/* Capital-Based Scaling */}
                            <div className={`p-4 rounded-xl border transition-all ${isCapitalCompound ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-white/8 bg-white/2'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <p className="text-sm font-bold text-white">Capital-Based Stake Scaling</p>
                                        <p className="text-[10px] text-gray-500">Stake = X% of live account balance · auto-scales as balance grows</p>
                                    </div>
                                    <Toggle enabled={isCapitalCompound} onChange={v => { setIsCapitalCompound(v); if (v) setIsCompounding(false); }} disabled={isRunningAuto} />
                                </div>
                                {isCapitalCompound && (
                                    <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-white/5">
                                        <div>
                                            <p className="text-[10px] text-gray-500 font-bold mb-1.5">Capital % Per Trade</p>
                                            <input type="number" min={0.01} max={100} step={0.1} value={capitalPct}
                                                onChange={e => setCapitalPct(e.target.value)} disabled={isRunningAuto}
                                                className="w-24 text-center bg-white/5 border border-white/10 rounded-xl text-sm font-black text-white py-2 focus:outline-none focus:border-indigo-500/50 disabled:opacity-40" />
                                            <p className="text-[9px] text-gray-600 mt-1">e.g. 1% of $500 = $5.00 stake</p>
                                        </div>
                                        <div className="flex flex-col justify-center p-3.5 bg-white/5 rounded-xl border border-white/10">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-1">Calculated Stake Now</p>
                                            <p className="text-2xl font-black font-mono text-teal-400">${capitalPreview ?? '—'}</p>
                                            <p className="text-[9px] text-gray-600 mt-0.5">Balance: ${(account?.balance || 0).toFixed(2)} × {capitalPct}%</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ─── MARKETS TAB ─────────────────────────────────────── */}
                    {activeTab === 'markets' && (
                        <div className="space-y-4">
                            {selectedPreset === 'trade_playlist' && (
                                <div className="p-4 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                                        <BarChart3 className="w-5 h-5" />
                                    </div>
                                    <div className="text-xs text-indigo-200 leading-relaxed">
                                        <span className="font-bold text-white">Autonomous Trade Playlist Active: </span>
                                        Target markets are loaded from each step's settings (or fine-tuned per step via the Market Override dropdown in the Playlist tab).
                                    </div>
                                </div>
                            )}

                            <div className="bg-white/2 rounded-2xl border border-white/8 overflow-hidden">
                                <div className="flex items-center gap-2 p-4 border-b border-white/5">
                                    <Search className="w-4 h-4 text-teal-400" />
                                    <span className="text-sm font-bold text-white">Live Market Scanner</span>
                                    <span className="ml-auto text-[10px] text-gray-500 font-mono">{marketRatings.length} markets ranked</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-white/5 bg-white/2">
                                                {['Market', 'Score', 'Gap %', 'Rationale', 'Rating'].map((h, i) => (
                                                    <th key={h} className={`px-4 py-3 text-[9px] font-black uppercase tracking-widest text-gray-500 ${i > 0 ? 'text-center' : 'text-left'}`}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/3">
                                            {marketRatings.map(m => (
                                                <tr key={m.symbol} className={`hover:bg-white/2 transition-colors ${m.symbol === selectedMarket ? 'bg-teal-500/5' : ''}`}>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            {m.symbol === selectedMarket && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />}
                                                            <span className="font-medium text-white">{m.label}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center font-mono font-black text-white">{m.score}</td>
                                                    <td className="px-4 py-3 text-center font-mono text-gray-400">{(m.gap * 100).toFixed(1)}%</td>
                                                    <td className="px-4 py-3 text-gray-400 italic text-[10px] max-w-[180px] truncate">{m.rationale}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wide ${RATING_CLS[m.rating]}`}>
                                                            {m.rating}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── VIRTUAL TAB ─────────────────────────────────────── */}
                    {activeTab === 'virtual' && (
                        <div className="space-y-4">
                            {selectedPreset === 'trade_playlist' && (
                                <div className="p-4 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                                        <FlaskConical className="w-5 h-5" />
                                    </div>
                                    <div className="text-xs text-indigo-200 leading-relaxed">
                                        <span className="font-bold text-white">Autonomous Trade Playlist Active: </span>
                                        Virtual trading and validation rules are dynamically loaded and executed according to each step's configured engine settings.
                                    </div>
                                </div>
                            )}

                            <div className="bg-white/2 rounded-2xl border border-white/8 p-5 space-y-6">
                                {/* Start Virtual -> Switch to Real */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <span className="text-sm font-bold text-white">Start Virtual → Switch to Real</span>
                                            <p className="text-[10px] text-gray-500">Begin with simulated trades, switch to real execution after target hits</p>
                                        </div>
                                        <Toggle
                                            enabled={virtualSettings.startVirtualToReal}
                                            onChange={(val: boolean) => setVirtualSettings({ startVirtualToReal: val })}
                                        />
                                    </div>

                                {virtualSettings.startVirtualToReal && (
                                    <div className="space-y-3 pt-2">
                                        <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                                            <div className="space-y-0.5">
                                                <span className="text-xs font-bold text-indigo-300">⚡ Double Virtual Mode (2-Stage Cascade)</span>
                                                <p className="text-[9px] text-gray-400">Stage A gate → Stage B virtual/real cycle</p>
                                            </div>
                                            <Toggle
                                                enabled={!!virtualSettings.isDoubleVirtual}
                                                onChange={(val: boolean) => setVirtualSettings({ isDoubleVirtual: val, vDoubleStage: 'A', vStageBCompletedReps: 0 })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Switch to Real After</span>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setVirtualSettings({ vTriggerType: 'losses' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.vTriggerType === 'losses'
                                                        ? 'bg-rose-500/10 border-rose-500/50 shadow-lg shadow-rose-500/10 text-rose-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Losses</span>
                                                    <span className="text-[9px] font-medium opacity-65">Consecutive</span>
                                                </button>
                                                <button
                                                    onClick={() => setVirtualSettings({ vTriggerType: 'wins' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.vTriggerType === 'wins'
                                                        ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10 text-teal-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Wins</span>
                                                    <span className="text-[9px] font-medium opacity-65">Consecutive</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Trigger Mode</span>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setVirtualSettings({ vTriggerMode: 'consec' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.vTriggerMode === 'consec'
                                                        ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10 text-teal-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Consecutive</span>
                                                    <span className="text-[9px] font-medium opacity-65">In a row</span>
                                                </button>
                                                <button
                                                    onClick={() => setVirtualSettings({ vTriggerMode: 'total' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.vTriggerMode === 'total'
                                                        ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10 text-teal-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Total</span>
                                                    <span className="text-[9px] font-medium opacity-65">Cumulative</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="md:col-span-2">
                                            <Input
                                                label="Threshold Amount (Wins/Losses before Real)"
                                                type="number"
                                                value={virtualSettings.vThreshold?.toString() || '0'}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVirtualSettings({ vThreshold: parseInt(e.target.value) || 0 })}
                                            />
                                        </div>
                                    </div>
                                     </div>
                                )}
                            </div>

                            <hr className="border-white/5" />

                            {/* Start Real -> Switch to Virtual */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <span className="text-sm font-bold text-white">Start Real → Switch to Virtual</span>
                                        <p className="text-[10px] text-gray-500">Automatically retreat back to virtual monitoring when criteria are met</p>
                                    </div>
                                    <Toggle
                                        enabled={virtualSettings.startRealToVirtual}
                                        onChange={(val: boolean) => setVirtualSettings({ startRealToVirtual: val })}
                                    />
                                </div>

                                {virtualSettings.startRealToVirtual && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                        <div className="space-y-2">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Switch to Virtual After</span>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setVirtualSettings({ rTriggerType: 'losses' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.rTriggerType === 'losses'
                                                        ? 'bg-rose-500/10 border-rose-500/50 shadow-lg shadow-rose-500/10 text-rose-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Losses</span>
                                                    <span className="text-[9px] font-medium opacity-65">Consecutive</span>
                                                </button>
                                                <button
                                                    onClick={() => setVirtualSettings({ rTriggerType: 'wins' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.rTriggerType === 'wins'
                                                        ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10 text-teal-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Wins</span>
                                                    <span className="text-[9px] font-medium opacity-65">Consecutive</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Trigger Mode</span>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setVirtualSettings({ rTriggerMode: 'consec' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.rTriggerMode === 'consec'
                                                        ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10 text-teal-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Consecutive</span>
                                                    <span className="text-[9px] font-medium opacity-65">In a row</span>
                                                </button>
                                                <button
                                                    onClick={() => setVirtualSettings({ rTriggerMode: 'total' })}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${virtualSettings.rTriggerMode === 'total'
                                                        ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10 text-teal-400'
                                                        : 'bg-white/5 border-white/10 hover:border-gray-700 text-gray-500'
                                                        }`}
                                                >
                                                    <span className="text-xs font-black uppercase">Total</span>
                                                    <span className="text-[9px] font-medium opacity-65">Cumulative</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="md:col-span-2">
                                            <Input
                                                label="Threshold Amount"
                                                type="number"
                                                value={virtualSettings.rThreshold?.toString() || '0'}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVirtualSettings({ rThreshold: parseInt(e.target.value) || 0 })}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Active Mode Status Indicator */}
                            <div className={`mt-4 p-4 rounded-xl border transition-all shadow-md ${virtualSettings.isVirtualMode
                                ? 'bg-indigo-500/5 border-indigo-500/20'
                                : 'bg-teal-500/5 border-teal-500/20'
                                }`}>
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <div className={`w-3.5 h-3.5 rounded-full animate-ping absolute inset-0 opacity-20 ${virtualSettings.isVirtualMode ? 'bg-indigo-500' : 'bg-teal-500'}`} />
                                            <div className={`w-3.5 h-3.5 rounded-full relative ${virtualSettings.isVirtualMode ? 'bg-indigo-500 shadow-md shadow-indigo-500/50' : 'bg-teal-500 shadow-md shadow-teal-500/50'}`} />
                                        </div>
                                        <div>
                                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest block mb-0.5">Active Execution Mode</span>
                                            <div className={`text-base font-black tracking-tight leading-none ${virtualSettings.isVirtualMode ? 'text-indigo-400' : 'text-teal-400'}`}>
                                                {virtualSettings.isVirtualMode ? 'VIRTUAL TRACKING (SIMULATED)' : 'REAL EXECUTION (LIVE)'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest block mb-1">Active Streak</span>
                                        <div className="flex items-center gap-2 justify-end">
                                            <span className="px-2.5 py-1 rounded bg-teal-500/10 text-teal-400 text-xs font-black font-mono">
                                                {virtualSettings.isVirtualMode ? virtualSettings.vConsecWins : virtualSettings.rConsecWins}W
                                            </span>
                                            <span className="px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 text-xs font-black font-mono">
                                                {virtualSettings.isVirtualMode ? virtualSettings.vConsecLosses : virtualSettings.rConsecLosses}L
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    )}
                </div>

                {/* ── Right: Log Panel ──────────────────────────────────────── */}
                <div className="space-y-4">

                    {/* System Status */}
                    <div className="bg-white/2 rounded-2xl border border-white/8 p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Activity className="w-4 h-4 text-indigo-400" />
                            <span className="text-xs font-bold text-white">System Status</span>
                        </div>
                        <div className="space-y-1.5">
                            {[
                                { label: 'Trading Hook',  active: tradingStatus === 'connected',       status: tradingStatus },
                                { label: 'Live Scanner',  active: activeCount > 0 || isScannerWarmup,  status: isScannerWarmup ? 'warming' : (activeCount > 0 ? `${activeCount} markets` : 'idle') },
                                { label: 'Bot Engine',    active: isEngineRunning,                     status: isEngineRunning ? 'running' : 'idle' },
                                { label: 'Triggers Fired',active: triggersFired > 0,                  status: `${triggersFired} total` },
                            ].map((item, i) => (
                                <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-white/3 rounded-lg border border-white/5">
                                    <span className="text-[10px] text-gray-400 font-bold">{item.label}</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-teal-400 animate-pulse' : 'bg-gray-600'}`} />
                                        <span className="text-[10px] font-mono font-bold text-gray-400 uppercase">{item.status}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Cycle / warmup countdown */}
                    {nextExecCd && isRunningAuto && (
                        <div className={`rounded-2xl p-4 flex items-center justify-between border ${
                            isScannerWarmup
                                ? 'bg-gradient-to-r from-amber-500/15 to-orange-500/10 border-amber-500/25'
                                : 'bg-gradient-to-r from-teal-500/15 to-indigo-500/10 border-teal-500/20'
                        }`}>
                            <div>
                                <p className={`text-[9px] font-black uppercase tracking-widest ${isScannerWarmup ? 'text-amber-400' : 'text-teal-400'}`}>
                                    {isScannerWarmup ? '🔍 Scanner Warming Up' : 'Next Cycle In'}
                                </p>
                                <p className={`text-2xl font-black font-mono mt-0.5 ${isScannerWarmup ? 'text-amber-300' : 'text-white'}`}>{nextExecCd}</p>
                                {isScannerWarmup && (
                                    <p className="text-[9px] text-amber-400/70 mt-0.5">Collecting fresh ticks · Engine starts after scan</p>
                                )}
                            </div>
                            {isScannerWarmup
                                ? <Activity className="w-7 h-7 text-amber-400/60 animate-pulse" />
                                : <Clock className="w-7 h-7 text-teal-400/50" />
                            }
                        </div>
                    )}

                    {/* Log Tabs */}
                    <div className="bg-white/2 rounded-2xl border border-white/8 overflow-hidden flex flex-col" style={{ minHeight: '440px' }}>
                        <div className="flex items-center border-b border-white/5 shrink-0">
                            {/* Tab buttons */}
                            <div className="flex flex-1">
                                {[
                                    { id: 'trades', label: 'Trade Log', count: tradeLog.length },
                                    { id: 'audit',  label: 'Audit',     count: auditLogs.length },
                                ].map(tab => (
                                    <button key={tab.id} onClick={() => setActiveLogTab(tab.id as any)}
                                        className={`flex-1 py-3 px-4 text-xs font-bold flex items-center justify-center gap-1.5 transition-all border-b-2 ${activeLogTab === tab.id ? 'border-teal-500 text-teal-400' : 'border-transparent text-gray-500 hover:text-white'}`}>
                                        {tab.label}
                                        <span className="text-[9px] bg-white/8 rounded px-1.5 py-0.5 font-mono">{tab.count}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Reset Button */}
                            <button
                                onClick={() => {
                                    // Stop engine if running
                                    if (isRunningAuto) { stopBot(); setIsRunningAuto(false); setUptimeStart(null); }
                                    // Clear session stats
                                    setSessionProfit(0); setSessionWins(0); setSessionLosses(0);
                                    setSessionTrades(0); setMktTrades(0); setTriggersFired(0);
                                    setCurStep(0); setCurRep(0);
                                    setPatternMatchIdx(0); setPatternSlotIdx(0);
                                    // Clear logs
                                    setTradeLog([]); setAuditLogs([]);
                                    lastIdRef.current = null;
                                }}
                                title="Reset session — clears stats & logs, keeps all settings"
                                className="shrink-0 mr-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/35 text-rose-400 text-[10px] font-black uppercase tracking-wider transition-all active:scale-95">
                                <RefreshCw className="w-3 h-3" />
                                Reset
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {/* ── Trade Log ── */}
                            {activeLogTab === 'trades' && (
                                tradeLog.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-600">
                                        <BookOpen className="w-8 h-8 opacity-25" />
                                        <p className="text-xs">No trades yet this session</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-[10px]">
                                        <thead className="sticky top-0 bg-[#0d0d14]/95 backdrop-blur-sm z-10">
                                            <tr className="border-b border-white/5">
                                                {['Time', 'Market', 'Type', 'Exit', 'P/L'].map(h => (
                                                    <th key={h} className="px-3 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 text-left first:text-left last:text-right">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/3">
                                            {tradeLog.map(trade => (
                                                <tr key={trade.id} className={`transition-colors ${
                                                    trade.isVirtual
                                                        ? 'hover:bg-indigo-500/5 border-l-2 border-l-indigo-500/30'
                                                        : 'hover:bg-white/2'
                                                }`}>
                                                    <td className="px-3 py-2.5 font-mono text-gray-500">
                                                        {trade.time}
                                                        {trade.isVirtual && (
                                                            <span className="ml-1.5 text-[8px] font-black uppercase tracking-widest px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">SIM</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="font-bold text-white truncate max-w-[80px]">
                                                            {TARGET_MARKETS.find(m => m.value === trade.market)?.label.replace(' Index', '') || trade.market}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-gray-400 font-mono">{trade.contractType}</td>
                                                    <td className="px-3 py-2.5">
                                                        <span className={`w-6 h-6 inline-flex items-center justify-center rounded-lg font-black text-xs ${
                                                            trade.result === 'WIN'  ? 'bg-teal-500/20 text-teal-400' :
                                                            trade.result === 'LOSS' ? 'bg-rose-500/20 text-rose-400' :
                                                            'bg-white/5 text-gray-400'
                                                        }`}>
                                                            {trade.exitDigit ?? '?'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right">
                                                        <span className={`font-black font-mono ${
                                                            trade.isVirtual
                                                                ? 'text-indigo-400 opacity-70'
                                                                : trade.profit >= 0 ? 'text-teal-400' : 'text-rose-400'
                                                        }`}>
                                                            {trade.isVirtual ? '~' : ''}{trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )
                            )}

                            {/* ── Audit Log ── */}
                            {activeLogTab === 'audit' && (
                                auditLogs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-600">
                                        <Activity className="w-8 h-8 opacity-25" />
                                        <p className="text-xs">Audit logs appear here when active</p>
                                    </div>
                                ) : (
                                    <div className="p-3 space-y-1.5">
                                        {auditLogs.map((log, i) => {
                                            const cls = {
                                                info:    'text-gray-400 bg-white/2    border-white/5',
                                                success: 'text-teal-400 bg-teal-500/5  border-teal-500/10',
                                                warn:    'text-amber-400 bg-amber-500/5 border-amber-500/10',
                                                error:   'text-rose-400  bg-rose-500/5  border-rose-500/10',
                                            }[log.type];
                                            return (
                                                <div key={i} className={`flex gap-2 p-2 rounded-lg border text-[10px] ${cls}`}>
                                                    <span className="font-mono text-gray-600 whitespace-nowrap shrink-0">{log.time}</span>
                                                    <span className="font-medium leading-snug">{log.message}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
