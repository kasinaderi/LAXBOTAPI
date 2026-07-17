'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Button, Toggle } from './ui';
import { LayoutDashboard, Users, Activity, Zap, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function AdminDashboard() {
    const { admin, toggleKillSwitch, rtt, account, status } = useDerivStore();

    if (status !== 'connected' || !account?.loginid || account.loginid !== 'CR8970194') {
        return null;
    }

    return (
        <Card className="border-red-500/20">
            <CardHeader
                icon={<LayoutDashboard className="w-5 h-5 text-amber-400" />}
                badge={<span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest px-2 py-0.5 bg-amber-400/10 rounded-full border border-amber-400/20">System Admin</span>}
            >
                Admin Control
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-dark-secondary rounded-lg border border-dark">
                        <div className="flex items-center gap-2 mb-1">
                            <Users className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-[9px] uppercase text-gray-500 font-bold tracking-wider">Active Users</span>
                        </div>
                        <div className="text-xl font-bold font-mono text-white">{admin.totalUsers}</div>
                    </div>
                    <div className="p-3 bg-dark-secondary rounded-lg border border-dark">
                        <div className="flex items-center gap-2 mb-1">
                            <Activity className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-[9px] uppercase text-gray-500 font-bold tracking-wider">Total Volume</span>
                        </div>
                        <div className="text-xl font-bold font-mono text-teal-400">
                            ${admin.platformVolume.toLocaleString()}
                        </div>
                    </div>
                </div>

                {/* Global Kill Switch */}
                <div className={`p-4 rounded-xl border transition-all duration-300 ${admin.isKillSwitchActive
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-dark-secondary border-dark'
                    }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${admin.isKillSwitchActive ? 'bg-red-500/20 animate-pulse' : 'bg-dark'}`}>
                                <ShieldAlert className={`w-5 h-5 ${admin.isKillSwitchActive ? 'text-red-400' : 'text-gray-600'}`} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-gray-200">Global Kill Switch</h4>
                                <p className="text-[10px] text-gray-500">Instantly stop all bots platform-wide</p>
                            </div>
                        </div>
                        <Toggle
                            enabled={admin.isKillSwitchActive}
                            onChange={toggleKillSwitch}
                            className={admin.isKillSwitchActive ? 'bg-red-500' : ''}
                        />
                    </div>

                    {admin.isKillSwitchActive && (
                        <div className="mt-3 flex items-center gap-2 text-red-500 text-[10px] font-bold uppercase animate-fade-in">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            System Wide Lock Engaged
                        </div>
                    )}
                </div>

                {/* Platform Settings */}
                <div className="space-y-3">
                    <h5 className="text-[10px] uppercase text-gray-600 font-black tracking-[0.2em]">Usage Analytics</h5>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center px-2 py-1.5 border-b border-dark/30">
                            <span className="text-[10px] text-gray-500 font-medium">API Latency</span>
                            <span className={`text-[10px] font-bold font-mono ${rtt > 500 ? 'text-red-400' : 'text-teal-400'}`}>
                                {rtt}ms
                            </span>
                        </div>
                        <div className="flex justify-between items-center px-2 py-1.5 border-b border-dark/30">
                            <span className="text-[10px] text-gray-500 font-medium">Uptime</span>
                            <span className="text-[10px] font-bold text-gray-300 font-mono">99.9%</span>
                        </div>
                    </div>
                </div>

                <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-bold text-amber-300">Fast Execution Mode</span>
                    </div>
                    <Toggle enabled={true} onChange={() => { }} />
                </div>
            </CardContent>
        </Card>
    );
}
