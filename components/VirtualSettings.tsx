'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Input, Toggle } from './ui';
import { FlaskConical, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function VirtualSettings() {
    const { virtualSettings, setVirtualSettings } = useDerivStore();

    return (
        <Card className="overflow-hidden border-indigo-500/20">
            <CardHeader
                icon={<FlaskConical className="w-5 h-5 text-indigo-400" />}
                className="bg-indigo-500/5"
            >
                Virtual Management
            </CardHeader>
            <CardContent className="p-4 space-y-6 bg-dark/40">
                {/* Start Virtual -> Switch to Real */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <span className="text-sm font-bold text-white">Start Virtual → Switch to Real</span>
                            <p className="text-[10px] text-gray-400 italic">Begin with simulated trades, switch after threshold</p>
                        </div>
                        <Toggle
                            enabled={virtualSettings.startVirtualToReal}
                            onChange={(val: boolean) => setVirtualSettings({ startVirtualToReal: val })}
                        />
                    </div>

                    <div className="space-y-2">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Switch to Real After</span>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setVirtualSettings({ vTriggerType: 'losses' })}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-300 ${virtualSettings.vTriggerType === 'losses'
                                    ? 'bg-red-500/10 border-red-500/50 shadow-lg shadow-red-500/10'
                                    : 'bg-dark-secondary/50 border-dark hover:border-gray-700'
                                    }`}
                            >
                                <span className={`text-xs font-black uppercase ${virtualSettings.vTriggerType === 'losses' ? 'text-red-400' : 'text-gray-500'}`}>Losses</span>
                                <span className="text-[9px] font-medium text-gray-500">Consecutive</span>
                            </button>
                            <button
                                onClick={() => setVirtualSettings({ vTriggerType: 'wins' })}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-300 ${virtualSettings.vTriggerType === 'wins'
                                    ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-500/10'
                                    : 'bg-dark-secondary/50 border-dark hover:border-gray-700'
                                    }`}
                            >
                                <span className={`text-xs font-black uppercase ${virtualSettings.vTriggerType === 'wins' ? 'text-teal-400' : 'text-gray-500'}`}>Wins</span>
                                <span className="text-[9px] font-medium text-gray-500">Consecutive</span>
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-3 px-3 bg-dark-secondary/30 rounded-lg border border-dark/50">
                        <div className="space-y-0.5">
                            <span className="text-xs font-bold text-white">Consecutive Wins Mode</span>
                            <p className="text-[9px] text-gray-500 uppercase font-medium">Off = total wins, On = consecutive wins</p>
                        </div>
                        <Toggle
                            enabled={virtualSettings.vTriggerMode === 'consec'}
                            onChange={(val: boolean) => setVirtualSettings({ vTriggerMode: val ? 'consec' : 'total' })}
                        />
                    </div>

                    <div className="space-y-1.5 px-4 py-3 bg-dark-secondary rounded-xl border border-dark shadow-inner">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">
                            {virtualSettings.isDoubleVirtual ? 'Stage A Gate Threshold' : 'Consecutive Wins Threshold'}
                        </span>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                value={virtualSettings.vThreshold?.toString() || '0'}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVirtualSettings({ vThreshold: parseInt(e.target.value) || 0 })}
                                className="bg-transparent border-none p-0 h-auto text-2xl font-black text-white focus:ring-0 w-full"
                            />
                        </div>
                    </div>

                    {/* Double Virtual Mode Toggle & Config */}
                    {virtualSettings.startVirtualToReal && (
                        <div className="p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <span className="text-xs font-bold text-indigo-300">⚡ Double Virtual System</span>
                                    <p className="text-[9px] text-gray-400">2-Stage cascade: Stage A gate → Stage B virtual/real cycle</p>
                                </div>
                                <Toggle
                                    enabled={!!virtualSettings.isDoubleVirtual}
                                    onChange={(val: boolean) => setVirtualSettings({ isDoubleVirtual: val, vDoubleStage: 'A', vStageBCompletedReps: 0 })}
                                />
                            </div>

                            {virtualSettings.isDoubleVirtual && (
                                <div className="pt-2 border-t border-indigo-500/10 space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-bold text-gray-400">Stage B Trigger</span>
                                            <select
                                                value={virtualSettings.vTriggerTypeB || 'wins'}
                                                onChange={(e) => setVirtualSettings({ vTriggerTypeB: e.target.value as any })}
                                                className="w-full bg-dark/60 border border-dark/60 h-8 rounded-lg px-2 text-xs font-bold text-indigo-300 outline-none"
                                            >
                                                <option value="wins">Wins</option>
                                                <option value="losses">Losses</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-bold text-gray-400">Stage B Mode</span>
                                            <select
                                                value={virtualSettings.vTriggerModeB || 'consec'}
                                                onChange={(e) => setVirtualSettings({ vTriggerModeB: e.target.value as any })}
                                                className="w-full bg-dark/60 border border-dark/60 h-8 rounded-lg px-2 text-xs font-bold text-indigo-300 outline-none"
                                            >
                                                <option value="consec">Consecutive</option>
                                                <option value="total">Total</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-bold text-gray-400">Target Value</span>
                                            <Input
                                                type="number"
                                                min={1}
                                                value={virtualSettings.vThresholdB?.toString() || '1'}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVirtualSettings({ vThresholdB: Math.max(1, parseInt(e.target.value) || 1) })}
                                                className="bg-dark/60 border-dark/60 h-8 text-xs font-bold"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-bold text-gray-400">Real Reps</span>
                                            <Input
                                                type="number"
                                                min={1}
                                                value={virtualSettings.vStageBReps?.toString() || '1'}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVirtualSettings({ vStageBReps: Math.max(1, parseInt(e.target.value) || 1) })}
                                                className="bg-dark/60 border-dark/60 h-8 text-xs font-bold"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="relative">
                    <hr className="border-dark/30" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 bg-dark/40">
                        <RefreshCw className="w-3 h-3 text-gray-600" />
                    </div>
                </div>

                {/* Start Real -> Switch to Virtual */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <span className="text-sm font-bold text-white">Start Real → Switch to Virtual</span>
                            <p className="text-[10px] text-gray-400 italic">Begin with real trades, switch after threshold</p>
                        </div>
                        <Toggle
                            enabled={virtualSettings.startRealToVirtual}
                            onChange={(val: boolean) => setVirtualSettings({ startRealToVirtual: val })}
                        />
                    </div>
                </div>

                {/* Status Indicator Panel */}
                <div className={`mt-6 p-4 rounded-2xl border-2 transition-all duration-700 shadow-2xl ${virtualSettings.isVirtualMode
                    ? 'bg-indigo-500/5 border-indigo-500/20 shadow-indigo-500/5'
                    : 'bg-teal-500/5 border-teal-500/20 shadow-teal-500/5'
                    }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <div className={`w-4 h-4 rounded-full animate-ping absolute inset-0 opacity-20 ${virtualSettings.isVirtualMode ? 'bg-indigo-500' : 'bg-teal-500'
                                    }`} />
                                <div className={`w-4 h-4 rounded-full relative ${virtualSettings.isVirtualMode ? 'bg-indigo-500 shadow-lg shadow-indigo-500/50' : 'bg-teal-500 shadow-lg shadow-teal-500/50'
                                    }`} />
                            </div>
                            <div>
                                <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-0.5">Engine Status</span>
                                <div className={`text-xl font-black italic tracking-tighter leading-none ${virtualSettings.isVirtualMode ? 'text-indigo-400' : 'text-teal-400'
                                    }`}>
                                    {virtualSettings.isVirtualMode ? 'VIRTUAL TRACKING' : 'REAL EXECUTION'}
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest block mb-0.5">Active Streak</span>
                            <div className="flex items-center gap-2 justify-end">
                                <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 text-xs font-black">{virtualSettings.isVirtualMode ? virtualSettings.vConsecWins : virtualSettings.rConsecWins}W</span>
                                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-xs font-black">{virtualSettings.isVirtualMode ? virtualSettings.vConsecLosses : virtualSettings.rConsecLosses}L</span>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
