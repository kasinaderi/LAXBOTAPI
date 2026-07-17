import React from 'react';

interface BadgeProps {
    children: React.ReactNode;
    variant?: 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'outline';
    className?: string;
}

export function Badge({ children, variant = 'neutral', className = '' }: BadgeProps) {
    const variantClasses = {
        success: 'bg-green-500/20 text-green-400 border-green-500/30',
        danger: 'bg-red-500/20 text-red-400 border-red-500/30',
        warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        info: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
        neutral: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        outline: 'bg-transparent text-gray-400 border-white/10 hover:border-white/20',
    };

    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${variantClasses[variant]} ${className}`}>
            {children}
        </span>
    );
}

interface StatusIndicatorProps {
    status: 'online' | 'offline' | 'running' | 'stopped' | 'connected' | 'disconnected' | 'connecting' | 'ready' | 'authenticating' | 'handshaking' | 'error';
    label?: string;
    className?: string;
}

export function StatusIndicator({ status, label, className = '' }: StatusIndicatorProps) {
    const statusConfig: any = {
        online: { color: 'bg-green-500', text: 'Connected', pulse: true },
        offline: { color: 'bg-red-500', text: 'Disconnected', pulse: false },
        connected: { color: 'bg-green-500', text: 'Connected', pulse: true },
        ready: { color: 'bg-teal-500', text: 'System Ready', pulse: true },
        authenticating: { color: 'bg-amber-500', text: 'Authenticating...', pulse: true },
        disconnected: { color: 'bg-red-500', text: 'Disconnected', pulse: false },
        running: { color: 'bg-green-500', text: 'Running', pulse: true },
        stopped: { color: 'bg-gray-500', text: 'Stopped', pulse: false },
        connecting: { color: 'bg-amber-500', text: 'Connecting...', pulse: true },
        handshaking: { color: 'bg-indigo-500', text: 'Handshaking...', pulse: true },
        error: { color: 'bg-red-600', text: 'Error', pulse: false },
    };

    const config = statusConfig[status];

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div className="relative">
                <div className={`w-2 h-2 rounded-full ${config.color}`} />
                {config.pulse && (
                    <div className={`absolute inset-0 w-2 h-2 rounded-full ${config.color} animate-ping opacity-75`} />
                )}
            </div>
            <span className="text-sm text-gray-300">{label || config.text}</span>
        </div>
    );
}
