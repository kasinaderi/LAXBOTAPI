'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardContent, Input, Button, StatusIndicator } from './ui';
import { useDerivStore } from '@/store/useDerivStore';
import { Power, Shield, Key, ExternalLink, Zap, CheckCircle2, Globe, LogIn, AlertCircle } from 'lucide-react';
import { AccountInfo } from '@/lib/deriv/types';

import { DERIV_APP_ID } from '@/lib/deriv/auth';

export function DerivConnection() {
    const {
        status,
        account,
        accounts,
        disconnect,
        switchAccount,
        authorize,
        token: storeToken,
        error: storeError
    } = useDerivStore();

    const [token, setToken] = useState(storeToken || '');
    const [localError, setLocalError] = useState('');

    const handleConnect = () => {
        if (!token.trim()) {
            setLocalError('API Token is required');
            return;
        }
        setLocalError('');
        authorize(token);
    };

    const isConnected = status === 'connected';

    return (
        <Card className="overflow-hidden border-teal-500/10 bg-dark-card/50 backdrop-blur-md">
            <CardHeader
                icon={<Shield className="w-5 h-5 text-teal-400" />}
                badge={
                    <div className="flex items-center gap-2">
                        {isConnected && (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal-500"></span>
                                </span>
                                <span className="text-[10px] font-black text-teal-400 uppercase tracking-tighter">Live Session</span>
                            </div>
                        )}
                        <StatusIndicator status={status === 'connected' ? 'online' : status === 'connecting' ? 'connecting' : 'offline'} />
                    </div>
                }
            >
                Deriv Connection
            </CardHeader>
            <CardContent className="space-y-4">
                {account && isConnected ? (
                    <div className="space-y-4">
                        {/* Account Info Glass Card */}
                        <div className="p-4 bg-gradient-to-br from-white/5 to-transparent rounded-xl border border-white/10 group hover:border-teal-500/30 transition-all duration-300">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 ${account.loginid.includes('VR') ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-teal-500/10 border-teal-500/20 text-teal-400'} rounded-2xl flex items-center justify-center border group-hover:scale-110 transition-transform shadow-lg`}>
                                        <span className="font-black text-lg uppercase">{(account.currency || 'USD')[0]}</span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest leading-none">Account ID</p>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter ${account.loginid.includes('VR') ? 'bg-amber-500/20 text-amber-500' : 'bg-teal-500/20 text-teal-500'}`}>
                                                {account.loginid.includes('VR') ? 'Demo' : 'Real'}
                                            </span>
                                        </div>
                                        <p className="text-sm font-mono font-black text-white">{account.loginid}</p>
                                        <div className="text-[10px] font-black text-white/90">
                                            {account.currency} {(Number(account.balance) || 0).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                                <Button 
                                    variant="danger" 
                                    size="sm" 
                                    onClick={() => disconnect()}
                                    className="h-10 w-10 p-0 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border-red-500/20 rounded-xl transition-all"
                                >
                                    <Power className="w-5 h-5" />
                                </Button>
                            </div>

                            {/* Account Switcher */}
                            {accounts && accounts.length > 1 && (
                                <div className="pt-4 border-t border-white/5">
                                    <div className="flex flex-col gap-2">
                                        <p className="text-[9px] text-gray-600 uppercase font-black tracking-widest px-1">Switch Account</p>
                                        <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto pr-1">
                                            {accounts.map((acc: AccountInfo) => (
                                                <button
                                                    key={acc.loginid}
                                                    onClick={() => acc.loginid !== account.loginid && switchAccount(acc.loginid)}
                                                    className={`w-full flex items-center justify-between p-2 rounded-lg border transition-all text-left ${
                                                        acc.loginid === account.loginid
                                                            ? 'bg-teal-500/10 border-teal-500/30 text-white cursor-default'
                                                            : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:border-white/20'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${acc.loginid.includes('VR') ? 'bg-amber-500' : 'bg-teal-500'}`} />
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-bold leading-none">{acc.loginid}</span>
                                                            <span className="text-[9px] opacity-60 font-medium">{acc.loginid.includes('VR') ? 'Demo' : 'Real'} Account</span>
                                                        </div>
                                                    </div>
                                                    {acc.loginid === account.loginid && <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 pt-2">
                        <div className="text-center space-y-2">
                            <div className="flex justify-center mb-4">
                                <div className="p-4 bg-teal-500/5 rounded-3xl border border-teal-500/10 relative">
                                    <Globe className="w-10 h-10 text-teal-400 opacity-50" />
                                    <Zap className="w-5 h-5 text-teal-400 absolute bottom-3 right-3 animate-pulse" />
                                </div>
                            </div>
                            <h3 className="text-lg font-black text-white tracking-tight uppercase italic">Secure Authorization</h3>
                            <p className="text-xs text-gray-400 px-4 leading-relaxed">
                                Connect via API token for secure high-frequency trading access.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <Input
                                label="API Token"
                                type="password"
                                placeholder="Paste your Deriv API token here"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                            />

                            {(localError || storeError) && (
                                <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
                                    <AlertCircle className="w-3 h-3" />
                                    {localError || storeError}
                                </div>
                            )}

                            <div className="relative group">
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500 to-indigo-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                                <Button
                                    variant="primary"
                                    className="relative w-full py-6 rounded-2xl bg-dark border-teal-500/30 hover:border-teal-500 text-white font-black text-base uppercase tracking-widest shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-all"
                                    onClick={handleConnect}
                                    disabled={status === 'connecting'}
                                >
                                    <LogIn className="w-5 h-5" />
                                    {status === 'connecting' ? 'Authorizing...' : 'Authorize Bot'}
                                </Button>
                            </div>
                        </div>

                        <div className="flex items-center justify-center gap-6 pt-2">
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                                <Shield className="w-3 h-3 text-teal-500" />
                                256-bit Encrypted
                            </div>
                            <div className="w-px h-4 bg-white/10" />
                            <a
                                href="https://app.deriv.com/account/api-token"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-white transition-colors uppercase font-bold tracking-widest"
                            >
                                Get Token <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    </div>
                )}

                {/* Footnote */}
                <div className="mt-4 p-3 rounded-xl bg-teal-500/5 border border-teal-500/10">
                    <div className="flex items-start gap-3">
                        <Key className="w-4 h-4 text-teal-400 mt-0.5" />
                        <div className="space-y-1">
                            <p className="text-[10px] text-white/70 font-bold uppercase tracking-widest leading-none">Authentication Node</p>
                            <p className="text-[10px] text-gray-500 leading-relaxed font-medium">
                                Hook established via <span className="text-teal-500 font-mono">App ID: {DERIV_APP_ID}</span>. Direct WebSocket connection with sub-50ms latency.
                            </p>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
