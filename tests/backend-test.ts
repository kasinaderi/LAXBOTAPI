import WebSocket from 'ws';

const ws = new WebSocket('ws://34.121.88.15:8080/ui');

ws.on('open', () => {
    console.log("Connected to Google Cloud Backend!");

    // Simulate what the bot sends on connect
    ws.send(JSON.stringify({
        type: 'authorize',
        token: process.env.NEXT_PUBLIC_DERIV_TOKEN || 'test_token'
    }));

    setTimeout(() => {
        const payload = {
            type: 'trade',
            payload: {
                requestId: 'loc_123',
                req_id: 'loc_123',
                symbol: 'R_100',
                contract_type: 'DIGITOVER',
                stake: 0.35,
                duration: 1,
                duration_unit: 't',
                barrier: '4',
                prediction: 4,
                currency: 'USD'
            }
        };
        console.log("Sending Trade:", payload);
        ws.send(JSON.stringify(payload));
    }, 2000);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log("RECEIVED:", msg);
});

ws.on('error', (err) => {
    console.error("WS ERROR:", err);
});

ws.on('close', () => {
    console.log("Connection closed.");
});

setTimeout(() => {
    ws.close();
    process.exit(0);
}, 6000);
