const http = require('http');
const data = JSON.stringify({ discordId: 'test-player', symbol: 'BTC', action: 'buy', quantity: 1 });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/stock/trade',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('BODY', body);
  });
});
req.on('error', (e) => console.error('REQUEST ERROR', e));
req.write(data);
req.end();
