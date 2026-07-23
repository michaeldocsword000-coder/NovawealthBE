const http = require('http');

function loginAndFetch() {
  const data = JSON.stringify({ email: 'admin@blueinvest.com', password: 'Admin@123456' });
  const opts = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  };

  const req = http.request(opts, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => {
      const body = JSON.parse(b);
      console.log('login', body);
      const token = body.token;
      const opts2 = {
        hostname: 'localhost',
        port: 5000,
        path: '/api/admin/plans',
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      };
      const req2 = http.request(opts2, (res2) => {
        let bb = '';
        res2.on('data', (c) => (bb += c));
        res2.on('end', () => console.log('plans', bb));
      });
      req2.on('error', console.error);
      req2.end();
    });
  });
  req.on('error', console.error);
  req.write(data);
  req.end();
}

loginAndFetch();
