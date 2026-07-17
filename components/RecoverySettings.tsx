'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Badge, Toggle } from './ui';
import { LifeBuoy, Settings2, TrendingUp, AlertTriangle } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { ALL_MARKETS } from '@/lib/deriv/constants';

export function RecoverySettings() {
    const { recoverySettings, setRecoverySettings, isRecoveryActive } = useDerivStore();

    return (
        <Card className={isRecoveryActive ? 'border-amber-500/50 shadow-amber-500/10' : 'border-amber-500/10'}>
            <CardHeader
                icon={<LifeBuoy className={`w-5 h-5 ${isRecoveryActive ? 'text-amber-400 animate-pulse' : 'text-amber-500/70'}`} />}
                badge={
                    <div className="flex items-center gap-2">
                        {isRecoveryActive && (
                            <Badge variant="warning" className="animate-pulse bg-amber-500/20 text-amber-400 border-amber-500/30">RECOVERING</Badge>
                        )}
                        <Toggle
                            enabled={recoverySettings.enabled}
                            onChange={(enabled: boolean) => setRecoverySettings({ enabled })}
                        />
                    </div>
                }
            >
                <span className="text-amber-500/90 tracking-tight">Recovery Engine</span>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                    {/* Activation */}
                    <div className="space-y-1.5 p-3 bg-amber-500/5 rounded-xl border border-amber-500/10">
                        <label className="text-[9px] uppercase tracking-wider font-black text-amber-500/70 flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3" /> Activation
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                value={recoverySettings.lossThreshold}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecoverySettings({ lossThreshold: parseInt(e.target.value) || 0 })}
                                className="w-full bg-transparent border-none p-0 text-lg font-black text-white focus:ring-0 outline-none"
                            />
                            <span className="text-[10px] text-amber-500/40 font-bold uppercase">Losses</span>
                        </div>
                    </div>

                    {/* Target Wins */}
                    <div className="space-y-1.5 p-3 bg-amber-500/5 rounded-xl border border-amber-500/10">
                        <label className="text-[9px] uppercase tracking-wider font-black text-amber-500/70 flex items-center gap-1.5">
                            <TrendingUp className="w-3 h-3" /> Target Wins
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                value={recoverySettings.winThreshold || 1}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecoverySettings({ winThreshold: parseInt(e.target.value) || 1 })}
                                className="w-full bg-transparent border-none p-0 text-lg font-black text-white focus:ring-0 outline-none"
                            />
                            <span className="text-[10px] text-amber-500/40 font-bold uppercase">Wins</span>
                        </div>
                    </div>

                    {/* Recovery Stake */}
                    <div className={`space-y-1.5 p-3 rounded-xl border transition-all ${recoverySettings.useMartingaleStake ? 'bg-amber-500/2 border-dashed border-amber-500/5 opacity-55' : 'bg-amber-500/5 border-amber-500/10'}`}>
                        <label className="text-[9px] uppercase tracking-wider font-black text-amber-500/70 flex items-center gap-1.5">
                            <TrendingUp className="w-3 h-3" /> Recovery Stake
                        </label>
                        <div className="flex items-center gap-2">
                            {recoverySettings.useMartingaleStake ? (
                                <div className="text-sm font-bold text-amber-400 py-1 select-none">Martingale</div>
                            ) : (
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.35"
                                    value={recoverySettings.recoveryStake}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecoverySettings({ recoveryStake: parseFloat(e.target.value) || 0.35 })}
                                    className="w-full bg-transparent border-none p-0 text-lg font-black text-white focus:ring-0 outline-none"
                                />
                            )}
                            <span className="text-[10px] text-amber-500/40 font-bold uppercase">USD</span>
                        </div>
                    </div>

                    {/* Martingale Stake toggle card */}
                    <div className="space-y-1.5 p-3 bg-amber-500/5 rounded-xl border border-amber-500/10 flex flex-col justify-between">
                        <label className="text-[9px] uppercase tracking-wider font-black text-amber-500/70 flex items-center gap-1.5">
                            Martingale Stake
                        </label>
                        <div className="flex items-center justify-between">
                            <span className="text-[9px] text-gray-500 font-bold uppercase">Inherit Stake</span>
                            <Toggle
                                enabled={recoverySettings.useMartingaleStake || false}
                                onChange={(val: boolean) => setRecoverySettings({ useMartingaleStake: val })}
                            />
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] uppercase tracking-wider font-black text-amber-500/70 flex items-center gap-1.5 px-1">
                        <Settings2 className="w-3 h-3" /> Targeting Strategy
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <select
                            value={recoverySettings.recoveryMarket}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRecoverySettings({ recoveryMarket: e.target.value })}
                            className="bg-dark border-2 border-amber-500/10 rounded-xl px-3 py-2 text-sm font-bold text-amber-400 focus:border-amber-500/40 outline-none bg-dark-secondary/50"
                        >
                            {ALL_MARKETS.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                        <select
                            value={recoverySettings.recoveryContractType}
                            onChange={(e) => setRecoverySettings({ recoveryContractType: e.target.value })}
                            className="bg-dark border-2 border-amber-500/10 rounded-xl px-3 py-2 text-sm font-bold text-amber-400 focus:border-amber-500/40 outline-none bg-dark-secondary/50"
                        >
                            <option value="DIGITEVEN">Digit Even</option>
                            <option value="DIGITODD">Digit Odd</option>
                            <option value="DIGITOVER">Digit Over</option>
                            <option value="DIGITUNDER">Digit Under</option>
                        </select>
                    </div>
                </div>

                {recoverySettings.recoveryContractType.includes('DIGIT') && !['DIGITEVEN', 'DIGITODD'].includes(recoverySettings.recoveryContractType) && (
                    <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-1">
                        <label className="text-[9px] uppercase tracking-wider font-black text-amber-500/70 px-1">
                            Target Prediction
                        </label>
                        <div className="grid grid-cols-5 gap-1.5">
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                                <button
                                    key={n}
                                    onClick={() => setRecoverySettings({ recoveryPrediction: n })}
                                    className={`py-2 rounded-lg text-xs font-black font-mono border-2 transition-all ${recoverySettings.recoveryPrediction === n
                                        ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                        : 'bg-dark border-dark-hover text-gray-500 hover:border-amber-500/20 hover:text-amber-500/50'
                                        }`}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
