import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse as parseCsv } from 'csv-parse/sync';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

const SOURCES = [];
const REGISTRY = new Map();

const MIC_LABELS = {
  XNAS: 'NASDAQ',
  XNYS: 'NYSE',
  XASE: 'NYSE American',
  ARCX: 'NYSE Arca',
  BATS: 'Cboe BZX',
  IEXG: 'IEX',
  XASX: 'ASX',
  XHKG: 'HKEX',
};

const MIC_SUFFIX = {
  XASX: 'AX',
  XHKG: 'HK',
  XTSE: 'TO',
  XTSX: 'V',
};

function normaliseWhitespace(input) {
  return (input || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function addSymbol(entry) {
  const symbol = normaliseWhitespace(entry.symbol || '').toUpperCase();
  if (!symbol) return;
  const mic = normaliseWhitespace(entry.mic || '').toUpperCase();
  const key = `${symbol}::${mic}`;
  const name = normaliseWhitespace(entry.name || '');
  const record = {
    symbol,
    name,
    exchange: entry.exchange || (mic ? MIC_LABELS[mic] || '' : ''),
    mic,
    country: entry.country || '',
    currency: entry.currency || '',
    type: entry.type || '',
  };
  Object.keys(record).forEach((k) => {
    if (!record[k]) delete record[k];
  });

  if (MIC_SUFFIX[mic]) {
    record.suffix = MIC_SUFFIX[mic];
  }

  if (REGISTRY.has(key)) {
    const existing = REGISTRY.get(key);
    if (!existing.name && record.name) existing.name = record.name;
    if (!existing.exchange && record.exchange) existing.exchange = record.exchange;
    if (!existing.country && record.country) existing.country = record.country;
    if (!existing.currency && record.currency) existing.currency = record.currency;
    if (!existing.type && record.type) existing.type = record.type;
    if (record.suffix && !existing.suffix) existing.suffix = record.suffix;
    return;
  }

  REGISTRY.set(key, record);
}

const execFileAsync = promisify(execFile);

async function fetchText(url) {
  const { stdout } = await execFileAsync('curl', ['-fsSL', url], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
  return stdout;
}

async function fetchBuffer(url) {
  const { stdout } = await execFileAsync('curl', ['-fsSL', url], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 });
  return stdout;
}

async function importNasdaq() {
  const url = 'https://datahub.io/core/nasdaq-listings/r/nasdaq-listed.csv';
  const csv = await fetchText(url);
  const records = parseCsv(csv, { columns: true, skip_empty_lines: true });
  records.forEach((row) => {
    addSymbol({
      symbol: row.Symbol,
      name: row['Security Name'],
      exchange: 'NASDAQ',
      mic: 'XNAS',
      country: 'US',
      type: row['ETF'] === 'Y' ? 'ETF' : 'Equity',
    });
  });
  SOURCES.push({ name: 'NASDAQ Listings', url, count: records.length });
}

function mapNyseExchange(code) {
  const map = {
    N: { mic: 'XNYS', exchange: 'NYSE' },
    A: { mic: 'XASE', exchange: 'NYSE American' },
    P: { mic: 'ARCX', exchange: 'NYSE Arca' },
    Z: { mic: 'BATS', exchange: 'Cboe BZX' },
    V: { mic: 'IEXG', exchange: 'IEX' },
  };
  return map[code] || null;
}

async function importNyseOther() {
  const url = 'https://datahub.io/core/nyse-other-listings/r/other-listed.csv';
  const csv = await fetchText(url);
  const records = parseCsv(csv, { columns: true, skip_empty_lines: true });
  let count = 0;
  records.forEach((row) => {
    if ((row['Test Issue'] || '').trim() === 'Y') return;
    const info = mapNyseExchange((row.Exchange || '').trim());
    if (!info) return;
    addSymbol({
      symbol: row['ACT Symbol'] || row['CQS Symbol'] || row['NASDAQ Symbol'],
      name: row['Security Name'] || row['Company Name'],
      exchange: info.exchange,
      mic: info.mic,
      country: 'US',
      type: row.ETF === 'Y' ? 'ETF' : 'Equity',
    });
    count += 1;
  });
  SOURCES.push({ name: 'NYSE/Arca/IEX Listings', url, count });
}

async function importAsx() {
  const url = 'https://www.asx.com.au/asx/research/ASXListedCompanies.csv';
  const text = await fetchText(url);
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('Company name'));
  if (headerIndex === -1) {
    throw new Error('ASX CSV header not found');
  }
  const data = lines.slice(headerIndex).join('\n');
  const records = parseCsv(data, { columns: true, skip_empty_lines: true });
  records.forEach((row) => {
    const symbol = normaliseWhitespace(row['ASX code']);
    if (!symbol || symbol === 'N/A') return;
    addSymbol({
      symbol,
      name: row['Company name'],
      exchange: 'ASX',
      mic: 'XASX',
      country: 'AU',
      type: 'Equity',
    });
  });
  SOURCES.push({ name: 'ASX Listed Companies', url, count: records.length });
}

function padHkSymbol(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return trimmed.toUpperCase();
  const normalized = digits.replace(/^0+/, '') || '0';
  const base = normalized.length >= 4 ? normalized.slice(-4) : normalized;
  return base.padStart(4, '0');
}

async function importHkex() {
  const url = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';
  const buffer = await fetchBuffer(url);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => /stock code/i.test(cell || '')));
  if (headerRowIndex === -1) {
    throw new Error('HKEX header row not found');
  }

  const headers = rows[headerRowIndex].map((cell) => normaliseWhitespace(cell || ''));
  const colIndex = Object.fromEntries(headers.map((name, idx) => [name.toLowerCase(), idx]));
  const codeKey = Object.keys(colIndex).find((k) => k.includes('stock code'));
  const nameKey = Object.keys(colIndex).find((k) => k.includes('name of securities'));
  const shortNameKey = Object.keys(colIndex).find((k) => k.includes('short name'));
  const statusKey = Object.keys(colIndex).find((k) => k.includes('status')); // may not exist
  const categoryKey = Object.keys(colIndex).find((k) => k.includes('category'));

  let count = 0;
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const rawCode = codeKey !== undefined ? row[colIndex[codeKey]] : row[0];
    const code = padHkSymbol(rawCode);
    if (!code) continue;
    const name = normaliseWhitespace(
      (nameKey !== undefined && row[colIndex[nameKey]])
        || (shortNameKey !== undefined && row[colIndex[shortNameKey]])
        || ''
    );
    if (!name) continue;
    const status = statusKey !== undefined ? normaliseWhitespace(row[colIndex[statusKey]]) : '';
    if (status && !/^active$/i.test(status)) continue;
    const category = categoryKey !== undefined ? normaliseWhitespace(row[colIndex[categoryKey]]) : '';
    if (category && /^(warrants?|structured products?)$/i.test(category)) continue;
    addSymbol({
      symbol: code,
      name,
      exchange: 'HKEX',
      mic: 'XHKG',
      country: 'HK',
      type: category || 'Equity',
    });
    count += 1;
  }
  SOURCES.push({ name: 'HKEX List Of Securities', url, count });
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  await importNasdaq();
  await importNyseOther();
  await importAsx();
  await importHkex();

  const symbols = Array.from(REGISTRY.values()).sort((a, b) => {
    if (a.symbol === b.symbol) return (a.mic || '').localeCompare(b.mic || '');
    return a.symbol.localeCompare(b.symbol);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    total: symbols.length,
    sources: SOURCES,
    symbols,
  };

  const outFile = path.join(dataDir, 'symbols.json');
  await fs.writeFile(outFile, JSON.stringify(payload));
  console.log(`Wrote ${symbols.length} symbols to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
