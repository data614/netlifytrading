import handleTiingoRequest from './netlify/functions/tiingo.js';

const req = new Request('http://localhost/api/tiingo?symbol=AAPL&kind=eod');
const resp = await handleTiingoRequest(req);
console.log('status', resp.status);
const headers = {}; resp.headers.forEach((v,k)=> headers[k]=v);
console.log('headers', headers);
const text = await resp.text();
console.log('body', text.slice(0,200)+'...');