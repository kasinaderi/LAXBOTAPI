'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui';
import { Settings2, Sliders, Clock, Activity, Target } from 'lucide-react';

interface ControlsPanelProps {
    historyLength: number;
    setHistoryLength: (val: number) => void;
    filter: 'all' | 'odd' | 'even';
    setFilter: (val: 'all' | 'odd' | 'even') => void;
    autoScroll: boolean;
    setAutoScroll: (val: boolean) => void;
    mode: 'stream' | 'history';
    setMode: (val: 'stream' | 'history') => void;
    overUnderMode: 'off' | 'over' | 'under';
    setOverUnderMode: (val: 'off' | 'over' | 'under') => void;
    overUnderDigit: number;
    setOverUnderDigit: (val: number) => void;
}

export function ControlsPanel({
    historyLength, setHistoryLength,
    filter, setFilter,
    autoScroll, setAutoScroll,
    mode, setMode,
    overUnderMode, setOverUnderMode,
    overUnderDigit, setOverUnderDigit
}: ControlsPanelProps) {
    return (
        <Card className="bg-dark-secondary/50 border-white/5">
            <CardContent className="p-4 space-y-6">
                {/* Mode & AutoScroll */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex gap-1 bg-dark rounded-lg p-1 border border-white/10">
                        <button 
                            onClick={() => setMode('stream')}
                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase transition-all ${mode === 'stream' ? 'bg-teal-500 text-dark shadow-lg shadow-teal-500/20' : 'text-gray-500 hover:text-white'}`}
                        >
                            <Activity className="w-3 h-3 inline mr-1" />
                            Live
                        </button>
                        <button 
                            onClick={() => setMode('history')}
                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase transition-all ${mode === 'history' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-white'}`}
                        >
                            <Clock className="w-3 h-3 inline mr-1" />
                            History
                        </button>
                    </div>
                    
                    <button 
                        onClick={() => setAutoScroll(!autoScroll)}
                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase border transition-all ${autoScroll ? 'border-teal-500/30 text-teal-400 bg-teal-500/5' : 'border-white/10 text-gray-500'}`}
                    >
                        Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
                    </button>
                </div>

                {/* History Length Slider */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-gray-500">
                        <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            <span>Sample Size</span>
                        </div>
                        <span className="text-teal-400 font-mono">{historyLength} Ticks</span>
                    </div>
                    <input 
                        type="range" min="10" max="5000" step="50"
                        value={historyLength}
                        onChange={(e) => setHistoryLength(Number(e.target.value))}
                        className="w-full accent-teal-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                    />
                </div>

                {/* Odd/Even Filter */}
                <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                        <Sliders className="w-3 h-3" />
                        Parity Filter
                    </span>
                    <div className="grid grid-cols-3 gap-1 p-1 bg-dark rounded-lg border border-white/10">
                        {['all', 'odd', 'even'].map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f as any)}
                                className={`py-1.5 rounded text-[10px] font-black uppercase transition-all ${filter === f ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Over/Under Mode */}
                <div className="space-y-3 pt-2 border-t border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                        <Target className="w-3 h-3" />
                        Analysis Mode
                    </span>
                    <div className="grid grid-cols-3 gap-1 p-1 bg-dark rounded-lg border border-white/10">
                        {['off', 'over', 'under'].map((m) => (
                            <button
                                key={m}
                                onClick={() => setOverUnderMode(m as any)}
                                className={`py-1.5 rounded text-[10px] font-black uppercase transition-all ${overUnderMode === m ? (m === 'off' ? 'bg-white/10 text-white' : 'bg-amber-500/20 text-amber-400') : 'text-gray-500 hover:text-white'}`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                    {overUnderMode !== 'off' && (
                        <div className="flex items-center gap-4 animate-in slide-in-from-top-2">
                            <input 
                                type="range" min="0" max="9" step="1"
                                value={overUnderDigit}
                                onChange={(e) => setOverUnderDigit(Number(e.target.value))}
                                className="flex-1 accent-amber-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                            />
                            <div className="w-10 h-10 flex items-center justify-center bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 font-black">
                                {overUnderDigit}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
