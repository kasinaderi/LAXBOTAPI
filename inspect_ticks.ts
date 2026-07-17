import WebSocket from 'ws';

const APP_ID = 1089;
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

const socket = new WebSocket(WS_URL);

// New Markets to test
const SYMBOLS = ['1HZ15V', '1HZ30V', '1HZ90V'];

socket.on('open', () => {
    console.log('Connected to Deriv.');
    SYMBOLS.forEach(s => {
        socket.send(JSON.stringify({ ticks: s }));
    });
});

socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.tick) {
        console.log(`[TICK ${msg.tick.symbol}] PipSize: ${msg.tick.pip_size}, Quote: ${msg.tick.quote} (Type: ${typeof msg.tick.quote})`);

        // Terminate after getting one of each
        const idx = SYMBOLS.indexOf(msg.tick.symbol);
        if (idx > -1) {
            SYMBOLS.splice(idx, 1);
        }
        if (SYMBOLS.length === 0) {
            process.exit(0);
        }
    }
});
