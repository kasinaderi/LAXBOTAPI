'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Input, Toggle } from './ui';
import { Settings, ShieldCheck, Target, AlertTriangle } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function TradeSettings() {
    const settings = useDerivStore();
    const setRisk = settings.setRiskSettings;

    return (
        <Card>
            <CardHeader icon={<Settings className="w-5 h-5" />}>
                Trade Settings
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Stake & Martingale */}
                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="Initial Stake"
                        type="number"
                        step="0.01"
                        value={settings.initialStake.toString()}
                        onChange={(e) => setRisk({ initialStake: parseFloat(e.target.value) })}
                    />
                    <Input
                        label="Martingale Multiplier"
                        type="number"
                        step="0.1"
                        value={settings.martingaleMultiplier.toString()}
                        onChange={(e) => setRisk({ martingaleMultiplier: parseFloat(e.target.value) })}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="Max Martingale Steps"
                        type="number"
                        value={settings.maxMartingaleSteps.toString()}
                        onChange={(e) => setRisk({ maxMartingaleSteps: parseInt(e.target.value) })}
                    />
                    <div className="flex flex-col gap-2 pt-6">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Stop on Max Steps</span>
                            <Toggle
                                enabled={settings.stopOnMaxSteps}
                                onChange={(val) => setRisk({ stopOnMaxSteps: val })}
                            />
                        </div>
                    </div>
                </div>

                <hr className="border-dark/30" />

                {/* TP / SL */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Target className="w-3.5 h-3.5 text-teal-400" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Take Profit</span>
                        </div>
                        <Input
                            type="number"
                            step="0.1"
                            value={settings.takeProfit.toString()}
                            onChange={(e) => setRisk({ takeProfit: parseFloat(e.target.value) })}
                        />
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Stop Loss</span>
                        </div>
                        <Input
                            type="number"
                            step="0.1"
                            value={settings.stopLoss.toString()}
                            onChange={(e) => setRisk({ stopLoss: parseFloat(e.target.value) })}
                        />
                    </div>
                </div>

                <hr className="border-dark/30" />

                {/* Global Limits */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-teal-400" />
                            <span className="text-sm font-medium">Total Wins Limit</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-20">
                                <Input
                                    type="number"
                                    value={settings.stopAfterTotalWins.value.toString()}
                                    onChange={(e) => setRisk({ stopAfterTotalWins: { ...settings.stopAfterTotalWins, value: parseInt(e.target.value) } })}
                                    className="text-right"
                                />
                            </div>
                            <Toggle
                                enabled={settings.stopAfterTotalWins.enabled}
                                onChange={(val) => setRisk({ stopAfterTotalWins: { ...settings.stopAfterTotalWins, enabled: val } })}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-medium">Max Consecutive Loss</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-20">
                                <Input
                                    type="number"
                                    value={settings.stopAfterConsecutiveLosses.value.toString()}
                                    onChange={(e) => setRisk({ stopAfterConsecutiveLosses: { ...settings.stopAfterConsecutiveLosses, value: parseInt(e.target.value) } })}
                                    className="text-right"
                                />
                            </div>
                            <Toggle
                                enabled={settings.stopAfterConsecutiveLosses.enabled}
                                onChange={(val) => setRisk({ stopAfterConsecutiveLosses: { ...settings.stopAfterConsecutiveLosses, enabled: val } })}
                            />
                        </div>
                    </div>
                </div>

                <div className="p-3 bg-teal-500/5 rounded-lg border border-teal-500/10 flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-bold text-teal-400">Compound Profits</span>
                        <p className="text-[10px] text-gray-500">Add profit to stake for next trade</p>
                    </div>
                    <Toggle
                        enabled={settings.compoundProfits}
                        onChange={(val) => setRisk({ compoundProfits: val })}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
