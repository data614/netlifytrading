const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeDocument = (doc = {}) => ({
  headline: doc.headline || doc.title || doc.name || 'Document',
  url: doc.url || doc.link || '#',
  publishedAt: doc.publishedAt || doc.date || doc.filedAt || doc.updatedAt || null,
  documentType: doc.documentType || doc.type || 'Filing',
  source: doc.source || doc.provider || '',
});

const buildTimeline = (symbol, news = [], actions = {}) => {
  const entries = [];

  news.forEach((item) => {
    const publishedAt = toDate(item?.publishedAt);
    if (!publishedAt) return;
    entries.push({
      type: 'news',
      symbol,
      headline: item?.headline || item?.title || 'News',
      summary: item?.summary || '',
      source: item?.source || '',
      url: item?.url || '#',
      publishedAt: publishedAt.toISOString(),
      sentiment: toNumber(item?.sentiment),
    });
  });

  (actions?.dividends || []).forEach((div) => {
    const date = toDate(div?.exDate || div?.payDate || div?.recordDate);
    if (!date) return;
    entries.push({
      type: 'dividend',
      symbol,
      headline: `Dividend $${Number(div?.amount ?? 0).toFixed(2)}`,
      summary: `Ex-date ${div?.exDate || '—'} · Pay date ${div?.payDate || '—'}`,
      publishedAt: date.toISOString(),
      amount: toNumber(div?.amount),
      currency: div?.currency || 'USD',
    });
  });

  (actions?.splits || []).forEach((split) => {
    const date = toDate(split?.exDate);
    if (!date) return;
    const ratioNumerator = Number.isFinite(Number(split?.numerator)) ? split.numerator : 1;
    const ratioDenominator = Number.isFinite(Number(split?.denominator)) ? split.denominator : 1;
    entries.push({
      type: 'split',
      symbol,
      headline: `Stock split ${ratioNumerator}:${ratioDenominator}`,
      summary: 'Corporate action recorded by Tiingo.',
      publishedAt: date.toISOString(),
    });
  });

  return entries
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 40);
};

const coalesceWarning = (bodyWarning, headerWarning, warningsArray = [], narrativeErrors = {}) => {
  const combined = [bodyWarning, headerWarning, ...warningsArray];
  combined.push(...Object.values(narrativeErrors || {}));
  return combined
    .map((message) => (typeof message === 'string' ? message.trim() : ''))
    .filter(Boolean)
    .join(' | ');
};

const attachFundamentals = (valuation = {}, fundamentals) => {
  if (!fundamentals) return valuation;
  if (valuation && typeof valuation === 'object') {
    if (!('fundamentals' in valuation) || !valuation.fundamentals) {
      return { ...valuation, fundamentals };
    }
  }
  return valuation;
};

export function normalizeAiAnalystPayload(body = {}, { warningHeader } = {}) {
  if (body && typeof body === 'object' && 'data' in body) {
    return {
      data: body.data,
      warning: body.warning || warningHeader || '',
      meta: {},
    };
  }

  const datasets = body?.tiingo?.data || {};
  const symbol = (body?.symbol || datasets?.valuation?.symbol || '').toUpperCase();
  const valuation = attachFundamentals(
    datasets?.valuation ? { ...datasets.valuation } : {},
    datasets?.fundamentals,
  );
  const news = Array.isArray(datasets?.news) ? datasets.news : [];
  const actions = datasets?.actions && typeof datasets.actions === 'object' ? datasets.actions : {};
  const documents = Array.isArray(datasets?.documents)
    ? datasets.documents.map((doc) => normalizeDocument(doc))
    : [];
  const trend = Array.isArray(datasets?.priceHistory)
    ? datasets.priceHistory
    : Array.isArray(datasets?.trend)
      ? datasets.trend
      : [];
  const aiSummary = typeof body?.narrative?.text === 'string' && body.narrative.text.trim()
    ? body.narrative.text.trim()
    : typeof body?.narrative === 'string' && body.narrative.trim()
      ? body.narrative.trim()
      : (valuation?.narrative && typeof valuation.narrative === 'string' ? valuation.narrative : '').trim();

  const timeline = buildTimeline(symbol, news, actions);
  const generatedAt = body?.generatedAt || body?.tiingo?.generatedAt || '';

  const warning = coalesceWarning(
    body?.warning,
    warningHeader,
    Array.isArray(body?.warnings) ? body.warnings : [],
    body?.narrative?.errors,
  );

  const meta = {
    narrativeSource: body?.narrative?.source || 'fallback',
    llm: {
      codex: body?.narrative?.codex,
      grok: body?.narrative?.grok,
      gemini: body?.narrative?.gemini,
    },
    tiingo: body?.tiingo?.responses || {},
    quant: body?.quant || null,
    warnings: Array.isArray(body?.warnings) ? body.warnings : [],
  };

  return {
    data: {
      symbol,
      valuation,
      news,
      documents,
      actions,
      timeline,
      trend,
      aiSummary,
      generatedAt,
      quant: body?.quant || null,
      meta,
    },
    warning,
    meta,
  };
}

export default normalizeAiAnalystPayload;
