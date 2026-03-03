const http = require('http');
const options = { hostname: 'localhost', port: 3000, path: '/api/user/test-player', method: 'GET' };
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (c) => body += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(body);
      const out = {
        points: j.points,
        pointsPerSecond: j.pointsPerSecond,
        lastLogin: j.lastLogin,
        lastExpenseTime: j.lastExpenseTime,
        nextUpkeepMs: j.nextUpkeepMs,
        totalUpkeepPaid: j.totalUpkeepPaid,
        totalWealthTaxPaid: j.totalWealthTaxPaid,
        totalLandTaxPaid: j.totalLandTaxPaid,
        totalInterestEarned: j.totalInterestEarned
      };
      console.log(JSON.stringify(out, null, 2));
    } catch (e) { console.error('PARSE ERR', e, body); }
  });
});
req.on('error', e => console.error('REQ ERR', e));
req.end();
