'use client';

import React from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import { ArrowUp, ArrowDown, Activity, FastForward, GitCommit, GitMerge, FileDigit } from 'lucide-react';
import { Badge } from '@/components/ui';

export function SequenceBuilder() {
    const {
        triggerSequence,
        setTriggerSequence,
        triggerMode,
        setTriggerMode,
        triggers,
        virtualSettings
    } = useDerivStore();

    const moveItem = (index: number, direction: 'up' | 'down') => {
        if (
            (direction === 'up' && index === 0) ||
            (direction === 'down' && index === triggerSequence.length - 1)
        ) return;

        const newSequence = [...triggerSequence];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;

        // Swap
        [newSequence[index], newSequence[targetIndex]] = [newSequence[targetIndex], newSequence[index]];

        setTriggerSequence(newSequence);
    };

    const getModuleConfig = (mod: 'entry' | 'pattern' | 'virtual') => {
        switch (mod) {
            case 'entry': return {
                title: 'Entry Digit',
                icon: <FileDigit className="w-4 h-4 text-purple-400" />,
                enabled: triggers.entryDigit.enabled,
                bgActive: 'bg-purple-500/10 border-purple-500/30',
                bgInactive: 'bg-dark-secondary/50 border-dark/50 opacity-40',
                desc: 'Wait for specific digit conditions'
            };
            case 'pattern': return {
                title: 'Digit Pattern',
                icon: <Activity className="w-4 h-4 text-amber-400" />,
                enabled: triggers.digitPattern.enabled,
                bgActive: 'bg-amber-500/10 border-amber-500/30',
                bgInactive: 'bg-dark-secondary/50 border-dark/50 opacity-40',
                desc: 'Sniff for chronological sequences'
            };
            case 'virtual': return {
                title: 'Virtual Tracking',
                icon: <FastForward className="w-4 h-4 text-indigo-400" />,
                enabled: virtualSettings.isVirtualMode,
                bgActive: 'bg-indigo-500/10 border-indigo-500/30',
                bgInactive: 'bg-dark-secondary/50 border-dark/50 opacity-40',
                desc: 'Simulate trades until threshold'
            };
        }
    };

    return (
        <div className="space-y-3 mb-4 p-3 bg-dark/30 rounded-xl border border-dark">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-teal-400" />
                    <span className="text-xs font-bold text-gray-200 uppercase tracking-widest">Pipeline Sequence</span>
                </div>

                {/* Mode Toggles */}
                <div className="flex bg-dark-secondary rounded-lg p-0.5 border border-dark">
                    <button
                        onClick={() => setTriggerMode('sequential')}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${triggerMode === 'sequential'
                                ? 'bg-teal-500 text-white shadow-lg'
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        Sequential Steps
                    </button>
                    <button
                        onClick={() => setTriggerMode('simultaneous')}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${triggerMode === 'simultaneous'
                                ? 'bg-amber-500 text-white shadow-lg'
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        Simultaneous (AND)
                    </button>
                </div>
            </div>

            <p className="text-[10px] text-gray-500 mb-3">
                {triggerMode === 'sequential'
                    ? 'Modules execute in order. The next module waits until the previous one completes.'
                    : 'All enabled modules are evaluated constantly. Trade executes only when ALL match.'}
            </p>

            {triggerMode === 'sequential' && (
                <div className="space-y-2 relative">
                    {triggerSequence.map((mod, i) => {
                        const conf = getModuleConfig(mod as any);
                        const isFirst = i === 0;
                        const isLast = i === triggerSequence.length - 1;

                        return (
                            <div key={mod} className="relative z-10">
                                <div className={`flex items-center justify-between p-2.5 rounded-lg border ${conf.enabled ? conf.bgActive : conf.bgInactive} transition-all duration-300`}>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-dark/50 border border-dark shadow-inner text-[10px] font-black text-gray-400">
                                            {i + 1}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                {conf.icon}
                                                <span className={`text-xs font-bold ${conf.enabled ? 'text-gray-200' : 'text-gray-500'}`}>{conf.title}</span>
                                                {!conf.enabled && (
                                                    <Badge variant="neutral" className="text-[8px] py-0 px-1 border-none bg-dark text-gray-500">Disabled</Badge>
                                                )}
                                            </div>
                                            <span className="text-[9px] text-gray-500">{conf.desc}</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <button
                                            onClick={() => moveItem(i, 'up')}
                                            disabled={isFirst}
                                            className="p-1 rounded bg-dark/50 text-gray-400 hover:text-teal-400 hover:bg-dark disabled:opacity-30 disabled:hover:text-gray-400 disabled:cursor-not-allowed transition-all"
                                        >
                                            <ArrowUp className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() => moveItem(i, 'down')}
                                            disabled={isLast}
                                            className="p-1 rounded bg-dark/50 text-gray-400 hover:text-teal-400 hover:bg-dark disabled:opacity-30 disabled:hover:text-gray-400 disabled:cursor-not-allowed transition-all"
                                        >
                                            <ArrowDown className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                                {!isLast && (
                                    <div className="absolute left-[22px] -bottom-3 w-0.5 h-4 bg-dark-secondary z-0" />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
