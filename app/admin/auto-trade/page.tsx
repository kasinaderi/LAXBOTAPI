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
    Target, ChevronRight, ArrowLeftRight, AlertTriangle, FlaskConical
} from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { useScannerStore } from '@/store/useScannerStore';
import { ticksToDecimals } from '@/lib/deriv/constants';
import { tradeEngine } from '@/lib/deriv/trade-engine';
import { tradeWS } from '@/lib/deriv/trade-ws';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

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
    { value: '1HZ25V',  label: 'Vol 25 (1s) Index' },
    { value: '1HZ50V',  label: 'Vol 50 (1s) Index' },
    { value: '1HZ75V',  label: 'Vol 75 (1s) Index' },
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

const RATING_CLS = {
    EXCELLENT: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    GOOD:      'text-teal-400 bg-teal-500/10 border-teal-500/30',
    NEUTRAL:   'text-gray-400 bg-white/5 border-white/10',
    AVOID:     'text-rose-400 bg-rose-500/10 border-rose-500/30',
};

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
    } = useDerivStore();
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

    useEffect(() => { isRunningRef.current      = isRunningAuto;    }, [isRunningAuto]);
    useEffect(() => { curStepRef.current        = curStep;          }, [curStep]);
    useEffect(() => { curRepRef.current         = curRep;           }, [curRep]);
    useEffect(() => { sessionProfRef.current    = sessionProfit;    }, [sessionProfit]);
    useEffect(() => { sessionWinsRef.current    = sessionWins;      }, [sessionWins]);
    useEffect(() => { sessionTrRef.current      = sessionTrades;    }, [sessionTrades]);
    useEffect(() => { cycleTradesCountRef.current = cycleTradesCount; }, [cycleTradesCount]);
    useEffect(() => { selectedPresetRef.current = selectedPreset;   }, [selectedPreset]);

    // Log virtual settings mode switches reactively
    const prevVirtualModeRef = useRef(virtualSettings.isVirtualMode);
    useEffect(() => {
        if (prevVirtualModeRef.current !== virtualSettings.isVirtualMode) {
            if (virtualSettings.isVirtualMode) {
                addAuditLog('🔄 Real threshold hit. Switching to VIRTUAL mode.', 'warn');
            } else {
                addAuditLog('✅ Virtual requirement met. Switching to REAL trading.', 'success');
            }
            prevVirtualModeRef.current = virtualSettings.isVirtualMode;
        }
    }, [virtualSettings.isVirtualMode]);

    // Sync pipeline settings to Zustand store for engine visibility
    useEffect(() => {
        setStorePipelineMode(pipelineMode);
    }, [pipelineMode, setStorePipelineMode]);

    useEffect(() => {
        setStorePipelineSteps(pipelineSteps);
    }, [pipelineSteps, setStorePipelineSteps]);

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
    const applyStep = useCallback((stepIdx: number) => {
        const step = pipelineSteps[stepIdx];
        if (!step) return;
        setContractType(step.contractType);
        setPrediction(step.prediction);
        addAuditLog(`Pipeline → Step ${stepIdx + 1}: ${step.contractType} (Digit ${step.prediction})`, 'info');
    }, [pipelineSteps, setContractType, setPrediction, addAuditLog]);

    // ── Advance pipeline after each settled trade ──────────────────────────
    const advancePipeline = useCallback(() => {
        if (pipelineMode !== 'sequential' || pipelineSteps.length === 0) return;
        const step = pipelineSteps[curStepRef.current];
        if (!step) return;
        const nextRep = curRepRef.current + 1;
        if (nextRep >= step.reps) {
            const nextStep = (curStepRef.current + 1) % pipelineSteps.length;
            setCurStep(nextStep);
            setCurRep(0);
            applyStep(nextStep);
        } else {
            setCurRep(nextRep);
        }
    }, [pipelineMode, pipelineSteps, applyStep]);

    // ── Trade log watcher ──────────────────────────────────────────────────
    useEffect(() => {
        if (!isRunningAuto || tradeLogs.length === 0) return;
        const latest = tradeLogs[0] as any;
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
            market:       selectedMarket,
            contractType: cType,
            entrySpot,
            exitDigit,
            stake:        stakeVal,
            profit:       isVirtual ? profit : profit,
            result:       isWon ? 'WIN' : 'LOSS',
            isVirtual,
        };
        setTradeLog(prev => [record, ...prev].slice(0, 300));
        addAuditLog(
            `${isVirtual ? '[VIRTUAL] ' : ''}[${cType}] ${isWon ? '✓ WIN' : '✗ LOSS'} | Exit: ${exitDigit ?? '?'} | P/L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`,
            isWon ? 'success' : 'error'
        );

        // ── Advance pipeline (real trades only) ───────────────────────────
        if (!isVirtual) {
            if (adaptiveSwitch && isLost) doAdaptiveSwitch(cType);
            advancePipeline();
        }

        // ── Cycle counter ────────────────────────────────────────────────
        {
            const isQualifyingVirtual = isVirtual && virtualSettings.startVirtualToReal;

            if (!isQualifyingVirtual) {
                // If pipeline mode is simultaneous, check if there are other open trades in the batch
                const hasMoreActive = isVirtual
                    ? tradeEngine.hasActiveVirtualTrades()
                    : tradeWS.hasPendingTrade();

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
                        if (!isVirtual) {
                            stopBot();
                            lastTradedMarketRef.current = selectedMarket;
                            addAuditLog(`Cycle complete (${nextCycleTradesCount}/${limit} trades). Stopping for next interval.`, 'success');
                        }
                    } else {
                    // ── Continuous cycle-end: 60s scanner warmup then pick best market ──
                    stopBot();
                    lastTradedMarketRef.current = selectedMarket;
                    cycleTradesCountRef.current = 0;
                    setCycleTradesCount(0);

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
                            setEntryDigits(pair);
                            setPipelineSteps([
                                { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                                { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                            ]);
                            setContractType('DIGITDIFF');
                            setPrediction(pair[0]);
                            addAuditLog(`🔄 Warmup done → ${best.label} | Pair: [${pair.join(', ')}] (${count} patterns)`, 'success');
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
                        lastIdRef.current = null;
                        startBot();
                    }, WARMUP_SECS * 1000);
                }
            }
        }
    }

    }, [tradeLogs, isRunningAuto, cycleInterval, tradesPerCycle, isMartingaleEnabled, martingaleMul, maxMartSteps, stopOnMaxSteps, takeProfit, stopLoss, selectedPreset, marketRegimes]);


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
            cycleEndRef.current = Date.now() + intervalMs;
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
                                setEntryDigits(pair);
                                const newSteps = [
                                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[0], reps: 1 },
                                    { id: uid(), contractType: 'DIGITDIFF' as ContractTypeKey, prediction: pair[1], reps: 1 },
                                ];
                                setPipelineSteps(newSteps);
                                setContractType('DIGITDIFF');
                                setPrediction(pair[0]);
                                addAuditLog(`🔄 Interval warmup done → ${best.label} | Pair: [${pair.join(', ')}] (${count} patterns)`, 'success');
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
    }, [isRunningAuto, tradingStatus, isEngineRunning, cycleInterval, takeProfit, stopLoss, maxWinsCap, maxTradesCap, tradesPerCycle, isMartingaleEnabled, martingaleMul, maxMartSteps, stopOnMaxSteps, selectedPreset, marketRegimes]);

    // ── Start ──────────────────────────────────────────────────────────────
    const handleStart = () => {
        if (tradingStatus !== 'connected') { alert('Connect the Deriv trading hook first.'); return; }
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
            
            // differ_1 dynamic setup on session manual launch
            if (selectedPreset === 'differ_1') {
                const r = marketRegimes[best.symbol];
                const last100 = (r?.digits || []).slice(-100);
                const { pair, count } = getTopAlternatingPairAndCount(last100);
                setEntryDigits(pair);
                setPipelineSteps([
                    { id: uid(), contractType: 'DIGITDIFF', prediction: pair[0], reps: 1 },
                    { id: uid(), contractType: 'DIGITDIFF', prediction: pair[1], reps: 1 },
                ]);
                addAuditLog(`differ 1 launch setup: Selected entry digits ${pair.join(', ')} for market ${best.label} (Pattern Count: ${count})`, 'info');
            }
        }
        applyStep(0);
        setCurStep(0); setCurRep(0);
        setIsRunningAuto(true);
        setUptimeStart(Date.now());
        setSessionProfit(0); setSessionWins(0); setSessionLosses(0); setSessionTrades(0);
        setMktTrades(0); setTriggersFired(0);
        setTradeLog([]); setAuditLogs([]);
        cycleTradesCountRef.current = 0;
        setCycleTradesCount(0);
        lastIdRef.current = null;
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
                                    { value: 'custom', label: 'Custom (Manual)' },
                                    { value: 'differ_1', label: 'differ 1' },
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
                            { id: 'strategy', label: 'Strategy',   icon: <Layers className="w-3.5 h-3.5" /> },
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
                        </div>
                    )}

                    {/* ─── TRIGGERS TAB ──────────────────────────────────── */}
                    {activeTab === 'triggers' && (
                        <div className="space-y-4">

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
                    )}

                    {/* ─── VIRTUAL TAB ─────────────────────────────────────── */}
                    {activeTab === 'virtual' && (
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
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
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
                    {nextExecCd && (
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
