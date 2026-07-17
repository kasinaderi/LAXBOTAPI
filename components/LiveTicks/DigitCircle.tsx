'use client';

import React from 'react';

interface DigitCircleProps {
    digit: number;
    overUnderMode?: 'off' | 'over' | 'under';
    overUnderDigit?: number;
    frequencyHighlight?: 'topEven' | 'topOdd' | 'leastEven' | 'leastOdd' | null;
}

export function DigitCircle({ 
    digit, 
    overUnderMode = 'off', 
    overUnderDigit = 5,
    frequencyHighlight = null 
}: DigitCircleProps) {
    
    // Core color logic - Matching reference image glows
    const colorClass = digit % 2 === 0 
        ? 'bg-[#2172ff] text-white shadow-[0_0_15px_rgba(33,114,255,0.6)]' 
        : 'bg-[#ff2147] text-white shadow-[0_0_15px_rgba(255,33,71,0.6)]';

    return (
        <div className={`
            w-10 h-10 rounded-full flex items-center justify-center text-sm font-black transition-all duration-300
            ${colorClass} hover:scale-110 cursor-default
        `}>
            {digit}
        </div>
    );
}
