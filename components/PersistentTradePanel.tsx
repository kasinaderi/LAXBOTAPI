'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    ChevronRight, 
    ChevronLeft, 
    ChevronDown, 
    ChevronUp, 
    X, 
    Activity, 
    Zap, 
    Square, 
    Maximize2, 
    Minimize2,
    TrendingUp,
    TrendingDown,
    LayoutDashboard,
    ClipboardList
} from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { Badge, Button } from './ui';
import { TradeLog } from './TradeLog';

export function PersistentTradePanel() {
    const { 
        isRunning, 
        isLogOverlayOpen, 
        isLogOverlayMinimized,
        setLogOverlayOpen, 
        setLogOverlayMinimized,
        stats,
        account,
        stopBot,
        market
    } = useDerivStore();

    // Local state to handle "hide" even if open (user manually closed it)
    if (!isLogOverlayOpen && !isRunning) return null;
    if (!isLogOverlayOpen && isRunning) {
        // Show a small "Show Log" button if it's running but overlay is closed
        return (
            <div className="fixed bottom-24 right-4 z-[100] hidden lg:block">
                <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={() => setLogOverlayOpen(true)}
                    className="bg-dark/80 backdrop-blur-md border-teal-500/30 text-teal-400 hover:bg-teal-500/10 shadow-lg shadow-teal-500/10"
                >
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Open Log
                </Button>
            </div>
        );
    }

    const profitColor = stats.totalProfit >= 0 ? 'text-teal-400' : 'text-red-400';
    const profitBg = stats.totalProfit >= 0 ? 'bg-teal-500/10' : 'bg-red-500/10';

    const desktopVariants = {
        open: { x: 0, opacity: 1 },
        minimized: { x: 300, opacity: 1 }, // Partially off-screen or just slim
        closed: { x: 500, opacity: 0 }
    };

    const mobileVariants = {
        open: { y: 0, opacity: 1 },
        minimized: { y: 'calc(100% - 60px)', opacity: 1 },
        closed: { y: '100%', opacity: 0 }
    };

    return (
        <AnimatePresence>
            {isLogOverlayOpen && (
                <>
                    {/* Desktop Overlay */}
                    <motion.div
                        initial="closed"
                        animate={isLogOverlayMinimized ? "minimized" : "open"}
                        exit="closed"
                        variants={desktopVariants}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className={`fixed top-24 bottom-6 right-6 z-[100] hidden lg:flex flex-col w-[380px] bg-dark-card/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden ${isLogOverlayMinimized ? 'translate-x-[320px]' : ''}`}
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isRunning ? 'bg-teal-500/20 text-teal-400 animate-pulse' : 'bg-white/10 text-gray-500'}`}>
                                    <Zap className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-tight">Trade Control</h3>
                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">{market.replace('_', ' ')} INDEX</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={() => setLogOverlayMinimized(!isLogOverlayMinimized)}
                                    className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 transition-colors"
                                >
                                    {isLogOverlayMinimized ? <ChevronLeft className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                                </button>
                                <button 
                                    onClick={() => setLogOverlayOpen(false)}
                                    className="p-1.5 hover:bg-red-500/20 rounded-lg text-gray-500 hover:text-red-400 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-hidden flex flex-col p-4 space-y-4">
                            {/* Stats Summary */}
                            <div className={`p-4 rounded-xl border border-white/5 ${profitBg} flex items-center justify-between`}>
                                <div>
                                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Net Profit</span>
                                    <div className={`text-xl font-black ${profitColor}`}>
                                        {account?.currency || 'USD'} {stats.totalProfit.toFixed(2)}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] text-gray-400 font-bold">
                                        W: <span className="text-teal-400">{stats.won}</span> / L: <span className="text-red-400">{stats.lost}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-1">
                                        Win Rate: <span className="text-white font-bold">{stats.totalTrades > 0 ? Math.round((stats.won/stats.totalTrades)*100) : 0}%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Mini Controls */}
                            <div className="flex gap-2">
                                <Button 
                                    variant={isRunning ? "danger" : "success"}
                                    size="sm"
                                    className="flex-1 font-black text-[10px] tracking-widest"
                                    onClick={() => isRunning ? stopBot() : useDerivStore.getState().startBot()}
                                >
                                    {isRunning ? <><Square className="w-3 h-3 mr-2 fill-current" /> STOP ENGINE</> : <><Zap className="w-3 h-3 mr-2 fill-current" /> ACTIVATE</>}
                                </Button>
                            </div>

                            {/* Log */}
                            <div className="flex-1 flex flex-col overflow-hidden">
                                <div className="flex items-center gap-2 mb-2 text-gray-500">
                                    <ClipboardList className="w-3 h-3" />
                                    <span className="text-[9px] font-black uppercase tracking-widest">Recent Activity</span>
                                </div>
                                <div className="flex-1 rounded-xl border border-white/5 bg-black/20 overflow-hidden">
                                    <TradeLog />
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Mobile Drawer */}
                    <motion.div
                        initial="closed"
                        animate={isLogOverlayMinimized ? "minimized" : "open"}
                        exit="closed"
                        variants={mobileVariants}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed bottom-0 left-0 right-0 z-[110] lg:hidden bg-dark-card/95 backdrop-blur-2xl border-t border-white/10 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh]"
                    >
                        {/* Drag Handle / Header */}
                        <div 
                            className="p-4 flex flex-col items-center cursor-pointer"
                            onClick={() => setLogOverlayMinimized(!isLogOverlayMinimized)}
                        >
                            <div className="w-12 h-1 bg-white/10 rounded-full mb-4" />
                            <div className="w-full flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-teal-500 animate-pulse' : 'bg-gray-500'}`} />
                                    <span className="text-xs font-black text-white uppercase tracking-widest">
                                        {isRunning ? 'Execution Active' : 'Execution Idle'}
                                    </span>
                                </div>
                                <div className={`text-sm font-black ${profitColor}`}>
                                    {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(2)}
                                </div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setLogOverlayOpen(false); }}
                                    className="p-1 text-gray-500"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        {!isLogOverlayMinimized && (
                            <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Wins</span>
                                        <div className="text-xl font-black text-teal-400">{stats.won}</div>
                                    </div>
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">Losses</span>
                                        <div className="text-xl font-black text-red-400">{stats.lost}</div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between px-1">
                                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Transaction Log</span>
                                        <Badge variant="neutral">{stats.totalTrades} Total</Badge>
                                    </div>
                                    <div className="rounded-2xl border border-white/5 overflow-hidden bg-black/20">
                                        <TradeLog />
                                    </div>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
