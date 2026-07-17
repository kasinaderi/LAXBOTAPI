'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Badge, StatusIndicator } from '@/components/ui';
import { ShieldAlert, Server, Activity, Users, Globe, Database, Clock, RefreshCw } from 'lucide-react';
import { useRelayStore } from '@/store/useRelayStore';
import { useDerivStore } from '@/store/useDerivStore';

export default function AdminPage() {
    const { relayStats, status: relayStatus } = useRelayStore();
    const { account, accounts } = useDerivStore();

    const adminId = process.env.NEXT_PUBLIC_ADMIN_LOGINID?.trim().toUpperCase();
    const isAuthorized = accounts.some(acc => acc.loginid.toUpperCase() === adminId) || 
                         (account?.loginid.toUpperCase() === adminId);

    if (!isAuthorized) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold text-white">Access Denied</h1>
                <p className="text-gray-400 font-medium">You do not have administrative privileges to view this page.</p>
                <div className="bg-dark/50 px-4 py-2 rounded-lg border border-white/5 mt-4">
                    <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-1">Current Session Identity</p>
                    <p className="text-xs font-mono text-gray-400 break-all">
                        {account?.loginid || 'Offline / Not Connected'}
                    </p>
                </div>
            </div>
        );
    }

    const formatUptime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}h ${m}m ${s}s`;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                        <ShieldAlert className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Admin <span className="text-indigo-500">Control</span></h1>
                        <p className="text-sm text-gray-400 italic">Core system metrics and relay backbone status.</p>
                    </div>
                </div>
                <Badge variant="danger" className="animate-pulse">System Secured</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <Server className="w-5 h-5 text-teal-400" />
                            <StatusIndicator status={relayStatus === 'connected' ? 'connected' : 'disconnected'} />
                        </div>
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Relay Uptime</p>
                        <h3 className="text-xl font-bold text-white mt-1">
                            {relayStats ? formatUptime(relayStats.uptime) : '0h 0m 0s'}
                        </h3>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <Users className="w-5 h-5 text-indigo-400" />
                            <span className="text-[10px] font-bold text-indigo-400">Total</span>
                        </div>
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Active Consumers</p>
                        <h3 className="text-xl font-bold text-white mt-1">
                            {relayStats ? `${relayStats.clients} Connections` : '0 Connections'}
                        </h3>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <RefreshCw className="w-5 h-5 text-amber-400" />
                            <span className="text-[10px] font-bold text-amber-400">Session</span>
                        </div>
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Backbone Reconnects</p>
                        <h3 className="text-xl font-bold text-white mt-1">
                            {relayStats ? relayStats.reconnects : 0} Attempts
                        </h3>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <Globe className="w-5 h-5 text-purple-400" />
                            <Badge variant="info">Sync OK</Badge>
                        </div>
                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Active Feed Count</p>
                        <h3 className="text-xl font-bold text-white mt-1">
                            {relayStats ? `${relayStats.markets} Markets` : '0 Markets'}
                        </h3>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader icon={<Database className="w-5 h-5 text-teal-500" />}>
                        Relay System Logs
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {[
                                { t: '14:20:11', e: 'Backbone initialized on wss://ws.derivws.com/v3', v: 'SUCCESS' },
                                { t: '14:20:12', e: 'Subscribed to market R_100', v: 'OK' },
                                { t: '14:20:13', e: 'Subscribed to market R_75', v: 'OK' },
                                { t: '14:20:15', e: 'Websocket Server listening on port 8081', v: 'ACTIVE' },
                                { t: '14:25:30', e: 'Inbound client connection: 127.0.0.1', v: 'INFO' }
                            ].map((log, i) => (
                                <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                                    <div className="flex items-center gap-4">
                                        <span className="text-[10px] font-bold text-gray-500 font-mono">{log.t}</span>
                                        <span className="text-xs text-white/80">{log.e}</span>
                                    </div>
                                    <Badge variant="neutral" className="text-[8px] px-2 py-0">{log.v}</Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader icon={<Activity className="w-5 h-5 text-indigo-400" />}>
                        Maintenance
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <button className="w-full py-3 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 transition-all">
                            Force Relay Restart
                        </button>
                        <button className="w-full py-3 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-white hover:bg-white/10 transition-all">
                            Clear Cache (50 Ticks)
                        </button>
                        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl mt-4">
                            <p className="text-[10px] text-amber-500 font-bold leading-tight">
                                ⚠️ Administrative actions here will affect all users currently connected to the relay backbone.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
