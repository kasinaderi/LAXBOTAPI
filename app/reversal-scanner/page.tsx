'use client';

import React, { useState, useEffect } from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import { Activity, ShieldAlert, MonitorPlay, ExternalLink, Settings } from 'lucide-react';

export default function ReversalScannerPage() {
  const { token, account, status } = useDerivStore();
  const [traderUrl, setTraderUrl] = useState<string>('https://dtraderbylaxdollar.vercel.app');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [iframeSrc, setIframeSrc] = useState<string>('');

  // Handle building dynamic auth query parameters
  useEffect(() => {
    // If we have an active token and account, append it so DTrader auto-logs-in
    if (token && account?.loginid) {
      setIframeSrc(
        `${traderUrl}/?token1=${encodeURIComponent(token)}&acct1=${encodeURIComponent(account.loginid)}&cur1=${encodeURIComponent(account.currency || 'USD')}`
      );
    } else {
      setIframeSrc(traderUrl);
    }
  }, [token, account, traderUrl]);

  return (
    <div className="flex flex-col h-[calc(100vh-110px)] bg-[#0d1117] rounded-2xl border border-white/5 overflow-hidden relative">
      
      {/* Top Header / Control Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#0d1117]/80 backdrop-blur-md z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-black text-white tracking-wider uppercase">
              Advanced <span className="text-teal-400">LX DTRADER</span>
            </h1>
            <p className="text-[10px] text-gray-500">
              {account?.loginid ? `Active Account: ${account.loginid}` : 'Preview Mode'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg transition-all ${showSettings ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-gray-400'}`}
            title="Configure DTrader Source Domain"
          >
            <Settings className="w-4 h-4" />
          </button>
          
          <a
            href={iframeSrc || traderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-white/5 text-gray-400 transition-all flex items-center gap-1.5 text-xs font-semibold"
            title="Open Platform in New Tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 bg-white/3 border-b border-white/5 z-20 flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
            Custom DTrader Vercel URL
          </label>
          <div className="flex gap-2 max-w-xl">
            <input
              type="text"
              value={traderUrl}
              onChange={(e) => setTraderUrl(e.target.value)}
              placeholder="e.g. https://your-dtrader.vercel.app"
              className="flex-1 px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-teal-500"
            />
            <button
              onClick={() => setShowSettings(false)}
              className="px-3 py-1.5 rounded-lg bg-teal-500 text-black text-xs font-black uppercase hover:bg-teal-400 transition-all"
            >
              Apply
            </button>
          </div>
          <p className="text-[10px] text-gray-500 italic">
            Once you host your custom DTrader template on Vercel, paste its domain above. The station automatically injects your active Laxdollar session token for direct login.
          </p>
        </div>
      )}

      {/* Main Iframe Wrapper */}
      <div className="flex-1 min-h-0 relative bg-black/20">
        {!token && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d1117]/95 z-10 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-4 animate-bounce">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h2 className="text-base font-black text-white uppercase tracking-wider">
              Authentication Required
            </h2>
            <p className="text-xs text-gray-400 max-w-sm mt-1 mb-4">
              Please authenticate your Deriv account in Laxdollar to activate the advanced white-labeled trading station.
            </p>
          </div>
        )}

        {token && iframeSrc && (
          <iframe
            src={iframeSrc}
            className="w-full h-full border-none bg-transparent"
            allow="clipboard-read; clipboard-write; camera; geolocation"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
            title="LaxTrade Station"
          />
        )}
      </div>
    </div>
  );
}
