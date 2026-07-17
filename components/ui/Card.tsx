import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    hover?: boolean;
}

export function Card({ children, className = '', hover = false }: CardProps) {
    const baseClasses = 'bg-dark-card border border-dark rounded-lg p-4 shadow-lg';
    const hoverClasses = hover ? 'transition-all duration-200 hover:border-teal-500/50 hover:shadow-teal-500/10' : '';

    return (
        <div className={`${baseClasses} ${hoverClasses} ${className}`}>
            {children}
        </div>
    );
}

interface CardHeaderProps {
    children: React.ReactNode;
    className?: string;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
}

export function CardHeader({ children, className = '', icon, badge }: CardHeaderProps) {
    return (
        <div className={`flex items-center justify-between mb-4 ${className}`}>
            <div className="flex items-center gap-2">
                {icon && <div className="text-teal-400">{icon}</div>}
                <h2 className="text-lg font-semibold">{children}</h2>
            </div>
            {badge && <div>{badge}</div>}
        </div>
    );
}

interface CardContentProps {
    children: React.ReactNode;
    className?: string;
}

export function CardContent({ children, className = '' }: CardContentProps) {
    return (
        <div className={className}>
            {children}
        </div>
    );
}
