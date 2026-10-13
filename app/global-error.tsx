'use client';

import React, { useEffect } from 'react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[Global Fatal Client Exception Caught]:', error);
    }, [error]);

    return (
        <html lang="en" className="dark">
            <body className="bg-[#0a0a10] text-white min-h-screen flex flex-col items-center justify-center p-6 text-center antialiased font-sans">
                <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-400">
                    ⚠️
                </div>
                <h1 className="text-xl font-black uppercase tracking-wider mb-2 text-white">
                    Session Interrupted
                </h1>
                <p className="text-xs text-gray-400 max-w-md mb-4">
                    The trading session encountered a client exception. Your settings and API keys are stored safely.
                </p>
                {error?.message && (
                    <div className="bg-black/70 border border-white/10 rounded-xl p-3 max-w-lg w-full mb-6 text-left font-mono text-[11px] text-rose-300 break-words">
                        {error.message}
                    </div>
                )}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => reset()}
                        className="px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-black font-black text-xs transition-all active:scale-95 cursor-pointer"
                    >
                        Recover Session
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition-all active:scale-95 cursor-pointer border border-white/10"
                    >
                        Reload Page
                    </button>
                </div>
            </body>
        </html>
    );
}
