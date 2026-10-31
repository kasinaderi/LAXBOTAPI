'use client';

import React from 'react';
import { Card, CardHeader, CardContent, Badge } from '@/components/ui';
import { Zap, ShieldCheck, Lock, ArrowRight, TrendingUp, Github } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

const TOOLS = [
    {
        name: 'LAXSNIPER XV',
        version: '2.5',
        desc: 'Advanced digit trading bot with multi-trigger pattern engine and martingale management.',
        path: '/laxsniper-xv',
        status: 'Operational',
        icon: Zap,
        color: 'from-indigo-600 to-indigo-400',
        active: true
    },
    {
        name: 'GRID MASTER',
        version: 'v1.2-ALPHA',
        desc: 'High-frequency market maker strategy for volatility indices.',
        path: '/bots',
        status: 'Legacy / Testing',
        icon: TrendingUp,
        color: 'from-blue-600 to-blue-400',
        active: false
    },
    {
        name: 'PATTERN AI',
        version: 'v0.5-LABS',
        desc: 'Machine learning based digit prediction engine.',
        path: '/bots',
        status: 'Under Development',
        icon: ShieldCheck,
        color: 'from-emerald-600 to-emerald-400',
        active: false
    }
];

export default function BotsPage() {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-black text-white tracking-tighter uppercase italic">
                    Trading <span className="text-teal-500">Suite</span>
                </h1>
                <p className="text-gray-400 mt-1 italic">Authorized tools for high-performance execution.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {TOOLS.map((tool, i) => (
                    <motion.div
                        key={tool.name}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                    >
                        <Card className={`group overflow-hidden border-white/5 bg-dark-card hover:border-${tool.active ? 'indigo' : 'gray'}-500/30 transition-all`}>
                            <div className={`h-2 w-full bg-gradient-to-r ${tool.color}`} />
                            <CardContent className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div className={`p-3 rounded-xl bg-white/5 text-white group-hover:scale-110 transition-transform`}>
                                        <tool.icon className="w-6 h-6" />
                                    </div>
                                    <Badge variant={tool.active ? 'info' : 'neutral'}>{tool.version}</Badge>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">{tool.name}</h3>
                                <p className="text-sm text-gray-500 line-clamp-2 mb-6">
                                    {tool.desc}
                                </p>

                                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-1.5 h-1.5 rounded-full ${tool.active ? 'bg-teal-500' : 'bg-gray-700'}`} />
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${tool.active ? 'text-teal-500' : 'text-gray-600'}`}>
                                            {tool.status}
                                        </span>
                                    </div>
                                    {tool.active ? (
                                        <Link href={tool.path} className="flex items-center gap-2 text-white font-bold text-sm bg-indigo-500 hover:bg-indigo-600 px-4 py-1.5 rounded-lg transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
                                            Open <ArrowRight className="w-4 h-4" />
                                        </Link>
                                    ) : (
                                        <div className="flex items-center gap-2 text-gray-600 font-bold text-sm bg-white/5 px-4 py-1.5 rounded-lg cursor-not-allowed">
                                            Locked <Lock className="w-3.5 h-3.5" />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* Development Notice */}
            <Card className="bg-indigo-500/5 border-indigo-500/10">
                <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center text-indigo-400">
                            <Github className="w-6 h-6" />
                        </div>
                        <div>
                            <h4 className="text-white font-bold underline decoration-indigo-500/50 underline-offset-4">Custom Strategies?</h4>
                            <p className="text-sm text-gray-400">Build and integrate your own proprietary logic into our secure cloud architecture.</p>
                        </div>
                    </div>
                    <Badge variant="outline" className="px-6 py-2 border-indigo-500/20 text-indigo-400 font-black">Coming Q2 2026</Badge>
                </CardContent>
            </Card>
        </div>
    );
}
