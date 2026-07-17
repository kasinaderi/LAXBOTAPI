'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Button } from './ui';
import { RotateCcw, Plus, Minus } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function TradePattern() {
    const { tradePattern, setTradePattern, currentStep } = useDerivStore();

    const toggleStep = (index: number) => {
        const newPattern = [...tradePattern];
        newPattern[index] = newPattern[index] === 'trade' ? 'skip' : 'trade';
        setTradePattern(newPattern);
    };

    const addStep = () => {
        if (tradePattern.length < 12) {
            setTradePattern([...tradePattern, 'skip']);
        }
    };

    const removeStep = () => {
        if (tradePattern.length > 1) {
            setTradePattern(tradePattern.slice(0, -1));
        }
    };

    const resetPattern = () => {
        setTradePattern(['trade', 'skip', 'skip', 'skip', 'trade', 'skip', 'skip', 'skip']);
    };

    return (
        <Card>
            <CardHeader
                icon={<RotateCcw className="w-5 h-5" />}
                badge={
                    <div className="flex items-center gap-1">
                        <button onClick={removeStep} className="p-1 hover:text-white text-gray-400 Transition-colors"><Minus className="w-4 h-4" /></button>
                        <button onClick={addStep} className="p-1 hover:text-white text-gray-400 transition-colors"><Plus className="w-4 h-4" /></button>
                        <button onClick={resetPattern} className="p-1 hover:text-white text-gray-400 transition-colors ml-1"><RotateCcw className="w-4 h-4" /></button>
                    </div>
                }
            >
                Trade Pattern
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-xs text-gray-400 -mt-2">Click to toggle trade/skip</p>

                <div className="flex flex-wrap gap-2">
                    {tradePattern.map((type, idx) => {
                        const stepNumber = idx + 1;
                        const isActive = stepNumber === currentStep;
                        const isTrade = type === 'trade';

                        return (
                            <button
                                key={idx}
                                onClick={() => toggleStep(idx)}
                                className={`
                  w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs transition-all transform active:scale-90
                  ${isTrade
                                        ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                                        : 'bg-dark-secondary text-gray-500 border border-dark'}
                  ${isActive ? 'ring-2 ring-teal-500 ring-offset-2 ring-offset-dark-card' : ''}
                `}
                            >
                                {stepNumber}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                        <span className="text-gray-400">Trade</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-dark-secondary border border-dark" />
                        <span className="text-gray-400">Skip</span>
                    </div>
                </div>

                <div className="text-[10px] text-gray-500 italic mt-2">
                    Pattern: {tradePattern.map((type, i) => (
                        <span key={i}>
                            <span className={type === 'trade' ? 'text-green-400' : 'text-gray-500'}>
                                {type}
                            </span>
                            {i < tradePattern.length - 1 && ' → '}
                        </span>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
