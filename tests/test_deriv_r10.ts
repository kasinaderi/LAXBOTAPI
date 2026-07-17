import WebSocket from 'ws';

const APP_ID = '123448';
const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log('Connected to Deriv');
    console.log('Subscribing to R_10...');
    ws.send(JSON.stringify({ ticks: 'R_10', subscribe: 1 }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.msg_type === 'tick') {
        console.log('Tick received for R_10:', msg.tick.quote);
        ws.close();
        process.exit(0);
    } else if (msg.error) {
        console.error('Error:', msg.error);
        ws.close();
        process.exit(1);
    }
});
