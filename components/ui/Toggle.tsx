'use client';

import React from 'react';

interface ToggleProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    label?: string;
    className?: string;
    disabled?: boolean;
}

export function Toggle({ enabled, onChange, label, className = '', disabled = false }: ToggleProps) {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            {label && <span className="text-sm text-gray-300">{label}</span>}
            <button
                type="button"
                onClick={() => !disabled && onChange(!enabled)}
                disabled={disabled}
                className={`
          relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out
          ${enabled ? 'bg-teal-500' : 'bg-gray-600'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-dark-card
        `}
            >
                <span
                    className={`
            inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out
            ${enabled ? 'translate-x-6' : 'translate-x-1'}
          `}
                />
            </button>
        </div>
    );
}
