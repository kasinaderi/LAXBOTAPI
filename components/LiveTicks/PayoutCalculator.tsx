'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardContent, Button } from '@/components/ui';
import { Calculator, TrendingUp, Wallet } from 'lucide-react';

const PAYOUT_RATES: Record<string, number> = {
    even_odd: 95.24,
    matches: 900.00,
    differs: 5.56,
    over_0: 5.26, over_1: 13.16, over_2: 25.00, over_3: 40.85, over_4: 63.93,
    over_5: 100.00, over_6: 163.16, over_7: 300.00, over_8: 800.00,
    under_1: 800.00, under_2: 300.00, under_3: 163.16, under_4: 100.00,
    under_5: 63.93, under_6: 40.85, under_7: 25.00, under_8: 13.16, under_9: 5.26,
};

export function PayoutCalculator() {
    const [stake, setStake] = useState(10);
    const [type, setType] = useState('even_odd');

    const payoutPct = PAYOUT_RATES[type] || 0;
    const profit = stake * (payoutPct / 100);
    const totalReturn = stake + profit;

    return (
        <Card className="bg-dark-secondary/30 border-white/5">
            <CardHeader icon={<Calculator className="w-5 h-5 text-teal-400" />}>
                Payout Estimator
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-gray-500">Stake ($)</label>
                        <input 
                            type="number"
                            value={stake}
                            onChange={(e) => setStake(Number(e.target.value))}
                            className="w-full bg-dark border border-white/10 rounded-lg px-3 py-2 text-sm font-black focus:border-teal-500/50 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-gray-500">Trade Type</label>
                        <select 
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            className="w-full bg-dark border border-white/10 rounded-lg px-2 py-2 text-sm font-black focus:border-teal-500/50 transition-all outline-none"
                        >
                            <option value="even_odd">Even/Odd</option>
                            <option value="matches">Matches</option>
                            <option value="differs">Differs</option>
                            <option value="over_4">Over 4</option>
                            <option value="over_5">Over 5</option>
                            <option value="under_5">Under 5</option>
                        </select>
                    </div>
                </div>

                <div className="p-4 bg-teal-500/10 rounded-xl border border-teal-500/20 space-y-3">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-teal-400" />
                            <span className="text-xs font-bold text-gray-400">Potential Profit</span>
                        </div>
                        <span className="text-xl font-black text-teal-400">+ ${profit.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-teal-500/10">
                        <div className="flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-white/60" />
                            <span className="text-xs font-bold text-gray-400">Total Return</span>
                        </div>
                        <span className="text-xl font-black text-white">${totalReturn.toFixed(2)}</span>
                    </div>
                </div>
                <div className="text-[10px] text-center text-gray-600 font-bold uppercase tracking-widest italic">
                    Payout Rate: {payoutPct}%
                </div>
            </CardContent>
        </Card>
    );
}
