const http = require('http');
const options = { hostname: 'localhost', port: 3000, path: '/api/user/test-player', method: 'GET' };
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (c) => body += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(body);
      const out = {
        pointsPerSecond: j.pointsPerSecond,
        upgradeCounts: j.upgradeCounts,
        competitorCounts: j.competitorCounts,
        stocks: j.stocks,
        stockAvgPrices: j.stockAvgPrices
      };
      console.log(JSON.stringify(out, null, 2));
    } catch (e) { console.error('PARSE ERR', e, body); }
  });
});
req.on('error', e => console.error('REQ ERR', e));
req.end();
