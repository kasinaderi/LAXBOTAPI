'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Button } from './ui';
import { BarChart3, TrendingUp, TrendingDown, RotateCcw, DollarSign } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function PerformanceStats() {
    const { stats, account, resetStats } = useDerivStore();

    const winRate = stats.totalTrades > 0
        ? Math.round((stats.won / stats.totalTrades) * 100)
        : 0;

    const profitColor = stats.totalProfit >= 0 ? 'text-teal-400' : 'text-red-400';

    return (
        <Card>
            <CardHeader
                icon={<BarChart3 className="w-5 h-5" />}
                badge={
                    <button
                        onClick={resetStats}
                        className="p-1 hover:text-white text-gray-400 transition-colors"
                        title="Reset Statistics"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </button>
                }
            >
                Performance
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-dark-secondary rounded-lg border border-dark">
                        <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Total Trades</span>
                        <div className="text-xl font-bold mt-1">{stats.totalTrades}</div>
                    </div>
                    <div className="p-3 bg-dark-secondary rounded-lg border border-dark">
                        <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Win Rate</span>
                        <div className="text-xl font-bold mt-1 text-teal-400">{winRate}%</div>
                    </div>

                    <div className="col-span-2 p-3 bg-teal-500/5 rounded-lg border border-teal-500/10">
                        <div className="flex justify-between items-end">
                            <div>
                                <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Net Profit</span>
                                <div className={`text-2xl font-bold mt-1 ${profitColor}`}>
                                    {account?.currency || 'USD'} {stats.totalProfit.toFixed(2)}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-500">Wins:</span>
                                    <span className="text-teal-400 font-bold">{stats.won}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-500">Loss:</span>
                                    <span className="text-red-400 font-bold">{stats.lost}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-dark/50 grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Current Step</span>
                        <div className="flex items-center gap-2 mt-1">
                            <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                            <span className="text-sm font-bold">Step {stats.currentStep}</span>
                        </div>
                    </div>
                    <div>
                        <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Max Stake</span>
                        <div className="text-sm font-bold mt-1">
                            {account?.currency || 'USD'} {stats.maxStake.toFixed(2)}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
