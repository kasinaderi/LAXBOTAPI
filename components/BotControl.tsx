'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Button, StatusIndicator } from './ui';
import { Bot, Play, Square, Loader2, Sparkles, Zap, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { ClientOnly } from './ClientOnly';

export function BotControl() {
    const {
        isRunning,
        status,
        startBot,
        stopBot,
        account,
        stats,
        triggerStatus,
        backendStatus,
        isBackendAuthorized,
        isTradeAuthorized,
        executionMode,
        token,
        virtualSettings,
        toggleManualMode,
        isLogOverlayOpen,
        setLogOverlayOpen
    } = useDerivStore();

    const isConnected = status === 'connected';
    const isConnecting = status === 'connecting';
    const isVirtualMode = virtualSettings?.isVirtualMode;

    // Determine the most relevant status to show
    const displayStatus = isRunning ? 'running' :
        isConnected ? 'ready' :
            isConnecting ? 'connecting' :
                (backendStatus === 'handshaking' || backendStatus === 'authenticating' || backendStatus === 'error') ? backendStatus :
                    'offline';

    // START is allowed when:
    //  - Main connection is live AND account is set
    //  - For REAL execution (standard mode): tradeWS must also be authorized
    //  - For VIRTUAL mode: can start regardless of tradeWS auth (no real trades placed)
    const isTradeReady = isTradeAuthorized;
    const canStart = isConnected && !!account && (isVirtualMode || isTradeReady);

    const renderRunButton = (isMobile = false) => {
        if (!isRunning) {
            return (
                <Button
                    variant="success"
                    className={`${isMobile ? 'h-9 text-[10px] px-3' : 'h-14 text-lg w-full'} font-bold group relative overflow-hidden shadow-xl`}
                    disabled={!canStart}
                    onClick={startBot}
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-green-400/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <Play className="w-3 h-3 mr-1 fill-current" />
                    START
                </Button>
            );
        }
        return (
            <Button
                variant="danger"
                className={`${isMobile ? 'h-9 text-[10px] px-3' : 'h-14 text-lg w-full'} font-bold group relative overflow-hidden shadow-xl`}
                onClick={stopBot}
            >
                <div className="absolute inset-0 bg-gradient-to-r from-red-400/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <Square className="w-3 h-3 mr-1 fill-current" />
                STOP
            </Button>
        );
    };

    const renderModeToggle = (isMobile = false) => {
        if (!isRunning) return null;
        return (
            <Button
                variant="secondary"
                className={`${isMobile ? 'h-9 text-[9px] px-2' : 'h-10 text-xs w-full'} font-black border uppercase tracking-tighter shadow-lg transition-all duration-300 ${
                    virtualSettings.isVirtualMode 
                    ? "bg-gradient-to-r from-teal-500/20 to-indigo-500/20 border-teal-500/30 hover:border-teal-400 text-teal-400 shadow-teal-500/5 animate-pulse-slow" 
                    : "bg-gradient-to-r from-amber-500/20 to-red-500/20 border-amber-500/30 hover:border-amber-400 text-amber-400 shadow-amber-500/5"
                } ${!isMobile && 'mt-2'}`}
                onClick={toggleManualMode}
            >
                {virtualSettings.isVirtualMode ? (
                    <>
                        <Sparkles className="w-3 h-3 mr-1 text-teal-400" />
                        Execute Real
                    </>
                ) : (
                    <>
                        <Zap className="w-3 h-3 mr-1 text-amber-400" />
                        Virtual Mode
                    </>
                )}
            </Button>
        );
    };

    return (
        <>
            <Card className={isRunning ? 'border-teal-500/50 shadow-lg shadow-teal-500/10' : ''}>
                <CardHeader
                    icon={<Bot className={`w-5 h-5 ${isRunning ? 'text-teal-400 animate-bounce' : ''}`} />}
                >
                    Bot Control
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between p-4 bg-dark-secondary rounded-xl border border-dark">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase text-gray-500 font-bold tracking-widest">System Status</span>
                            <StatusIndicator status={displayStatus as any} />
                        </div>
                        {isConnected && !isRunning && (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-tighter transition-all"
                                style={isTradeAuthorized
                                    ? { background: 'rgba(20,184,166,0.1)', borderColor: 'rgba(20,184,166,0.3)', color: '#2dd4bf' }
                                    : { background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }
                                }
                            >
                                {isTradeAuthorized
                                    ? <><ShieldCheck className="w-2.5 h-2.5 mr-1" />Trade Auth OK</>
                                    : <><ShieldAlert className="w-2.5 h-2.5 mr-1" />Virtual Only</>}
                            </div>
                        )}
                        {isRunning && (
                            <div className="flex flex-col items-end gap-2">
                                <div className="flex items-center gap-2 px-3 py-1 bg-teal-500/10 rounded-full border border-teal-500/20">
                                    <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />
                                    <span className="text-[10px] font-bold text-teal-400 uppercase">{triggerStatus || 'Analyzing Market'}</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 rounded border border-amber-500/20">
                                    <Zap className="w-2.5 h-2.5 text-amber-400 animate-pulse" />
                                    <span className="text-[8px] font-black text-amber-400 uppercase tracking-tighter">High Frequency</span>
                                </div>
                                {!isLogOverlayOpen && (
                                    <button 
                                        onClick={() => setLogOverlayOpen(true)}
                                        className="text-[9px] font-bold text-teal-400 hover:text-teal-300 underline underline-offset-2 mt-1 transition-colors"
                                    >
                                        Show Execution Log
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-4">
                            {renderRunButton()}
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="flex-1 flex flex-col justify-center px-4 bg-dark-secondary rounded-xl border border-dark group transition-all hover:border-teal-500/30">
                                <span className="text-[9px] uppercase text-gray-500 font-bold">Active Step</span>
                                <div className="flex items-center gap-2">
                                    <Sparkles className={`w-3 h-3 ${isRunning ? 'text-amber-400 animate-pulse' : 'text-gray-600'}`} />
                                    <span className={`text-lg font-mono font-bold ${isRunning ? 'text-white' : 'text-gray-500'}`}>
                                        {stats.currentStep}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {renderModeToggle()}

                    {isRunning && (
                        <div className="space-y-2 animate-fade-in">
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold px-1">
                                <span>Session Target</span>
                                <span>{Math.min(100, Math.round((stats.won / (useDerivStore.getState().stopAfterTotalWins.value || 1)) * 100))}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-dark-secondary rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-1000"
                                    style={{ width: `${Math.min(100, (stats.won / (useDerivStore.getState().stopAfterTotalWins.value || 1)) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="text-[10px] text-gray-500 text-center italic px-2">
                        {!token
                            ? 'Please enter your API token to begin.'
                            : isConnecting
                                ? 'Establishing secure Options API session...'
                                : !isConnected
                                    ? (backendStatus === 'authenticating' ? 'Backend is verifying your account...' : 'Waiting for system to be READY...')
                                    : isRunning
                                        ? (isVirtualMode ? 'Virtual mode active — simulating trades...' : 'Bot is actively monitoring triggers and patterns...')
                                        : isTradeAuthorized
                                            ? 'System is READY. Press Start to begin automated sequence.'
                                            : 'Connected. Real trades require OTP auth — Virtual mode available.'}
                    </div>
                </CardContent>
            </Card >

            {/* Floating Mobile Controls */}
            <ClientOnly>
                <div className="fixed bottom-4 left-4 right-4 z-[90] lg:hidden flex flex-col pointer-events-none">
                    <div className="pointer-events-auto p-2 flex items-center gap-3 justify-center bg-dark-secondary/60 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl">
                        <div className="min-w-[100px] flex-none">
                            {renderRunButton(true)}
                        </div>
                        {isRunning && (
                            <div className="min-w-[120px] flex-none">
                                {renderModeToggle(true)}
                            </div>
                        )}
                    </div>
                </div>
            </ClientOnly>
        </>
    );
}
