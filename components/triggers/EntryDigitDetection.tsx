'use client';

import React from 'react';
import { Toggle, Select } from '../ui';
import { useDerivStore } from '@/store/useDerivStore';
import { DIGIT_VALUES } from '@/lib/deriv/constants';
import { Hash, Plus, X } from 'lucide-react';

const MONITOR_TICK_OPTIONS = [1, 2, 3, 4, 5, 8, 10, 15, 20].map(v => ({ value: v.toString(), label: v.toString() }));
const CONSECUTIVE_OPTIONS = [1, 2, 3, 4, 5].map(v => ({ value: v.toString(), label: v.toString() }));
const TYPE_OPTIONS = [
    { value: 'Over', label: 'Over' },
    { value: 'Under', label: 'Under' },
    { value: 'Even', label: 'Even' },
    { value: 'Odd', label: 'Odd' },
    { value: 'Match', label: 'Matches' },
    { value: 'Diff', label: 'Differs' },
];

export function EntryDigitDetection() {
    const { triggers, setTrigger } = useDerivStore();
    const config = triggers.entryDigit;

    const update = (fields: any) => setTrigger('entryDigit', fields);

    return (
        <div className="space-y-4 pt-2 border-t border-dark/50">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-teal-400 font-bold">#</span>
                    <span className="text-sm font-medium">Entry Digit Detection</span>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => {
                            if (config.enabled) update({ useMulti: !config.useMulti });
                        }}
                        className={`p-1.5 rounded-lg transition-all ${config.useMulti && config.enabled ? 'bg-teal-500/20 text-teal-400' : 'text-gray-500 hover:text-gray-300'} ${!config.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={!config.enabled}
                    >
                        <Hash className="w-4 h-4" />
                    </button>
                    <Toggle
                        enabled={config.enabled}
                        onChange={(enabled) => update({ enabled })}
                    />
                </div>
            </div>

            {config.enabled && (
                <div className="grid grid-cols-2 gap-4 animate-fade-in">
                    {!config.useMulti ? (
                        <Select
                            label="Entry Digit"
                            options={DIGIT_VALUES}
                            value={config.entryDigit.toString()}
                            onChange={(val) => update({ entryDigit: parseInt(val) })}
                            className="col-span-2"
                        />
                    ) : (
                        <div className="col-span-2 space-y-1.5">
                            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Multi-Digit Entry (ANY)</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[0, 1, 2, 3].map((idx) => (
                                    <select
                                        key={idx}
                                        value={config.multiDigits?.[idx] !== undefined ? config.multiDigits[idx].toString() : ""}
                                        onChange={(e) => {
                                            const newDigits = [...(config.multiDigits || [])];
                                            if (e.target.value === "") {
                                                newDigits.splice(idx, 1);
                                            } else {
                                                newDigits[idx] = parseInt(e.target.value);
                                            }
                                            update({ multiDigits: newDigits.filter(d => d !== undefined) });
                                        }}
                                        className="w-full bg-dark border border-dark-hover rounded-lg py-2 text-center text-xs font-bold text-teal-400 outline-none focus:border-teal-500/50 transition-all"
                                    >
                                        <option value="">-</option>
                                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                            <option key={d} value={d}>{d}</option>
                                        ))}
                                    </select>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Mode Toggle */}
                    <div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-dark-secondary/50 border border-dark">
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-gray-200">Instant Trigger Mode</span>
                            <span className="text-[10px] text-gray-500">Fire immediately upon detecting entry digit (bypasses monitor)</span>
                        </div>
                        <Toggle
                            enabled={config.triggerOnEntry}
                            onChange={(enabled) => update({ triggerOnEntry: enabled })}
                        />
                    </div>

                    {!config.triggerOnEntry && (
                        <>
                            <Select
                                label="Monitor Ticks"
                                options={MONITOR_TICK_OPTIONS}
                                value={config.monitorTicks.toString()}
                                onChange={(val) => update({ monitorTicks: parseInt(val) })}
                            />
                            <Select
                                label="Consecutive"
                                options={CONSECUTIVE_OPTIONS}
                                value={config.consecutive.toString()}
                                onChange={(val) => update({ consecutive: parseInt(val) })}
                            />
                            <Select
                                label="Type"
                                options={TYPE_OPTIONS}
                                value={config.type}
                                onChange={(val: any) => update({ type: val })}
                            />
                            <Select
                                label={`${config.type} Digit`}
                                options={DIGIT_VALUES}
                                value={config.targetValue.toString()}
                                onChange={(val) => update({ targetValue: parseInt(val) })}
                            />
                        </>
                    )}

                    <div className="col-span-2 text-[10px] text-gray-500 italic p-2 bg-dark/30 rounded border border-dark/50">
                        {config.triggerOnEntry ? (
                            <span>detect <span className="text-teal-400 font-bold">{config.entryDigit}</span> → instantly passed</span>
                        ) : (
                            <span>After <span className="text-teal-400">{config.monitorTicks}</span> ticks →
                                detect <span className="text-teal-400">{config.consecutive} {config.type} {config.targetValue}</span> →
                                passed</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
