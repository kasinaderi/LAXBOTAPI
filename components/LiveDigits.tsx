'use client';

import React, { useEffect, useRef } from 'react';
import { Card, CardHeader, CardContent } from './ui';
import { Activity, Trash2, RotateCcw } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { useRelayStore } from '@/store/useRelayStore';
import { useScannerStore } from '@/store/useScannerStore';
import { Button, Badge } from './ui';

const EMPTY_ARRAY: number[] = [];

export function LiveDigits() {
    const { 
        market, 
        ticks: storeTicks, 
        contractType, 
        prediction, 
        isSwitchingMarket, 
        resetTicks,
        setContractType,
        setPrediction,
        virtualSettings,
        setVirtualSettings,
        showQuickControls,
        quickSwitchVirtualBehavior,
        triggers,
        updateTriggers
    } = useDerivStore();

    // Select ONLY the current market ticks from Relay to avoid re-renders on other market updates
    const relayTicks = useRelayStore(state => state.ticks[market] || EMPTY_ARRAY);
    const relayStatus = useRelayStore(state => state.status);

    const { marketRegimes } = useScannerStore();
    const regime = marketRegimes[market];

    // Scanner History Source
    const historyStoredTicks = regime?.digits || EMPTY_ARRAY;
    const historyReady = regime?.historyReady || false;
    const historySize = regime?.historySize || 0;

    // DUAL-SOURCE LOGIC: Prefer Scanner History (Exact 1000), then Relay, then Direct
    const isUsingRelay = relayStatus === 'connected' && relayTicks.length > 0;

    // For STATS: Use full available history (preferably 1000 strict)
    const ticks = historyReady ? historyStoredTicks : (isUsingRelay ? relayTicks : storeTicks);

    // For DISPLAY: Show last 50
    const displayTicks = ticks.slice(-50);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to the right whenever ticks update
    useEffect(() => {
        if (scrollRef.current && !isSwitchingMarket) {
            scrollRef.current.scrollTo({
                left: scrollRef.current.scrollWidth,
                behavior: 'auto'
            });
        }
    }, [ticks, isSwitchingMarket]);

    // For PERCENTAGES: Use exactly 100 ticks
    const percentTicks = ticks.slice(-100);

    const digitCounts = Array(10).fill(0);
    percentTicks.forEach(d => {
        if (d >= 0 && d <= 9) digitCounts[d]++;
    });

    const total = percentTicks.length || 1;
    const evenCount = percentTicks.filter(d => d % 2 === 0).length;
    const oddCount = percentTicks.length - evenCount;

    const evenPercent = Math.round((evenCount / total) * 100);
    const oddPercent = 100 - evenPercent;

    const handleQuickSwitch = (newContractType?: string, newPrediction?: number) => {
        if (!showQuickControls) return;

        console.log(`[QuickSwitch] Triggered: ${newContractType} ${newPrediction}`);

        // 1. Update Mode/Type
        if (newContractType) {
            setContractType(newContractType as any);
        }
        if (newPrediction !== undefined) {
            setPrediction(newPrediction);
        }

        // 2. Behavioral Override (If in Virtual Mode)
        if (virtualSettings.isVirtualMode && quickSwitchVirtualBehavior === 'override_to_real') {
            console.log('[QuickSwitch] Overriding to REAL mode per user preference.');
            setVirtualSettings({ isVirtualMode: false });
        }

        // 3. Update Adaptive Triggers if active
        if (triggers.adaptiveEvenOdd.enabled && newContractType) {
            let nextSide = 'Even';
            if (newContractType === 'DIGITEVEN') nextSide = 'Even';
            else if (newContractType === 'DIGITODD') nextSide = 'Odd';
            else if (newContractType === 'DIGITOVER') nextSide = 'Over';
            else if (newContractType === 'DIGITUNDER') nextSide = 'Under';

            updateTriggers({
                adaptiveEvenOdd: {
                    ...triggers.adaptiveEvenOdd,
                    currentSide: nextSide as any
                }
            });
        }
    };

    const isEvenActive = contractType === 'DIGITEVEN';
    const isOddActive = contractType === 'DIGITODD';

    const checkCondition = (digit: number) => {
        switch (contractType) {
            case 'DIGITOVER': return digit > prediction;
            case 'DIGITUNDER': return digit < prediction;
            case 'DIGITEVEN': return digit % 2 === 0;
            case 'DIGITODD': return digit % 2 !== 0;
            case 'DIGITMATCH': return digit === prediction;
            case 'DIGITDIFF': return digit !== prediction;
            default: return true;
        }
    };

    return (
        <Card className="relative overflow-hidden">
            <div className="absolute top-3 right-3 z-50 flex flex-col items-end gap-1">
                <div className="flex items-center gap-3">
                    {isSwitchingMarket && (
                        <div className="flex items-center gap-2 animate-pulse">
                            <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-ping" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-teal-400">Syncing...</span>
                        </div>
                    )}
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${isUsingRelay ? 'bg-teal-500/10 border-teal-500/20 text-teal-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                        <div className={`w-1 h-1 rounded-full ${isUsingRelay ? 'bg-teal-500' : 'bg-amber-500'}`} />
                        <span className="text-[9px] font-black uppercase tracking-tighter">{isUsingRelay ? 'Relay' : 'Direct'}</span>
                    </div>
                </div>
            </div>
            <CardHeader
                icon={<Activity className="w-5 h-5" />}
                badge={
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 w-7 p-0 bg-transparent border-none hover:bg-white/5"
                        onClick={resetTicks}
                        title="Reset Ticks"
                    >
                        <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-rose-400 transition-colors" />
                    </Button>
                }
            >
                Live Digits Analysis

            </CardHeader>
            <CardContent className="space-y-6">
                {/* Last Digits Stream with Auto-Scroll */}
                <div
                    ref={scrollRef}
                    className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar"
                >
                    {displayTicks.length > 0 ? (
                        displayTicks.map((t, i) => {
                            const isWin = checkCondition(t);
                            const isLatest = i === displayTicks.length - 1;

                            return (
                                <div
                                    key={i}
                                    className={`w-8 h-8 flex-shrink-0 rounded flex items-center justify-center font-mono text-[11px] font-black border ${isWin
                                        ? 'bg-teal-500/20 border-teal-500/50 text-teal-400'
                                        : 'bg-rose-500/10 border-rose-500/30 text-rose-500/70'
                                        } ${isLatest ? 'ring-2 ring-white/20 scale-110 shadow-lg shadow-teal-500/20 z-10' : ''}`}
                                >
                                    {t}
                                </div>
                            );
                        })
                    ) : (
                        <div className="w-full text-center py-2 text-xs text-gray-500 animate-pulse font-medium uppercase tracking-widest">
                            Waiting for market data...
                        </div>
                    )}
                </div>

                {/* E/O Stats */}
                <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-1">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                            <button
                                onClick={() => handleQuickSwitch('DIGITEVEN', prediction)}
                                className={`transition-colors hover:text-white ${isEvenActive ? 'text-teal-400' : 'text-gray-500'}`}
                            >
                                Even ({evenPercent}%)
                            </button>
                            <button
                                onClick={() => handleQuickSwitch('DIGITODD', prediction)}
                                className={`transition-colors hover:text-white ${isOddActive ? 'text-teal-400' : 'text-gray-500'}`}
                            >
                                Odd ({oddPercent}%)
                            </button>
                        </div>
                        <div className="h-1.5 w-full bg-dark rounded-full overflow-hidden flex border border-white/5 cursor-pointer group">
                            <div
                                onClick={() => handleQuickSwitch('DIGITEVEN', prediction)}
                                className={`h-full bg-teal-500 transition-all duration-300 ${isEvenActive ? 'shadow-[0_0_12px_rgba(20,184,166,0.6)] brightness-125' : 'opacity-40 hover:opacity-100'}`}
                                style={{ width: `${evenPercent}%` }}
                            />
                            <div
                                onClick={() => handleQuickSwitch('DIGITODD', prediction)}
                                className={`h-full bg-amber-500 transition-all duration-300 ${isOddActive ? 'shadow-[0_0_12px_rgba(245,158,11,0.6)] brightness-125' : 'opacity-40 hover:opacity-100'}`}
                                style={{ width: `${oddPercent}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Digit Distribution Grid */}
                <div className="grid grid-cols-5 gap-2">
                    {digitCounts.map((count, digit) => {
                        const percent = Math.round((count / total) * 100);
                        const isMatchDiffMode = contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF';
                        
                        const isOverActive = contractType === 'DIGITOVER' && prediction === digit;
                        const isUnderActive = contractType === 'DIGITUNDER' && prediction === digit;
                        const isMatchActive = contractType === 'DIGITMATCH' && prediction === digit;
                        const isDiffActive = contractType === 'DIGITDIFF' && prediction === digit;

                        const isDigitSelected = isOverActive || isUnderActive || isMatchActive || isDiffActive;

                        return (
                            <div
                                key={digit}
                                className={`flex flex-col items-center p-0 rounded-lg border overflow-hidden transition-all duration-500 group relative ${isDigitSelected
                                        ? 'bg-teal-500/20 border-teal-400 shadow-[0_0_20px_rgba(20,184,166,0.4)] z-10'
                                        : 'bg-dark-secondary border-dark hover:border-gray-700'
                                    }`}
                            >
                                {/* Active Selection Shine Effect */}
                                {isDigitSelected && (
                                    <div className="absolute inset-0 bg-gradient-to-br from-teal-400/10 to-transparent pointer-events-none animate-pulse" />
                                )}
                                
                                {/* Top Button: DIGITOVER / Set Prediction */}
                                <button
                                    onClick={() => {
                                        if (isMatchDiffMode) {
                                            handleQuickSwitch(undefined, digit);
                                        } else {
                                            handleQuickSwitch('DIGITOVER', digit);
                                        }
                                    }}
                                    className={`w-full py-1.5 flex flex-col items-center transition-colors relative ${isOverActive || (isMatchDiffMode && prediction === digit) ? 'bg-teal-500/20' : 'hover:bg-white/5'
                                        }`}
                                >
                                    <span className={`text-xs font-black transition-all duration-300 ${isDigitSelected 
                                        ? 'text-white drop-shadow-[0_0_8px_rgba(20,184,166,0.8)] scale-110' 
                                        : 'text-gray-400'}`}>
                                        {digit}
                                    </span>
                                </button>

                                {/* Middle Progress Bar (Matches OVER/UNDER logic) */}
                                <div className="w-full px-2">
                                    <div className="w-full h-1 bg-dark rounded-full overflow-hidden border border-white/5">
                                        <div
                                            className={`h-full transition-all duration-300 ${isDigitSelected
                                                    ? 'bg-teal-500 shadow-[0_0_5px_rgba(20,184,166,0.5)]'
                                                    : 'bg-gray-700'
                                                }`}
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>
                                </div>

                                {/* Bottom Button: DIGITUNDER / Percentage View */}
                                <button
                                    onClick={() => {
                                        if (isMatchDiffMode) {
                                            handleQuickSwitch(undefined, digit);
                                        } else {
                                            handleQuickSwitch('DIGITUNDER', digit);
                                        }
                                    }}
                                    className={`w-full py-1.5 flex flex-col items-center transition-colors relative ${isUnderActive ? 'bg-teal-500/20' : 'hover:bg-white/5'
                                        }`}
                                >
                                    <span className={`text-[9px] font-black font-mono transition-all duration-300 ${isDigitSelected 
                                        ? 'text-teal-300 drop-shadow-[0_0_5px_rgba(20,184,166,0.5)]' 
                                        : 'text-gray-500'}`}>
                                        {percent}%
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
