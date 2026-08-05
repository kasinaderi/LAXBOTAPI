import WebSocket from 'ws';

const APP_ID = '33BxSv2MzUXBDltrSkyrZ';
const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${APP_ID}`;

const socket = new WebSocket(WS_URL, {
    headers: {
        Origin: 'http://localhost:3000'
    }
});

socket.on('open', () => {
    console.log('Connected to Deriv.');
    socket.send(JSON.stringify({ ticks: '1HZ10V', subscribe: 1 }));
    socket.send(JSON.stringify({ ticks: '1HZ25V', subscribe: 1 }));
});

socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('RECEIVED:', JSON.stringify(msg, null, 2));
    if (msg.error) {
        console.error('ERROR:', msg.error);
    }
});

socket.on('error', (err) => {
    console.error('SOCKET ERROR:', err);
});

// Exit after 5 seconds to gather ticks
setTimeout(() => {
    console.log('Exiting...');
    process.exit(0), 5000;
}, 5000);
