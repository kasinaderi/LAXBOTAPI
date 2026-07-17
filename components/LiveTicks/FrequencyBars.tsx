'use client';

import React from 'react';

interface FrequencyBarsProps {
    counts: Record<number, number>;
    total: number;
    topOdd?: number;
    topEven?: number;
}

export function FrequencyBars({ counts, total, topOdd, topEven }: FrequencyBarsProps) {
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    
    return (
        <div className="grid grid-cols-10 gap-2 h-40">
            {digits.map((digit) => {
                const count = counts[digit] || 0;
                const percentage = total > 0 ? (count / total) * 100 : 0;
                const isTop = digit === topOdd || digit === topEven;
                
                return (
                    <div key={digit} className="flex flex-col items-center justify-end group">
                        <div className="w-full bg-white/5 rounded-t-sm relative flex flex-col justify-end min-h-[4px] border-x border-t border-white/5 transition-all group-hover:border-teal-500/30 overflow-hidden">
                            <div 
                                className={`
                                    w-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(20,184,166,0.2)]
                                    ${digit % 2 === 0 ? 'bg-gradient-to-t from-blue-600 to-blue-400' : 'bg-gradient-to-t from-red-600 to-red-400'}
                                    ${isTop ? 'brightness-125 saturate-150' : ''}
                                `}
                                style={{ height: `${Math.max(percentage, 2)}%` }}
                            />
                            {isTop && (
                                <div className="absolute top-0 left-0 right-0 h-0.5 bg-white animate-pulse" />
                            )}
                        </div>
                        <div className="mt-2 text-center">
                            <span className={`text-[10px] font-black ${isTop ? 'text-white' : 'text-gray-500'}`}>{digit}</span>
                            <div className="text-[8px] font-bold text-gray-600 font-mono">{Math.round(percentage)}%</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
