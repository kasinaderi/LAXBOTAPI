'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Badge } from '@/components/ui';
import { TrendingUp, Activity, Zap, ShieldCheck } from 'lucide-react';
import { useScannerStore } from '@/store/useScannerStore';
import { motion } from 'framer-motion';
import { ALL_MARKETS } from '@/lib/deriv/constants';

export default function AnalysisPage() {
    const { marketRegimes, signals, activeCount } = useScannerStore();

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tighter uppercase italic">
                        Reversal <span className="text-teal-500">Scanner</span>
                    </h1>
                    <p className="text-gray-400 mt-1 italic">
                        Monitoring {activeCount} markets for dominance flips.
                        Targeting 58% regime strength.
                    </p>
                </div>
            </div>

            {/* Market Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {ALL_MARKETS.map(market => {
                    const symbol = market.value;
                    const regimeData = marketRegimes[symbol];
                    const signal = signals[symbol];

                    const details = regimeData?.details;
                    const hasData = !!details;

                    const isOddRegime = regimeData?.regime === 'ODD';
                    const isEvenRegime = regimeData?.regime === 'EVEN';
                    const isNeutral = !isOddRegime && !isEvenRegime;

                    return (
                        <Card key={symbol} className={`group transition-all duration-500 border-2 ${signal ? 'border-teal-500 shadow-lg shadow-teal-500/20' : 'border-white/5 hover:border-white/10'}`}>
                            {signal && (
                                <div className="absolute top-0 left-0 right-0 bg-teal-500/20 text-teal-400 text-[10px] font-black uppercase tracking-widest text-center py-1 animate-pulse">
                                    High Probability Reversal Detected
                                </div>
                            )}

                            <CardContent className="p-5 pt-8">
                                {/* Header */}
                                <div className="flex justify-between items-start mb-4">
                                    <Badge variant="neutral" className="text-lg px-3 py-1">{market.label}</Badge>

                                    {hasData ? (
                                        <div className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border ${isOddRegime ? 'bg-amber-500/20 text-amber-500 border-amber-500/30' :
                                                isEvenRegime ? 'bg-teal-500/20 text-teal-500 border-teal-500/30' :
                                                    'bg-gray-800 text-gray-500 border-gray-700'
                                            }`}>
                                            {regimeData.regime} Dominance
                                        </div>
                                    ) : (
                                        <div className="text-[10px] text-gray-600 animate-pulse">WAITING FOR DATA...</div>
                                    )}
                                </div>

                                {hasData && details && (
                                    <div className="space-y-4">
                                        {/* Dominance Bar */}
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase">
                                                <span>ODD {(details.oddPct * 100).toFixed(0)}%</span>
                                                <span className="text-gray-600">Gap: {(details.gap * 100).toFixed(1)}%</span>
                                                <span>EVEN {(details.evenPct * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="h-2 bg-dark rounded-full overflow-hidden flex">
                                                <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${details.oddPct * 100}%` }} />
                                                <div className="h-full bg-teal-500 transition-all duration-500" style={{ width: `${details.evenPct * 100}%` }} />
                                            </div>
                                        </div>

                                        {/* Top 3 Digits */}
                                        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
                                            <div className="text-[9px] font-black text-gray-500 uppercase mb-2">Top 3 Clustered Digits</div>
                                            <div className="flex gap-2">
                                                {details.top3Digits.map((d, i) => (
                                                    <div key={i} className="flex-1 flex flex-col items-center">
                                                        <span className={`text-sm font-black ${d.digit % 2 === 0 ? 'text-teal-400' : 'text-amber-400'}`}>
                                                            {d.digit}
                                                        </span>
                                                        <span className="text-[9px] text-gray-400">{(d.pct * 100).toFixed(0)}%</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Signal Section */}
                                        {signal && (
                                            <div className="mt-2 text-center">
                                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-500/10 rounded-full border border-teal-500/50">
                                                    <Zap className="w-3 h-3 text-teal-500" />
                                                    <span className="text-xs font-bold text-teal-400">
                                                        Confidence: {signal.confidence}%
                                                    </span>
                                                </div>
                                                <div className="text-[10px] text-gray-400 mt-1">
                                                    Horizon: ~{signal.details.horizon} Ticks
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
