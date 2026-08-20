'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardContent, Input, Toggle } from './ui';
import { Settings, BarChart2, DollarSign, Zap, FlaskConical, Target, AlertTriangle, ShieldCheck, LifeBuoy, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDerivStore } from '@/store/useDerivStore';
import { TradeSetup } from './TradeSetup';
import { VirtualSettings } from './VirtualSettings';
import { RecoverySettings } from './RecoverySettings';
import { ALL_MARKETS, CONTRACT_TYPES, DIGIT_VALUES } from '@/lib/deriv/constants';

type TabType = 'trade' | 'money' | 'mgale' | 'virtual' | 'recovery';

export function SettingsTabs() {
    const [activeTab, setActiveTab] = useState<TabType>('trade');
    const settings = useDerivStore();
    const { market, contractType, prediction, setMarket, setContractType, setPrediction, setRiskSettings } = settings;
    const virtual = settings.virtualSettings;

    const tabs = [
        { id: 'trade', label: 'Trade', icon: <BarChart2 className="w-4 h-4" /> },
        { id: 'money', label: 'Money', icon: <DollarSign className="w-4 h-4" /> },
        { id: 'mgale', label: 'M-Gale', icon: <Zap className="w-4 h-4" /> },
        { id: 'virtual', label: 'Virtual', icon: <FlaskConical className="w-4 h-4" /> },
        { id: 'recovery', label: 'Recovery', icon: <LifeBuoy className="w-4 h-4" /> },
    ];

    const isDigitType = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);

    return (
        <Card className="min-h-[500px] flex flex-col border-indigo-500/10 transition-all duration-500 overflow-hidden">
            <div className="flex-none flex flex-wrap bg-dark-secondary/50 border-b border-dark p-1 gap-1">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`flex-1 min-w-[80px] flex flex-col md:flex-row items-center justify-center gap-1.5 py-3 px-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all duration-300 relative ${activeTab === tab.id
                            ? 'text-white bg-indigo-500/20 shadow-[inset_0_0_20px_rgba(99,102,241,0.1)] border border-indigo-500/30'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-dark-hover/50 border border-transparent'
                            }`}
                    >
                        <span className={activeTab === tab.id ? 'text-indigo-400' : ''}>{tab.icon}</span>
                        <span className="truncate">{tab.label}</span>
                        {activeTab === tab.id && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute -bottom-1 left-1 right-1 h-0.5 bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.8)]"
                            />
                        )}
                    </button>
                ))}
            </div>

            <CardContent className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar max-h-[calc(100vh-150px)]">
                {activeTab === 'trade' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="space-y-2">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Execution Engine</span>
                            <div className="flex bg-dark rounded-xl p-1 border border-dark-hover">
                                <button
                                    onClick={() => settings.setExecutionMode('fast')}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${settings.executionMode === 'fast' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    FAST (BACKEND)
                                </button>
                                <button
                                    onClick={() => settings.setExecutionMode('standard')}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${settings.executionMode === 'standard' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    STANDARD (DDBOT)
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Market Selection</span>
                            <select
                                value={market}
                                onChange={(e) => setMarket(e.target.value)}
                                className="w-full bg-dark-secondary border-2 border-dark rounded-xl px-4 py-3 text-sm font-bold text-white focus:border-indigo-500/50 outline-none transition-all"
                            >
                                {ALL_MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Contract</span>
                                <select
                                    value={contractType}
                                    onChange={(e) => setContractType(e.target.value)}
                                    className="w-full bg-dark-secondary border-2 border-dark rounded-xl px-4 py-3 text-sm font-bold text-white focus:border-indigo-500/50 outline-none transition-all"
                                >
                                    {CONTRACT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                            </div>

                            {isDigitType && (
                                <div className="space-y-2">
                                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Prediction</span>
                                    <select
                                        value={prediction.toString()}
                                        onChange={(e) => setPrediction(parseInt(e.target.value))}
                                        className="w-full bg-dark-secondary border-2 border-dark rounded-xl px-4 py-3 text-sm font-bold text-white focus:border-indigo-500/50 outline-none transition-all"
                                    >
                                        {DIGIT_VALUES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'money' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        {/* Stakes Section */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5 p-4 bg-dark-secondary/50 rounded-2xl border border-dark">
                                <span className="text-[10px] font-black text-teal-400 uppercase tracking-tighter">Initial Stake</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={settings.initialStake}
                                    onChange={(e) => setRiskSettings({ initialStake: parseFloat(e.target.value) || 0.35 })}
                                    className="w-full bg-transparent border-none p-0 text-xl font-black text-white focus:ring-0 outline-none"
                                />
                            </div>
                            <div className="space-y-1.5 p-4 bg-dark-secondary/50 rounded-2xl border border-dark">
                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">Currency</span>
                                <div className="text-xl font-black text-white py-1">{settings.account?.currency || 'USD'}</div>
                            </div>
                        </div>

                        {/* Profit/Loss Targets ($) */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5 p-4 bg-dark-secondary/50 rounded-2xl border border-dark group hover:border-teal-500/30 transition-all">
                                <span className="text-[10px] font-black text-teal-400 uppercase tracking-tighter">Take Profit ($)</span>
                                <input
                                    type="number"
                                    step="1"
                                    value={settings.takeProfit}
                                    onChange={(e) => setRiskSettings({ takeProfit: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-transparent border-none p-0 text-xl font-black text-white focus:ring-0 outline-none"
                                />
                            </div>
                            <div className="space-y-1.5 p-4 bg-dark-secondary/50 rounded-2xl border border-dark group hover:border-red-500/30 transition-all">
                                <span className="text-[10px] font-black text-red-400 uppercase tracking-tighter">Stop Loss ($)</span>
                                <input
                                    type="number"
                                    step="1"
                                    value={settings.stopLoss}
                                    onChange={(e) => setRiskSettings({ stopLoss: Math.abs(parseFloat(e.target.value)) || 0 })}
                                    className="w-full bg-transparent border-none p-0 text-xl font-black text-white focus:ring-0 outline-none"
                                />
                            </div>
                        </div>

                        {/* Quantity Limits (Qty) */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-3 p-4 bg-dark-secondary/30 rounded-2xl border border-dark">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 px-1">
                                        <Target className="w-4 h-4 text-teal-400" />
                                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Max Wins (Qty)</span>
                                    </div>
                                    <Toggle
                                        enabled={settings.stopAfterTotalWins.enabled}
                                        onChange={(val) => setRiskSettings({ stopAfterTotalWins: { ...settings.stopAfterTotalWins, enabled: val } })}
                                    />
                                </div>
                                {settings.stopAfterTotalWins.enabled && (
                                    <input
                                        type="number"
                                        min="1"
                                        value={settings.stopAfterTotalWins.value}
                                        onChange={(e) => setRiskSettings({ stopAfterTotalWins: { ...settings.stopAfterTotalWins, value: parseInt(e.target.value) || 1 } })}
                                        className="w-full bg-dark-card border-2 border-dark rounded-xl px-4 py-3 text-xl font-black text-teal-400 focus:border-teal-500/50 outline-none transition-all text-center"
                                    />
                                )}
                            </div>

                            <div className="space-y-3 p-4 bg-dark-secondary/30 rounded-2xl border border-dark">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 px-1">
                                        <AlertTriangle className="w-4 h-4 text-red-400" />
                                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Max Losses (Qty)</span>
                                    </div>
                                    <Toggle
                                        enabled={settings.stopAfterTotalLosses?.enabled || false}
                                        onChange={(val) => setRiskSettings({ stopAfterTotalLosses: { ...(settings.stopAfterTotalLosses || { value: 50 }), enabled: val } })}
                                    />
                                </div>
                                {(settings.stopAfterTotalLosses?.enabled) && (
                                    <input
                                        type="number"
                                        min="1"
                                        value={settings.stopAfterTotalLosses.value}
                                        onChange={(e) => setRiskSettings({ stopAfterTotalLosses: { ...settings.stopAfterTotalLosses, value: parseInt(e.target.value) || 1 } })}
                                        className="w-full bg-dark-card border-2 border-dark rounded-xl px-4 py-3 text-xl font-black text-red-400 focus:border-red-500/50 outline-none transition-all text-center"
                                    />
                                )}
                            </div>
                        </div>

                        <div className="p-4 bg-teal-500/5 rounded-2xl border border-teal-500/10 flex items-center justify-between group hover:border-teal-500/30 transition-all duration-500">
                            <div className="space-y-0.5">
                                <span className="text-sm font-bold text-teal-400">Compound Wins</span>
                                <p className="text-[10px] text-gray-500 font-medium">Add profit to the next stake upon winning</p>
                            </div>
                            <Toggle enabled={settings.compoundProfits} onChange={(val) => setRiskSettings({ compoundProfits: val })} />
                        </div>

                        <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex items-center justify-between group hover:border-indigo-500/30 transition-all duration-500">
                            <div className="space-y-0.5">
                                <span className="text-sm font-bold text-indigo-400">Quick HUD Controls</span>
                                <p className="text-[10px] text-gray-500 font-medium">Enable interactive buttons on analysis charts</p>
                            </div>
                            <Toggle enabled={settings.showQuickControls} onChange={(val) => settings.setShowQuickControls(val)} />
                        </div>

                        {settings.showQuickControls && (
                            <div className="space-y-3 p-4 bg-dark-secondary/30 rounded-2xl border border-dark animate-in slide-in-from-top-2 duration-300">
                                <div className="space-y-0.5">
                                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Virtual HUD Behavior</span>
                                    <p className="text-[9px] text-gray-600 font-medium pl-1">What happens when clicking buttons in Virtual mode</p>
                                </div>
                                <div className="flex flex-col sm:flex-row bg-dark rounded-xl p-1 border border-dark-hover gap-1">
                                    <button
                                        onClick={() => settings.setQuickSwitchVirtualBehavior('continue_virtual')}
                                        className={`flex-1 py-2 px-3 rounded-lg text-[10px] font-black transition-all ${settings.quickSwitchVirtualBehavior === 'continue_virtual' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        STAY VIRTUAL
                                    </button>
                                    <button
                                        onClick={() => settings.setQuickSwitchVirtualBehavior('override_to_real')}
                                        className={`flex-1 py-2 px-3 rounded-lg text-[10px] font-black transition-all ${settings.quickSwitchVirtualBehavior === 'override_to_real' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        SWITCH TO REAL
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'mgale' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5 p-4 bg-dark-secondary/50 rounded-2xl border border-dark">
                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">Multiplier</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={settings.martingaleMultiplier}
                                    onChange={(e) => setRiskSettings({ martingaleMultiplier: parseFloat(e.target.value) })}
                                    className="w-full bg-transparent border-none p-0 text-xl font-black text-white focus:ring-0 outline-none"
                                />
                            </div>
                            <div className="space-y-1.5 p-4 bg-dark-secondary/50 rounded-2xl border border-dark">
                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">Max Steps</span>
                                <input
                                    type="number"
                                    value={settings.maxMartingaleSteps}
                                    onChange={(e) => setRiskSettings({ maxMartingaleSteps: parseInt(e.target.value) })}
                                    className="w-full bg-transparent border-none p-0 text-xl font-black text-white focus:ring-0 outline-none"
                                />
                            </div>
                        </div>

                        <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex items-center justify-between group hover:border-indigo-500/30 transition-all duration-500">
                            <div className="space-y-0.5">
                                <span className="text-sm font-bold text-indigo-400">Stop on Max Steps</span>
                                <p className="text-[10px] text-gray-500 font-medium">Stop bot after reaching max Martingale steps</p>
                            </div>
                            <Toggle enabled={settings.stopOnMaxSteps} onChange={(val) => setRiskSettings({ stopOnMaxSteps: val })} />
                        </div>

                        <div className="p-4 bg-rose-500/5 rounded-2xl border border-rose-500/10 flex items-center justify-between group hover:border-rose-500/30 transition-all duration-500">
                            <div className="space-y-0.5">
                                <span className="text-sm font-bold text-rose-400">Run Popup Window</span>
                                <p className="text-[10px] text-gray-500 font-medium">Auto-open execution logs when bot starts</p>
                            </div>
                            <Toggle enabled={settings.showLogOverlayOnRun} onChange={(val) => settings.setShowLogOverlayOnRun(val)} />
                        </div>
                    </div>
                )}

                {activeTab === 'virtual' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 -mt-2 space-y-6">
                        {/* Initial Mode Selection */}
                        <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/20 flex items-center justify-between group hover:border-indigo-500/40 transition-all duration-500">
                            <div className="space-y-0.5">
                                <span className="text-sm font-bold text-white uppercase tracking-tighter">Initial Bot Mode</span>
                                <p className="text-[10px] text-gray-500 font-medium">Which mode to start with</p>
                            </div>
                            <div className="flex bg-dark rounded-xl p-1 border border-dark-hover">
                                <button
                                    onClick={() => settings.setVirtualSettings({ isVirtualMode: true })}
                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${virtual.isVirtualMode ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    VIRTUAL
                                </button>
                                <button
                                    onClick={() => settings.setVirtualSettings({ isVirtualMode: false })}
                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${!virtual.isVirtualMode ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    REAL
                                </button>
                            </div>
                        </div>

                        {/* Virtual -> Real Section */}
                        <div className="space-y-4 p-4 bg-dark-secondary/30 rounded-2xl border border-dark">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <span className="text-sm font-bold text-indigo-400 uppercase tracking-tighter">Virtual → Real</span>
                                    <p className="text-[10px] text-gray-500 font-medium">Automatic switch to live trading</p>
                                </div>
                                <Toggle
                                    enabled={virtual.startVirtualToReal}
                                    onChange={(val) => settings.setVirtualSettings({ startVirtualToReal: val })}
                                />
                            </div>

                            {virtual.startVirtualToReal && (
                                <div className="space-y-4 pt-2 animate-in zoom-in-95 duration-300">
                                    <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                                        <div className="space-y-0.5">
                                            <span className="text-xs font-bold text-indigo-300">⚡ Double Virtual Mode (2-Stage Cascade)</span>
                                            <p className="text-[9px] text-gray-400">Stage A gate → Stage B virtual/real cycle</p>
                                        </div>
                                        <Toggle
                                            enabled={!!virtual.isDoubleVirtual}
                                            onChange={(val) => settings.setVirtualSettings({ isDoubleVirtual: val, vDoubleStage: 'A', vStageBCompletedReps: 0 })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest pl-1">{virtual.isDoubleVirtual ? 'Stage A Thresh' : 'Threshold'}</span>
                                            <input
                                                type="number"
                                                value={virtual.vThreshold}
                                                onChange={(e) => settings.setVirtualSettings({ vThreshold: parseInt(e.target.value) || 0 })}
                                                className="w-full bg-dark border-2 border-dark-hover rounded-xl px-4 py-2 text-sm font-bold text-indigo-400 focus:border-indigo-500/50 outline-none"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest pl-1">Mode</span>
                                            <select
                                                value={virtual.vTriggerMode}
                                                onChange={(e) => settings.setVirtualSettings({ vTriggerMode: e.target.value as any })}
                                                className="w-full bg-dark border-2 border-dark-hover rounded-xl px-4 py-2 text-sm font-bold text-indigo-400 focus:border-indigo-500/50 outline-none"
                                            >
                                                <option value="consec">Consecutive</option>
                                                <option value="total">Total</option>
                                            </select>
                                        </div>
                                    </div>
                                    {virtual.isDoubleVirtual && (
                                        <div className="p-3 rounded-xl bg-dark/60 border border-indigo-500/20 space-y-2">
                                            <span className="text-[10px] font-bold text-indigo-400 uppercase">Stage B Gate Settings</span>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-bold text-gray-400">Trigger</span>
                                                    <select
                                                        value={virtual.vTriggerTypeB || 'wins'}
                                                        onChange={(e) => settings.setVirtualSettings({ vTriggerTypeB: e.target.value as any })}
                                                        className="w-full bg-dark border border-dark-hover rounded-lg px-2 py-1 text-xs font-bold text-indigo-300 outline-none"
                                                    >
                                                        <option value="wins">Wins</option>
                                                        <option value="losses">Losses</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-bold text-gray-400">Mode</span>
                                                    <select
                                                        value={virtual.vTriggerModeB || 'consec'}
                                                        onChange={(e) => settings.setVirtualSettings({ vTriggerModeB: e.target.value as any })}
                                                        className="w-full bg-dark border border-dark-hover rounded-lg px-2 py-1 text-xs font-bold text-indigo-300 outline-none"
                                                    >
                                                        <option value="consec">Consecutive</option>
                                                        <option value="total">Total</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-bold text-gray-400">Target Value</span>
                                                    <input
                                                        type="number" min={1}
                                                        value={virtual.vThresholdB ?? ''}
                                                        onChange={(e) => settings.setVirtualSettings({ vThresholdB: e.target.value === '' ? ('' as any) : Math.max(1, parseInt(e.target.value) || 1) })}
                                                        className="w-full bg-dark border border-dark-hover rounded-lg px-3 py-1.5 text-xs font-bold text-purple-300 outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-bold text-gray-400">Real Reps</span>
                                                    <input
                                                        type="number" min={1}
                                                        value={virtual.vStageBReps ?? ''}
                                                        onChange={(e) => settings.setVirtualSettings({ vStageBReps: e.target.value === '' ? ('' as any) : Math.max(1, parseInt(e.target.value) || 1) })}
                                                        className="w-full bg-dark border border-dark-hover rounded-lg px-3 py-1.5 text-xs font-bold text-purple-300 outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => settings.setVirtualSettings({ vTriggerType: 'wins' })}
                                            className={`py-2 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${virtual.vTriggerType === 'wins' ? 'bg-teal-500/10 border-teal-500/50 text-teal-400' : 'bg-dark border-dark-hover text-gray-500'}`}
                                        >
                                            Wins
                                        </button>
                                        <button
                                            onClick={() => settings.setVirtualSettings({ vTriggerType: 'losses' })}
                                            className={`py-2 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${virtual.vTriggerType === 'losses' ? 'bg-red-500/10 border-red-500/50 text-red-400' : 'bg-dark border-dark-hover text-gray-500'}`}
                                        >
                                            Losses
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Real -> Virtual Section */}
                        <div className="space-y-4 p-4 bg-dark-secondary/30 rounded-2xl border border-dark">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <span className="text-sm font-bold text-teal-400 uppercase tracking-tighter">Real → Virtual</span>
                                    <p className="text-[10px] text-gray-500 font-medium">Automatic switch back to virtual</p>
                                </div>
                                <Toggle
                                    enabled={virtual.startRealToVirtual}
                                    onChange={(val) => settings.setVirtualSettings({ startRealToVirtual: val })}
                                />
                            </div>

                            {virtual.startRealToVirtual && (
                                <div className="space-y-4 pt-2 animate-in zoom-in-95 duration-300">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest pl-1">Threshold</span>
                                            <input
                                                type="number"
                                                value={virtual.rThreshold}
                                                onChange={(e) => settings.setVirtualSettings({ rThreshold: parseInt(e.target.value) || 0 })}
                                                className="w-full bg-dark border-2 border-dark-hover rounded-xl px-4 py-2 text-sm font-bold text-teal-400 focus:border-teal-500/50 outline-none"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest pl-1">Mode</span>
                                            <select
                                                value={virtual.rTriggerMode}
                                                onChange={(e) => settings.setVirtualSettings({ rTriggerMode: e.target.value as any })}
                                                className="w-full bg-dark border-2 border-dark-hover rounded-xl px-4 py-2 text-sm font-bold text-teal-400 focus:border-teal-500/50 outline-none"
                                            >
                                                <option value="consec">Consecutive</option>
                                                <option value="total">Total</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => settings.setVirtualSettings({ rTriggerType: 'wins' })}
                                            className={`py-2 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${virtual.rTriggerType === 'wins' ? 'bg-teal-500/10 border-teal-500/50 text-teal-400' : 'bg-dark border-dark-hover text-gray-500'}`}
                                        >
                                            Wins
                                        </button>
                                        <button
                                            onClick={() => settings.setVirtualSettings({ rTriggerType: 'losses' })}
                                            className={`py-2 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${virtual.rTriggerType === 'losses' ? 'bg-red-500/10 border-red-500/50 text-red-400' : 'bg-dark border-dark-hover text-gray-500'}`}
                                        >
                                            Losses
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Smart Analysis Switch */}
                        <div className="space-y-4 p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/20">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <span className="text-sm font-bold text-indigo-400 uppercase tracking-tighter">Smart Analysis Switch</span>
                                    <p className="text-[10px] text-gray-500 font-medium">Switch to real on strict result patterns</p>
                                </div>
                                <Toggle
                                    enabled={virtual.smartSettings?.enabled || false}
                                    onChange={(val) => settings.setVirtualSettings({ smartSettings: { ...(virtual.smartSettings || {
                                        enabled: false,
                                        type: 'sequence' as const,
                                        sequence: { step1Type: 'Wins', step1Qty: 2, step2Type: 'Losses', step2Qty: 2 },
                                        alternating: { count: 2 }
                                    }), enabled: val } })}
                                />
                            </div>

                            {virtual.smartSettings?.enabled && (
                                <div className="space-y-4 pt-2 animate-in slide-in-from-top-2 duration-300">
                                    <div className="flex bg-dark rounded-xl p-1 border border-dark-hover">
                                        <button
                                            onClick={() => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, type: 'sequence' } })}
                                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${virtual.smartSettings?.type === 'sequence' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                        >
                                            STRICT SEQUENCE
                                        </button>
                                        <button
                                            onClick={() => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, type: 'alternating' } })}
                                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${virtual.smartSettings?.type === 'alternating' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                        >
                                            ALTERNATING
                                        </button>
                                    </div>

                                    {virtual.smartSettings?.type === 'sequence' ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 space-y-1">
                                                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest pl-1">Stage 1</span>
                                                    <div className="flex items-center bg-dark rounded-xl border border-dark-hover overflow-hidden">
                                                        <select
                                                            value={virtual.smartSettings?.sequence?.step1Type || 'Wins'}
                                                            onChange={(e) => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step1Type: e.target.value as any } } })}
                                                            className="bg-transparent text-[10px] font-bold text-white px-2 py-2 outline-none border-r border-dark-hover"
                                                        >
                                                            <option value="Wins">Wins</option>
                                                            <option value="Losses">Losses</option>
                                                        </select>
                                                        <input
                                                            type="number"
                                                            value={virtual.smartSettings?.sequence?.step1Qty || 2}
                                                            onChange={(e) => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step1Qty: parseInt(e.target.value) || 1 } } })}
                                                            className="w-full bg-transparent px-2 py-2 text-xs font-black text-indigo-400 outline-none text-center"
                                                        />
                                                    </div>
                                                    {/* Stage 1 Mode Toggle */}
                                                    <div className="flex bg-dark rounded-xl border border-dark-hover overflow-hidden p-0.5 mt-1">
                                                        <button
                                                            onClick={() => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step1Mode: 'consecutive' } } })}
                                                            className={`flex-1 py-1 rounded-md text-[8px] font-black uppercase tracking-tight transition-all ${(virtual.smartSettings?.sequence?.step1Mode || 'consecutive') === 'consecutive' ? 'bg-indigo-500 text-white' : 'text-gray-500'}`}
                                                        >
                                                            Consec
                                                        </button>
                                                        <button
                                                            onClick={() => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step1Mode: 'total' } } })}
                                                            className={`flex-1 py-1 rounded-md text-[8px] font-black uppercase tracking-tight transition-all ${(virtual.smartSettings?.sequence?.step1Mode || 'consecutive') === 'total' ? 'bg-indigo-500 text-white' : 'text-gray-500'}`}
                                                        >
                                                            Total
                                                        </button>
                                                    </div>
                                                </div>
                                                <ArrowRight className="w-4 h-4 text-gray-600 mt-4" />
                                                <div className="flex-1 space-y-1">
                                                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest pl-1">Stage 2</span>
                                                    <div className="flex items-center bg-dark rounded-xl border border-dark-hover overflow-hidden">
                                                        <select
                                                            value={virtual.smartSettings?.sequence?.step2Type || 'Losses'}
                                                            onChange={(e) => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step2Type: e.target.value as any } } })}
                                                            className="bg-transparent text-[10px] font-bold text-white px-2 py-2 outline-none border-r border-dark-hover"
                                                        >
                                                            <option value="Wins">Wins</option>
                                                            <option value="Losses">Losses</option>
                                                        </select>
                                                        <input
                                                            type="number"
                                                            value={virtual.smartSettings?.sequence?.step2Qty || 2}
                                                            onChange={(e) => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step2Qty: parseInt(e.target.value) || 1 } } })}
                                                            className="w-full bg-transparent px-2 py-2 text-xs font-black text-indigo-400 outline-none text-center"
                                                        />
                                                    </div>
                                                    {/* Stage 2 Mode Toggle */}
                                                    <div className="flex bg-dark rounded-xl border border-dark-hover overflow-hidden p-0.5 mt-1">
                                                        <button
                                                            onClick={() => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step2Mode: 'consecutive' } } })}
                                                            className={`flex-1 py-1 rounded-md text-[8px] font-black uppercase tracking-tight transition-all ${(virtual.smartSettings?.sequence?.step2Mode || 'consecutive') === 'consecutive' ? 'bg-indigo-500 text-white' : 'text-gray-500'}`}
                                                        >
                                                            Consec
                                                        </button>
                                                        <button
                                                            onClick={() => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, sequence: { ...virtual.smartSettings!.sequence, step2Mode: 'total' } } })}
                                                            className={`flex-1 py-1 rounded-md text-[8px] font-black uppercase tracking-tight transition-all ${(virtual.smartSettings?.sequence?.step2Mode || 'consecutive') === 'total' ? 'bg-indigo-500 text-white' : 'text-gray-500'}`}
                                                        >
                                                            Total
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <p className="text-[9px] text-gray-500 italic text-center px-2">
                                                Bot will switch to Real only after {virtual.smartSettings?.sequence?.step1Qty} {(virtual.smartSettings?.sequence?.step1Mode || 'consecutive') === 'consecutive' ? 'Consecutive' : 'Total'} {virtual.smartSettings?.sequence?.step1Type} followed immediately by {virtual.smartSettings?.sequence?.step2Qty} {(virtual.smartSettings?.sequence?.step2Mode || 'consecutive') === 'consecutive' ? 'Consecutive' : 'Total'} {virtual.smartSettings?.sequence?.step2Type}.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="space-y-1.5 p-3 bg-dark rounded-xl border border-dark-hover">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Required Alternating Patterns</span>
                                                    <span className="text-[9px] font-black text-indigo-400">{virtual.smartSettings?.alternating?.count || 2} CYCLES</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="5"
                                                    value={virtual.smartSettings?.alternating?.count || 2}
                                                    onChange={(e) => settings.setVirtualSettings({ smartSettings: { ...virtual.smartSettings!, alternating: { count: parseInt(e.target.value) } } })}
                                                    className="w-full h-1 bg-dark-hover rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                />
                                                <div className="flex justify-between text-[8px] text-gray-600 font-bold uppercase mt-1">
                                                    <span>W-L</span>
                                                    <span>W-L-W-L</span>
                                                    <span>W-L-W-L-W-L</span>
                                                </div>
                                            </div>
                                            <p className="text-[9px] text-gray-500 italic text-center px-4">
                                                Detects repeated Win-Loss or Loss-Win cycles. Switches to Real after pattern completion.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Status Monitor */}
                        <div className={`p-4 rounded-2xl border flex flex-col gap-3 transition-all duration-700 ${virtual.isVirtualMode ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-teal-500/10 border-teal-500/20'
                            }`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-3 h-3 rounded-full animate-pulse ${virtual.isVirtualMode ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-teal-500 shadow-[0_0_10px_rgba(20,184,166,0.5)]'}`} />
                                    <div>
                                        <span className={`text-xs font-black italic tracking-tighter block leading-none ${virtual.isVirtualMode ? 'text-indigo-400' : 'text-teal-400'}`}>
                                            {virtual.isVirtualMode ? 'VIRTUAL TRACKING' : 'REAL EXECUTION'}
                                        </span>
                                        <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest mt-1 block">Active Machine</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-black text-white">
                                        {virtual.isVirtualMode
                                            ? `${virtual.vConsecWins}W / ${virtual.vConsecLosses}L`
                                            : `${virtual.rConsecWins}W / ${virtual.rConsecLosses}L`}
                                    </div>
                                    <div className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">Active Streak</div>
                                </div>
                            </div>

                            {virtual.isVirtualMode && virtual.smartSettings?.enabled && (
                                <div className="pt-2 border-t border-indigo-500/10">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Smart Matcher Progress</span>
                                        <span className="text-[8px] font-bold text-indigo-400">
                                            {virtual.smartSettings?.type === 'sequence' 
                                                ? `STAGE ${virtual.vSmartStage}: ${virtual.vSmartCount}/${virtual.vSmartStage === 1 ? virtual.smartSettings?.sequence?.step1Qty : virtual.smartSettings?.sequence?.step2Qty}`
                                                : `HISTORY: ${virtual.vResultHistory?.slice(-4).join('-') || 'Waiting...'}`}
                                        </span>
                                    </div>
                                    <div className="h-1 bg-dark rounded-full overflow-hidden">
                                        <motion.div 
                                            className="h-full bg-indigo-500"
                                            initial={{ width: 0 }}
                                            animate={{ 
                                                width: virtual.smartSettings?.type === 'sequence'
                                                    ? `${((virtual.vSmartStage - 1) * 50) + (virtual.vSmartCount / (virtual.vSmartStage === 1 ? (virtual.smartSettings?.sequence?.step1Qty || 1) : (virtual.smartSettings?.sequence?.step2Qty || 1)) * 50)}%`
                                                    : '0%' 
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {activeTab === 'recovery' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <RecoverySettings />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
