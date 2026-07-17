'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Toggle } from './ui';
import { RefreshCcw } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function ContinuousTrading() {
    const { tradingMode, setTradingMode } = useDerivStore();

    return (
        <Card>
            <CardHeader icon={<RefreshCcw className="w-5 h-5" />}>
                Continuous Trading
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-medium">Trade after 1st entry (no re-check)</span>
                        <p className="text-[10px] text-gray-500">Trades pattern loop without waiting for new trigger</p>
                    </div>
                    <Toggle
                        enabled={tradingMode === 'after_first'}
                        onChange={(enabled) => enabled && setTradingMode('after_first')}
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <span className="text-sm font-medium">Trade continuously + check entry</span>
                        <p className="text-[10px] text-gray-500">Trades each tick but also monitors for triggers</p>
                    </div>
                    <Toggle
                        enabled={tradingMode === 'continuous_check'}
                        onChange={(enabled) => enabled && setTradingMode('continuous_check')}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
