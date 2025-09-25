import searchHandler from './netlify/functions/search.js';

const req = new Request('http://localhost/.netlify/functions/search?q=wow&exchange=XASX&limit=5');
const resp = await searchHandler(req);
console.log('status', resp.status);
console.log(await resp.text());
