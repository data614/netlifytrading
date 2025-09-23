import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.resolve(__dirname, '../../../data/symbols.json');

// Lazy async loader for dataset
let datasetCache = null;
async function getDataset() {
  if (datasetCache) return datasetCache;
  const data = await fs.promises.readFile(dataPath, 'utf8');
  datasetCache = JSON.parse(data);
  return datasetCache;
}
const MIC_PREFIXES = {
  XNAS: ['NASDAQ', 'US', 'USA'],
  XNYS: ['NYSE', 'US', 'USA'],
  XASE: ['AMEX', 'NYSEAMERICAN', 'US'],
  ARCX: ['ARCA', 'NYSEARCA', 'US'],
  BATS: ['BATS', 'CBOE', 'US'],
  IEXG: ['IEX', 'US'],
  XASX: ['ASX', 'AU', 'AUS'],
  XHKG: ['HK', 'HKG', 'HKEX'],
  XTSE: ['TSX', 'CA', 'CAN'],
  XTSX: ['TSXV', 'VENTURE', 'CA'],
  XLON: ['LSE', 'LON', 'UK'],
  XETR: ['XETRA', 'FRA', 'DE'],
  XSWX: ['SIX', 'SWX', 'CH'],
  XSES: ['SGX', 'SG'],
  XNSE: ['NSE', 'IN'],
  XBOM: ['BSE', 'IN'],
};

function normalise(str) {
  return (str || '').trim();
}

function toUpper(str) {
  return normalise(str).toUpperCase();
}

function tokeniseName(name) {
  return toUpper(name)
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildAliases(symbol, mic, suffix) {
  const aliases = new Set();
  const upSymbol = toUpper(symbol);
  if (upSymbol) aliases.add(upSymbol);
  const prefixList = MIC_PREFIXES[mic] || [];
  prefixList.forEach((prefix) => aliases.add(`${prefix}:${upSymbol}`));
  if (suffix) aliases.add(`${upSymbol}.${suffix}`);
  if (mic) aliases.add(`${mic}:${upSymbol}`);
  return Array.from(aliases);
}

function prepareRecord(entry) {
  const symbol = toUpper(entry.symbol);
  const name = normalise(entry.name);
  const mic = toUpper(entry.mic);
  const suffix = entry.suffix ? toUpper(entry.suffix) : '';
  return {
    symbol,
    name,
    mic,
    exchange: entry.exchange || '',
    country: entry.country || '',
    currency: entry.currency || '',
    type: entry.type || '',
    suffix,
    aliases: buildAliases(symbol, mic, suffix),
    nameTokens: tokeniseName(name),
  };
}

const RECORDS = dataset.symbols.map(prepareRecord);

const RECORD_INDEX = new Map();
RECORDS.forEach((record) => {
  const key = `${record.symbol}::${record.mic}`;
  if (!RECORD_INDEX.has(key)) {
    RECORD_INDEX.set(key, record);
  }
});

function scoreRecord(record, upperQuery, lowerQuery, tokens) {
  if (!upperQuery) return 0;
  let score = 0;
  if (record.symbol === upperQuery) score += 200;
  if (!score && record.aliases.includes(upperQuery)) score += 180;
  if (record.symbol.startsWith(upperQuery)) score += 120;
  if (record.aliases.some((alias) => alias.startsWith(upperQuery))) score += 90;
  const nameUpper = record.name.toUpperCase();
  if (nameUpper === upperQuery) score += 110;
  if (nameUpper.startsWith(upperQuery)) score += 80;
  if (nameUpper.includes(upperQuery)) score += 50;
  if (tokens.length) {
    const matches = tokens.filter((token) => record.nameTokens.some((nameToken) => nameToken.startsWith(token)));
    if (matches.length === tokens.length) score += 60;
    else if (matches.length > 0) score += 30;
  }
  const nameLower = record.name.toLowerCase();
  if (lowerQuery && nameLower.includes(lowerQuery)) score += 20;
  return score;
}

export function searchLocalSymbols(rawQuery, { micFilter = '', limit = 25 } = {}) {
  const cleaned = normalise(rawQuery);
  const upperQuery = cleaned.toUpperCase();
  const lowerQuery = cleaned.toLowerCase();
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .map((token) => token.toUpperCase());

  const filteredMic = toUpper(micFilter);
  const matches = [];

  RECORDS.forEach((record) => {
    if (filteredMic && record.mic !== filteredMic) return;
    const score = scoreRecord(record, upperQuery, lowerQuery, tokens);
    if (score <= 0) return;
    matches.push({ record, score });
  });

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.record.symbol !== b.record.symbol) return a.record.symbol.localeCompare(b.record.symbol);
    return (a.record.mic || '').localeCompare(b.record.mic || '');
  });

  return matches.slice(0, limit).map(({ record }) => ({
    symbol: record.symbol,
    name: record.name,
    exchange: record.exchange,
    mic: record.mic,
    country: record.country,
    currency: record.currency,
    type: record.type,
    suffix: record.suffix,
    source: 'local',
  }));
}

export function getLocalRecord(symbol, mic = '') {
  const key = `${toUpper(symbol)}::${toUpper(mic)}`;
  return RECORD_INDEX.get(key) || null;
}
