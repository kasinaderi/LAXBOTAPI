'use client';

import React, { useEffect } from 'react';
import { Card, CardHeader, CardContent, Badge, StatusIndicator, Button } from '@/components/ui';
import {
    LayoutDashboard,
    Activity,
    Zap,
    Users,
    ShieldCheck,
    TrendingUp,
    Clock,
    Globe,
    ArrowRight,
    ShieldAlert
} from 'lucide-react';
import { useRelayStore } from '@/store/useRelayStore';
import { useDerivStore } from '@/store/useDerivStore';
import Link from 'next/link';

export default function Dashboard() {
    const { status: relayStatus, latency: relayLatency, relayStats, reconnect: reconnectRelay } = useRelayStore();
    const { status: tradingStatus, account, lastTickReceived, totalTicksReceived, error: tradingError, forceReconnect: reconnectTrading } = useDerivStore();

    return (
        <div className="space-y-6">
            {/* Connection Error Alert */}
            {tradingError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 animate-in fade-in slide-in-from-top-4 duration-300">
                    <ShieldAlert className="w-5 h-5 flex-shrink-0" />
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest leading-none mb-1">Connection Error</p>
                        <p className="text-sm font-medium">{tradingError}</p>
                    </div>
                    <Button
                        size="sm"
                        variant="danger"
                        className="ml-auto bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-400/20"
                        onClick={() => window.location.reload()}
                    >
                        Restart App
                    </Button>
                </div>
            )}
            {/* Welcome Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">System <span className="text-teal-500">Overview</span></h1>
                    <p className="text-gray-400 mt-1">Real-time performance and system health monitoring.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="bg-teal-500/5 border-teal-500/20 text-teal-400 px-4 py-2">
                        <Clock className="w-3.5 h-3.5 mr-2" />
                        {new Date().toLocaleDateString()}
                    </Badge>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-teal-500/10 to-transparent border-teal-500/20">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 bg-teal-500/20 rounded-lg">
                                <Activity className="w-5 h-5 text-teal-400" />
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusIndicator 
                                    status={relayStatus === 'connected' ? 'connected' : 'disconnected'} 
                                    label={relayStatus === 'connected' ? 'Connected' : 'If new'}
                                />
                                {relayStatus !== 'connected' && (
                                    <Link 
                                        href="https://deriv.partners/rx?sidc=B6225E3C-7ED5-4F16-9738-8FEB0DEADEC0&utm_campaign=dynamicworks&utm_medium=affiliate&utm_source=CU55087"
                                        target="_blank"
                                        className="px-1.5 py-0.5 bg-[#ff444f] text-white text-[10px] font-black rounded uppercase hover:bg-[#e33e48] transition-all shadow-lg shadow-red-500/10"
                                    >
                                        Sign up
                                    </Link>
                                )}
                            </div>
                        </div>
                        <p className="text-gray-400 text-sm font-medium">Click connect engine</p>
                        <h3 className="text-2xl font-bold text-white mt-1">
                            Deriv
                        </h3>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-indigo-500/10 to-transparent border-indigo-500/20">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 bg-indigo-500/20 rounded-lg">
                                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                            </div>
                            <StatusIndicator status={tradingStatus === 'connected' ? 'connected' : 'disconnected'} />
                        </div>
                        <p className="text-gray-400 text-sm font-medium">Trading Channel</p>
                        <h3 className="text-2xl font-bold text-white mt-1">
                            {tradingStatus === 'connected' ? 'Secure' : 'Inactive'}
                        </h3>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-500/10 to-transparent border-amber-500/20">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 bg-amber-500/20 rounded-lg">
                                <Users className="w-5 h-5 text-amber-400" />
                            </div>
                            <Badge className="bg-amber-500/20 text-amber-400 border-none">Live</Badge>
                        </div>
                        <p className="text-gray-400 text-sm font-medium">Active Streams</p>
                        <h3 className="text-2xl font-bold text-white mt-1">19 Markets</h3>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-500/10 to-transparent border-purple-500/20">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 bg-purple-500/20 rounded-lg">
                                <Zap className="w-5 h-5 text-purple-400" />
                            </div>
                            <span className="text-xs font-bold text-purple-400">High Speed</span>
                        </div>
                        <p className="text-gray-400 text-sm font-medium">Relay Latency</p>
                        <h3 className="text-2xl font-bold text-white mt-1">
                            {relayLatency ? `${relayLatency}ms` : '< 50ms'}
                        </h3>
                    </CardContent>
                </Card>
            </div>

            {/* Connection Diagnostics & Quick Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card className="border-teal-500/10 bg-dark-card/30">
                        <CardHeader
                            icon={<Activity className="w-5 h-5 text-teal-400" />}
                        >
                            Connection Diagnostics
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Direct Hook Status */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black uppercase text-gray-500 tracking-widest">Direct Hook (Trading)</span>
                                            <span className="text-[10px] text-teal-500/80 font-mono font-bold">App ID: {process.env.NEXT_PUBLIC_DERIV_APP_ID || '33AztynpQOiYrx5yBUODj'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant={tradingStatus === 'connected' ? 'success' : tradingStatus === 'connecting' ? 'warning' : 'danger'}>{tradingStatus}</Badge>
                                            <button
                                                onClick={() => reconnectTrading()}
                                                className="p-1 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-teal-400"
                                                title="Force Reconnect"
                                            >
                                                <Zap className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-400">Total Ticks</span>
                                            <span className="text-white font-mono font-bold">{totalTicksReceived || 0}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-400">Last Arrival</span>
                                            <span className="text-teal-400 font-mono font-bold">
                                                {lastTickReceived
                                                    ? `${Math.floor((Date.now() - lastTickReceived) / 1000)}s ago`
                                                    : 'Never'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Relay Backbone Status */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black uppercase text-gray-500 tracking-widest">Relay Backbone (Data)</span>
                                            <span className="text-[10px] text-gray-600 font-mono">127.0.0.1:8081</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant={relayStatus === 'connected' ? 'success' : 'warning'}>{relayStatus}</Badge>
                                            <button
                                                onClick={() => reconnectRelay()}
                                                className="p-1 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-indigo-400"
                                                title="Force Reconnect"
                                            >
                                                <Zap className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-400">Backbone Ticks</span>
                                            <span className="text-white font-mono font-bold">{relayStats?.totalTicks || 0}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-400">Active Markets</span>
                                            <span className="text-indigo-400 font-mono font-bold">{relayStats?.markets || 0}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader
                            icon={<Globe className="w-5 h-5 text-teal-400" />}
                        >
                            Market Feed Availability
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {['R_10', 'R_25', 'R_50', 'R_75', 'R_100'].map((m) => (
                                    <div key={m} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:border-teal-500/30 transition-all cursor-default group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.6)] group-hover:animate-pulse" />
                                            <span className="font-bold text-white">{m} Index</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">Live Stream Active</div>
                                            <Link href="/live-ticks">
                                                <ArrowRight className="w-4 h-4 text-gray-400 hover:text-teal-400 transition-colors" />
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="overflow-hidden group">
                        <div className="bg-indigo-600 p-6 relative">
                            <ShieldCheck className="absolute top-4 right-4 w-12 h-12 text-white/10 group-hover:scale-110 transition-transform" />
                            <h3 className="text-xl font-bold text-white mb-2">LAXSNIPER XV</h3>
                            <p className="text-indigo-100 text-sm opacity-80">Access your professional trading logic and triggers.</p>
                            <Link
                                href="/laxsniper-xv"
                                className="mt-4 inline-flex items-center gap-2 bg-white text-indigo-600 px-4 py-2 rounded-lg font-bold text-sm hover:shadow-xl transition-all active:scale-95"
                            >
                                Launch Bot <Zap className="w-4 h-4 fill-current" />
                            </Link>
                        </div>
                        <CardContent className="p-4 bg-indigo-700/50">
                            {account ? (
                                <div className="flex items-center justify-between">
                                    <span className="text-white/60 text-xs font-bold uppercase">Balance Ready</span>
                                    <span className="text-white font-black">{account.currency} {(Number(account.balance) || 0).toFixed(2)}</span>
                                </div>
                            ) : (
                                <div className="text-white/40 text-xs text-center font-medium italic">Login required in Bot page</div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader icon={<Activity className="w-5 h-5 text-gray-400" />}>
                            System Log
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                <div className="flex items-start gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1.5" />
                                    <div>
                                        <p className="text-xs text-white/80">Tick Relay Server established on port 8081</p>
                                        <span className="text-[10px] text-gray-500">Just now</span>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5" />
                                    <div>
                                        <p className="text-xs text-white/80">LAXSNIPER XV verification check complete</p>
                                        <span className="text-[10px] text-gray-500">2 minutes ago</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
