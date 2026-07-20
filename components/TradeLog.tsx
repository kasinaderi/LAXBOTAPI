'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Badge } from './ui';
import { ClipboardList, Trash2, Clock, Download, Zap } from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';

export function TradeLog() {
    const { tradeLogs, clearLogs } = useDerivStore();

    const exportToCSV = () => {
        if (tradeLogs.length === 0) return;

        const headers = ['Time', 'Contract', 'Stake', 'P/L', 'Result'];
        const rows = tradeLogs.map(log => [
            new Date(log.time).toISOString(),
            log.contract,
            log.stake,
            log.profit,
            log.result
        ]);

        const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `trade_log_${new Date().getTime()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <Card>
            <CardHeader
                icon={<ClipboardList className="w-5 h-5" />}
                badge={
                    <div className="flex items-center gap-1">
                        <button
                            onClick={exportToCSV}
                            className="p-1 hover:text-white text-gray-400 transition-colors"
                            title="Export CSV"
                            disabled={tradeLogs.length === 0}
                        >
                            <Download className="w-4 h-4" />
                        </button>
                        <button
                            onClick={clearLogs}
                            className="p-1 hover:text-white text-gray-400 transition-colors"
                            title="Clear Log"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                }
            >
                Trade Log
            </CardHeader>
            <CardContent className="p-0">
                <div className="max-h-[400px] overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-dark scrollbar-track-transparent">
                    {tradeLogs.length > 0 ? (
                        <table className="w-full text-left text-[11px] border-collapse min-w-[500px]">
                            <thead className="sticky top-0 bg-dark-card/95 backdrop-blur shadow-sm z-10">
                                <tr className="border-b border-dark">
                                    <th className="px-4 py-2 font-bold text-gray-500 uppercase tracking-wider">Time</th>
                                    <th className="px-4 py-2 font-bold text-gray-500 uppercase tracking-wider">Type</th>
                                    <th className="px-4 py-2 font-bold text-gray-500 uppercase tracking-wider">Stake</th>
                                    <th className="px-4 py-2 font-bold text-gray-500 uppercase tracking-wider">Exit</th>
                                    <th className="px-4 py-2 font-bold text-gray-500 uppercase tracking-wider">P/L</th>
                                    <th className="px-4 py-2 font-bold text-gray-500 uppercase tracking-wider text-right">Result</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark">
                                {tradeLogs.map((log, i) => {
                                    const isRiseFall = log.contract === 'CALL' || log.contract === 'PUT';
                                    const isWon = log.result === 'WON' || log.result === 'RISE WIN' || log.result === 'FALL WIN';
                                    const isLost = log.result === 'LOST' || log.result === 'RISE LOSS' || log.result === 'FALL LOSS';
                                    const isSettled = isWon || isLost;
                                    return (
                                    <tr key={i} className={`group ${log.isVirtual ? 'bg-indigo-500/5' : ''}`}>
                                        <td className="px-4 py-3 text-gray-400 font-mono">
                                            {new Date(log.time).toLocaleTimeString([], { hour12: false })}
                                            {log.isVirtual && <Badge variant="neutral" className="ml-2 bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-[8px] py-0 px-1">VIRTUAL</Badge>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-gray-300">{log.contract}</span>
                                                {isRiseFall
                                                    ? <span className="text-[9px] text-gray-500">Entry: {log.entrySpot || '-'}</span>
                                                    : <span className="text-[9px] text-gray-500">Digit: {log.digit}</span>
                                                }
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-medium text-gray-300">
                                            {log.currency} {log.stake}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-gray-300">
                                            {log.exit !== undefined && log.exit !== null && log.exit !== '-' ? log.exit : '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            {log.profit !== null ? (
                                                <span className={`font-bold ${(Number(log.profit) || 0) >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                                                    {(Number(log.profit) || 0) >= 0 ? '+' : ''}{(Number(log.profit) || 0).toFixed(2)}
                                                </span>
                                            ) : (
                                                <span className="text-gray-500 font-mono">...</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {isSettled ? (
                                                <Badge variant={isWon ? 'success' : 'danger'}>
                                                    {log.result}
                                                </Badge>
                                            ) : log.result && log.result !== 'BUYING...' ? (
                                                <Badge variant="neutral">{log.result}</Badge>
                                            ) : (
                                                <span className="text-gray-500 font-mono">...</span>
                                            )}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                            <div className="w-12 h-12 bg-dark-secondary rounded-full flex items-center justify-center mb-3">
                                <Clock className="w-6 h-6 text-gray-600" />
                            </div>
                            <p className="text-gray-500 text-xs">No trades executed yet.</p>
                            <p className="text-[10px] text-gray-600 mt-1 italic">Bot activity will appear here in real-time</p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card >
    );
}
