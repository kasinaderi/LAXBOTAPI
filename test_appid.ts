import WebSocket from 'ws';

// Test the user's App ID specifically
const APP_ID = 123448;
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

const socket = new WebSocket(WS_URL);

const SYMBOLS = ['1HZ15V', '1HZ30V', '1HZ90V'];

console.log(`Testing App ID ${APP_ID}...`);

socket.on('open', () => {
    console.log('Connected to Deriv.');
    SYMBOLS.forEach(s => {
        socket.send(JSON.stringify({ ticks: s }));
    });
});

socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.error) {
        console.error(`[ERROR] ${msg.error.code}: ${msg.error.message}`);
    }
    if (msg.tick) {
        console.log(`[SUCCESS] ${msg.tick.symbol} received.`);
        process.exit(0);
    }
});
