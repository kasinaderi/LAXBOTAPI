'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useDerivStore } from '@/store/useDerivStore';
import { derivWS } from '@/lib/deriv/websocket';
import { Bot, Play } from 'lucide-react';

// Dynamic import keeps chart code out of the initial JS bundle
const TradeChart    = dynamic(() => import('@/components/DTrader/TradeChart'),    { ssr: false });
const TradeForm     = dynamic(() => import('@/components/DTrader/TradeForm'),     { ssr: false });
const MarketSelector = dynamic(() => import('@/components/DTrader/MarketSelector'), { ssr: false });
const AutoPanel     = dynamic(() => import('@/components/DTrader/AutoPanel'),     { ssr: false });

const DISPLAY_NAMES: Record<string, string> = {
  R_10: 'Volatility 10 Index', R_25: 'Volatility 25 Index',
  R_50: 'Volatility 50 Index', R_75: 'Volatility 75 Index',
  R_100: 'Volatility 100 Index', '1HZ10V': 'Volatility 10 (1s) Index',
  '1HZ25V': 'Volatility 25 (1s) Index', '1HZ50V': 'Volatility 50 (1s) Index',
  '1HZ75V': 'Volatility 75 (1s) Index', '1HZ100V': 'Volatility 100 (1s) Index',
  frxEURUSD: 'EUR/USD', frxGBPUSD: 'GBP/USD', frxUSDJPY: 'USD/JPY',
  frxAUDUSD: 'AUD/USD', frxUSDCAD: 'USD/CAD', frxEURGBP: 'EUR/GBP',
  frxXAUUSD: 'Gold / USD', frxXAGUSD: 'Silver / USD',
  CRASH300: 'Crash 300 Index', CRASH500: 'Crash 500 Index', CRASH1000: 'Crash 1000 Index',
  BOOM300: 'Boom 300 Index', BOOM500: 'Boom 500 Index', BOOM1000: 'Boom 1000 Index',
  JD10: 'Jump 10 Index', JD25: 'Jump 25 Index', JD50: 'Jump 50 Index',
  JD75: 'Jump 75 Index', JD100: 'Jump 100 Index', STPIDX10: 'Step Index',
};

// ── Right sidebar — tab switcher between Trade Form and AUTO panel ─────────────
function RightSidebarTabs({
  symbol, displayName, token,
}: { symbol: string; displayName: string; token?: string }) {
  const [activeTab, setActiveTab] = useState<'trade' | 'auto'>('trade');
  const { isRunning } = useDerivStore();

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex flex-shrink-0 border-b border-white/5 bg-[#0a0f18]">
        <button
          onClick={() => setActiveTab('trade')}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
            activeTab === 'trade'
              ? 'text-teal-400 border-b-2 border-teal-400'
              : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          Trade
        </button>
        <button
          onClick={() => setActiveTab('auto')}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 ${
            activeTab === 'auto'
              ? 'text-indigo-400 border-b-2 border-indigo-400'
              : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          <Bot className="w-3 h-3" />
          AUTO
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse ml-0.5" />
          )}
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'trade' ? (
          <TradeForm symbol={symbol} displayName={displayName} token={token} />
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <AutoPanel />
          </div>
        )}
      </div>
    </div>
  );
}

export default function TradingStation() {
  const { token, account, manualMarket: storeSymbol, setManualMarket: setMarket, sidebarView, setSidebarView, isRunning, startBot, stopBot, virtualSettings, setVirtualSettings, setTradingApp } = useDerivStore();
  const symbol = storeSymbol || 'R_100';
  const displayName = DISPLAY_NAMES[symbol] ?? symbol;

  React.useEffect(() => {
    setTradingApp('dtrader');
  }, [setTradingApp]);

  const handleMarketSelect = (sym: string) => setMarket(sym);

  const handleStart = () => {
    setSidebarView('logs');
    startBot();
  };

  const handleStop = () => {
    stopBot();
  };

  return (
    <div
      className="flex flex-col h-[calc(100vh-4rem)] bg-[#080c12] relative"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Page header ── */}
      <div className="hidden md:flex items-center justify-between px-3 py-1.5 md:px-4 md:py-2 border-b border-white/5 flex-shrink-0 bg-[#0a0f18]">
        <div className="flex items-center gap-2">
          <h1 className="text-sm md:text-base font-black text-white tracking-tight">
            STATION<span className="text-teal-400"> LX</span>
          </h1>
          <span className="hidden sm:block text-[9px] text-gray-600 uppercase tracking-widest">
            Trade Station · Historical Candles
          </span>
        </div>

        {account ? (
          <div className="flex items-center gap-1.5 bg-white/3 border border-white/8 rounded-md px-2 py-0.5 md:py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            <div className="flex items-center gap-1.5 md:flex-col md:items-start md:gap-0">
              <span className="text-[8px] text-gray-500 font-mono font-bold leading-none">{account.loginid}</span>
              <span className="text-[10px] md:text-xs font-black text-white leading-tight font-mono">
                {(account.balance ?? 0).toFixed(2)}
                <span className="text-gray-500 text-[8px] ml-0.5">{account.currency}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-0.5 md:py-1">
            <span className="text-[10px] text-amber-300 font-bold">Connect on Dashboard</span>
          </div>
        )}
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-0">

        {/* Market selector / Trade Log sidebar */}
        <div className="hidden md:flex flex-col w-52 border-r border-white/5 flex-shrink-0 bg-[#0a0f18]">
          {sidebarView === 'logs' ? (
            <TradeLogSidebar />
          ) : (
            <MarketSelector
              selectedSymbol={symbol}
              onSelect={handleMarketSelect}
              token={token ?? undefined}
            />
          )}
        </div>

        {/* Chart — takes most space */}
        <div className="flex-1 min-w-0">
          <TradeChart
            symbol={symbol}
            displayName={displayName}
            token={token ?? undefined}
          />
        </div>

        {/* Right sidebar: Trade + AUTO tabs */}
        <div className="hidden lg:flex flex-col w-64 border-l border-white/5 flex-shrink-0">
          <RightSidebarTabs
            symbol={symbol}
            displayName={displayName}
            token={token ?? undefined}
          />
        </div>
      </div>

      {/* ── Mobile: bottom tabs for market + trade + auto ── */}
      <div className="flex md:hidden border-t border-white/5 bg-[#0d1117] flex-shrink-0">
        <MobileBottomPanel
          symbol={symbol}
          displayName={displayName}
          token={token ?? undefined}
          onSelect={handleMarketSelect}
        />
      </div>

      {/* Floating Bot Control Pill — bottom center */}
      {token && isRunning && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 md:bottom-4 z-50 flex items-center gap-1 bg-[#0d121f]/90 backdrop-blur-md border border-white/10 rounded-full px-2 py-1.5 shadow-2xl">
          <button
            onClick={() => setVirtualSettings({ isVirtualMode: !virtualSettings.isVirtualMode })}
            className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-300 ${
              virtualSettings.isVirtualMode
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
            }`}
          >
            {virtualSettings.isVirtualMode ? 'VIRTUAL' : 'REAL'}
          </button>
          <div className="w-[1px] h-4 bg-white/10" />
          <button
            onClick={isRunning ? handleStop : handleStart}
            className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${
              isRunning
                ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-pulse'
                : 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]'
            }`}
          >
            {isRunning ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                STOP
              </>
            ) : (
              <>
                <Play className="w-2.5 h-2.5 fill-current" />
                START
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Mobile bottom panel (market + trade + auto switcher) ──────────────────────
function MobileBottomPanel({
  symbol, displayName, token, onSelect,
}: {
  symbol: string;
  displayName: string;
  token?: string;
  onSelect: (sym: string) => void;
}) {
  const [tab, setTab] = useState<'trade' | 'markets' | 'auto'>('trade');
  const { sidebarView, manualContractType, isRunning } = useDerivStore();
  const isDigitMode = manualContractType?.startsWith('DIGIT');

  // Auto-switch to logs tab when bot starts
  React.useEffect(() => {
    if (sidebarView === 'logs') {
      setTab('markets');
    }
  }, [sidebarView]);

  return (
    <div className="flex flex-col w-full h-[20rem] bg-[#0d1117]">
      {/* Tab bar */}
      <div className="flex border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => setTab('trade')}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
            tab === 'trade' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-600'
          }`}
        >
          Trade
        </button>
        <button
          onClick={() => setTab('markets')}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
            tab === 'markets' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-600'
          }`}
        >
          {sidebarView === 'logs' ? 'Logs' : 'Markets'}
        </button>
        <button
          onClick={() => setTab('auto')}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 ${
            tab === 'auto' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-600'
          }`}
        >
          <Bot className="w-3 h-3" />
          AUTO
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse ml-0.5" />
          )}
        </button>
      </div>

      {/* Panel */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {tab === 'trade' ? (
          <TradeForm symbol={symbol} displayName={displayName} token={token} />
        ) : tab === 'auto' ? (
          <AutoPanel />
        ) : sidebarView === 'logs' ? (
          <TradeLogSidebar />
        ) : (
          <MarketSelector selectedSymbol={symbol} onSelect={(sym) => onSelect(sym)} token={token} />
        )}
      </div>
    </div>
  );
}

// ── Trade Log Sidebar ──────────────────────────────────────────────────────────
function TradeLogSidebar() {
  const { manualPositions, setManualPositions, clearLogs, setSidebarView, tradeLogs, isRunning, stats, currentStep, tradePattern } = useDerivStore();
  const [logType, setLogType] = React.useState<'manual' | 'bot'>('bot');

  // Auto-switch to bot tab when bot is running
  React.useEffect(() => {
    if (isRunning) setLogType('bot');
  }, [isRunning]);

  const handleSell = (contractId: number) => {
    derivWS.send({ sell: contractId, price: 0 });
  };

  const handleResetLog = () => {
    setManualPositions((prev: any[]) => prev.filter((p: any) => !p.isSold));
    clearLogs?.();
  };

  // Compute active bot trade info
  const activeBotLogs = tradeLogs.filter((l: any) => !l.result || l.result === '...V...' || l.result === 'BUYING...' || l.result === 'PROPOSING...');
  const totalPL = stats.totalProfit;
  const patternStep = currentStep;
  const patternLabel = tradePattern?.[patternStep - 1] === 'trade' ? '✅ TRADE' : tradePattern?.[patternStep - 1] === 'skip' ? '⏭ SKIP' : `Step ${patternStep}`;

  return (
    <div className="flex flex-col h-full bg-[#0a0f18] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/20 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Trade Log</span>
          <button
            onClick={handleResetLog}
            title="Reset Everything"
            className="text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 p-1 rounded transition-colors text-xs leading-none"
          >
            🗑
          </button>
        </div>
        <button
          onClick={() => setSidebarView('markets')}
          className="text-[9px] text-teal-400 font-bold bg-teal-500/10 hover:bg-teal-500/20 px-2.5 py-0.5 rounded border border-teal-500/20 transition-all active:scale-95"
        >
          Markets
        </button>
      </div>

      {/* Live Bot Status Strip — only shows when running */}
      {isRunning && (
        <div className="flex items-center justify-between px-3 py-1 bg-emerald-500/5 border-b border-emerald-500/20 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[8px] font-black text-emerald-400 uppercase tracking-wider">LIVE</span>
            <span className="text-[8px] text-gray-500 font-mono">| Step {patternStep}</span>
            <span className={`text-[8px] font-bold ${
              tradePattern?.[patternStep - 1] === 'trade' ? 'text-teal-400' : 'text-gray-500'
            }`}>{patternLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] font-black font-mono text-gray-400">P/L:</span>
            <span className={`text-[9px] font-black font-mono ${
              totalPL > 0 ? 'text-emerald-400' : totalPL < 0 ? 'text-rose-400' : 'text-gray-400'
            }`}>
              {totalPL >= 0 ? '+' : ''}{totalPL.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Log Type Tabs */}
      <div className="flex border-b border-white/5 bg-[#080c12]/60 p-1 flex-shrink-0">
        <button
          onClick={() => setLogType('manual')}
          className={`flex-1 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all ${
            logType === 'manual'
              ? 'bg-teal-500/15 border border-teal-500/30 text-teal-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Manual ({manualPositions.length})
        </button>
        <button
          onClick={() => setLogType('bot')}
          className={`flex-1 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all ${
            logType === 'bot'
              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Bot ({tradeLogs.length})
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 trade-form-scroll max-h-[400px] md:max-h-none">
        {logType === 'manual' ? (
          manualPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-gray-500 gap-1.5">
              <span className="text-lg">📋</span>
              <span className="text-[10px] font-bold uppercase tracking-wider">No manual trades</span>
            </div>
          ) : (
            manualPositions.slice().reverse().map((pos: any) => {
              const profit = pos.currentProfit;
              const isSettled = pos.isSold;

              return (
                <div key={pos.contractId} className="bg-white/3 border border-white/5 rounded-lg p-2 flex flex-col gap-1 text-[10px] font-medium">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-gray-400 uppercase tracking-wider">{pos.type}</span>
                    <span className={profit > 0 ? 'text-emerald-400 font-mono font-black' : profit < 0 ? 'text-rose-400 font-mono font-black' : 'text-gray-400 font-mono'}>
                      {profit > 0 ? `+$${profit.toFixed(2)}` : profit < 0 ? `-$${Math.abs(profit).toFixed(2)}` : '$0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-500 text-[9px] font-mono">
                    <span>ID: {pos.contractId}</span>
                    <span>Stake: ${pos.buyPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500 text-[9px] font-mono">
                    <span>Spot: {pos.entrySpot}</span>
                    {pos.prediction !== null && <span>Pred: {pos.prediction}</span>}
                  </div>
                  {!isSettled && (
                    <button
                      onClick={() => handleSell(pos.contractId)}
                      className="mt-1 w-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 py-0.5 rounded font-bold text-[9px] transition-all"
                    >
                      Sell
                    </button>
                  )}
                </div>
              );
            })
          )
        ) : (
          tradeLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-gray-500 gap-1.5">
              <span className="text-lg">🤖</span>
              <span className="text-[10px] font-bold uppercase tracking-wider">No bot trades</span>
            </div>
          ) : (
            tradeLogs.map((log: any, idx: number) => {
              const profit = Number(log.profit) || 0;
              return (
                <div key={idx} className={`border rounded-lg p-2 flex flex-col gap-1 text-[10px] font-medium ${
                  log.isVirtual ? 'border-indigo-500/20 bg-indigo-500/5' : 'border-white/5 bg-white/3'
                }`}>
                  <div className="flex justify-between items-center font-bold">
                    <div className="flex items-center gap-1">
                      {log.isVirtual && (
                        <span className="text-[8px] font-black text-indigo-400 bg-indigo-500/15 border border-indigo-500/20 px-1 py-0.5 rounded uppercase leading-none">
                          V
                        </span>
                      )}
                      <span className="text-gray-400 uppercase tracking-wider">{log.contract}</span>
                    </div>
                    {log.result && log.result !== 'BUYING...' && log.result !== 'PROPOSING...' ? (
                      <span className={log.result === 'WON' ? 'text-emerald-400 font-mono font-black' : 'text-rose-400 font-mono font-black'}>
                        {profit >= 0 ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`}
                      </span>
                    ) : (
                      <span className="text-amber-400 font-mono font-black animate-pulse">
                        {log.result || 'BUYING...'}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between text-gray-500 text-[9px] font-mono">
                    <span>Time: {new Date(log.time).toLocaleTimeString([], { hour12: false })}</span>
                    <span>Stake: ${Number(log.stake || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500 text-[9px] font-mono">
                    <span>Exit Digit: {log.exit !== undefined && log.exit !== null ? log.exit : '-'}</span>
                    {log.digit !== undefined && log.digit !== '-' && <span>Pred: {log.digit}</span>}
                  </div>
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}
