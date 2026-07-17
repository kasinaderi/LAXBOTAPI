'use client';

import React from 'react';
import { MarketState } from '@/lib/scanner/types';
import { Badge } from '@/components/ui';
import { Activity, TrendingUp, AlertTriangle, Clock } from 'lucide-react';

interface IndexCardProps {
    data: MarketState;
    label: string;
}

export function IndexCard({ data, label }: IndexCardProps) {
    const { currentFingerprint, reversalSetup, ticks } = data;
    const { dominance, dominanceStrength, slope } = currentFingerprint;

    // Status Logic
    const isReversalLikely = reversalSetup && reversalSetup.probability > 75;
    const dominanceColor = dominance === 'Even' ? 'text-teal-400' : dominance === 'Odd' ? 'text-rose-400' : 'text-gray-400';
    const dominanceBg = dominance === 'Even' ? 'bg-teal-500/10' : dominance === 'Odd' ? 'bg-rose-500/10' : 'bg-gray-500/10';

    // Sparkline Visual (Simple SVG)
    const history = ticks.slice(-20);
    const sparkline = history.map((d, i) => {
        const x = (i / (history.length - 1)) * 100;
        const y = 100 - (d * 10); // 0 at top (100%), 9 at bottom (10%)
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className={`
            relative overflow-hidden rounded-xl border p-4 transition-all duration-300
            ${isReversalLikely
                ? 'bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                : 'bg-dark/40 border-white/5 hover:border-white/10 hover:bg-white/5'}
        `}>
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="font-bold text-sm text-gray-300 uppercase tracking-wider">{label}</h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`text-lg font-black ${dominanceColor}`}>
                            {dominance} <span className="text-xs opacity-60">DOMINANCE</span>
                        </span>
                    </div>
                </div>

                <div className={`px-2 py-1 rounded text-xs font-bold leading-none ${dominanceBg} ${dominanceColor}`}>
                    {Math.round(dominanceStrength)}%
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-black/20 rounded p-2 flex flex-col items-center justify-center">
                    <span className="text-[9px] text-gray-500 uppercase font-bold text-center">Slope</span>
                    <span className={`text-xs font-mono font-bold ${slope > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {slope > 0 ? '+' : ''}{slope.toFixed(2)}
                    </span>
                </div>
                <div className="bg-black/20 rounded p-2 flex flex-col items-center justify-center">
                    <span className="text-[9px] text-gray-500 uppercase font-bold text-center">Entropy</span>
                    <span className="text-xs font-mono font-bold text-gray-300">
                        {currentFingerprint.entropy.toFixed(2)}
                    </span>
                </div>
                <div className="bg-black/20 rounded p-2 flex flex-col items-center justify-center">
                    <span className="text-[9px] text-gray-500 uppercase font-bold text-center">Clusters</span>
                    <span className="text-xs font-mono font-bold text-indigo-400">
                        {currentFingerprint.clusterCount}
                    </span>
                </div>
                <div className="bg-black/20 rounded p-2 flex flex-col items-center justify-center">
                    <span className="text-[9px] text-gray-500 uppercase font-bold text-center">Switch Rate</span>
                    <span className="text-xs font-mono font-bold text-amber-400">
                        {currentFingerprint.alternationRate.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* Reversal Signal */}
            {isReversalLikely ? (
                <div className="animate-pulse bg-red-500/20 border border-red-500/30 rounded-lg p-3 mb-3">
                    <div className="flex items-center gap-2 text-red-400 mb-1">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-black text-xs uppercase tracking-wider">High Probability Reversal</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-red-300 font-medium">
                        <span>Confidence: {reversalSetup.confidence}</span>
                        <span>{reversalSetup.probability.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-red-950/50 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                            className="bg-red-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${reversalSetup.probability}%` }}
                        />
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 text-[10px] text-red-400/80 font-mono">
                        <Clock className="w-3 h-3" />
                        Est. Horizon: ~{reversalSetup.horizon} ticks
                    </div>
                </div>
            ) : (
                <div className="text-center py-2 mb-3">
                    <span className="text-xs text-gray-600 font-medium italic">Scanning for reversal patterns...</span>
                </div>
            )}

            {/* Sparkline */}
            <div className="h-12 w-full mt-auto relative opacity-50">
                <svg className="w-full h-full text-indigo-500" preserveAspectRatio="none">
                    <polyline
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        points={sparkline}
                    />
                </svg>
            </div>
        </div>
    );
}
