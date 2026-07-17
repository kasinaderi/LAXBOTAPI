'use client';

import { Card, CardHeader, CardContent, Button, Badge, StatusIndicator } from '@/components/ui';
import { DerivConnection } from '@/components/DerivConnection';
import { TradeSetup } from '@/components/TradeSetup';
import { TradeTriggers } from '@/components/TradeTriggers';
import { TradePattern } from '@/components/TradePattern';
import { ContinuousTrading } from '@/components/ContinuousTrading';
import { TradeSettings } from '@/components/TradeSettings';
import { PerformanceStats } from '@/components/PerformanceStats';
import { LiveDigits } from '@/components/LiveDigits';
import { TradeLog } from '@/components/TradeLog';
import { BotControl } from '@/components/BotControl';
import { AdminDashboard } from '@/components/AdminDashboard';
import { SettingsTabs } from '@/components/SettingsTabs';
import { TrendingUp, ShieldCheck } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export default function LaxSniperXV() {
    const { status, account, ticks } = useDerivStore();

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <TrendingUp className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gradient">LAXSNIPER XV</h1>
                        <p className="text-sm text-gray-400">Professional Digit Trading Bot</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                        <ShieldCheck className="w-4 h-4 text-indigo-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Verified Logic</span>
                    </div>
                    <Badge variant="info">v2.1-XV</Badge>
                </div>
            </div>

            {/* Main Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left Column */}
                <div className="space-y-4">
                    <AdminDashboard />
                    <SettingsTabs />
                </div>

                {/* Center Column */}
                <div className="space-y-4">
                    <TradeTriggers />
                    <TradePattern />
                    <ContinuousTrading />
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                    <PerformanceStats />
                    <LiveDigits />
                    <BotControl />
                    <TradeLog />
                </div>
            </div>

            {/* Warning Footer */}
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-amber-400 text-sm text-center">
                    ⚠️ Trading involves risk. Use responsibly and only trade what you can afford to lose.
                </p>
            </div>
        </div>
    );
}
