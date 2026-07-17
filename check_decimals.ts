import WebSocket from 'ws';

const APP_ID = 1089; // Public default or use env
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

const symbols = ['1HZ15V', '1HZ30V', '1HZ90V'];
const socket = new WebSocket(WS_URL);

socket.on('open', () => {
    console.log('Connected.');
    symbols.forEach(s => {
        socket.send(JSON.stringify({ ticks: s }));
    });
});

socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.tick) {
        const { symbol, quote } = msg.tick;
        const parts = quote.toString().split('.');
        const decimals = parts.length > 1 ? parts[1].length : 0;
        console.log(`Symbol: ${symbol}, Quote: ${quote}, Decimals: ${decimals}`);

        // Remove from list
        const idx = symbols.indexOf(symbol);
        if (idx > -1) {
            symbols.splice(idx, 1);
        }

        if (symbols.length === 0) {
            console.log('All done.');
            process.exit(0);
        }
    }
});
