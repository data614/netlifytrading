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
        y:{
          beginAtZero:true,  // ✅ Force Y-axis to start at zero
          grid:{ color:'rgba(255,255,255,.08)' },
          ticks:{ color:'#cfd3da' }
        },
        x:{
          grid:{ color:'rgba(255,255,255,.06)' },
          ticks:{ color:'#cfd3da', maxTicksLimit: 10 }
        }
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

// (rest of your watchlist, search, news, profile, bootstrap functions stay unchanged)
