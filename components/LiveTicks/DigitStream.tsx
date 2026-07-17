'use client';

import React, { useEffect, useRef } from 'react';
import { DigitCircle } from './DigitCircle';
import { TickData } from '@/lib/deriv/useLiveTicks';

interface DigitStreamProps {
    ticks: TickData[];
    filter?: 'all' | 'odd' | 'even';
    historyLength: number;
    autoScroll?: boolean;
    overUnderMode?: 'off' | 'over' | 'under';
    overUnderDigit?: number;
    frequencyHighlights?: Record<number, 'topEven' | 'topOdd' | 'leastEven' | 'leastOdd' | null>;
}

export function DigitStream({
    ticks,
    filter = 'all',
    historyLength = 100,
    autoScroll = true,
    overUnderMode = 'off',
    overUnderDigit = 5,
    frequencyHighlights = {}
}: DigitStreamProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const filteredTicks = ticks.filter(t => {
        if (filter === 'odd') return t.digit % 2 !== 0;
        if (filter === 'even') return t.digit % 2 === 0;
        return true;
    });
    
    const viewTicks = filteredTicks.slice(-historyLength);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [viewTicks, autoScroll]);

    return (
        <div 
            ref={scrollRef}
            className="w-full h-[500px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
        >
            <div className="flex flex-wrap gap-3 p-4 justify-start content-start">
                {viewTicks.map((tick, index) => (
                    <div 
                        key={`${tick.timestamp}-${index}`} 
                        className="transition-all animate-in zoom-in-50 duration-300"
                    >
                        <DigitCircle 
                            digit={tick.digit}
                            overUnderMode={overUnderMode}
                            overUnderDigit={overUnderDigit}
                            frequencyHighlight={frequencyHighlights[tick.digit]}
                        />
                    </div>
                ))}
                {viewTicks.length === 0 && (
                    <div className="h-full w-full flex flex-col items-center justify-center text-gray-600 italic text-sm space-y-4 py-20">
                        <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-700 animate-spin" />
                        <span>Waiting for streaming data...</span>
                    </div>
                )}
            </div>
        </div>
    );
}
