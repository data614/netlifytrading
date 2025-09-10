# Intelfin-Style Trading Desk Demo

This README contains the **full working HTML demo** of the Intelfin-style dashboard.  
You can open it directly in a browser, or copy parts into your project.

---

## Full HTML Code

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Intelfin Trading Desk — Marketstack Integrated</title>

  <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">

  <style>
    :root {
      --background-primary: #121721;
      --background-secondary: #1f2533;
      --background-tertiary: #2a3142;
      --text-primary: #e1e3e6;
      --text-secondary: #9a9ea4;
      --accent-blue: #3498db;
      --accent-green: #2ecc71;
      --accent-red: #e74c3c;
      --border-color: #3b4355;
    }
    * { box-sizing: border-box }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      margin: 0;
      background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
      color: var(--text-primary);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .main-container { display: flex; flex-grow: 1; }
    .main-content { flex: 3; padding: 20px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; }
    .sidebar { flex: 1; background-color: rgba(31,37,51,.95); padding: 20px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; border-left: 1px solid var(--border-color); backdrop-filter: blur(4px); }

    .card { background-color: rgba(31,37,51,.92); border-radius: 10px; padding: 16px; border: 1px solid var(--border-color); }
    .card-header { display:flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color); }
    .card-header h3 { margin: 0; font-size: 1.05em; color: var(--text-primary); }
    .chip { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); color: var(--text-secondary); padding: 6px 10px; border-radius: 999px; font-size: 12px; }

    .stock-header h1 { margin: 0; font-size: 2.2em; display: flex; align-items: center; gap: 8px; }
    .stock-header h1 small { font-size: 0.5em; color: var(--text-secondary); }
    .stock-price { font-size: 2.2em; font-weight: 800; }
    .stock-change { font-size: 1.05em; margin-left: 12px; }
    .positive-change { color: var(--accent-green); }
    .negative-change { color: var(--accent-red); }

    #stockChart { max-height: 420px; }

    .stock-stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .stat-item { background-color: var(--background-tertiary); padding: 12px; border-radius: 8px; }
    .stat-item-label { font-size: .8em; color: var(--text-secondary); margin-bottom: 4px; }
    .stat-item-value { font-size: 1.05em; font-weight: 600; }

    .search-container input, .profile-form input {
      width: 100%; padding: 10px; background-color: var(--background-tertiary);
      border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px;
    }
    #searchResults { margin-top: 10px; }
    .search-result-item { display:flex; justify-content: space-between; align-items: center; padding: 8px; border-radius: 6px; background: rgba(255,255,255,.03); margin-bottom: 6px; }
    .search-result-item button { background-color: var(--accent-blue); color: #fff; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }

    .watchlist-item { display:flex; justify-content: space-between; align-items:center; padding: 10px 6px; border-bottom: 1px solid var(--border-color); cursor:pointer; }
    .watchlist-item:hover { background: rgba(255,255,255,.03); }
    .watchlist-symbol { font-weight: 700; }
    .watchlist-remove { color: var(--accent-red); font-weight: 700; cursor:pointer; padding: 6px; }

    .news-sources { display:flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .news-sources button { background-color: var(--background-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 999px; cursor:pointer; }
    .news-sources button.active, .news-sources button:hover { background-color: var(--accent-blue); color:#fff; border-color: var(--accent-blue); }

    .news-item { padding: 10px 0; border-bottom: 1px solid var(--border-color); }
    .news-item:last-child { border-bottom: none; }
    .news-item a { color: var(--text-primary); text-decoration: none; font-weight: 500; }
    .news-item a:hover { color: var(--accent-blue); }
    .news-item small { color: var(--text-secondary); display:block; margin-top: 4px; }

    .tf { display:flex; gap: 6px; flex-wrap: wrap; }
    .tf button { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); color: #fff; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
    .tf button.active { background: rgba(52,152,219,.25); border-color: var(--accent-blue); }

    .exchange-filter { display:flex; gap: 6px; flex-wrap: wrap; }
    .exchange-filter button { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); color:#fff; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    .exchange-filter button.active { background: rgba(46,204,113,.2); border-color: var(--accent-green); }

    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; word-break: break-all; }
    .muted { color: var(--text-secondary); }
    #loading { display:none; position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 1000; align-items: center; justify-content: center; font-size: 18px; }
    #error   { display:none; background: rgba(231,76,60,.15); color: #ffc2bb; border: 1px solid rgba(231,76,60,.4); padding: 10px 12px; border-radius: 10px; margin-bottom: 10px; }
  </style>
</head>
<body>
<div id="loading"><i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Loading…</div>

<div class="main-container">
  <main class="main-content">
    <div id="error"></div>
    <div class="stock-header">
      <h1>
        <span id="stockName">Apple Inc.</span>
        (<span id="stockSymbol">AAPL</span>)
        <small id="exchangeAcronym"></small>
      </h1>
      <div>
        <span id="stockPrice" class="stock-price">$—</span>
        <span id="stockChange" class="stock-change">—</span>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Price Chart</h3>
        <div class="tf" id="tfControls">
          <button class="active" data-tf="1D">1D</button>
          <button data-tf="1W">1W</button>
          <button data-tf="1M">1M</button>
          <button data-tf="3M">3M</button>
          <button data-tf="6M">6M</button>
          <button data-tf="1Y">1Y</button>
        </div>
      </div>
      <canvas id="stockChart"></canvas>
    </div>

    <div class="card">
      <div class="card-header"><h3>Key Statistics</h3></div>
      <div class="stock-stats">
        <div class="stat-item">
          <div class="stat-item-label">Open</div>
          <div id="statOpen" class="stat-item-value">—</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">High</div>
          <div id="statHigh" class="stat-item-value">—</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Low</div>
          <div id="statLow" class="stat-item-value">—</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">Volume</div>
          <div id="statVolume" class="stat-item-value">—</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">52W High</div>
          <div id="stat52wHigh" class="stat-item-value">—</div>
        </div>
        <div class="stat-item">
          <div class="stat-item-label">52W Low</div>
          <div id="stat52wLow" class="stat-item-value">—</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Market Movers (Watchlist universe)</h3>
        <span class="chip mono" id="apiKeyEcho">API: —</span>
      </div>
      <table class="data-table" id="marketMoversTable">
        <thead>
          <tr><th>Symbol</th><th>Exchange</th><th>Price</th><th>Δ%</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </main>

  <aside class="sidebar">
    <div class="card">
      <div class="card-header">
        <h3>Watchlist</h3>
        <div class="exchange-filter" id="exchangeFilters">
          <button data-exchange="" class="active">All</button>
          <button data-exchange="XNAS">NASDAQ</button>
          <button data-exchange="XNYS">NYSE</button>
          <button data-exchange="XASE">AMEX</button>
          <button data-exchange="XTSE">Toronto</button>
          <button data-exchange="XLON">LSE</button>
          <button data-exchange="XETR">XETRA</button>
          <button data-exchange="XTKS">Tokyo</button>
          <button data-exchange="XHKG">HKEX</button>
          <button data-exchange="XASX">ASX</button>
        </div>
      </div>
      <div class="search-container">
        <input type="text" id="stockSearchInput" placeholder="Search ticker, company, or ASX:WOW, WOW.AX…">
        <div id="searchResults"></div>
      </div>
      <div id="watchlist" class="watchlist-container"></div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Financial News</h3></div>
      <div class="news-sources" id="newsApiButtons">
        <button class="active" data-source="All">All</button>
        <button data-source="Bloomberg">Bloomberg</button>
        <button data-source="Reuters">Reuters</button>
        <button data-source="Yahoo">Yahoo Finance</button>
      </div>
      <div id="news-feed"></div>
      <div class="muted" style="margin-top:8px">Pluggable: swap in your real news API when ready.</div>
    </div>

    <div class="card">
      <div class="card-header"><h3>My Profile</h3></div>
      <form id="profileForm" class="profile-form">
        <div class="form-group">
          <label for="userName" class="muted">Name</label>
          <input type="text" id="userName" placeholder="Your Name">
        </div>
        <div class="form-group">
          <label for="userEmail" class="muted">Email</label>
          <input type="email" id="userEmail" placeholder="your.email@example.com">
        </div>
        <button type="submit" style="background: var(--accent-green); color:#fff; border:none; padding: 10px 14px; border-radius: 8px; cursor:pointer;">Save Details</button>
        <div id="saveConfirmation" style="color: var(--accent-green); margin-top: 8px; font-size: .9em;"></div>
      </form>
      <ul class="contact-info" style="list-style:none; padding:0; margin-top: 14px;">
        <li class="muted"><strong style="color:#fff">Support:</strong> <a href="mailto:info@Intelfin.com" style="color: var(--accent-blue)">info@Intelfin.com</a></li>
        <li class="muted"><strong style="color:#fff">Phone:</strong> +61 0425 124 339</li>
      </ul>
    </div>
  </aside>
</div>

<script>
// ===== Config =====
// FIXED: Removed a trailing newline character from the key string. This was causing all API requests to fail.
const DEFAULT_KEY = 'YOUR_MARKETSTACK_API_KEY';  // override with ?ms_key= or localStorage
const qsKey = new URLSearchParams(location.search).get('ms_key');
const API_KEY = qsKey || localStorage.getItem('ms_key') || DEFAULT_KEY;
const BASE = 'https://api.marketstack.com/v1';
document.getElementById('apiKeyEcho').textContent = 'API: ' + API_KEY.replace(/.(?=.{4})/g, '•');

// ===== Utils =====
const $ = (id) => document.getElementById(id);
function showLoading(b){ $('loading').style.display = b? 'flex':'none'; }
function showError(msg){ const e=$('error'); e.textContent = msg; e.style.display='block'; setTimeout(()=>e.style.display='none', 6000); }
function fmt(n){ return (n==null? '—' : '$'+Number(n).toFixed(2)); }
function fmtVol(v){ const n=Number(v||0); if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(2)+'M'; if(n>=1e3) return (n/1e3).toFixed(2)+'K'; return String(n); }
function sma(arr, p){ const out=[]; for(let i=0;i<arr.length;i++){ if(i<p-1){ out.push(null); continue; } let s=0; for(let j=i-p+1;j<=i;j++) s+=arr[j]; out.push(s/p);} return out; }
function cleanXY(labels, values){ const L=[], V=[]; for(let i=0;i<values.length;i++){ const v=Number(values[i]); if(Number.isFinite(v)){ L.push(labels[i]); V.push(v);} } return {labels:L, values:V}; }
function intradayInterval(tf){ if(tf==='1D')return'5min'; if(tf==='1W')return'30min'; if(tf==='1M')return'1hour'; return null; }
function calcBounds(values, smaValues){ const all=[...values, ...smaValues].filter(v=>v!==null && Number.isFinite(v)); if(!all.length) return {min:0, max:100}; let min=Math.min(...all), max=Math.max(...all); if(min===max){ min = min - min*0.05; max = max + max*0.05; } else { const pad=(max-min)*0.05; min-=pad; max+=pad; } return {min,max}; }

// ===== Exchange aliases & parsing (supports ASX:WOW, WOW.AX, etc.) =====
const EXCHANGE_ALIASES = {
  XASX: ['.AX', '.ASX', '.AU'],
  XNYS: ['.N'],
  XNAS: ['.O'],
  XTSE: ['.TO'],
  XLON: ['.L'],
  XETR: ['.DE'],
  XHKG: ['.HK'],
  XTKS: ['.T'],
  XBOM: ['.BO'],
  XNSE: ['.NS'],
  XSWX: ['.SW'],
  XJSE: ['.J'],
  XSGO: ['.SN']
};

function parseUserQuery(q){
  q = (q||'').trim();
  if(!q) return { raw:q };
  const colon = q.match(/^([A-Za-z]{2,5})\s*:\s*([A-Za-z0-9.\-]+)$/);
  if(colon){
    const ex = colon[1].toUpperCase();
    const sym = colon[2].toUpperCase();
    const MIC = ex === 'ASX' ? 'XASX'
             : ex === 'LSE' ? 'XLON'
             : ex === 'HKEX' ? 'XHKG'
             : ex === 'TSE' ? 'XTSE'
             : ex === 'TSEJP' ? 'XTKS'
             : ex === 'NYSE' ? 'XNYS'
             : ex === 'NASDAQ' ? 'XNAS'
             : ex.startsWith('X') ? ex : ex;
    return { raw:q, symbol:sym, mic:MIC };
  }
  const dot = q.match(/^([A-Za-z0-9\-]+)\.([A-Za-z]{1,4})$/);
  if(dot){
    const sym = dot[1].toUpperCase();
    const suff = dot[2].toUpperCase();
    const mic = (suff==='AX'||suff==='ASX'||suff==='AU') ? 'XASX'
             : (suff==='L'||suff==='LSE') ? 'XLON'
             : (suff==='DE') ? 'XETR'
             : (suff==='HK') ? 'XHKG'
             : (suff==='TO') ? 'XTSE'
             : (suff==='T') ? 'XTKS'
             : (suff==='NS') ? 'XNSE'
             : (suff==='BO') ? 'XBOM'
             : (suff==='SW') ? 'XSWX'
             : '';
    return { raw:q, symbol:sym, mic:mic };
  }
  return { raw:q };
}

// ===== API Wrapper (friendly messages) =====
async function ms(endpoint, params={}){
  showLoading(true);
  try{
    const res = await axios.get(`${BASE}/${endpoint}`, { params: { access_key: API_KEY, ...params }});
    showLoading(false);
    if(res.data?.error){
      const msg = res.data.error.message || 'Unknown API error';
      const code = res.data.error.code || res.status || 0;
      throw new Error(`${code} ${msg}`);
    }
    return res.data;
  } catch(err){
    showLoading(false);
    const status = err?.response?.status || '';
    const apiMsg = err?.response?.data?.error?.message || err.message;
    let friendly = apiMsg;
    if(String(status)==='401') friendly = '401 – Unauthorized. Check API key/plan. Intraday endpoints require a paid plan; falling back to EOD.';
    if(String(status)==='404') friendly = '404 – Ticker not available or endpoint not found.';
    showError(`Request failed (${endpoint}) – ${friendly}`);
    const e = new Error(friendly); e.status=status; throw e;
  }
}

// Try to resolve the best symbol to query, given a user input and optional selected exchange
async function resolveSymbol(q, selectedMic){
  const parsed = parseUserQuery(q);
  const wantSymbol = parsed.symbol;
  const wantMic = parsed.mic || selectedMic || '';

  function score(it){
    let s = 0;
    const sym = (it.symbol||'').toUpperCase();
    const name = (it.name||'').toUpperCase();
    const mic = it.stock_exchange?.mic || '';
    if(wantSymbol && sym === wantSymbol) s += 5;
    if(wantSymbol && sym.startsWith(wantSymbol)) s += 2;
    if(parsed.raw && (name.includes(parsed.raw.toUpperCase()))) s += 3;
    if(wantMic && mic === wantMic) s += 3;
    return s;
  }

  let res1;
  try {
    const params = { search: parsed.raw || wantSymbol || q, limit: 25, ...(wantMic ? { exchanges: wantMic } : {}) };
    res1 = await ms('tickers', params);
  } catch(e){ res1 = { data: [] }; }
  let pool = res1.data || [];

  const variants = [];
  const base = (wantSymbol || q).toUpperCase();
  const aliases = wantMic ? (EXCHANGE_ALIASES[wantMic] || []) : [];
  aliases.forEach(suff => variants.push(base + suff));

  for(const v of variants.slice(0,3)){
    try {
      const extra = await ms('tickers', { search: v, limit: 10, ...(wantMic ? { exchanges: wantMic } : {}) });
      pool = pool.concat(extra.data||[]);
    } catch(_){}
  }

  if(!pool.length){
    const candidates = [];
    const base = (wantSymbol || q).toUpperCase();
    if (wantMic) {
      candidates.push({ symbols: base, exchanges: wantMic });
      candidates.push({ symbols: `${wantMic}:${base}` });
      candidates.push({ symbols: `${base}.${wantMic}` });
    }
    candidates.push({ symbols: `${base}.AX` });
    try {
      for (const c of candidates) {
        try {
          const test = await ms('eod', Object.assign({ limit: 1 }, c));
          if (test?.data?.length) {
            pool.push({
              symbol: c.symbols || base,
              name: q,
              stock_exchange: { mic: wantMic || '', acronym: wantMic || '' }
            });
            break;
          }
        } catch(_){}
      }
    } catch(_){}
  }

  if(!pool.length) return null;
  pool.sort((a,b)=> score(b)-score(a));
  const top = pool[0];
  return {
    symbol: top.symbol,
    name: top.name,
    mic: top.stock_exchange?.mic || '',
    exchange: top.stock_exchange?.acronym || ''
  };
}

// ===== State =====
let currentSymbol = '';
let currentExchange = '';
let priceChart;
let selectedExchange = '';
let watchlist = JSON.parse(localStorage.getItem('stockWatchlistV2') || '[]'); // [{symbol, exchange, name}]

// ===== Core loaders =====
async function loadSymbol(symOrQuery, exchange='', knownName=''){
  $('error').style.display='none';
  currentSymbol = (symOrQuery||'').toUpperCase();
  currentExchange = exchange;

  $('stockSymbol').textContent = currentSymbol;
  $('stockName').textContent = knownName || '—';
  $('exchangeAcronym').textContent = exchange ? `(${exchange})` : '';

  try {
    const best = await resolveSymbol(symOrQuery || currentSymbol, exchange || selectedExchange);
    if(best){
      currentSymbol = best.symbol.toUpperCase();
      currentExchange = best.mic || '';
      $('stockSymbol').textContent = currentSymbol;
      $('exchangeAcronym').textContent = best.exchange ? `(${best.exchange})` : '';
      $('stockName').textContent = best.name || $('stockName').textContent || '—';
    } else {
      showError('Ticker not available on Marketstack: ' + currentSymbol);
      return;
    }
  } catch(e){ console.warn('resolver failed', e); }

  await loadQuote();
  await loadTimeframe('1D');
  await load52w();
}

async function loadQuote(){
  try {
    let q=null;
    try{ q = (await ms('intraday/latest',{symbols:currentSymbol, exchanges:currentExchange}))?.data?.[0]||null; } catch(_){}
    if(!q){ q = (await ms('eod/latest',{symbols:currentSymbol, exchanges:currentExchange}))?.data?.[0]||null; }
    if(!q){ showError('No recent quote data'); return; }

    const price = q.close ?? q.last ?? q.price;
    const open  = q.open ?? price;
    const high  = q.high;
    const low   = q.low;
    const vol   = q.volume;

    $('stockPrice').textContent = fmt(price);
    const deltaAbs = (price - open);
    const deltaPct = open ? (deltaAbs/open*100) : 0;
    const changeEl = $('stockChange');
    const isPos = deltaAbs >= 0;
    changeEl.textContent = `${isPos?'+':''}${deltaAbs.toFixed(2)} (${isPos?'+':''}${deltaPct.toFixed(2)}%)`;
    changeEl.className = `stock-change ${isPos? 'positive-change':'negative-change'}`;

    $('statOpen').textContent = fmt(open);
    $('statHigh').textContent = fmt(high);
    $('statLow').textContent  = fmt(low);
    $('statVolume').textContent = fmtVol(vol);
  } catch(e){ console.error(e); }
}

async function loadTimeframe(tf){
  document.querySelectorAll('#tfControls button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`#tfControls button[data-tf="${tf}"]`);
  if(btn) btn.classList.add('active');

  try {
    const intr = intradayInterval(tf);
    let endpoint = intr? 'intraday':'eod';
    let params = { symbols: currentSymbol, exchanges: currentExchange };
    if(intr){ params.interval = intr; params.limit = (tf==='1D'?150 : tf==='1W'?300 : 500); }
    else { params.limit = (tf==='3M'?70 : tf==='6M'?140 : 260); }

    let data;
    try{ data = await ms(endpoint, params); }
    catch(e){ if(endpoint==='intraday'){ delete params.interval; endpoint='eod'; data = await ms(endpoint, params); } else throw e; }

    const rows = (data.data||[]).slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
    let labels = rows.map(r => intr ? new Date(r.date).toLocaleTimeString() : new Date(r.date).toLocaleDateString());
    let values = rows.map(r => r.close);
    const cleaned = cleanXY(labels, values);
    labels = cleaned.labels; values = cleaned.values;
    const sma20 = sma(values, Math.min(20, values.length));
    const bounds = calcBounds(values, sma20);

    if(priceChart) priceChart.destroy();
    priceChart = new Chart($('stockChart'), {
      type:'line',
      data:{ labels, datasets:[
        { label:'Price', data:values, borderColor:'#2ecc71', backgroundColor:'rgba(46,204,113,.14)', fill:values.length>1, tension:.12, spanGaps:false, clip:5 },
        { label:'SMA 20', data:sma20, borderColor:'#f1c40f', borderDash:[6,4], fill:false, tension:0, spanGaps:false, clip:5 }
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{
          y:{ suggestedMin: bounds.min, suggestedMax: bounds.max, grid:{color:'rgba(255,255,255,.08)'}, ticks:{ color:'#cfd3da' } },
          x:{ grid:{color:'rgba(255,255,255,.06)'}, ticks:{ color:'#cfd3da', maxTicksLimit: 10 } }
        },
        plugins:{ legend:{ labels:{ color:'#cfd3da' } }, tooltip:{ mode:'index', intersect:false } },
        animation:{ duration:600, easing:'easeOutQuart' }
      }
    });
  } catch(e){ console.error(e); }
}

async function load52w(){
  try{
    const eod = await ms('eod',{symbols:currentSymbol, exchanges:currentExchange, limit:260});
    const rows = eod.data||[];
    if(rows.length){
      const hi = Math.max(...rows.map(r=>r.high).filter(n=>Number.isFinite(Number(n))));
      const lo = Math.min(...rows.map(r=>r.low).filter(n=>Number.isFinite(Number(n))));
      $('stat52wHigh').textContent = fmt(hi);
      $('stat52wLow').textContent  = fmt(lo);
    } else { $('stat52wHigh').textContent='—'; $('stat52wLow').textContent='—'; }
  } catch(_){ $('stat52wHigh').textContent='—'; $('stat52wLow').textContent='—'; }
}

// ===== Watchlist =====
function saveWatch(){ localStorage.setItem('stockWatchlistV2', JSON.stringify(watchlist)); }
function renderWatchlist(){
  const container = $('watchlist'); container.innerHTML='';
  if(!watchlist.length){
    container.innerHTML = '<p class="muted" style="text-align:center">No symbols yet. Search above to add.</p>';
    return;
  }
  watchlist.forEach(item => {
    const row = document.createElement('div');
    row.className = 'watchlist-item';
    row.dataset.symbol = item.symbol;
    row.innerHTML = `
      <div>
        <div class="watchlist-symbol">${item.symbol}</div>
        <div class="muted" style="font-size:.85em">${item.name||''}</div>
      </div>
      <div style="text-align:right">
        <div class="mono" id="wp-${item.symbol}">—</div>
        <div class="mono muted" id="wc-${item.symbol}">—</div>
      </div>
      <span class="watchlist-remove" title="Remove" data-symbol="${item.symbol}">&times;</span>
    `;
    container.appendChild(row);
  });
  // refresh quotes for all
  watchlist.forEach(item => refreshWatch(item.symbol, item.exchange));
}
function addToWatchlist(symbol, exchange, name){
  if(!symbol) return;
  if(!watchlist.some(it=>it.symbol===symbol)){
    watchlist.push({ symbol, exchange: exchange||'', name: name||'' });
    saveWatch();
    renderWatchlist();
  }
}
function removeFromWatchlist(symbol){
  watchlist = watchlist.filter(s => s.symbol !== symbol);
  saveWatch();
  renderWatchlist();
}
$('watchlist').addEventListener('click', (e)=>{
  if(e.target.classList.contains('watchlist-remove')){
    removeFromWatchlist(e.target.dataset.symbol);
  } else if(e.target.closest('.watchlist-item')){
    const sym = e.target.closest('.watchlist-item').dataset.symbol;
    const it = watchlist.find(x=>x.symbol===sym);
    loadSymbol(sym, it?.exchange||'', it?.name||'');
  }
});
async function refreshWatch(sym, ex){
  try{
    let q=null;
    try{ q = (await ms('intraday/latest',{symbols:sym, exchanges:ex}))?.data?.[0]||null; } catch(_){}
    if(!q){ q = (await ms('eod/latest',{symbols:sym, exchanges:ex}))?.data?.[0]||null; }
    if(!q) return;
    const price = q.close ?? q.last ?? q.price;
    const open  = q.open ?? price;
    const chPct = open ? ((price-open)/open*100) : 0;
    $(`wp-${sym}`).textContent = fmt(price);
    const ce = $(`wc-${sym}`);
    ce.textContent = `${chPct>=0?'+':''}${chPct.toFixed(2)}% ${ex? '('+ex+')':''}`;
    ce.style.color = chPct>=0? 'var(--accent-green)' : 'var(--accent-red)';
  }catch(e){ /* ignore */}
}

// ===== Search =====
const searchInput = $('stockSearchInput');
const searchResultsContainer = $('searchResults');
searchInput.addEventListener('input', async (e)=>{
  const q = e.target.value.trim();
  searchResultsContainer.innerHTML='';
  if(q.length<2) return;
  try{
    const parsed = parseUserQuery(q);
    const params = { search: parsed.raw || q, limit: 12 };
    if(selectedExchange) params.exchanges = selectedExchange;
    const r = await ms('tickers', params);
    let items = (r.data||[]).filter(x=>x.symbol && x.name);
    if(selectedExchange) items = items.filter(x => (x.stock_exchange?.mic||'') === selectedExchange);
    if(!items.length && selectedExchange){
      try{
        const best = await resolveSymbol(q, selectedExchange);
        if(best) items = [{ symbol: best.symbol, name: best.name || q.toUpperCase(), stock_exchange: { acronym: best.exchange || 'N/A', mic: best.mic || selectedExchange } }];
      }catch(_){}
    }
    items.slice(0,10).forEach(it=>{
      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `
        <span><span class="mono">${it.symbol}</span> — ${it.name} <span class="chip">${it.stock_exchange?.acronym || 'N/A'}</span></span>
        <div style="display:flex; gap:6px">
          <button data-symbol="${it.symbol}" data-ex="${it.stock_exchange?.mic||''}" data-name="${it.name}">Add</button>
          <button data-load="${it.symbol}" data-ex="${it.stock_exchange?.mic||''}" data-name="${it.name}" style="background:#2ecc71">Load</button>
        </div>`;
      searchResultsContainer.appendChild(row);
    });
  }catch(_){}
});
searchResultsContainer.addEventListener('click', (e)=>{
  if(e.target.tagName==='BUTTON'){
    const sym = e.target.dataset.symbol || e.target.dataset.load;
    const ex  = e.target.dataset.ex || '';
    const nm  = e.target.dataset.name || '';
    if(e.target.dataset.symbol){
      addToWatchlist(sym, ex, nm);
      searchInput.value='';
      searchResultsContainer.innerHTML='';
    } else {
      loadSymbol(sym, ex, nm);
    }
  }
});

// ===== Exchange filter in sidebar =====
$('exchangeFilters').addEventListener('click', (e)=>{
  if(e.target.tagName==='BUTTON'){
    document.querySelectorAll('#exchangeFilters button').forEach(b=>b.classList.remove('active'));
    e.target.classList.add('active');
    selectedExchange = e.target.dataset.exchange;
    // retrigger search results with new filter
    const ev = new Event('input', { bubbles:true });
    searchInput.dispatchEvent(ev);
  }
});

// ===== Timeframe click =====
$('tfControls').addEventListener('click', (e)=>{
  if(e.target.tagName==='BUTTON'){ loadTimeframe(e.target.dataset.tf); }
});

// ===== Market movers (based on watchlist universe or defaults) =====
const DEFAULT_UNIVERSE = [
  {symbol:'AAPL'}, {symbol:'MSFT'}, {symbol:'NVDA'}, {symbol:'AMZN'}, {symbol:'GOOGL'}, {symbol:'TSLA'}
];
async function renderMovers(){
  const rowsEl = document.querySelector('#marketMoversTable tbody');
  rowsEl.innerHTML='';
  const universe = (watchlist.length? watchlist : DEFAULT_UNIVERSE).slice(0, 20);
  const stats = [];
  for(const it of universe){
    try{
      let q=null;
      try{ q = (await ms('intraday/latest',{symbols:it.symbol, exchanges:it.exchange||''}))?.data?.[0]||null; }catch(_){}
      if(!q){ q = (await ms('eod/latest',{symbols:it.symbol, exchanges:it.exchange||''}))?.data?.[0]||null; }
      if(!q) continue;
      const price = q.close ?? q.last ?? q.price;
      const open  = q.open ?? price;
      const pct   = open? ((price-open)/open*100):0;
      stats.push({ symbol: it.symbol, ex: (q.exchange || it.exchange || ''), price, pct });
    }catch(_){}
  }
  stats.sort((a,b)=> b.pct - a.pct);
  stats.forEach(row=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${row.symbol}</td><td>${row.ex||''}</td><td>${fmt(row.price)}</td><td style="color:${row.pct>=0?'var(--accent-green)':'var(--accent-red)'}">${row.pct>=0?'+':''}${row.pct.toFixed(2)}%</td>`;
    rowsEl.appendChild(tr);
  });
}

// ===== News (placeholder/demo) =====
const mockNews = {
  'Bloomberg': [
    { title: 'Apple Intelligence to Redefine AI Landscape', source: 'Bloomberg', time: '1h ago' },
    { title: 'NVIDIA Hits New High on AI Chip Demand', source: 'Bloomberg', time: '3h ago' }
  ],
  'Reuters': [
    { title: 'Microsoft Azure Cloud Sees Unprecedented Growth', source: 'Reuters', time: '2h ago' },
    { title: 'Tesla Faces Stiff Competition in EV Market', source: 'Reuters', time: '5h ago' }
  ],
  'Yahoo': [
    { title: 'Is Amazon a Buy After Recent Earnings Beat?', source: 'Yahoo Finance', time: '4h ago' },
    { title: 'Alphabet Doubles Down on Quantum Computing Research', source: 'Yahoo Finance', time: '6h ago' }
  ]
};
function loadNews(source='All'){
  const newsFeed = $('news-feed'); newsFeed.innerHTML='';
  let articles = [];
  if(source==='All'){ articles = Object.values(mockNews).flat(); } else { articles = mockNews[source] || []; }
  articles.sort((a,b)=> parseInt(a.time) - parseInt(b.time));
  articles.forEach(article=>{
    const d = document.createElement('div');
    d.className='news-item';
    d.innerHTML = `<a href="#" target="_blank">${article.title}</a><small>${article.time} — ${article.source}</small>`;
    newsFeed.appendChild(d);
  });
}
$('newsApiButtons').addEventListener('click', (e)=>{
  if(e.target.tagName==='BUTTON'){
    $('newsApiButtons').querySelector('.active').classList.remove('active');
    e.target.classList.add('active');
    loadNews(e.target.dataset.source);
  }
});

// ===== Profile =====
const profileForm = $('profileForm');
profileForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const userDetails = { name: $('userName').value, email: $('userEmail').value };
  localStorage.setItem('userProfile', JSON.stringify(userDetails));
  $('saveConfirmation').textContent = 'Details saved successfully!';
  setTimeout(()=> $('saveConfirmation').textContent = '', 3000);
});
function loadProfile(){
  const user = JSON.parse(localStorage.getItem('userProfile')||'null');
  if(user){ $('userName').value = user.name || ''; $('userEmail').value = user.email || ''; }
}

// ===== Init =====
function bootstrap(){
  renderWatchlist();
  loadProfile();
  loadNews('All');
  if(watchlist.length){
    const first = watchlist[0];
    loadSymbol(first.symbol, first.exchange||'', first.name||'');
  } else {
    loadSymbol('AAPL');
  }
  renderMovers();
  setInterval(()=>{ if(currentSymbol){ loadQuote(); renderMovers(); watchlist.forEach(it=> refreshWatch(it.symbol, it.exchange)); } }, 60*1000);
}
bootstrap();
</script>
</body>
</html>
