export interface DerivConfig {
    appId: string;
    websocketUrl: string;
}

export interface TickData {
    epoch: number;
    quote: number;
    symbol: string;
    pip_size: number;
}

export interface AccountInfo {
    balance: number;
    currency: string;
    loginid: string;
    token?: string;
    is_virtual?: boolean;
    email?: string;
}

export interface ContractPurchase {
    buy_price: number;
    contract_id: number;
    longcode: string;
    payout: number;
    purchase_time: number;
    start_time: number;
    transaction_id: number;
}

export interface ContractResult {
    contract_id: number;
    profit: number;
    status: 'won' | 'lost';
    sell_price: number;
    buy_price: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DerivMessage {
    msg_type: string;
    [key: string]: any;
}
