'use client';

import React from 'react';
import { Toggle, Select, Button } from '../ui';
import { useDerivStore } from '@/store/useDerivStore';
import { DIGIT_VALUES } from '@/lib/deriv/constants';
import { PatternStep } from '@/lib/triggers/types';
import { Plus, Minus, RotateCcw, Settings, X } from 'lucide-react';

const PATTERN_TYPES = [
    { value: 'E', label: 'E=Even', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
    { value: 'O', label: 'O=Odd', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    { value: 'D', label: 'D=Differs', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
    { value: 'M', label: 'M=Matches', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { value: 'V', label: 'V=Over', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
    { value: 'U', label: 'U=Under', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    { value: 'SE', label: 'SE=Same Even', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
    { value: 'SO', label: 'SO=Same Odd', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
    { value: 'HE', label: 'HE=Highest Even', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    { value: 'LE', label: 'LE=Least Even', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' },
    { value: 'HO', label: 'HO=Highest Odd', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    { value: 'LO', label: 'LO=Least Odd', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
];

const PATTERN_COLORS: Record<string, string> = {
    E: 'bg-teal-500',
    O: 'bg-amber-500',
    D: 'bg-red-500',
    M: 'bg-green-500',
    V: 'bg-teal-600',
    U: 'bg-blue-600',
    SE: 'bg-cyan-600',
    SO: 'bg-purple-600',
    HE: 'bg-emerald-400',
    LE: 'bg-sky-500',
    HO: 'bg-amber-400',
    LO: 'bg-pink-400',
};

export function DigitPattern() {
    const { triggers, setTrigger } = useDerivStore();
    const config = triggers.digitPattern;
    const multi = config.multiEntry || {
        enabled: false,
        showSettings: false,
        useCustomContracts: false,
        patterns: ['', '', '', ''],
        contracts: ['', '', '', ''],
        predictions: ['0', '0', '0', '0'],
        currentIndex: 0,
    };

    const update = (fields: any) => setTrigger('digitPattern', fields);
    const updateMulti = (fields: any) => update({ multiEntry: { ...multi, ...fields } });

    const addStep = () => {
        if (config.pattern.length < 8) {
            update({ pattern: [...config.pattern, 'D'] });
        }
    };

    const removeStep = () => {
        if (config.pattern.length > 1) {
            update({ pattern: config.pattern.slice(0, -1) });
        }
    };

    const cycleStep = (index: number) => {
        const types = ['E', 'O', 'D', 'M', 'V', 'U', 'SE', 'SO', 'HE', 'LE', 'HO', 'LO'];
        const current = config.pattern[index];
        const next = types[(types.indexOf(current) + 1) % types.length] as PatternStep;
        const newPattern = [...config.pattern];
        newPattern[index] = next;
        update({ pattern: newPattern });
    };

    return (
        <div className="space-y-4 pt-4 border-t border-dark/50">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-bold">👁</span>
                    <span className="text-sm font-medium">Digit Pattern</span>
                </div>
                <div className="flex items-center gap-2">
                    {config.enabled && !multi?.enabled && (
                        <div className="flex items-center gap-1">
                            <button onClick={removeStep} className="p-1 hover:text-white text-gray-400"><Minus className="w-4 h-4" /></button>
                            <button onClick={addStep} className="p-1 hover:text-white text-gray-400"><Plus className="w-4 h-4" /></button>
                            <button onClick={() => update({ pattern: ['D', 'D', 'M', 'D', 'D'] })} className="p-1 hover:text-white text-gray-400 ml-1"><RotateCcw className="w-4 h-4" /></button>
                        </div>
                    )}
                    <button 
                        onClick={() => {
                            if (config.enabled) updateMulti({ showSettings: !multi?.showSettings });
                        }}
                        className={`p-1.5 rounded-lg transition-all ${multi?.showSettings && config.enabled ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-500 hover:text-gray-300'} ${!config.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={!config.enabled}
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                    <Toggle
                        enabled={config.enabled}
                        onChange={(enabled) => update({ enabled })}
                    />
                </div>
            </div>

            {multi?.showSettings && config.enabled && (
                <div className="p-3 bg-dark/50 rounded-xl border border-indigo-500/20 space-y-4 animate-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Multi-Entry Sequence</span>
                        <Toggle 
                            enabled={multi?.enabled} 
                            onChange={(enabled) => updateMulti({ enabled })} 
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {[0, 1, 2, 3].map((boxIdx) => {
                            const patternStr = multi?.patterns?.[boxIdx] || '';
                            const steps = patternStr.split('-').filter(s => s.length > 0);
                            
                            const updateBox = (newSteps: string[]) => {
                                const newPatterns = [...(multi?.patterns || ['', '', '', ''])];
                                newPatterns[boxIdx] = newSteps.join('-');
                                updateMulti({ patterns: newPatterns });
                            };

                            return (
                                <div key={boxIdx} className={`p-2 rounded-xl border-2 transition-all ${multi?.currentIndex === boxIdx && multi?.enabled ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'border-dark-hover bg-dark/30'}`}>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-tighter">Box {boxIdx + 1}</span>
                                        {multi?.currentIndex === boxIdx && multi?.enabled && (
                                            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                                        )}
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-1 min-h-[32px] items-center">
                                        {steps.map((step, stepIdx) => {
                                            const type = step.charAt(0);
                                            const digit = step.substring(1);
                                            const isEvenOdd = ['E', 'O'].includes(type);

                                            return (
                                                <div 
                                                    key={stepIdx} 
                                                    className={`flex items-center rounded-md overflow-hidden border border-white/10 shadow-sm transition-transform active:scale-95`}
                                                >
                                                    <button
                                                        onClick={() => {
                                                            const types = ['U', 'V', 'M', 'D', 'E', 'O'];
                                                            const currentIdx = types.indexOf(type);
                                                            const nextType = types[(currentIdx + 1) % types.length];
                                                            const newStep = nextType + (['E', 'O'].includes(nextType) ? '' : (digit || '0'));
                                                            const newSteps = [...steps];
                                                            newSteps[stepIdx] = newStep;
                                                            updateBox(newSteps);
                                                        }}
                                                        className={`px-1.5 py-1 text-[10px] font-black text-white ${PATTERN_COLORS[type] || 'bg-gray-600'}`}
                                                    >
                                                        {type}
                                                    </button>
                                                    {!isEvenOdd && (
                                                        <button
                                                            onClick={() => {
                                                                const currentDigit = parseInt(digit || '0');
                                                                const nextDigit = (currentDigit + 1) % 10;
                                                                const newSteps = [...steps];
                                                                newSteps[stepIdx] = type + nextDigit;
                                                                updateBox(newSteps);
                                                            }}
                                                            className="px-1 py-1 text-[10px] font-bold bg-dark text-gray-300 border-l border-white/5 min-w-[18px]"
                                                        >
                                                            {digit}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => {
                                                            const newSteps = steps.filter((_, i) => i !== stepIdx);
                                                            updateBox(newSteps);
                                                        }}
                                                        className="px-1 py-1 bg-black/20 hover:bg-rose-500/50 text-white/50 hover:text-white transition-colors"
                                                    >
                                                        <X className="w-2.5 h-2.5" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                        {steps.length < 8 && (
                                            <button
                                                onClick={() => updateBox([...steps, 'U0'])}
                                                className="w-7 h-7 rounded-md border border-dashed border-gray-700 flex items-center justify-center text-gray-600 hover:text-gray-400 hover:border-gray-500 transition-all flex-shrink-0"
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>

                                    {multi?.useCustomContracts && (
                                        <div className="mt-2 flex gap-1">
                                            <select
                                                value={multi?.contracts?.[boxIdx] || ''}
                                                onChange={(e) => {
                                                    const newContracts = [...(multi?.contracts || ['', '', '', ''])];
                                                    newContracts[boxIdx] = e.target.value;
                                                    updateMulti({ contracts: newContracts });
                                                }}
                                                className="flex-1 bg-dark border border-dark-hover rounded text-[9px] py-1 px-1 text-gray-400 outline-none"
                                            >
                                                <option value="">Global</option>
                                                <option value="DIGITOVER">Over</option>
                                                <option value="DIGITUNDER">Under</option>
                                                <option value="DIGITEVEN">Even</option>
                                                <option value="DIGITODD">Odd</option>
                                                <option value="DIGITMATCH">Match</option>
                                                <option value="DIGITDIFF">Diff</option>
                                            </select>
                                            {!['DIGITEVEN', 'DIGITODD'].includes(multi?.contracts?.[boxIdx] || '') && (
                                                <select
                                                    value={multi?.predictions?.[boxIdx] || '0'}
                                                    onChange={(e) => {
                                                        const newPreds = [...(multi?.predictions || ['0', '0', '0', '0'])];
                                                        newPreds[boxIdx] = e.target.value;
                                                        updateMulti({ predictions: newPreds });
                                                    }}
                                                    className="w-8 bg-dark border border-dark-hover rounded text-[9px] py-1 text-center text-teal-400 outline-none"
                                                >
                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                                        <option key={d} value={d.toString()}>{d}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Use Custom Contracts</span>
                        <Toggle 
                            enabled={multi?.useCustomContracts} 
                            onChange={(val) => updateMulti({ useCustomContracts: val })} 
                        />
                    </div>
                </div>
            )}

            {config.enabled && !multi?.enabled && (
                <div className="space-y-4 animate-fade-in">
                    <div className="flex flex-wrap gap-2">
                        {config.pattern.map((step, idx) => (
                            <button
                                key={idx}
                                onClick={() => cycleStep(idx)}
                                className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white transition-all transform active:scale-90 ${PATTERN_COLORS[step] || 'bg-gray-600'}`}
                            >
                                {step}
                            </button>
                        ))}
                    </div>

                    {config.pattern.some(s => ['D', 'M', 'V', 'U'].includes(s)) && (
                        <Select
                            label="Compare Digit (for D/M/V/U)"
                            options={DIGIT_VALUES}
                            value={config.compareDigit.toString()}
                            onChange={(val) => update({ compareDigit: parseInt(val) })}
                        />
                    )}

                    <div className="flex items-center justify-between p-3 rounded-lg bg-dark/30 border border-dark/50 mt-2">
                        <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-200">No Contradiction</span>
                            <span className="text-[10px] text-gray-500">Wait for opposite digit before re-triggering</span>
                        </div>
                        <Toggle
                            enabled={config.waitForOpposite}
                            onChange={(waitForOpposite) => update({ waitForOpposite })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
                        {PATTERN_TYPES.map(type => (
                            <div key={type.value} className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-sm ${PATTERN_COLORS[type.value]}`} />
                                <span className="text-[10px] text-gray-400">{type.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="text-[10px] text-gray-500 italic mt-2">
                        Detect pattern: {config.pattern.map((s, i) => (
                            <span key={i}>
                                <span className={s === 'M' ? 'text-green-400' : s === 'D' ? 'text-red-400' : 'text-teal-400'}>
                                    {s === 'E' ? 'Even' : s === 'O' ? 'Odd' : s === 'D' ? 'Differs' : s === 'M' ? 'Matches' : s === 'V' ? 'Over' : s === 'U' ? 'Under' : s === 'SE' ? 'SameEven' : s === 'SO' ? 'SameOdd' : s === 'HE' ? 'HiEven' : s === 'LE' ? 'LoEven' : s === 'HO' ? 'HiOdd' : s === 'LO' ? 'LoOdd' : s}
                                </span>
                                {i < config.pattern.length - 1 && ' → '}
                            </span>
                        ))} (vs digit {config.compareDigit})
                    </div>
                </div>
            )}
        </div>
    );
}
