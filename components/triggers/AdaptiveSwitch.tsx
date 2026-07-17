'use client';

import React from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import { Toggle, Badge } from '@/components/ui';
import { RefreshCw, ArrowRightLeft, Settings } from 'lucide-react';

const CONTRACT_OPTIONS = [
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' }
];

const PREDICTION_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const needsPrediction = (type: string) => {
    return ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(type || '');
};

export function AdaptiveSwitch() {
    const { triggers, updateTriggers, toggleAdaptiveSide, contractType, getActiveAdaptiveContract } = useDerivStore();
    const config = triggers?.adaptiveEvenOdd || {
        enabled: false,
        currentSide: 'Even',
        initialSide: 'Even',
        showAdvancedSettings: false,
        advancedEnabled: false,
        mode: 'adaptive_contracts',
        adaptiveContracts: {
            contractA: { type: 'DIGITUNDER', prediction: 4 },
            contractB: { type: 'DIGITOVER', prediction: 5 },
            activeSide: 'A',
            startSide: 'A'
        },
        customPattern: {
            steps: [
                { type: 'DIGITEVEN', prediction: 0, repeats: 2 },
                { type: 'DIGITODD', prediction: 0, repeats: 2 }
            ],
            currentStepIndex: 0,
            currentRepeatCount: 0
        }
    };

    const isOverUnder = ['DIGITOVER', 'DIGITUNDER'].includes(contractType || '');
    
    const toggleEnabled = () => {
        updateTriggers({
            adaptiveEvenOdd: {
                ...config,
                enabled: !config.enabled
            }
        });
    };

    const setCurrentSide = (side: 'Even' | 'Odd' | 'Over' | 'Under') => {
        updateTriggers({
            adaptiveEvenOdd: {
                ...config,
                currentSide: side
            }
        });
    };

    const setInitialSide = (side: 'Even' | 'Odd' | 'Over' | 'Under') => {
        updateTriggers({
            adaptiveEvenOdd: {
                ...config,
                initialSide: side
            }
        });
    };

    // Determine what sides to show
    const availableSides = isOverUnder 
        ? [{ label: 'OVER', value: 'Over', color: 'bg-indigo-500' }, { label: 'UNDER', value: 'Under', color: 'bg-orange-500' }]
        : [{ label: 'EVEN', value: 'Even', color: 'bg-indigo-500' }, { label: 'ODD', value: 'Odd', color: 'bg-orange-500' }];

    return (
        <div className="bg-dark-accent/30 rounded-lg p-3 space-y-3 border border-dark-border/50">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-warning" />
                    <span
                        className="text-sm font-medium cursor-pointer text-gray-200"
                        onClick={toggleEnabled}
                    >
                        Adaptive Switch
                    </span>
                    {config.enabled && (
                        <Badge variant="warning">ACTIVE</Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {config.enabled && (
                        <button
                            onClick={() => {
                                updateTriggers({
                                    adaptiveEvenOdd: {
                                        ...config,
                                        showAdvancedSettings: !config.showAdvancedSettings
                                    }
                                });
                            }}
                            className={`p-1.5 rounded-lg transition-all ${config.showAdvancedSettings ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-500 hover:text-gray-300'}`}
                            title="Advanced Strategy Settings"
                        >
                            <Settings className="w-4 h-4" />
                        </button>
                    )}
                    <Toggle
                        enabled={config.enabled}
                        onChange={toggleEnabled}
                    />
                </div>
            </div>

            <p className="text-[11px] text-gray-400 leading-tight">
                Automatically switches between {isOverUnder ? 'Over/Under' : 'Even/Odd'} on loss to target the winning side.
            </p>

            {config.enabled && config.showAdvancedSettings && (
                <div className="p-3 bg-dark/50 rounded-xl border border-indigo-500/20 space-y-4 animate-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Advanced Strategy</span>
                        <Toggle
                            enabled={config.advancedEnabled}
                            onChange={(val) => {
                                updateTriggers({
                                    adaptiveEvenOdd: {
                                        ...config,
                                        advancedEnabled: val
                                    }
                                });
                            }}
                        />
                    </div>

                    {config.advancedEnabled && (
                        <div className="space-y-4 pt-2 border-t border-dark-border/20">
                            {/* Mode select tabs */}
                            <div className="flex bg-dark rounded-xl p-1 border border-dark-hover">
                                <button
                                    onClick={() => {
                                        updateTriggers({
                                            adaptiveEvenOdd: {
                                                ...config,
                                                mode: 'adaptive_contracts'
                                            }
                                        });
                                    }}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${config.mode === 'adaptive_contracts' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    ADAPTIVE CONTRACTS
                                </button>
                                <button
                                    onClick={() => {
                                        updateTriggers({
                                            adaptiveEvenOdd: {
                                                ...config,
                                                mode: 'custom_pattern'
                                            }
                                        });
                                    }}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${config.mode === 'custom_pattern' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    CUSTOM PATTERN
                                </button>
                            </div>

                            {/* Mode 1: Adaptive Contracts Settings */}
                            {config.mode === 'adaptive_contracts' && (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    {/* Contract A */}
                                    <div className="p-2 bg-dark/30 rounded-lg border border-dark-hover space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[9px] font-black text-teal-400 uppercase tracking-tighter">Contract A</span>
                                            {config.adaptiveContracts?.activeSide === 'A' && (
                                                <Badge variant="success">LIVE</Badge>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <select
                                                value={config.adaptiveContracts?.contractA?.type || 'DIGITUNDER'}
                                                onChange={(e) => {
                                                    updateTriggers({
                                                        adaptiveEvenOdd: {
                                                            ...config,
                                                            adaptiveContracts: {
                                                                ...config.adaptiveContracts,
                                                                contractA: {
                                                                    ...(config.adaptiveContracts?.contractA || { prediction: 4 }),
                                                                    type: e.target.value
                                                                }
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="bg-dark border border-dark-hover rounded px-2 py-1 text-xs font-bold text-white outline-none focus:border-indigo-500/50"
                                            >
                                                {CONTRACT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                            {needsPrediction(config.adaptiveContracts?.contractA?.type || '') ? (
                                                <select
                                                    value={config.adaptiveContracts?.contractA?.prediction !== undefined ? config.adaptiveContracts.contractA.prediction : 4}
                                                    onChange={(e) => {
                                                        updateTriggers({
                                                            adaptiveEvenOdd: {
                                                                ...config,
                                                                adaptiveContracts: {
                                                                    ...config.adaptiveContracts,
                                                                    contractA: {
                                                                        ...(config.adaptiveContracts?.contractA || { type: 'DIGITUNDER' }),
                                                                        prediction: parseInt(e.target.value)
                                                                    }
                                                                }
                                                            }
                                                        });
                                                    }}
                                                    className="bg-dark border border-dark-hover rounded px-2 py-1 text-xs font-bold text-white outline-none focus:border-indigo-500/50"
                                                >
                                                    {PREDICTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            ) : (
                                                <div className="bg-dark/10 border border-dark-hover/30 rounded px-2 py-1 text-xs text-gray-600 font-bold text-center select-none flex items-center justify-center">
                                                    N/A
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Contract B */}
                                    <div className="p-2 bg-dark/30 rounded-lg border border-dark-hover space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[9px] font-black text-orange-400 uppercase tracking-tighter">Contract B</span>
                                            {config.adaptiveContracts?.activeSide === 'B' && (
                                                <Badge variant="success">LIVE</Badge>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <select
                                                value={config.adaptiveContracts?.contractB?.type || 'DIGITOVER'}
                                                onChange={(e) => {
                                                    updateTriggers({
                                                        adaptiveEvenOdd: {
                                                            ...config,
                                                            adaptiveContracts: {
                                                                ...config.adaptiveContracts,
                                                                contractB: {
                                                                    ...(config.adaptiveContracts?.contractB || { prediction: 5 }),
                                                                    type: e.target.value
                                                                }
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="bg-dark border border-dark-hover rounded px-2 py-1 text-xs font-bold text-white outline-none focus:border-indigo-500/50"
                                            >
                                                {CONTRACT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                            {needsPrediction(config.adaptiveContracts?.contractB?.type || '') ? (
                                                <select
                                                    value={config.adaptiveContracts?.contractB?.prediction !== undefined ? config.adaptiveContracts.contractB.prediction : 5}
                                                    onChange={(e) => {
                                                        updateTriggers({
                                                            adaptiveEvenOdd: {
                                                                ...config,
                                                                adaptiveContracts: {
                                                                    ...config.adaptiveContracts,
                                                                    contractB: {
                                                                        ...(config.adaptiveContracts?.contractB || { type: 'DIGITOVER' }),
                                                                        prediction: parseInt(e.target.value)
                                                                    }
                                                                }
                                                            }
                                                        });
                                                    }}
                                                    className="bg-dark border border-dark-hover rounded px-2 py-1 text-xs font-bold text-white outline-none focus:border-indigo-500/50"
                                                >
                                                    {PREDICTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            ) : (
                                                <div className="bg-dark/10 border border-dark-hover/30 rounded px-2 py-1 text-xs text-gray-600 font-bold text-center select-none flex items-center justify-center">
                                                    N/A
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Start Side */}
                                    <div className="flex items-center justify-between text-xs pt-1">
                                        <span className="text-[10px] text-gray-400 uppercase font-bold">Start With:</span>
                                        <div className="flex gap-1">
                                            {['A', 'B'].map((side) => (
                                                <button
                                                    key={side}
                                                    onClick={() => {
                                                        updateTriggers({
                                                            adaptiveEvenOdd: {
                                                                ...config,
                                                                adaptiveContracts: {
                                                                    ...config.adaptiveContracts,
                                                                    startSide: side as any,
                                                                    activeSide: side as any
                                                                }
                                                            }
                                                        });
                                                    }}
                                                    className={`px-2.5 py-1 text-[10px] rounded transition-all font-bold ${config.adaptiveContracts?.startSide === side
                                                        ? 'bg-indigo-500 text-white ring-1 ring-white/30'
                                                        : 'bg-dark-hover text-gray-500 hover:text-gray-300'
                                                    }`}
                                                >
                                                    Contract {side}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Mode 2: Custom Pattern Settings */}
                            {config.mode === 'custom_pattern' && (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Sequence Steps</span>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => {
                                                    const steps = config.customPattern?.steps || [];
                                                    if (steps.length > 1) {
                                                        updateTriggers({
                                                            adaptiveEvenOdd: {
                                                                ...config,
                                                                customPattern: {
                                                                    ...config.customPattern,
                                                                    steps: steps.slice(0, -1)
                                                                }
                                                            }
                                                        });
                                                    }
                                                }}
                                                className="px-2 py-0.5 bg-dark-hover hover:bg-dark-hover/80 text-[9px] font-black uppercase text-gray-400 hover:text-red-400 rounded transition-all"
                                            >
                                                - Remove
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const steps = config.customPattern?.steps || [];
                                                    if (steps.length < 5) {
                                                        updateTriggers({
                                                            adaptiveEvenOdd: {
                                                                ...config,
                                                                customPattern: {
                                                                    ...config.customPattern,
                                                                    steps: [...steps, { type: 'DIGITEVEN', prediction: 0, repeats: 1 }]
                                                                }
                                                            }
                                                        });
                                                    }
                                                }}
                                                className="px-2 py-0.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-[9px] font-black uppercase text-indigo-400 hover:text-indigo-300 rounded transition-all"
                                            >
                                                + Add Step
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                        {(config.customPattern?.steps || []).map((step, idx) => (
                                            <div
                                                key={idx}
                                                className={`p-2 rounded-lg border transition-all flex flex-col gap-2 ${config.customPattern?.currentStepIndex === idx
                                                    ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                                                    : 'border-dark bg-dark/30'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between text-[9px] font-black uppercase text-gray-500">
                                                    <span>Step {idx + 1}</span>
                                                    {config.customPattern?.currentStepIndex === idx && (
                                                        <span className="text-indigo-400 font-bold animate-pulse">LIVE (Trade {(config.customPattern?.currentRepeatCount || 0) + 1}/{step.repeats})</span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    <select
                                                        value={step.type}
                                                        onChange={(e) => {
                                                            const newSteps = [...(config.customPattern?.steps || [])];
                                                            newSteps[idx] = { ...step, type: e.target.value };
                                                            updateTriggers({
                                                                adaptiveEvenOdd: {
                                                                    ...config,
                                                                    customPattern: {
                                                                        ...config.customPattern,
                                                                        steps: newSteps
                                                                    }
                                                                }
                                                            });
                                                        }}
                                                        className="bg-dark border border-dark-hover rounded px-1.5 py-1 text-[11px] font-bold text-white outline-none focus:border-indigo-500/50"
                                                    >
                                                        {CONTRACT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                    </select>

                                                    {needsPrediction(step.type) ? (
                                                        <select
                                                            value={step.prediction}
                                                            onChange={(e) => {
                                                                const newSteps = [...(config.customPattern?.steps || [])];
                                                                newSteps[idx] = { ...step, prediction: parseInt(e.target.value) };
                                                                updateTriggers({
                                                                    adaptiveEvenOdd: {
                                                                        ...config,
                                                                        customPattern: {
                                                                            ...config.customPattern,
                                                                            steps: newSteps
                                                                        }
                                                                    }
                                                                });
                                                            }}
                                                            className="bg-dark border border-dark-hover rounded px-1.5 py-1 text-[11px] font-bold text-white outline-none focus:border-indigo-500/50"
                                                        >
                                                            {PREDICTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                                        </select>
                                                    ) : (
                                                        <div className="bg-dark/10 border border-dark-hover/30 rounded px-1.5 py-1 text-[11px] text-gray-600 font-bold text-center select-none flex items-center justify-center">
                                                            N/A
                                                        </div>
                                                    )}

                                                    <div className="flex items-center bg-dark border border-dark-hover rounded overflow-hidden">
                                                        <span className="text-[8px] text-gray-500 font-bold uppercase px-1.5">Reps</span>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={step.repeats || 1}
                                                            onChange={(e) => {
                                                                const newSteps = [...(config.customPattern?.steps || [])];
                                                                newSteps[idx] = { ...step, repeats: Math.max(1, parseInt(e.target.value) || 1) };
                                                                updateTriggers({
                                                                    adaptiveEvenOdd: {
                                                                        ...config,
                                                                        customPattern: {
                                                                            ...config.customPattern,
                                                                            steps: newSteps
                                                                        }
                                                                    }
                                                                });
                                                            }}
                                                            className="w-full bg-transparent text-[11px] font-bold text-white outline-none text-center"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {config.enabled && (
                <div className="space-y-3 pt-2 border-t border-dark-border/20 animate-in fade-in duration-300">
                    {config.advancedEnabled ? (
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400 uppercase font-bold text-gray-500">Live:</span>
                                <span className="text-xs font-black text-indigo-400 uppercase tracking-wide">
                                    {(() => {
                                        const contract = getActiveAdaptiveContract();
                                        const label = CONTRACT_OPTIONS.find(o => o.value === contract.type)?.label || contract.type;
                                        const predStr = needsPrediction(contract.type) ? ` ${contract.prediction}` : '';
                                        
                                        if (config.mode === 'adaptive_contracts') {
                                            const activeSide = config.adaptiveContracts?.activeSide || 'A';
                                            return `${label}${predStr} (Contract ${activeSide})`;
                                        } else {
                                            const stepIdx = config.customPattern?.currentStepIndex || 0;
                                            const step = config.customPattern?.steps?.[stepIdx];
                                            const repeatCount = config.customPattern?.currentRepeatCount || 0;
                                            const repStr = step ? ` [Step ${stepIdx + 1}, ${repeatCount + 1}/${step.repeats}]` : '';
                                            return `${label}${predStr}${repStr}`;
                                        }
                                    })()}
                                </span>
                            </div>
                            <button
                                onClick={toggleAdaptiveSide}
                                className="p-1.5 hover:bg-dark-hover rounded text-gray-400 hover:text-warning transition-colors"
                                title="Manual Toggle/Advance"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Initial Side Selection */}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-gray-400 uppercase font-bold">Start With:</span>
                                <div className="flex gap-1">
                                    {availableSides.map(side => (
                                        <button
                                            key={`initial-${side.value}`}
                                            onClick={() => setInitialSide(side.value as any)}
                                            className={`px-2 py-0.5 text-[10px] rounded transition-all ${config.initialSide === side.value
                                                    ? `${side.color} text-white font-bold ring-1 ring-white/30`
                                                    : 'bg-dark-hover text-gray-500 hover:text-gray-300'
                                                }`}
                                        >
                                            {side.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Current Side / Manual Toggle */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 uppercase font-bold text-gray-500">Live:</span>
                                    <div className="flex gap-1">
                                        {availableSides.map(side => (
                                            <button
                                                key={`current-${side.value}`}
                                                onClick={() => setCurrentSide(side.value as any)}
                                                className={`px-3 py-1 text-[11px] rounded transition-all ${config.currentSide === side.value
                                                        ? `${side.color} text-white font-bold`
                                                        : 'bg-dark-hover text-gray-400 hover:text-white opacity-50'
                                                    }`}
                                            >
                                                {side.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    onClick={toggleAdaptiveSide}
                                    className="p-1.5 hover:bg-dark-hover rounded text-gray-400 hover:text-warning transition-colors"
                                    title="Manual Toggle"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
