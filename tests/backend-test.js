const WebSocket = require('ws');
const fs = require('fs');

const ws = new WebSocket('wss://compliance-toddler-geek-pix.trycloudflare.com/ui');
const logs = [];

ws.on('open', () => {
    logs.push("Connected!");
    ws.send(JSON.stringify({
        type: 'authorize',
        token: process.env.NEXT_PUBLIC_DERIV_TOKEN || 'test_token' // Make sure there is a real token in terminal
    }));

    setTimeout(() => {
        const payload = {
            type: 'trade',
            payload: {
                requestId: 'loc_123',
                req_id: 'loc_123',
                symbol: 'R_100',
                contract_type: 'DIGITDIFF',
                stake: 0.35,
                duration: 1,
                duration_unit: 't',
                barrier: '4',
                currency: 'USD'
            }
        };
        logs.push({ tx: payload });
        ws.send(JSON.stringify(payload));
    }, 2000);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type !== 'tick' && msg.msg_type !== 'tick' && msg.type !== 'stats' && msg.type !== 'pong') {
        logs.push({ rx: msg });
    }
});

setTimeout(() => {
    fs.writeFileSync('C:\\dev\\Masterbot\\tests\\output.json', JSON.stringify(logs, null, 2));
    process.exit(0);
}, 10000);
