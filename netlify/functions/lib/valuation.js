const toNumber = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const mean = (values) => {
  const filtered = values.map(toNumber).filter((v) => typeof v === 'number');
  if (!filtered.length) return null;
  const sum = filtered.reduce((acc, val) => acc + val, 0);
  return sum / filtered.length;
};

const clamp = (value, min, max) => {
  const num = toNumber(value);
  if (num === null) return null;
  if (typeof min === 'number' && num < min) return min;
  if (typeof max === 'number' && num > max) return max;
  return num;
};

export function computeGrowthRate({ revenueGrowth, epsGrowth, fcfGrowth }) {
  const candidates = [revenueGrowth, epsGrowth, fcfGrowth]
    .map((v) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (Math.abs(n) > 5) return Math.sign(n) * 5; // limit extreme outliers
      return n;
    })
    .filter((v) => typeof v === 'number');

  if (!candidates.length) return { base: 0.03, bull: 0.05, bear: 0.01 };

  const avg = mean(candidates);
  const volatility = candidates.length > 1 ? Math.max(0.01, Math.min(0.08, Math.abs(mean(candidates.map((v) => v - avg))))) : 0.015;

  const base = clamp(avg, -0.1, 0.25);
  return {
    base,
    bull: clamp(base + volatility, -0.05, 0.3) ?? base,
    bear: clamp(base - volatility, -0.25, 0.15) ?? base,
  };
}

export function discountedCashFlow({
  startingCashFlow,
  growthRate,
  discountRate = 0.09,
  years = 5,
  terminalGrowth = 0.025,
}) {
  const cash = toNumber(startingCashFlow);
  if (cash === null) return null;
  const g = typeof growthRate === 'number' ? growthRate : toNumber(growthRate);
  const r = typeof discountRate === 'number' ? discountRate : toNumber(discountRate);
  if (r === null || g === null) return null;

  let presentValue = 0;
  let currentCash = cash;
  for (let year = 1; year <= years; year += 1) {
    currentCash *= (1 + g);
    presentValue += currentCash / (1 + r) ** year;
  }
  const terminalValue = (currentCash * (1 + terminalGrowth)) / (r - terminalGrowth);
  presentValue += terminalValue / (1 + r) ** (years + 1);
  return presentValue;
}

export function earningsPowerValue({ earningsPerShare, discountRate = 0.1 }) {
  const eps = toNumber(earningsPerShare);
  if (eps === null) return null;
  const r = typeof discountRate === 'number' ? discountRate : toNumber(discountRate);
  if (r === null || r <= 0) return null;
  return eps / r;
}

export function buildValuationSnapshot({
  price,
  earningsPerShare,
  revenuePerShare,
  freeCashFlowPerShare,
  bookValuePerShare,
  revenueGrowth,
  epsGrowth,
  fcfGrowth,
  discountRate = 0.09,
  terminalGrowth = 0.025,
  marginOfSafety = 0.15,
}) {
  const cleanPrice = toNumber(price);
  const eps = toNumber(earningsPerShare);
  const revPerShare = toNumber(revenuePerShare);
  const fcfPerShare = toNumber(freeCashFlowPerShare);
  const book = toNumber(bookValuePerShare);

  const growth = computeGrowthRate({ revenueGrowth, epsGrowth, fcfGrowth });
  const dcf = discountedCashFlow({ startingCashFlow: fcfPerShare ?? eps, growthRate: growth.base, discountRate, terminalGrowth });
  const earningsValue = earningsPowerValue({ earningsPerShare: eps, discountRate });
  const revenueMultiple = revPerShare ? revPerShare * Math.max(0.4, 1 + (growth.base ?? 0)) : null;
  const bookValue = book ? book * 1.1 : null;

  const fairCandidates = [dcf, earningsValue, revenueMultiple, bookValue].map(toNumber).filter((v) => typeof v === 'number' && v > 0);
  const fairValue = fairCandidates.length ? mean(fairCandidates) : null;

  const scenarios = {
    bull: dcf && growth.bull !== undefined ? discountedCashFlow({ startingCashFlow: fcfPerShare ?? eps, growthRate: growth.bull, discountRate: discountRate - 0.01, terminalGrowth: terminalGrowth + 0.005 }) : null,
    base: dcf,
    bear: dcf && growth.bear !== undefined ? discountedCashFlow({ startingCashFlow: fcfPerShare ?? eps, growthRate: growth.bear, discountRate: discountRate + 0.01, terminalGrowth }) : null,
  };

  const downside = fairValue && cleanPrice ? ((fairValue - cleanPrice) / cleanPrice) : null;
  const suggestedEntry = fairValue ? fairValue * (1 - marginOfSafety) : null;

  return {
    price: cleanPrice,
    fairValue,
    marginOfSafety,
    suggestedEntry,
    upside: downside,
    growth,
    scenarios,
    components: {
      discountedCashFlow: dcf,
      earningsPower: earningsValue,
      revenueMultiple,
      bookValue,
    },
    inputs: {
      earningsPerShare: eps,
      revenuePerShare: revPerShare,
      freeCashFlowPerShare: fcfPerShare,
      bookValuePerShare: book,
      revenueGrowth,
      epsGrowth,
      fcfGrowth,
      discountRate,
      terminalGrowth,
    },
  };
}

export function summarizeValuationNarrative(symbol, snapshot) {
  if (!snapshot) return `Insufficient data to evaluate ${symbol}.`;
  const parts = [];
  const price = snapshot.price ?? null;
  const fair = snapshot.fairValue ?? null;
  if (fair && price) {
    const diffPct = ((fair - price) / price) * 100;
    const descriptor = diffPct > 15 ? 'appears undervalued' : diffPct < -15 ? 'screens as overvalued' : 'looks fairly priced';
    parts.push(`${symbol} ${descriptor} with a fair value estimate near $${fair.toFixed(2)} versus the current price of $${price.toFixed(2)}.`);
  } else if (fair) {
    parts.push(`${symbol} has an intrinsic value estimate around $${fair.toFixed(2)}.`);
  }

  const growth = snapshot?.growth;
  if (growth && typeof growth.base === 'number') {
    const pct = (growth.base * 100).toFixed(1);
    parts.push(`Projected baseline growth is ${pct}% annually, with scenarios ranging from ${(growth.bear * 100).toFixed(1)}% to ${(growth.bull * 100).toFixed(1)}%.`);
  }

  if (snapshot?.scenarios) {
    const { bull, bear } = snapshot.scenarios;
    if (bull && bear && snapshot.price) {
      const bullUpside = ((bull - snapshot.price) / snapshot.price) * 100;
      const bearUpside = ((bear - snapshot.price) / snapshot.price) * 100;
      parts.push(`Bull case upside is roughly ${bullUpside.toFixed(1)}% while the bear case implies ${bearUpside.toFixed(1)}%.`);
    }
  }

  if (snapshot?.suggestedEntry && snapshot?.marginOfSafety) {
    parts.push(`Applying a ${(snapshot.marginOfSafety * 100).toFixed(0)}% safety buffer, an attractive entry zone begins near $${snapshot.suggestedEntry.toFixed(2)}.`);
  }

  return parts.join(' ');
}

export const valuationUtils = {
  toNumber,
  mean,
  clamp,
};

export default buildValuationSnapshot;
