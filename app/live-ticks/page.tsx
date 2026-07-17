'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardContent, Badge } from '@/components/ui';
import { Activity, Zap, BarChart3, TrendingUp, Sliders, RefreshCw } from 'lucide-react';
import { VOLATILITY_INDICES, JUMP_INDICES } from '@/lib/deriv/constants';
import { useLiveTicks } from '@/lib/deriv/useLiveTicks';
import { DigitStream } from '@/components/LiveTicks/DigitStream';
import { FrequencyBars } from '@/components/LiveTicks/FrequencyBars';
import { ControlsPanel } from '@/components/LiveTicks/ControlsPanel';
import { PayoutCalculator } from '@/components/LiveTicks/PayoutCalculator';
import { ClientOnly } from '@/components/ClientOnly';

export default function LiveTicksPage() {
    // --- State & Orchestration ---
    const [selectedMarket, setSelectedMarket] = useState('R_100');
    const [historyLength, setHistoryLength] = useState(100);
    const [filter, setFilter] = useState<'all' | 'odd' | 'even'>('all');
    const [autoScroll, setAutoScroll] = useState(true);
    const [mode, setMode] = useState<'stream' | 'history'>('stream');
    const [overUnderMode, setOverUnderMode] = useState<'off' | 'over' | 'under'>('off');
    const [overUnderDigit, setOverUnderDigit] = useState(5);

    // --- Data Management ---
    const { 
        ticks: allTicks, 
        status, 
        reconnect,
        subscribe, 
        unsubscribe, 
        fetchHistory 
    } = useLiveTicks();

    // Always keep subscription active to ensure real-time updates
    useEffect(() => {
        subscribe(selectedMarket);
        if (mode === 'history') {
            fetchHistory(selectedMarket, historyLength);
        }
        return () => unsubscribe(selectedMarket);
    }, [selectedMarket, mode, subscribe, unsubscribe, fetchHistory, historyLength]);

    const rawTicks = useMemo(() => allTicks[selectedMarket] || [], [allTicks, selectedMarket]);
    
    // --- Frequency Analysis Logic ---
    const analysis = useMemo(() => {
        const symbolTicks = rawTicks.slice(-historyLength);
        const freq: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) freq[i] = 0;
        
        symbolTicks.forEach(t => freq[t.digit]++);

        const odds = [1, 3, 5, 7, 9];
        const evens = [0, 2, 4, 6, 8];

        const sortByFreq = (arr: number[]) => [...arr].sort((a, b) => freq[b] - freq[a]);
        
        const sortedOdds = sortByFreq(odds);
        const sortedEvens = sortByFreq(evens);

        return {
            freq,
            total: symbolTicks.length,
            topOdd: sortedOdds[0],
            topEven: sortedEvens[0],
            leastOdd: sortedOdds[4],
            leastEven: sortedEvens[4],
            evenCount: evens.reduce((sum, d) => sum + freq[d], 0)
        };
    }, [rawTicks, historyLength]);

    const frequencyHighlights = useMemo(() => {
        const h: Record<number, any> = {};
        h[analysis.topOdd] = 'topOdd';
        h[analysis.topEven] = 'topEven';
        h[analysis.leastOdd] = 'leastOdd';
        h[analysis.leastEven] = 'leastEven';
        return h;
    }, [analysis]);

    return (
        <div className="space-y-6 max-w-[1600px] mx-auto pb-12">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-teal-500/10 rounded-2xl border border-teal-500/20">
                        <Activity className="w-8 h-8 text-teal-400 animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                            Live <span className="text-teal-500">Ticks</span>
                        </h1>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em]">
                            Global Market Intelligence Dashboard
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black uppercase text-gray-500 tracking-widest leading-none mb-1">Status</span>
                        <div className="flex items-center gap-2">
                            <Badge 
                                variant={status === 'connected' ? 'success' : 'warning'} 
                                className="uppercase border-none text-[10px]"
                            >
                                {status === 'connected' ? 'Streaming Live' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
                            </Badge>
                            <button 
                                onClick={() => reconnect()}
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                                title="Force Reconnect"
                            >
                                <RefreshCw className={`w-3 h-3 ${status === 'connecting' ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <ClientOnly>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Lateral Navigation & Controls */}
                    <div className="space-y-6">
                        {/* Market Selector */}
                        <Card className="bg-dark-secondary/30 border-white/5">
                            <CardHeader icon={<Sliders className="w-4 h-4 text-gray-400" />}>
                                Market Selection
                            </CardHeader>
                            <CardContent className="p-1 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/5">
                                <div className="grid grid-cols-2 gap-1 p-2">
                                    {[...VOLATILITY_INDICES, ...JUMP_INDICES].map(m => (
                                        <button
                                            key={m.value}
                                            onClick={() => setSelectedMarket(m.value)}
                                            className={`px-2 py-3 rounded-lg text-[10px] font-black transition-all text-center uppercase tracking-tighter border ${
                                                selectedMarket === m.value
                                                ? 'bg-teal-500/20 border-teal-500/50 text-teal-400 shadow-[0_0_15px_rgba(20,184,166,0.1)]'
                                                : 'bg-dark border-transparent text-gray-500 hover:border-white/10 hover:text-white'
                                            }`}
                                        >
                                            {m.label.split(' Index')[0].replace('Volatility ', 'V')}
                                        </button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <ControlsPanel 
                            historyLength={historyLength}
                            setHistoryLength={setHistoryLength}
                            filter={filter}
                            setFilter={setFilter}
                            autoScroll={autoScroll}
                            setAutoScroll={setAutoScroll}
                            mode={mode}
                            setMode={setMode}
                            overUnderMode={overUnderMode}
                            setOverUnderMode={setOverUnderMode}
                            overUnderDigit={overUnderDigit}
                            setOverUnderDigit={setOverUnderDigit}
                        />

                        <PayoutCalculator />
                    </div>

                    {/* Main Analysis Display */}
                    <div className="lg:col-span-3 space-y-6">
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            {/* Digit Stream View */}
                            <Card className="xl:col-span-2 overflow-hidden border-teal-500/10 shadow-xl shadow-teal-500/5">
                                <CardHeader 
                                    icon={<Zap className="w-5 h-5 text-amber-400" />}
                                    badge={<Badge variant="outline" className="border-amber-500/20 text-amber-500">{selectedMarket}</Badge>}
                                >
                                    Digit Stream Intelligence
                                </CardHeader>
                                <CardContent className="p-0">
                                    <DigitStream 
                                        ticks={rawTicks}
                                        filter={filter}
                                        historyLength={historyLength}
                                        autoScroll={autoScroll}
                                        overUnderMode={overUnderMode}
                                        overUnderDigit={overUnderDigit}
                                        frequencyHighlights={frequencyHighlights}
                                    />
                                    <div className="p-4 bg-dark/30 border-t border-white/5 flex gap-4 text-[9px] font-black uppercase text-gray-600 tracking-widest">
                                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full ring-1 ring-green-400 ring-offset-1 ring-offset-dark" /> Top Even</div>
                                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full ring-1 ring-white ring-offset-1 ring-offset-dark" /> Top Odd</div>
                                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full ring-1 ring-amber-400 ring-offset-1 ring-offset-dark" /> Threshold</div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Quick Summary Grid */}
                            <div className="flex flex-col gap-6">
                                <Card className="flex-1">
                                    <CardHeader icon={<BarChart3 className="w-5 h-5 text-indigo-400" />}>
                                        Parity Balance
                                    </CardHeader>
                                    <CardContent className="flex flex-col justify-center h-full space-y-6 pb-8">
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-end">
                                                <span className="text-[10px] font-black uppercase text-teal-500 tracking-widest">Even Bias</span>
                                                <span className="text-3xl font-black text-white">{analysis.total > 0 ? Math.round((analysis.evenCount / analysis.total) * 100) : 0}%</span>
                                            </div>
                                            <div className="h-2.5 w-full bg-dark rounded-full overflow-hidden border border-white/5">
                                                <div 
                                                    className="h-full bg-gradient-to-r from-teal-600 to-teal-400 shadow-[0_0_15px_rgba(20,184,166,0.4)] transition-all duration-1000" 
                                                    style={{ width: `${analysis.total > 0 ? (analysis.evenCount / analysis.total) * 100 : 0}%` }} 
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-end">
                                                <span className="text-[10px] font-black uppercase text-rose-500 tracking-widest">Odd Bias</span>
                                                <span className="text-3xl font-black text-white">{analysis.total > 0 ? 100 - Math.round((analysis.evenCount / analysis.total) * 100) : 0}%</span>
                                            </div>
                                            <div className="h-2.5 w-full bg-dark rounded-full overflow-hidden border border-white/5">
                                                <div 
                                                    className="h-full bg-gradient-to-r from-rose-600 to-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)] transition-all duration-1000" 
                                                    style={{ width: `${analysis.total > 0 ? 100 - (analysis.evenCount / analysis.total) * 100 : 0}%` }} 
                                                />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>

                        {/* Full Frequency Counter Chart */}
                        <Card>
                            <CardHeader 
                                icon={<BarChart3 className="w-5 h-5 text-cyan-400" />}
                                badge={<Badge variant="outline" className="border-white/5">{historyLength} Samples</Badge>}
                            >
                                Real-Time Frequency Counter
                            </CardHeader>
                            <CardContent className="p-8">
                                <FrequencyBars 
                                    counts={analysis.freq}
                                    total={analysis.total}
                                    topOdd={analysis.topOdd}
                                    topEven={analysis.topEven}
                                />
                            </CardContent>
                        </Card>

                        {/* Insights Footer */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                                { label: 'Most Frequent Even', val: analysis.topEven, color: 'text-teal-400' },
                                { label: 'Most Frequent Odd', val: analysis.topOdd, color: 'text-rose-400' },
                                { label: 'Least Frequent Even', val: analysis.leastEven, color: 'text-gray-500' },
                                { label: 'Least Frequent Odd', val: analysis.leastOdd, color: 'text-gray-500' },
                            ].map((stat, i) => (
                                <Card key={i} className="bg-dark/40 border-white/5">
                                    <CardContent className="p-4 flex flex-col items-center justify-center">
                                        <span className="text-[8px] font-black uppercase text-gray-600 tracking-widest mb-1">{stat.label}</span>
                                        <span className={`text-2xl font-black ${stat.color}`}>{stat.val}</span>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            </ClientOnly>
        </div>
    );
}
