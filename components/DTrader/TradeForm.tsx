'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDerivStore } from '@/store/useDerivStore';
import { derivWS } from '@/lib/deriv/websocket';
import { tradeWS } from '@/lib/deriv/trade-ws';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Contract {
  id: string;
  label: string;
  shortCode: string;
  description: string;
  needsBarrier?: boolean;
  needsPrediction?: boolean;
  /** Minimum allowed duration seconds */
  minDurationSec?: number;
  /** Allowed duration units */
  allowedUnits?: string[];
}

interface ContractCategory {
  id: string;
  label: string;
  icon: string;
  contracts: Contract[];
}

interface TradeFormProps {
  symbol: string;
  displayName?: string;
  token?: string;
}

// ─── Contract categories ─────────────────────────────────────────────────────

const CONTRACT_CATEGORIES: ContractCategory[] = [
  {
    id: 'rise_fall',
    label: 'Rise/Fall',
    icon: '📈',
    contracts: [
      {
        id: 'CALL', label: 'Rise', shortCode: 'CALL',
        description: 'Win if exit price is higher than entry price',
        allowedUnits: ['t', 'm', 'h', 'd'],
      },
      {
        id: 'PUT', label: 'Fall', shortCode: 'PUT',
        description: 'Win if exit price is lower than entry price',
        allowedUnits: ['t', 'm', 'h', 'd'],
      },
    ],
  },
  {
    id: 'digits',
    label: 'Digits',
    icon: '🔢',
    contracts: [
      { id: 'DIGITMATCH', label: 'Matches', shortCode: 'DIGITMATCH', description: 'Win if last digit equals prediction', needsPrediction: true, allowedUnits: ['t'] },
      { id: 'DIGITDIFF',  label: 'Differs',  shortCode: 'DIGITDIFF',  description: 'Win if last digit differs from prediction', needsPrediction: true, allowedUnits: ['t'] },
      { id: 'DIGITEVEN',  label: 'Even',     shortCode: 'DIGITEVEN',  description: 'Win if last digit is even', allowedUnits: ['t'] },
      { id: 'DIGITODD',   label: 'Odd',      shortCode: 'DIGITODD',   description: 'Win if last digit is odd', allowedUnits: ['t'] },
      { id: 'DIGITOVER',  label: 'Over',     shortCode: 'DIGITOVER',  description: 'Win if last digit is over barrier', needsBarrier: true, allowedUnits: ['t'] },
      { id: 'DIGITUNDER', label: 'Under',    shortCode: 'DIGITUNDER', description: 'Win if last digit is under barrier', needsBarrier: true, allowedUnits: ['t'] },
    ],
  },
  {
    id: 'touch',
    label: 'Touch',
    icon: '👆',
    contracts: [
      {
        id: 'ONETOUCH', label: 'Touch', shortCode: 'ONETOUCH',
        description: 'Win if price touches the barrier',
        needsBarrier: true, allowedUnits: ['t', 'm', 'h', 'd'],
      },
      {
        id: 'NOTOUCH', label: 'No Touch', shortCode: 'NOTOUCH',
        description: 'Win if price never touches the barrier',
        needsBarrier: true, allowedUnits: ['t', 'm', 'h', 'd'],
      },
    ],
  },
  {
    id: 'higher_lower',
    label: 'High/Low',
    icon: '↕️',
    contracts: [
      {
        id: 'CALL_HIGHER', label: 'Higher', shortCode: 'HIGHER',
        description: 'Win if exit is higher than barrier',
        needsBarrier: true, allowedUnits: ['t', 'm', 'h', 'd'],
      },
      {
        id: 'PUT_LOWER', label: 'Lower', shortCode: 'LOWER',
        description: 'Win if exit is lower than barrier',
        needsBarrier: true, allowedUnits: ['t', 'm', 'h', 'd'],
      },
    ],
  },
];

// ─── Market classification helpers ────────────────────────────────────────────

const isVolatilityIndex = (sym: string) =>
  /^R_(10|25|50|75|100)$/.test(sym) || /^1HZ(10|25|50|75|100)V$/.test(sym);

const isJumpIndex = (sym: string) =>
  /^JD(10|25|50|75|100)$/.test(sym);

const isCrashBoom = (sym: string) =>
  /^(CRASH|BOOM)(300|500|1000)$/.test(sym);

const isForex = (sym: string) =>
  sym.startsWith('frx');

const isStepIndex = (sym: string) => sym === 'stpRNG';

// ─── Market-aware contract availability ────────────────────────────────────────
// Returns which contract categories are supported for this market
export function getAvailableCategories(sym: string): string[] {
  if (isForex(sym))          return ['rise_fall', 'touch', 'higher_lower'];
  if (isCrashBoom(sym))      return ['rise_fall'];
  if (isJumpIndex(sym))      return ['rise_fall', 'touch', 'higher_lower'];
  if (isVolatilityIndex(sym)) return ['rise_fall', 'digits', 'touch', 'higher_lower'];
  return ['rise_fall', 'digits', 'touch', 'higher_lower'];
}

// ─── Market-aware duration limits per contract ────────────────────────────────
export interface DurationLimits {
  allowedUnits: string[];         // e.g. ['t', 'm', 'h', 'd']
  tickOptions?: number[];         // allowed tick counts
  minuteOptions?: number[];       // allowed minute values
  hourOptions?: number[];         // allowed hour values
  dayOptions?: number[];          // allowed day values
}

export function getContractLimits(sym: string, contractId: string): DurationLimits {
  const isDigit = contractId.startsWith('DIGIT');
  const isTouch = contractId === 'ONETOUCH' || contractId === 'NOTOUCH';
  const isRiseFall = contractId === 'CALL' || contractId === 'PUT';
  const isHighLow = contractId === 'CALL_HIGHER' || contractId === 'PUT_LOWER' ||
                    contractId === 'HIGHER'       || contractId === 'LOWER';

  // Digit contracts: ONLY on Volatility 1t = ticks only
  if (isDigit) {
    return { allowedUnits: ['t'], tickOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
  }

  // Crash/Boom: Rise/Fall ONLY, 1 tick ONLY
  if (isCrashBoom(sym)) {
    if (isRiseFall) return { allowedUnits: ['t'], tickOptions: [1] };
    // No other contracts supported
    return { allowedUnits: ['t'], tickOptions: [1] };
  }

  // Forex: time-based ONLY (no ticks), min 1 minute
  if (isForex(sym)) {
    if (isTouch) return {
      allowedUnits: ['m', 'h', 'd'],
      minuteOptions: [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440],
      hourOptions:   [1, 2, 3, 4, 6, 8, 12, 24],
      dayOptions:    [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
    };
    return {
      allowedUnits: ['m', 'h', 'd'],
      minuteOptions: [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480, 1440],
      hourOptions:   [1, 2, 3, 4, 6, 8, 12, 24],
      dayOptions:    [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
    };
  }

  // Jump Indices: ticks + time, no digits
  if (isJumpIndex(sym)) {
    if (isTouch) return {
      allowedUnits: ['t', 'm', 'h', 'd'],
      tickOptions:   [5, 6, 7, 8, 9, 10],
      minuteOptions: [15, 30, 60, 120, 240, 480, 1440],
      hourOptions:   [1, 2, 3, 4, 6, 8, 12, 24],
      dayOptions:    [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
    };
    return {
      allowedUnits: ['t', 'm', 'h', 'd'],
      tickOptions:   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      minuteOptions: [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480, 1440],
      hourOptions:   [1, 2, 3, 4, 6, 8, 12, 24],
      dayOptions:    [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
    };
  }

  // Volatility Indices (default / most full-featured)
  if (isTouch) return {
    allowedUnits: ['t', 'm', 'h', 'd'],
    tickOptions:   [5, 6, 7, 8, 9, 10],
    minuteOptions: [15, 30, 60, 120, 240, 480, 1440],
    hourOptions:   [1, 2, 3, 4, 6, 8, 12, 24],
    dayOptions:    [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
  };

  // Rise/Fall + Higher/Lower on Volatility
  return {
    allowedUnits: ['t', 'm', 'h', 'd'],
    tickOptions:   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    minuteOptions: [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480, 1440],
    hourOptions:   [1, 2, 3, 4, 6, 8, 12, 24],
    dayOptions:    [1, 2, 3, 7, 14, 30, 60, 90, 180, 365],
  };
}

// Barrier presets (offsets from current price)
const BARRIER_PRESETS = ['-2.0', '-1.0', '-0.5', '-0.3', '-0.1', '+0.1', '+0.3', '+0.5', '+1.0', '+2.0'];

// ─── WebSocket helper ─────────────────────────────────────────────────────────

function useTradeSocket() {
  const unsubscribesRef = useRef<Map<any, () => void>>(new Map());

  const connect = useCallback((): Promise<any> => {
    tradeWS.connect();
    return Promise.resolve(tradeWS);
  }, []);

  const send = useCallback((payload: object) => {
    if (payload && 'authorize' in payload) return;
    tradeWS.send(payload);
  }, []);

  const addListener = useCallback((fn: (msg: any) => void) => {
    const unsub = tradeWS.onMessage(fn);
    unsubscribesRef.current.set(fn, unsub);
  }, []);

  const removeListener = useCallback((fn: (msg: any) => void) => {
    const unsub = unsubscribesRef.current.get(fn);
    if (unsub) {
      unsub();
      unsubscribesRef.current.delete(fn);
    }
  }, []);

  useEffect(() => {
    return () => {
      unsubscribesRef.current.forEach(unsub => unsub());
      unsubscribesRef.current.clear();
    };
  }, []);

  return { connect, send, addListener, removeListener };
}

// ─── Main Trade Form ──────────────────────────────────────────────────────────

export default function TradeForm({ symbol, displayName, token: tokenProp }: TradeFormProps) {
  const {
    token: storeToken,
    account,
    setManualContractType,
    setManualPrediction,
    manualPositions: positions,
    setManualPositions: setPositions,
    setSidebarView,
    clearLogs,
    manualDurationUnit: durationUnit,
    manualDurationValue: durationValue,
    setManualDurationUnit: setDurationUnit,
    setManualDurationValue: setDurationValue,
  } = useDerivStore();

  const token = tokenProp ?? storeToken;
  const [selectedCategory, setSelectedCategory] = useState(CONTRACT_CATEGORIES[0]);
  const [selectedContract, setSelectedContract] = useState(CONTRACT_CATEGORIES[0].contracts[0]);
  const [stake, setStake] = useState('1.00');
  const [prediction, setPrediction] = useState(5);
  const [barrier, setBarrier] = useState('+0.3');
  const [isLoading, setIsLoading] = useState(false);
  const [proposalData, setProposalData] = useState<{ payout: string; profit: string; percentage: string } | null>(null);
  const [lastProposalId, setLastProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalSubId, setProposalSubId] = useState<string | null>(null);
  const [durationOpen, setDurationOpen] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const socket = useTradeSocket();
  const proposalTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Derived duration object
  const duration = { value: durationValue, unit: durationUnit };

  // Load saved setup from localStorage on mount (hydration safe)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedStake = localStorage.getItem('lax_dtrader_stake');
      const savedBarrier = localStorage.getItem('lax_dtrader_barrier');
      const savedCatId = localStorage.getItem('lax_dtrader_category_id');
      const savedContractId = localStorage.getItem('lax_dtrader_contract_id');

      if (savedStake) setStake(savedStake);
      if (savedBarrier) setBarrier(savedBarrier);

      if (savedCatId) {
        const cat = CONTRACT_CATEGORIES.find(c => c.id === savedCatId);
        if (cat) {
          setSelectedCategory(cat);
          if (savedContractId) {
            const con = cat.contracts.find(c => c.id === savedContractId);
            if (con) setSelectedContract(con);
          }
        }
      }
    }
    setHasLoaded(true);
  }, []);

  // Save changes to localStorage only after load is complete
  useEffect(() => {
    if (hasLoaded) {
      localStorage.setItem('lax_dtrader_stake', stake);
    }
  }, [stake, hasLoaded]);

  useEffect(() => {
    if (hasLoaded) {
      localStorage.setItem('lax_dtrader_barrier', barrier);
    }
  }, [barrier, hasLoaded]);

  useEffect(() => {
    if (hasLoaded) {
      localStorage.setItem('lax_dtrader_category_id', selectedCategory.id);
    }
  }, [selectedCategory, hasLoaded]);

  useEffect(() => {
    if (hasLoaded) {
      localStorage.setItem('lax_dtrader_contract_id', selectedContract.id);
    }
  }, [selectedContract, hasLoaded]);
  // Helper for setting dynamic default barriers based on index price scale
  const getDefaultBarrierForSymbol = (sym: string): string => {
    if (['R_25', 'R_75', 'R_100', '1HZ25V', '1HZ75V', '1HZ100V'].includes(sym)) {
      return '+20.0';
    }
    return '+0.3';
  };

  // Dynamically update default barrier when market changes (after load is complete)
  useEffect(() => {
    if (hasLoaded) {
      setBarrier(getDefaultBarrierForSymbol(symbol));
    }
  }, [symbol, hasLoaded]);

  // Auto-reset trade category when market changes and current category is unsupported
  useEffect(() => {
    const available = getAvailableCategories(symbol);
    if (!available.includes(selectedCategory.id)) {
      const riseFall = CONTRACT_CATEGORIES.find(c => c.id === 'rise_fall') ?? CONTRACT_CATEGORIES[0];
      setSelectedCategory(riseFall);
      const first = riseFall.contracts[0];
      setSelectedContract(first);
      setManualContractType(first.shortCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // ─── Market-aware limits ───────────────────────────────────────────
  const marketLimits = getContractLimits(symbol, selectedContract.shortCode);
  const allowedUnits = marketLimits.allowedUnits;
  const availableCategories = getAvailableCategories(symbol);
  const isTouch = selectedCategory.id === 'touch';

  // Refs to prevent duplicate listeners & stale closures in WebSocket handlers
  const selectedContractRef = useRef(selectedContract);
  const durationRef = useRef(duration);
  const barrierRef = useRef(barrier);
  const predictionRef = useRef(prediction);
  const symbolRef = useRef(symbol);
  const stakeRef = useRef(stake);
  const accountRef = useRef(account);
  const tokenRef = useRef(token);

  useEffect(() => { selectedContractRef.current = selectedContract; }, [selectedContract]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { barrierRef.current = barrier; }, [barrier]);
  useEffect(() => { predictionRef.current = prediction; }, [prediction]);
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { stakeRef.current = stake; }, [stake]);
  useEffect(() => { accountRef.current = account; }, [account]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Hook up global quick trade handler for interactive digit frequency grids
  useEffect(() => {
    (window as any).__dtrader_quick_trade = async (data: { type: string; digit: number }) => {
      const activeToken = tokenRef.current;
      if (!activeToken) {
        console.warn('[DTrader TradeForm] Quick buy failed: No token / account not connected');
        return;
      }

      // Find the contract option matching data.type
      let foundContract: any = null;
      let foundCategory: any = null;
      for (const cat of CONTRACT_CATEGORIES) {
        const c = cat.contracts.find(item => item.shortCode === data.type);
        if (c) {
          foundContract = c;
          foundCategory = cat;
          break;
        }
      }

      if (!foundContract || !foundCategory) {
        console.warn(`[DTrader TradeForm] Quick buy failed: Contract type ${data.type} not found`);
        return;
      }

      // Update local state to match selection
      setSelectedCategory(foundCategory);
      setSelectedContract(foundContract);
      setManualContractType(data.type);
      setPrediction(data.digit);
      setManualPrediction(data.digit);
      setProposalData(null);
      setError(null);

      // Trigger socket buy call
      setIsLoading(true);
      setError(null);
      await socket.connect();
      setSidebarView('logs');

      const payload: any = {
        buy: 1,
        price: parseFloat(stakeRef.current) || 1,
        parameters: {
          amount: parseFloat(stakeRef.current) || 1,
          basis: 'stake',
          contract_type: data.type,
          currency: accountRef.current?.currency || 'USD',
          duration: durationRef.current.value,
          duration_unit: durationRef.current.unit,
          underlying_symbol: symbolRef.current,
        },
        subscribe: 1,
      };

      if (data.type === 'DIGITOVER' || data.type === 'DIGITUNDER' || foundContract.needsPrediction) {
        payload.parameters.barrier = String(data.digit);
      } else if (foundContract.needsBarrier) {
        payload.parameters.barrier = barrierRef.current;
      }

      console.log('[DTrader TradeForm] Quick Buy payload:', JSON.stringify(payload, null, 2));
      socket.send(payload);

      setTimeout(() => {
        socket.send({ proposal_open_contract: 1, subscribe: 1 });
      }, 500);
    };

    return () => {
      delete (window as any).__dtrader_quick_trade;
    };
  }, [socket, setManualContractType, setManualPrediction, setSidebarView]);

  // Duration options for current unit (market-aware)
  const getDurationOptions = (unit: string): number[] => {
    if (unit === 't') return marketLimits.tickOptions   ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (unit === 'm') return marketLimits.minuteOptions ?? [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480, 1440];
    if (unit === 'h') return marketLimits.hourOptions   ?? [1, 2, 3, 4, 6, 8, 12, 24];
    if (unit === 'd') return marketLimits.dayOptions    ?? [1, 2, 3, 7, 14, 30, 60, 90, 180, 365];
    return [1];
  };
  const durationOptions = getDurationOptions(durationUnit);

  // Snap duration to valid value when unit changes
  const snapDuration = (unit: string, current: number): number => {
    const opts = getDurationOptions(unit);
    if (opts.includes(current)) return current;
    // Find closest valid option >= current, or last option
    return opts.find(o => o >= current) ?? opts[opts.length - 1];
  };

  // Reset duration to a valid unit/value whenever contract or market changes
  useEffect(() => {
    const units = marketLimits.allowedUnits;

    if (!units.includes(durationUnit)) {
      const newUnit = units[0];
      const newOpts = getDurationOptions(newUnit);
      setDurationUnit(newUnit);
      setDurationValue(newOpts[0]);
    } else {
      // Snap duration value to a valid option
      const opts = getDurationOptions(durationUnit);
      if (!opts.includes(durationValue)) {
        setDurationValue(opts[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContract, symbol]);

  // Sync positions globally for TradeChart
  useEffect(() => {
    (window as any).laxPositions = positions;
    window.dispatchEvent(new CustomEvent('laxPositionsUpdated', { detail: positions }));
  }, [positions]);

  // Sync barrier globally for TradeChart
  useEffect(() => {
    (window as any).laxBarrier = barrier;
    window.dispatchEvent(new CustomEvent('laxBarrierUpdated', { detail: barrier }));
  }, [barrier]);

  // Fetch proposal with debounce
  const fetchProposal = useCallback(async () => {
    if (!token || !symbol) return;
    setError(null);

    await socket.connect();

    if (proposalSubId) socket.send({ forget: proposalSubId });

    const payload: any = {
      proposal: 1,
      amount: parseFloat(stake) || 1,
      basis: 'stake',
      contract_type: selectedContract.shortCode,
      currency: account?.currency || 'USD',
      duration: duration.value,
      duration_unit: duration.unit,
      underlying_symbol: symbol,
      subscribe: 1,
    };

    if (selectedContract.needsPrediction) {
      payload.barrier = String(prediction);
    } else if (selectedContract.shortCode === 'DIGITOVER' || selectedContract.shortCode === 'DIGITUNDER') {
      payload.barrier = String(prediction);
    } else if (selectedContract.needsBarrier) {
      payload.barrier = barrier;
    }

    console.log('[DTrader TradeForm] Requesting proposal with payload:', JSON.stringify(payload, null, 2));
    socket.send(payload);
  }, [token, symbol, stake, selectedContract, duration, prediction, barrier, account, proposalSubId]);

  useEffect(() => {
    if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current);
    proposalTimerRef.current = setTimeout(fetchProposal, 500);
    return () => { if (proposalTimerRef.current) clearTimeout(proposalTimerRef.current); };
  }, [fetchProposal]);

  // Listen for WebSocket messages (Exactly ONE listener registered on mount)
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.error) {
        if (msg.error.code === 'AlreadySubscribed') return;
        console.error('[DTrader TradeForm] WS Error Received:', JSON.stringify(msg.error, null, 2));
        setError(msg.error.message || msg.error.code || 'An error occurred');
        setIsLoading(false);
        return;
      }

      if (msg.msg_type === 'proposal' && msg.proposal) {
        setProposalSubId(msg.subscription?.id || null);
        setLastProposalId(msg.proposal.id);
        const { payout, ask_price } = msg.proposal;
        const payoutN = parseFloat(payout);
        const stakeN = parseFloat(ask_price);
        const profitN = payoutN - stakeN;
        setProposalData({
          payout: payoutN.toFixed(2),
          profit: profitN.toFixed(2),
          percentage: stakeN > 0 ? ((profitN / stakeN) * 100).toFixed(1) : '0',
        });
      }

      if (msg.msg_type === 'buy' && msg.buy) {
        console.log('[DTrader TradeForm] Buy successful:', msg.buy);
        const { contract_id, buy_price, entry_spot_display_value, date_start, expiry_time, shortcode } = msg.buy;
        
        // Parse actual contract type from shortcode if returned, otherwise use ref
        const actualType = shortcode ? shortcode.split('_')[0] : selectedContractRef.current.shortCode;

        setPositions(prev => {
          // Avoid duplicate entries for the same contract_id
          if (prev.some(p => p.contractId === contract_id)) return prev;

          return [...prev, {
            contractId: contract_id,
            type: actualType,
            buyPrice: parseFloat(buy_price),
            currentProfit: 0,
            entrySpot: entry_spot_display_value || '—',
            symbol: symbolRef.current,
            dateStart: date_start || Math.floor(Date.now() / 1000),
            expiryTime: expiry_time || null,
            durationValue: durationRef.current.value,
            durationUnit: durationRef.current.unit,
            barrier: selectedContractRef.current.needsBarrier ? barrierRef.current : null,
            prediction: selectedContractRef.current.needsPrediction ? predictionRef.current : null,
            tickCount: 0
          }];
        });
        setIsLoading(false);
      }

      if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
        const poc = msg.proposal_open_contract;
        if (!poc.contract_id) return;
        setPositions(prev => prev.map(p => {
          if (p.contractId !== poc.contract_id) return p;
          const profit = parseFloat(poc.profit || '0');
          const isSold = poc.is_sold === 1 || poc.status === 'sold';
          const absBarrier = poc.barrier ?? poc.high_barrier ?? p.barrier;
          const entrySpot = poc.entry_spot_display_value || (poc.entry_spot ? String(poc.entry_spot) : '') || p.entrySpot;
          const tickCount = poc.tick_count || 0;
          return {
            ...p,
            currentProfit: profit,
            isSold,
            sellPrice: poc.sell_price,
            barrier: absBarrier,
            entrySpot,
            type: poc.contract_type || p.type,
            tickCount
          };
        }));
      }
    };

    socket.addListener(handler);
    return () => socket.removeListener(handler);
  }, [socket]);

  const handleBuy = async () => {
    if (!token || isLoading) return;
    setIsLoading(true);
    setError(null);

    await socket.connect();
    setSidebarView('logs');

    const payload: any = {
      buy: 1,
      price: parseFloat(stake) || 1,
      parameters: {
        amount: parseFloat(stake) || 1,
        basis: 'stake',
        contract_type: selectedContract.shortCode,
        currency: account?.currency || 'USD',
        duration: duration.value,
        duration_unit: duration.unit,
        underlying_symbol: symbol,
      },
      subscribe: 1,
    };

    if (selectedContract.needsPrediction) {
      payload.parameters.barrier = String(prediction);
    } else if (selectedContract.shortCode === 'DIGITOVER' || selectedContract.shortCode === 'DIGITUNDER') {
      payload.parameters.barrier = String(prediction);
    } else if (selectedContract.needsBarrier) {
      payload.parameters.barrier = barrier;
    }

    console.log('[DTrader TradeForm] Sending buy request payload:', JSON.stringify(payload, null, 2));
    socket.send(payload);

    setTimeout(() => {
      socket.send({ proposal_open_contract: 1, subscribe: 1 });
    }, 500);
  };

  const handleSell = (contractId: number) => {
    socket.send({ sell: contractId, price: 0 });
  };

  const handleResetLog = () => {
    // Clear only settled (sold) positions, keep active ones
    setPositions(prev => prev.filter(p => !p.isSold));
    clearLogs?.();
  };

  const isRise = selectedContract.shortCode === 'CALL';
  const isDigit = selectedCategory.id === 'digits';

  const unitLabel: Record<string, string> = { t: 'Ticks', m: 'Minutes', h: 'Hours', d: 'Days' };

  return (
    <div className="flex flex-col h-full gap-3 overflow-y-auto pr-1 pb-16 trade-form-scroll">

      {/* Contract Category Selector — Collapsible Dropdown */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Trade Type</p>
          <button
            onClick={() => setCategoryDropdownOpen(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/3 border border-white/8 hover:border-teal-500/40 hover:bg-teal-500/8 transition-all"
          >
            <span className="text-teal-300 text-xs font-bold flex items-center gap-1.5">
              <span>{selectedCategory.icon}</span>
              <span>{selectedCategory.label}</span>
            </span>
            <span className="text-gray-600 text-[9px]">{categoryDropdownOpen ? '▲' : '▼'}</span>
          </button>
        </div>

        {categoryDropdownOpen && (
          <div className="border border-white/8 rounded-xl bg-black/40 p-2 grid grid-cols-2 gap-1.5 animate-[fadeIn_0.15s_ease] z-20 relative">
            {CONTRACT_CATEGORIES.map(cat => {
              const supported = availableCategories.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  disabled={!supported}
                  onClick={() => {
                    if (!supported) return;
                    setSelectedCategory(cat);
                    const first = cat.contracts[0];
                    setSelectedContract(first);
                    setManualContractType(first.shortCode);
                    setProposalData(null);
                    setError(null);
                    setCategoryDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-xs font-bold transition-all border ${
                    !supported
                      ? 'bg-white/2 border-white/4 text-gray-600 cursor-not-allowed opacity-50'
                      : selectedCategory.id === cat.id
                        ? 'bg-teal-500/15 border-teal-500/40 text-teal-400'
                        : 'bg-white/3 border-white/5 text-gray-400 hover:border-white/15 hover:text-gray-200'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                  </span>
                  {!supported && <span className="text-[9px] text-red-400/70 font-bold">N/A</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Contract Type */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Direction</p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(selectedCategory.contracts.length, 3)}, 1fr)` }}>
          {selectedCategory.contracts.map(contract => (
            <button
              key={contract.id}
              onClick={() => {
                setSelectedContract(contract);
                setManualContractType(contract.shortCode);
                setProposalData(null);
                setError(null);
              }}
              className={`px-2 py-2 rounded-lg text-xs font-bold transition-all border ${
                selectedContract.id === contract.id
                  ? 'bg-teal-500/15 border-teal-500/50 text-teal-300'
                  : 'bg-white/3 border-white/5 text-gray-400 hover:border-white/15'
              }`}
            >
              {contract.label}
            </button>
          ))}
        </div>
      </div>

      {/* Duration — collapsed by default, click to expand */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Duration</p>
          <button
            onClick={() => setDurationOpen(prev => !prev)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/3 border border-white/8 hover:border-teal-500/40 hover:bg-teal-500/8 transition-all"
          >
            <span className="text-teal-300 font-mono font-black text-[11px]">
              {durationValue}{durationUnit === 't' ? 'T' : durationUnit === 'm' ? 'M' : durationUnit === 'h' ? 'H' : 'D'}
            </span>
            <span className="text-gray-600 text-[9px]">{durationOpen ? '▲' : '▼'}</span>
          </button>
        </div>

        {durationOpen && (
          <div className="border border-white/8 rounded-xl bg-black/30 p-2 space-y-2 animate-[fadeIn_0.15s_ease]">
            {/* Unit tabs */}
            <div className="flex gap-1">
              {allowedUnits.map(u => (
                <button
                  key={u}
                  onClick={() => {
                    const snapped = snapDuration(u, durationValue);
                    setDurationUnit(u);
                    setDurationValue(snapped);
                    setProposalData(null);
                  }}
                  className={`flex-1 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all border ${
                    durationUnit === u
                      ? 'bg-teal-500/20 border-teal-500/40 text-teal-400'
                      : 'bg-white/3 border-white/5 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {u === 't' ? 'Ticks' : u === 'm' ? 'Mins' : u === 'h' ? 'Hrs' : 'Days'}
                </button>
              ))}
            </div>
            {/* Value pills */}
            <div className="flex gap-1 flex-wrap">
              {durationOptions.map(val => (
                <button
                  key={val}
                  onClick={() => { setDurationValue(val); setProposalData(null); setDurationOpen(false); }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all border ${
                    durationValue === val
                      ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                      : 'bg-white/3 border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/15'
                  }`}
                >
                  {val}{durationUnit === 't' ? 'T' : durationUnit === 'm' ? 'M' : durationUnit === 'h' ? 'H' : 'D'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Prediction (digits) */}
      {selectedContract.needsPrediction && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Last Digit Prediction</p>
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <button
                key={i}
                onClick={() => { setPrediction(i); setManualPrediction(i); setProposalData(null); }}
                className={`py-2 rounded-lg text-sm font-black transition-all border ${
                  prediction === i
                    ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                    : 'bg-white/3 border-white/5 text-gray-400 hover:border-white/15'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Barrier — digit picker for OVER/UNDER, presets + input for touch/high-low */}
      {selectedContract.needsBarrier && (
        <div>
          {(selectedContract.shortCode === 'DIGITOVER' || selectedContract.shortCode === 'DIGITUNDER') ? (
            <>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">
                {selectedContract.shortCode === 'DIGITOVER' ? 'Last digit is over' : 'Last digit is under'}
              </p>
              <div className="grid grid-cols-5 gap-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => { setPrediction(i); setManualPrediction(i); setProposalData(null); }}
                    className={`py-2 rounded-lg text-sm font-black transition-all border ${
                      prediction === i
                        ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                        : 'bg-white/3 border-white/5 text-gray-400 hover:border-white/15'
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Barrier (offset from spot)</p>
              {/* Barrier presets */}
              <div className="flex gap-1 flex-wrap mb-2">
                {BARRIER_PRESETS.map(b => (
                  <button
                    key={b}
                    onClick={() => { setBarrier(b); setProposalData(null); }}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${
                      barrier === b
                        ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                        : 'bg-white/3 border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/15'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={barrier}
                onChange={e => { setBarrier(e.target.value); setProposalData(null); }}
                placeholder="e.g. +0.5"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-teal-500/50"
              />
              <p className="text-[9px] text-gray-600 mt-1">Use +/- offset from current price, e.g. +0.5</p>
            </>
          )}
        </div>
      )}

      {/* Stake */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Stake</p>
        <div className="relative flex items-center">
          <span className="absolute left-3 text-gray-500 text-sm font-bold">
            {account?.currency || 'USD'}
          </span>
          <input
            type="number"
            value={stake}
            min="0.35"
            step="0.5"
            onChange={e => { setStake(e.target.value); setProposalData(null); }}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-12 pr-3 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-teal-500/50 focus:bg-white/8"
          />
        </div>
        <div className="flex gap-1.5 mt-1.5">
          {['0.50', '1', '5', '10', '50'].map(v => (
            <button
              key={v}
              onClick={() => { setStake(v); setProposalData(null); }}
              className="flex-1 text-[10px] text-gray-500 hover:text-teal-400 border border-white/5 hover:border-teal-500/30 rounded py-1 transition-all font-bold"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Proposal info */}
      {proposalData && (
        <div className="bg-white/3 rounded-xl border border-white/8 p-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Payout</span>
            <span className="text-white font-mono font-bold">{account?.currency || 'USD'} {proposalData.payout}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Profit</span>
            <span className="text-teal-400 font-mono font-bold">+{proposalData.profit} ({proposalData.percentage}%)</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          <p className="text-rose-400 text-xs">{error}</p>
        </div>
      )}

      {/* Buy Button + Reset Log row */}
      <div className="flex gap-2 items-stretch">
        <button
          onClick={handleBuy}
          disabled={isLoading || !token}
          className={`flex-1 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all relative overflow-hidden ${
            !token
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : isLoading
              ? 'bg-teal-600/50 text-teal-300 cursor-wait'
              : isRise
              ? 'bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40'
              : 'bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white shadow-lg shadow-rose-500/20 hover:shadow-rose-500/40'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Placing Trade...
            </span>
          ) : !token ? (
            'Connect Account First'
          ) : (
            <span>{selectedContract.label} — {account?.currency || 'USD'} {stake}</span>
          )}
        </button>
        {/* Reset Log — small icon button beside Buy */}
        <button
          onClick={handleResetLog}
          title="Reset Trade Log"
          className="w-11 rounded-xl font-bold text-base text-gray-600 border border-white/5 hover:border-rose-500/30 hover:text-rose-400 hover:bg-rose-500/8 transition-all flex items-center justify-center flex-shrink-0"
        >
          🗑
        </button>
      </div>

    </div>
  );
}
