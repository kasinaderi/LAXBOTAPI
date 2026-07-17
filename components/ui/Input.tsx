import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    containerClassName?: string;
}

export function Input({
    label,
    error,
    icon,
    containerClassName = '',
    className = '',
    ...props
}: InputProps) {
    return (
        <div className={containerClassName}>
            {label && (
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    {label}
                </label>
            )}
            <div className="relative">
                {icon && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        {icon}
                    </div>
                )}
                <input
                    className={`
            w-full bg-dark-secondary border border-dark rounded-lg px-4 py-2.5 text-white placeholder-gray-500
            focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors
            ${icon ? 'pl-10' : ''}
            ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
            ${className}
          `}
                    {...props}
                />
            </div>
            {error && (
                <p className="mt-1 text-sm text-red-400">{error}</p>
            )}
        </div>
    );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
    containerClassName?: string;
}

export function Textarea({
    label,
    error,
    containerClassName = '',
    className = '',
    ...props
}: TextareaProps) {
    return (
        <div className={containerClassName}>
            {label && (
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    {label}
                </label>
            )}
            <textarea
                className={`
          w-full bg-dark-secondary border border-dark rounded-lg px-4 py-2.5 text-white placeholder-gray-500
          focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors
          custom-scrollbar
          ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
          ${className}
        `}
                {...props}
            />
            {error && (
                <p className="mt-1 text-sm text-red-400">{error}</p>
            )}
        </div>
    );
}
