const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const safeDivide = (numerator, denominator) => {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (n === null || d === null || d === 0) return null;
  return n / d;
};

export const priceToEarnings = (price, earningsPerShare) => safeDivide(price, earningsPerShare);

export const priceToSales = (price, revenuePerShare) => safeDivide(price, revenuePerShare);

export const debtToEquity = (totalDebt, shareholdersEquity) => safeDivide(totalDebt, shareholdersEquity);

export const freeCashFlowYield = (price, freeCashFlowPerShare) => {
  const ratio = safeDivide(freeCashFlowPerShare, price);
  return ratio === null ? null : ratio;
};

export const netDebtToEBITDA = (netDebt, ebitda) => safeDivide(netDebt, ebitda);

export const returnOnEquity = (netIncome, shareholdersEquity) => safeDivide(netIncome, shareholdersEquity);

export const toQuantNumber = toNumber;

export default {
  priceToEarnings,
  priceToSales,
  debtToEquity,
  freeCashFlowYield,
  netDebtToEBITDA,
  returnOnEquity,
  toQuantNumber,
};
