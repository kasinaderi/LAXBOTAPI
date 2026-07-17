import WebSocket from 'ws';

const RELAY_URL = 'ws://localhost:8081';

const socket = new WebSocket(RELAY_URL);

console.log('Connecting to Relay...');

socket.on('open', () => {
    console.log('Connected to Relay.');
});

socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'tick') {
        const { symbol, quote } = msg;
        if (['1HZ15V', '1HZ30V', '1HZ90V'].includes(symbol)) {
            console.log(`RECEIVED: ${symbol} @ ${quote}`);
        }
    } else if (msg.type === 'snapshot') {
        console.log('Snapshot received. checking keys...');
        const keys = Object.keys(msg.data);
        console.log('Snapshot keys:', keys);
        const missing = ['1HZ15V', '1HZ30V', '1HZ90V'].filter(k => !keys.includes(k));
        if (missing.length) console.log('MISSING in snapshot:', missing);
        else console.log('All new markets present in snapshot.');
    }
});
