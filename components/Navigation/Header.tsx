'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
    LayoutDashboard,
    Activity,
    Zap,
    History,
    TrendingUp,
    Settings,
    ShieldAlert,
    Menu,
    X,
    Wallet,
    ChevronDown,
    CheckCircle2,
    Power,
    LogIn,
    ExternalLink,
    Cpu
} from 'lucide-react';
import { useDerivStore } from '@/store/useDerivStore';
import { useRelayStore } from '@/store/useRelayStore';
import { Badge, StatusIndicator, Button, Input } from '../ui';
import { AccountInfo } from '@/lib/deriv/types';

import { initiateOAuth2Login } from '@/lib/deriv/auth';

const NAV_ITEMS = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'STATION LX', path: '/dtrader', icon: TrendingUp },
    { name: 'Live Ticks', path: '/live-ticks', icon: Activity },
    { name: 'LAXPRIME', path: '/reversal-scanner', icon: Zap, highlight: true },
    { name: 'LAXSNIPER XV', path: '/laxsniper-xv', icon: Zap },
    { name: 'Auto Trade', path: '/admin/auto-trade', icon: Cpu, admin: true, highlight: true },
    { name: 'Bots', path: '/bots', icon: Settings },
    { name: 'Admin', path: '/admin', icon: ShieldAlert, admin: true },
];

export function Header() {
    const pathname = usePathname();
    const { status: tradingStatus, account, accounts, switchAccount, disconnect } = useDerivStore();
    const { status: relayStatus } = useRelayStore();
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const [isWalletMenuOpen, setIsWalletMenuOpen] = React.useState(false);
    const [isLoginMenuOpen, setIsLoginMenuOpen] = React.useState(false);

    const router = useRouter();
    const { token: storeToken, authorize, error: storeError } = useDerivStore();
    const [tokenInput, setTokenInput] = React.useState(storeToken || '');

    const ADMIN_IDS = [
        (process.env.NEXT_PUBLIC_ADMIN_LOGINID || 'DOT93428953').trim().toUpperCase(),
        'ROT92069817',
    ];
    const isAdmin = tradingStatus === 'connected' &&
                    !!account?.loginid &&
                    ADMIN_IDS.includes(account.loginid.toUpperCase());

    return (
        <header className="sticky top-0 z-[100] w-full bg-dark/80 backdrop-blur-xl border-b border-white/5 px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-8">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="relative w-11 h-11 group-hover:scale-105 transition-transform">
                        <Image
                            src="/logo.png"
                            alt="LX Sniper"
                            fill
                            className="object-contain"
                            priority
                        />
                    </div>
                    <span className="font-black text-lg tracking-tighter text-white uppercase italic">
                        LX <span className="text-teal-500">SNIPER</span>
                    </span>
                </Link>

                {/* Desktop Nav */}
                <nav className="hidden lg:flex items-center gap-1">
                    {NAV_ITEMS.filter(item => {
                        if (item.admin) {
                            return isAdmin;
                        }
                        return true;
                    }).map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                href={item.path}
                                className={`
                                    flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                                    ${isActive
                                        ? 'bg-teal-500 text-dark shadow-lg shadow-teal-500/20'
                                        : item.highlight
                                            ? 'text-indigo-400 hover:bg-indigo-500/10'
                                            : 'text-gray-400 hover:bg-white/5 hover:text-white'}
                                `}
                            >
                                <Icon className="w-4 h-4" />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-4">
                {/* Connection Status Bullets */}
                <div className="hidden md:flex items-center gap-3 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                    <div className="flex items-center gap-1.5" title="Tick Relay">
                        <div className={`w-1.5 h-1.5 rounded-full ${relayStatus === 'connected' ? 'bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.5)]' : 'bg-gray-600'}`} />
                        <span className="text-[9px] font-black uppercase text-gray-500 tracking-tighter">Relay</span>
                    </div>
                    <div className="w-px h-2 bg-white/10" />
                    <div className="flex items-center gap-1.5" title="Trading Hook">
                        <div className={`w-1.5 h-1.5 rounded-full ${tradingStatus === 'connected' ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' :
                            tradingStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                                'bg-gray-600'
                            }`} />
                        <span className="text-[9px] font-black uppercase text-gray-500 tracking-tighter">Hook</span>
                    </div>
                </div>

                {/* Account Summary */}
                {account ? (
                    <div className="relative">
                        <div 
                            className="flex items-center gap-3 px-4 py-1.5 bg-gradient-to-r from-teal-500/10 to-indigo-500/10 border border-teal-500/20 rounded-lg cursor-pointer hover:border-teal-500/40 transition-all group"
                            onClick={() => setIsWalletMenuOpen(!isWalletMenuOpen)}
                        >
                            <div className="flex flex-col items-end">
                                <span className="text-[8px] text-teal-500/60 font-black uppercase leading-none">Balance</span>
                                <span className="text-sm font-black text-white leading-tight">
                                    {account.currency} {account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div className="p-1.5 bg-teal-500/20 rounded text-teal-400 group-hover:bg-teal-500 group-hover:text-dark transition-all">
                                <Wallet className="w-4 h-4" />
                            </div>
                            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${isWalletMenuOpen ? 'rotate-180' : ''}`} />
                        </div>

                        {/* Wallet Dropdown */}
                        {isWalletMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-[110]" onClick={() => setIsWalletMenuOpen(false)} />
                                <div className="absolute top-full right-0 mt-2 w-64 bg-dark-card border border-white/10 rounded-xl shadow-2xl p-2 z-[120] animate-in fade-in zoom-in-95 duration-200 backdrop-blur-xl">
                                    <div className="px-2 py-1.5 mb-1.5 border-b border-white/5">
                                        <p className="text-[9px] text-gray-500 uppercase font-black tracking-widest">Switch Account</p>
                                    </div>
                                    <div className="space-y-1">
                                        {accounts.map((acc: AccountInfo) => (
                                            <button
                                                key={acc.loginid}
                                                onClick={() => {
                                                    if (acc.loginid !== account.loginid) switchAccount(acc.loginid);
                                                    setIsWalletMenuOpen(false);
                                                }}
                                                className={`w-full flex items-center justify-between p-2.5 rounded-lg transition-all text-left ${
                                                    acc.loginid === account.loginid
                                                        ? 'bg-teal-500/10 border border-teal-500/20 text-white'
                                                        : 'hover:bg-white/5 text-gray-400 hover:text-white'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${acc.loginid.includes('VR') ? 'bg-amber-500' : 'bg-teal-500'}`} />
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-bold leading-none">{acc.loginid}</span>
                                                        <span className="text-[9px] opacity-60">{acc.loginid.includes('VR') ? 'Demo' : 'Real'} Account</span>
                                                    </div>
                                                </div>
                                                {acc.loginid === account.loginid && <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-white/5 px-1">
                                        <button 
                                            onClick={() => {
                                                disconnect();
                                                setIsWalletMenuOpen(false);
                                            }}
                                            className="w-full flex items-center gap-2 p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-all text-[10px] font-black uppercase tracking-wider"
                                        >
                                            <Power className="w-3.5 h-3.5" />
                                            Disconnect Engine
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="relative">
                        <button onClick={() => setIsLoginMenuOpen(!isLoginMenuOpen)}>
                            <Badge variant="info" className="cursor-pointer hover:bg-indigo-500 hover:text-dark transition-all py-1.5 px-4 font-black uppercase italic tracking-wider">
                                {tradingStatus === 'connecting' ? 'Connecting...' : 'Connect Engine'}
                            </Badge>
                        </button>
                        
                        {isLoginMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-[110]" onClick={() => setIsLoginMenuOpen(false)} />
                                <div className="absolute top-full right-0 mt-2 w-72 bg-dark-card border border-white/10 rounded-xl shadow-2xl p-4 z-[120] animate-in fade-in zoom-in-95 duration-200 backdrop-blur-xl space-y-4">
                                    <div className="space-y-1 border-b border-white/5 pb-2">
                                        <p className="text-xs font-black uppercase text-white tracking-widest">Secure Connection</p>
                                        <p className="text-[10px] text-gray-400">Enter your Deriv API token</p>
                                    </div>
                                    <div className="space-y-3">
                                        <Input
                                            type="password"
                                            placeholder="Paste API Token"
                                            value={tokenInput}
                                            onChange={(e) => setTokenInput(e.target.value)}
                                            className="h-9 text-xs"
                                        />
                                        {storeError && (
                                            <p className="text-[10px] text-red-400 leading-tight">{storeError}</p>
                                        )}
                                        <Button 
                                            variant="primary" 
                                            className="w-full h-9 text-xs font-bold uppercase tracking-wider"
                                            onClick={() => {
                                                if(tokenInput.trim()){
                                                    authorize(tokenInput);
                                                    setIsLoginMenuOpen(false);
                                                    router.push('/laxsniper-xv');
                                                }
                                            }}
                                            disabled={tradingStatus === 'connecting'}
                                        >
                                            {tradingStatus === 'connecting' ? 'Authorizing...' : 'Authorize Bot'}
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Mobile Toggle */}
                <button
                    className="lg:hidden p-2 text-gray-400 hover:text-white"
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                    {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile Nav Overlay */}
            {isMenuOpen && (
                <div className="fixed top-16 left-0 right-0 h-[calc(100vh-4rem)] bg-dark z-[100] lg:hidden animate-in fade-in slide-in-from-top-2 duration-300 border-t border-white/5 overflow-y-auto">
                    <div className="flex flex-col gap-1 p-4">
                    {NAV_ITEMS.filter(item => {
                        if (item.admin) return isAdmin;
                        return true;
                    }).map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                href={item.path}
                                onClick={() => setIsMenuOpen(false)}
                                className={`
                                    flex items-center gap-3 p-4 rounded-xl text-sm font-bold uppercase tracking-wider
                                    ${isActive ? 'bg-teal-500 text-dark' : 'text-gray-400 bg-white/5'}
                                `}
                            >
                                <Icon className="w-5 h-5" />
                                {item.name}
                            </Link>
                        );
                    })}
                    </div>
                </div>
            )}
        </header>
    );
}
