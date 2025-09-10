// --- small helpers ---
const $ = (id) => document.getElementById(id);
const showLoading = (b)=> $('loading').style.display = b? 'flex' : 'none';
const showError = (msg)=> { const e=$('error'); e.textContent = msg; e.style.display='block'; setTimeout(()=>e.style.display='none',6000); };
const fmt = (n)=> (n==null? '—' : '$'+Number(n).toFixed(2));
const fmtVol = (v)=>{ const n=Number(v||0); if(n>=1e9)return(n/1e9).toFixed(2)+'B'; if(n>=1e6)return(n/1e6).toFixed(2)+'M'; if(n>=1e3)return(n/1e3).toFixed(2)+'K'; return String(n); };
const sma = (arr, p)=>{ const out=[]; for(let i=0;i<arr.length;i++){ if(i<p-1){ out.push(null); continue; } let s=0; for(let j=i-p+1;j<=i;j++) s+=arr[j]; out.push(s/p);} return out; };
const intradayInterval = (tf)=> tf==='1D'?'5min': tf==='1W'?'30min': tf==='1M'?'1hour': null;

let currentSymbol = 'AAPL';
let currentExchange = '';
let priceChart;
let selectedExchange = '';
let watchlist = JSON.parse(localStorage.getItem('stockWatchlistV2') || '[]');

// --- call your Functions (backend owns the API key) ---
async function fx(path, params={}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? ('?'+qs) : ''}`;
  showLoading(true);
  try {
    const r = await fetch(url);
    showLoading(false);
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (e) {
    showLoading(false);
    showError(`Request failed (${path}) – ${e.message}`);
    throw e;
  }
}

// --- loaders ---
async function loadQuote(){
  // try intraday latest via function, fallback to eod/latest
  let q = null;
  try { q = (await fx('marketstack', { symbol: currentSymbol, exchange: currentExchange, kind:'intraday_latest' }))?.data?.[0] || null; } catch(_){}
  if(!q){ q = (await fx('marketstack', { symbol: currentSymbol, exchange: currentExchange, kind:'eod_latest' }))?.data?.[0] || null; }
  if(!q){ showError('No recent quote data'); return; }

  const price = q.close ?? q.last ?? q.price;
  const open  = q.open ?? price;
  const high  = q.high; const low = q.low; const vol = q.volume;

  $('stockPrice').textContent = fmt(price);
  const deltaAbs = (price-open);
  const deltaPct = open ? (deltaAbs/open*100) : 0;
  const isPos = deltaAbs >= 0;
  const ce = $('stockChange');
  ce.textContent = `${isPos?'+':''}${deltaAbs.toFixed(2)} (${isPos?'+':''}${deltaPct.toFixed(2)}%)`;
  ce.className = `stock-change ${isPos? 'positive-change':'negative-change'}`;

  $('statOpen').textContent = fmt(open);
  $('statHigh').textContent = fmt(high);
  $('statLow').textContent  = fmt(low);
  $('statVolume').textContent = fmtVol(vol);
}

async function loadTimeframe(tf){
  document.querySelectorAll('#tfControls button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`#tfControls button[data-tf="${tf}"]`); if(btn) btn.classList.add('active');

  const intr = intradayInterval(tf);
  let kind = intr ? 'intraday' : 'eod';
  const limit = intr ? (tf==='1D'?150 : tf==='1W'?300 : 500) : (tf==='3M'?70 : tf==='6M'?140 : 260);

  let data = await fx('marketstack', { symbol: currentSymbol, exchange: currentExchange, kind, interval: intr || '', limit });
  const rows = (data.data||[]).slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
  let labels = rows.map(r => intr ? new Date(r.date).toLocaleTimeString() : new Date(r.date).toLocaleDateString());
  let values = rows.map(r => r.close);

  const clean = values.reduce((acc,v,i)=> (Number.isFinite(+v) ? (acc.labels.push(labels[i]), acc.values.push(+v)) : acc, acc), {labels:[], values:[]});
  const sma20 = sma(clean.values, Math.min(20, clean.values.length));
  const all = [...clean.values, ...sma20].filter(v=>v!=null && Number.isFinite(v));
  let min = Math.min(...all), max = Math.max(...all); const pad = (max-min||min*0.1)*0.05; min-=pad; max+=pad;

  if(priceChart) priceChart.destroy();
  priceChart = new Chart($('stockChart'), {
    type:'line',
    data:{ labels: clean.labels, datasets:[
      { label:'Price', data: clean.values, borderColor:'#2ecc71', backgroundColor:'rgba(46,204,113,.14)', fill: clean.values.length>1, tension:.12, spanGaps:false, clip:5 },
      { label:'SMA 20', data: sma20, borderColor:'#f1c40f', borderDash:[6,4], fill:false, tension:0, spanGaps:false, clip:5 }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        y:{ suggestedMin:min, suggestedMax:max, grid:{color:'rgba(255,255,255,.08)'}, ticks:{ color:'#cfd3da' } },
        x:{ grid:{color:'rgba(255,255,255,.06)'}, ticks:{ color:'#cfd3da', maxTicksLimit: 10 } }
      },
      plugins:{ legend:{ labels:{ color:'#cfd3da' } }, tooltip:{ mode:'index', intersect:false } },
      animation:{ duration:600, easing:'easeOutQuart' }
    }
  });
}

async function load52w(){
  const data = await fx('marketstack', { symbol: currentSymbol, exchange: currentExchange, kind:'eod', limit:260 });
  const rows = data.data||[];
  if(!rows.length){ $('stat52wHigh').textContent='—'; $('stat52wLow').textContent='—'; return; }
  const hi = Math.max(...rows.map(r=>r.high).filter(Number.isFinite));
  const lo = Math.min(...rows.map(r=>r.low).filter(Number.isFinite));
  $('stat52wHigh').textContent = fmt(hi);
  $('stat52wLow').textContent  = fmt(lo);
}

// --- watchlist/search/news same structure as design ---
function saveWatch(){ localStorage.setItem('stockWatchlistV2', JSON.stringify(watchlist)); }
function renderWatchlist(){
  const el = $('watchlist'); el.innerHTML='';
  if(!watchlist.length){ el.innerHTML='<p class="muted" style="text-align:center">No symbols yet. Search above to add.</p>'; return; }
  watchlist.forEach(it=>{
    const row=document.createElement('div');
    row.className='watchlist-item'; row.dataset.symbol=it.symbol;
    row.innerHTML=`
      <div><div class="watchlist-symbol">${it.symbol}</div><div class="muted" style="font-size:.85em">${it.name||''}</div></div>
      <div style="text-align:right"><div class="mono" id="wp-${it.symbol}">—</div><div class="mono muted" id="wc-${it.symbol}">—</div></div>
      <span class="watchlist-remove" data-symbol="${it.symbol}">&times;</span>`;
    el.appendChild(row);
  });
  watchlist.forEach(it=> refreshWatch(it.symbol, it.exchange));
}
function addToWatchlist(symbol, exchange, name){
  if(symbol && !watchlist.some(x=>x.symbol===symbol)){ watchlist.push({symbol, exchange:exchange||'', name:name||''}); saveWatch(); renderWatchlist(); }
}
function removeFromWatchlist(symbol){ watchlist = watchlist.filter(s=>s.symbol!==symbol); saveWatch(); renderWatchlist(); }
$('watchlist').addEventListener('click',(e)=>{
  if(e.target.classList.contains('watchlist-remove')) removeFromWatchlist(e.target.dataset.symbol);
  else if(e.target.closest('.watchlist-item')){
    const sym=e.target.closest('.watchlist-item').dataset.symbol;
    const it=watchlist.find(x=>x.symbol===sym); loadSymbol(sym, it?.exchange||'', it?.name||'');
  }
});
async function refreshWatch(sym, ex){
  let q=null;
  try { q = (await fx('marketstack',{symbol:sym,exchange:ex,kind:'intraday_latest'}))?.data?.[0]||null; } catch(_){}
  if(!q){ q = (await fx('marketstack',{symbol:sym,exchange:ex,kind:'eod_latest'}))?.data?.[0]||null; }
  if(!q) return;
  const price = q.close ?? q.last ?? q.price;
  const open  = q.open ?? price;
  const pct   = open? ((price-open)/open*100):0;
  $(`wp-${sym}`).textContent = fmt(price);
  const ce = $(`wc-${sym}`); ce.textContent = `${pct>=0?'+':''}${pct.toFixed(2)}% ${ex? '('+ex+')':''}`;
  ce.style.color = pct>=0? 'var(--accent-green)' : 'var(--accent-red)';
}

// --- search (hits your /api/search) ---
const searchInput = $('stockSearchInput'), searchResultsContainer = $('searchResults');
searchInput.addEventListener('input', async (e)=>{
  const q = e.target.value.trim(); searchResultsContainer.innerHTML=''; if(q.length<2) return;
  const r = await fx('search', { q, exchange: selectedExchange || '' });
  const items = (r.data||[]).slice(0,10);
  items.forEach(it=>{
    const row = document.createElement('div'); row.className='search-result-item';
    row.innerHTML = `
      <span><span class="mono">${it.symbol}</span> — ${it.name||''} <span class="chip">${it.exchange||''}</span></span>
      <div style="display:flex; gap:6px">
        <button data-symbol="${it.symbol}" data-ex="${it.mic||''}" data-name="${it.name||''}">Add</button>
        <button data-load="${it.symbol}" data-ex="${it.mic||''}" data-name="${it.name||''}" style="background:#2ecc71">Load</button>
      </div>`;
    searchResultsContainer.appendChild(row);
  });
});
searchResultsContainer.addEventListener('click',(e)=>{
  if(e.target.tagName!=='BUTTON') return;
  const sym=e.target.dataset.symbol || e.target.dataset.load;
  const ex =e.target.dataset.ex||''; const nm=e.target.dataset.name||'';
  if(e.target.dataset.symbol){ addToWatchlist(sym,ex,nm); searchInput.value=''; searchResultsContainer.innerHTML=''; }
  else { loadSymbol(sym,ex,nm); }
});

// --- filters/timeframes/news/profile ---
$('exchangeFilters').addEventListener('click',(e)=>{
  if(e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#exchangeFilters button').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active'); selectedExchange = e.target.dataset.exchange || '';
  const ev = new Event('input', { bubbles:true }); searchInput.dispatchEvent(ev);
});
$('tfControls').addEventListener('click',(e)=>{ if(e.target.tagName==='BUTTON') loadTimeframe(e.target.dataset.tf); });

const mockNews = {
  'Bloomberg':[ {title:'Apple Intelligence to Redefine AI Landscape',source:'Bloomberg',time:'1h ago'}, {title:'NVIDIA Hits New High on AI Chip Demand',source:'Bloomberg',time:'3h ago'} ],
  'Reuters':[ {title:'Microsoft Azure Cloud Sees Unprecedented Growth',source:'Reuters',time:'2h ago'}, {title:'Tesla Faces Stiff Competition in EV Market',source:'Reuters',time:'5h ago'} ],
  'Yahoo':[ {title:'Is Amazon a Buy After Earnings Beat?',source:'Yahoo Finance',time:'4h ago'}, {title:'Alphabet Doubles Down on Quantum',source:'Yahoo Finance',time:'6h ago'} ]
};
function loadNews(source='All'){
  const feed=$('news-feed'); feed.innerHTML='';
  let articles = source==='All' ? Object.values(mockNews).flat() : (mockNews[source]||[]);
  articles.sort((a,b)=> parseInt(a.time)-parseInt(b.time));
  articles.forEach(a=>{ const d=document.createElement('div'); d.className='news-item'; d.innerHTML=`<a href="#" target="_blank">${a.title}</a><small>${a.time} — ${a.source}</small>`; feed.appendChild(d); });
}
$('newsApiButtons').addEventListener('click',(e)=>{
  if(e.target.tagName!=='BUTTON') return;
  $('newsApiButtons').querySelector('.active').classList.remove('active');
  e.target.classList.add('active'); loadNews(e.target.dataset.source);
});
const profileForm = $('profileForm');
profileForm.addEventListener('submit',(e)=>{
  e.preventDefault();
  localStorage.setItem('userProfile', JSON.stringify({ name:$('userName').value, email:$('userEmail').value }));
  $('saveConfirmation').textContent='Details saved successfully!'; setTimeout(()=> $('saveConfirmation').textContent='', 3000);
});
function loadProfile(){ const u=JSON.parse(localStorage.getItem('userProfile')||'null'); if(u){ $('userName').value=u.name||''; $('userEmail').value=u.email||''; } }

// --- symbol bootstrap ---
async function loadSymbol(sym, exchange='', knownName=''){
  $('error').style.display='none';
  currentSymbol = (sym||'AAPL').toUpperCase();
  currentExchange = exchange||'';
  $('stockSymbol').textContent=currentSymbol; $('stockName').textContent=knownName||'—'; $('exchangeAcronym').textContent = exchange? `(${exchange})` : '';
  await loadQuote(); await loadTimeframe('1D'); await load52w();
}

// --- init ---
function bootstrap(){
  renderWatchlist(); loadProfile(); loadNews('All');
  if(watchlist.length){ const f=watchlist[0]; loadSymbol(f.symbol, f.exchange||'', f.name||''); } else { loadSymbol('AAPL'); }
  setInterval(()=>{ if(currentSymbol){ loadQuote(); renderMovers(); watchlist.forEach(it=> refreshWatch(it.symbol, it.exchange)); } }, 60*1000);
}
async function renderMovers(){
  const rowsEl = document.querySelector('#marketMoversTable tbody'); rowsEl.innerHTML='';
  const universe = (watchlist.length? watchlist : [{symbol:'AAPL'},{symbol:'MSFT'},{symbol:'NVDA'},{symbol:'AMZN'},{symbol:'GOOGL'},{symbol:'TSLA'}]).slice(0,20);
  const stats=[];
  for(const it of universe){
    let q=null; try{ q=(await fx('marketstack',{symbol:it.symbol,exchange:it.exchange||'',kind:'intraday_latest'}))?.data?.[0]||null; }catch(_){}
    if(!q){ q=(await fx('marketstack',{symbol:it.symbol,exchange:it.exchange||'',kind:'eod_latest'}))?.data?.[0]||null; }
    if(!q) continue;
    const price=q.close ?? q.last ?? q.price; const open=q.open ?? price; const pct=open?((price-open)/open*100):0;
    stats.push({symbol:it.symbol, ex:q.exchange||it.exchange||'', price, pct});
  }
  stats.sort((a,b)=> b.pct-a.pct);
  stats.forEach(r=>{ const tr=document.createElement('tr');
    tr.innerHTML=`<td class="mono">${r.symbol}</td><td>${r.ex||''}</td><td>${fmt(r.price)}</td><td style="color:${r.pct>=0?'var(--accent-green)':'var(--accent-red)'}">${r.pct>=0?'+':''}${r.pct.toFixed(2)}%</td>`;
    rowsEl.appendChild(tr);
  });
}
bootstrap();
