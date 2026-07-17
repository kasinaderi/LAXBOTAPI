'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Select } from './ui';
import { BarChart2 } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { ALL_MARKETS, CONTRACT_TYPES, DIGIT_VALUES } from '@/lib/deriv/constants';

export function TradeSetup() {
    const { market, contractType, prediction, setMarket, setContractType, setPrediction } = useDerivStore();

    const isDigitType = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);

    return (
        <Card>
            <CardHeader icon={<BarChart2 className="w-5 h-5" />}>
                Trade Setup
            </CardHeader>
            <CardContent className="space-y-4">
                <Select
                    label="Market"
                    options={ALL_MARKETS}
                    value={market}
                    onChange={setMarket}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                        label="Contract"
                        options={CONTRACT_TYPES}
                        value={contractType}
                        onChange={setContractType}
                    />

                    {isDigitType && (
                        <Select
                            label={contractType.includes('OVER') ? 'Over Digit' : contractType.includes('UNDER') ? 'Under Digit' : 'Target Digit'}
                            options={DIGIT_VALUES}
                            value={prediction.toString()}
                            onChange={(val) => setPrediction(parseInt(val))}
                        />
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
