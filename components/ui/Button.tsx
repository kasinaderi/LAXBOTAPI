import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'danger' | 'success';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    icon?: React.ReactNode;
}

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    className = '',
    icon,
    ...props
}: ButtonProps) {
    const baseClasses = 'font-medium rounded-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-2';

    const variantClasses = {
        primary: 'bg-teal-500 hover:bg-teal-600 text-white hover:shadow-lg hover:shadow-teal-500/30',
        secondary: 'bg-dark-secondary hover:bg-dark-hover text-white border border-dark',
        danger: 'bg-red-500 hover:bg-red-600 text-white hover:shadow-lg hover:shadow-red-500/30',
        success: 'bg-green-500 hover:bg-green-600 text-white hover:shadow-lg hover:shadow-green-500/30',
    };

    const sizeClasses = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-6 py-2.5 text-base',
        lg: 'px-8 py-3 text-lg',
    };

    return (
        <button
            className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className} disabled:opacity-50 disabled:cursor-not-allowed`}
            {...props}
        >
            {icon && <span>{icon}</span>}
            {children}
        </button>
    );
}
