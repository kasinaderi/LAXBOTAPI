'use client';

import React, { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Market {
  symbol: string;
  displayName: string;
  category: string;
  pip: number;
}

interface MarketSelectorProps {
  selectedSymbol: string;
  onSelect: (symbol: string, displayName: string) => void;
  token?: string;
}

// ─── Market list ──────────────────────────────────────────────────────────────

const MARKETS: Market[] = [
  // Synthetic indices
  { symbol: 'R_10',    displayName: 'Volatility 10',      category: 'Synthetic', pip: 3 },
  { symbol: 'R_25',    displayName: 'Volatility 25',      category: 'Synthetic', pip: 3 },
  { symbol: 'R_50',    displayName: 'Volatility 50',      category: 'Synthetic', pip: 4 },
  { symbol: 'R_75',    displayName: 'Volatility 75',      category: 'Synthetic', pip: 4 },
  { symbol: 'R_100',   displayName: 'Volatility 100',     category: 'Synthetic', pip: 2 },
  { symbol: '1HZ10V',  displayName: 'Vol 10 (1s)',        category: 'Synthetic', pip: 2 },
  { symbol: '1HZ25V',  displayName: 'Vol 25 (1s)',        category: 'Synthetic', pip: 2 },
  { symbol: '1HZ50V',  displayName: 'Vol 50 (1s)',        category: 'Synthetic', pip: 2 },
  { symbol: '1HZ75V',  displayName: 'Vol 75 (1s)',        category: 'Synthetic', pip: 2 },
  { symbol: '1HZ100V', displayName: 'Vol 100 (1s)',       category: 'Synthetic', pip: 2 },
  // Forex
  { symbol: 'frxEURUSD', displayName: 'EUR/USD',          category: 'Forex',     pip: 5 },
  { symbol: 'frxGBPUSD', displayName: 'GBP/USD',          category: 'Forex',     pip: 5 },
  { symbol: 'frxUSDJPY', displayName: 'USD/JPY',          category: 'Forex',     pip: 3 },
  { symbol: 'frxAUDUSD', displayName: 'AUD/USD',          category: 'Forex',     pip: 5 },
  { symbol: 'frxUSDCAD', displayName: 'USD/CAD',          category: 'Forex',     pip: 5 },
  { symbol: 'frxEURGBP', displayName: 'EUR/GBP',          category: 'Forex',     pip: 5 },
  // Commodities
  { symbol: 'frxXAUUSD', displayName: 'Gold / USD',       category: 'Commodities', pip: 2 },
  { symbol: 'frxXAGUSD', displayName: 'Silver / USD',     category: 'Commodities', pip: 4 },
  // Crash/Boom
  { symbol: 'CRASH300',  displayName: 'Crash 300',         category: 'Crash/Boom', pip: 2 },
  { symbol: 'CRASH500',  displayName: 'Crash 500',         category: 'Crash/Boom', pip: 2 },
  { symbol: 'CRASH1000', displayName: 'Crash 1000',        category: 'Crash/Boom', pip: 2 },
  { symbol: 'BOOM300',   displayName: 'Boom 300',          category: 'Crash/Boom', pip: 2 },
  { symbol: 'BOOM500',   displayName: 'Boom 500',          category: 'Crash/Boom', pip: 2 },
  { symbol: 'BOOM1000',  displayName: 'Boom 1000',         category: 'Crash/Boom', pip: 2 },
  // Jump Indices
  { symbol: 'JD10',  displayName: 'Jump 10 Index',   category: 'Jump', pip: 2 },
  { symbol: 'JD25',  displayName: 'Jump 25 Index',   category: 'Jump', pip: 2 },
  { symbol: 'JD50',  displayName: 'Jump 50 Index',   category: 'Jump', pip: 2 },
  { symbol: 'JD75',  displayName: 'Jump 75 Index',   category: 'Jump', pip: 2 },
  { symbol: 'JD100', displayName: 'Jump 100 Index',  category: 'Jump', pip: 2 },
  // Step Indices
  { symbol: 'STPIDX10', displayName: 'Step Index',   category: 'Step', pip: 2 },
];

const CATEGORIES = ['Synthetic', 'Forex', 'Commodities', 'Crash/Boom', 'Jump', 'Step'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarketSelector({ selectedSymbol, onSelect }: MarketSelectorProps) {
  const [search,        setSearch]        = useState('');
  const [activeCategory, setActiveCategory] = useState('Synthetic');
  const [livePrices,    setLivePrices]    = useState<Record<string, number>>({});
  const [flash,         setFlash]         = useState<Record<string, 'up' | 'down' | null>>({});
  const prevPrices = useRef<Record<string, number>>({});
  const wsRef      = useRef<WebSocket | null>(null);
  const appId      = process.env.NEXT_PUBLIC_DERIV_CLIENT_ID || '33AztynpQOiYrx5yBUODj';

  // Live price stream for current category
  useEffect(() => {
    wsRef.current?.close();

    const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    wsRef.current = ws;

    const categoryMarkets = MARKETS.filter(m => m.category === activeCategory);

    ws.onopen = () => {
      categoryMarkets.forEach(m => {
        ws.send(JSON.stringify({ ticks: m.symbol, subscribe: 1 }));
      });
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.tick) {
          const { symbol, quote, ask, bid } = msg.tick;
          const price = parseFloat(ask ?? bid ?? quote);
          if (isNaN(price)) return;

          const prev = prevPrices.current[symbol];
          const dir: 'up' | 'down' | null = prev !== undefined
            ? price > prev ? 'up' : price < prev ? 'down' : null
            : null;

          prevPrices.current[symbol] = price;
          setLivePrices(p => ({ ...p, [symbol]: price }));

          if (dir) {
            setFlash(f => ({ ...f, [symbol]: dir }));
            setTimeout(() => setFlash(f => ({ ...f, [symbol]: null })), 400);
          }
        }
      } catch {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [activeCategory, appId]);

  const filtered = MARKETS.filter(m =>
    m.category === activeCategory &&
    (m.displayName.toLowerCase().includes(search.toLowerCase()) ||
     m.symbol.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#080c12]">

      {/* Search */}
      <div className="px-2 pt-2 pb-1 flex-shrink-0">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white/4 border border-white/6 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-700 focus:outline-none focus:border-teal-500/40"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex px-2 gap-1 pb-1 flex-shrink-0 overflow-x-auto no-scrollbar">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => { setActiveCategory(cat); setSearch(''); }}
            className={`flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
              activeCategory === cat
                ? 'bg-teal-500/20 text-teal-300'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {cat === 'Crash/Boom' ? 'C/B' : cat.slice(0, 3)}
          </button>
        ))}
      </div>

      {/* Market list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-gray-700">No markets found</div>
        )}

        {filtered.map(market => {
          const price  = livePrices[market.symbol];
          const dir    = flash[market.symbol];
          const isSelected = market.symbol === selectedSymbol;

          return (
            <button
              key={market.symbol}
              onClick={() => onSelect(market.symbol, market.displayName)}
              className={`w-full flex items-center justify-between px-3 py-2 transition-all border-l-2 ${
                isSelected
                  ? 'bg-teal-500/8 border-teal-400'
                  : 'border-transparent hover:bg-white/3 hover:border-white/10'
              }`}
            >
              {/* Name */}
              <div className="text-left min-w-0">
                <div className={`text-xs font-semibold truncate leading-tight ${isSelected ? 'text-teal-300' : 'text-gray-300'}`}>
                  {market.displayName}
                </div>
                <div className="text-[9px] text-gray-700 font-mono leading-tight">{market.symbol}</div>
              </div>

              {/* Price */}
              <div className={`text-right ml-1 flex-shrink-0 font-mono text-xs font-bold transition-colors duration-200 ${
                dir === 'up'   ? 'text-teal-400' :
                dir === 'down' ? 'text-red-400'  :
                'text-gray-400'
              }`}>
                {price !== undefined
                  ? price.toFixed(market.pip)
                  : <span className="inline-block w-10 h-2.5 bg-white/5 rounded animate-pulse" />
                }
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
