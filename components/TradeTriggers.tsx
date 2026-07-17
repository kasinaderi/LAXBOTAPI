'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Badge } from '@/components/ui';
import { Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { SequenceBuilder } from './triggers/SequenceBuilder';
import { EntryDigitDetection } from './triggers/EntryDigitDetection';
import { DigitPattern } from './triggers/DigitPattern';
import { AdaptiveSwitch } from './triggers/AdaptiveSwitch';

export function TradeTriggers() {
    const { triggers } = useDerivStore();
    const [isExpanded, setIsExpanded] = React.useState(true);

    const activeCount = [
        triggers?.entryDigit?.enabled,
        triggers?.digitPattern?.enabled,
        triggers?.adaptiveEvenOdd?.enabled
    ].filter(Boolean).length;

    return (
        <Card>
            <CardHeader
                icon={<Zap className="w-5 h-5" />}
                badge={
                    <div className="flex items-center gap-2">
                        <Badge variant={activeCount > 0 ? "warning" : "neutral"}>
                            {activeCount} active
                        </Badge>
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-1 hover:bg-dark-hover rounded transition-colors"
                        >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                    </div>
                }
            >
                Trade Triggers
            </CardHeader>

            {isExpanded && (
                <CardContent className="space-y-2 -mt-2">
                    <SequenceBuilder />
                    <AdaptiveSwitch />
                    <EntryDigitDetection />
                    <DigitPattern />
                </CardContent>
            )}
        </Card>
    );
}
