'use client';

import React, { useEffect } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

export default function ErrorBoundary({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[Application Client Exception Caught]:', error);
    }, [error]);

    return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-400 shadow-lg shadow-rose-500/10">
                <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-black uppercase tracking-wider mb-2 text-white">
                Application Recovered
            </h1>
            <p className="text-xs text-gray-400 max-w-md mb-4 leading-relaxed">
                A client exception occurred during execution. Your local settings and credentials are safely preserved.
            </p>
            {error?.message && (
                <div className="bg-black/60 border border-white/10 rounded-xl p-3 max-w-lg w-full mb-6 text-left font-mono text-[11px] text-rose-300 break-words">
                    {error.message}
                </div>
            )}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => reset()}
                    className="px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-black font-black text-xs flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-md shadow-teal-500/20"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Resume Session
                </button>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs flex items-center gap-2 transition-all active:scale-95 cursor-pointer border border-white/10"
                >
                    Reload Page
                </button>
            </div>
        </div>
    );
}
