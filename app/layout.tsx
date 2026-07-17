import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Navigation/Header";
import { ConnectionInitializer } from "@/components/ConnectionInitializer";
import { PersistentTradePanel } from "@/components/PersistentTradePanel";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "LAX SNIPER - Professional Digit Trading Platform",
    description: "Next-gen Deriv automated trading platform with professional tick relay and multi-bot dashboard",
    icons: {
        icon: '/logo.png',
        shortcut: '/logo.png',
        apple: '/logo.png',
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="dark" suppressHydrationWarning>
            <body className={`${inter.className} bg-dark text-white antialiased min-h-screen flex flex-col`} suppressHydrationWarning>
                <ConnectionInitializer />
                <Header />
                <main className="flex-1 container mx-auto p-4 md:p-6 lg:p-8">
                    {children}
                </main>
                <PersistentTradePanel />
            </body>
        </html>
    );
}
