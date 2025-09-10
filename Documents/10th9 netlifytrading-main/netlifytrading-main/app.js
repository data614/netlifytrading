const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const input = $('#search');
const btn = $('#btnFetch');
const tableBody = $('#eodTable tbody');
const suggestions = $('#suggestions');

async function ping() {
  try {
    const res = await fetch('/api/hello');
    const data = await res.json();
    statusEl.textContent = data.ok ? 'Backend OK' : 'Backend error';
  } catch (err) {
    statusEl.textContent = 'Backend not reachable';
  }
}

async function suggest(q) {
  if (!q || q.length < 2) { suggestions.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const list = (data.data || []).map(x => `<code>${x.symbol}</code> — ${x.name}`).join(' · ');
    suggestions.innerHTML = list || '<em>No suggestions</em>';
  } catch (e) {
    suggestions.innerHTML = '<em>Suggestion error</em>';
  }
}

async function fetchEod(symbol) {
  tableBody.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const res = await fetch(`/api/marketstack?symbol=${encodeURIComponent(symbol)}`);
    const data = await res.json();
    const rows = (data.data || []).map(r => `
      <tr>
        <td>${r.date?.slice(0,10) || ''}</td>
        <td>${r.open ?? ''}</td>
        <td>${r.high ?? ''}</td>
        <td>${r.low ?? ''}</td>
        <td>${r.close ?? ''}</td>
        <td>${r.volume ?? ''}</td>
      </tr>
    `).join('');
    tableBody.innerHTML = rows || '<tr><td colspan="6">No data</td></tr>';
    $('#resultTitle').textContent = `Results for ${symbol}`;
  } catch (e) {
    tableBody.innerHTML = '<tr><td colspan="6">Error fetching data</td></tr>';
  }
}

input.addEventListener('input', (e) => suggest(e.target.value.trim()));
btn.addEventListener('click', () => fetchEod(input.value.trim() || 'AAPL'));

document.addEventListener('DOMContentLoaded', () => {
  ping();
  input.value = 'AAPL';
});
