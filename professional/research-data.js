const LAB_FOCUS = {
  AAPL: {
    summary:
      'Services monetization pacing above plan with ecosystem lock-in offsetting hardware softness. Monitoring Vision Pro ramp and gross margin cadence into FY24.',
    positioning: 'Overweight bias with tactical adds on 2-3% pullbacks versus NASDAQ futures.',
    quickStats: [
      { label: 'Fundamental Bias', value: 'Positive', tone: 'positive' },
      { label: 'Catalyst Window', value: 'WWDC · 2 weeks', tone: 'neutral' },
      { label: 'Risk Flag', value: 'China demand volatility', tone: 'caution' },
    ],
    diligence: [
      { title: 'Services ARPU sensitivity refresh', owner: 'Platform Strategy', due: 'Due Friday' },
      { title: 'Channel inventory pulse check', owner: 'Global Supply', due: 'Rolling' },
    ],
    catalysts: [
      { label: 'June 10', detail: 'WWDC keynote — services roadmap & AI co-pilots' },
      { label: 'Late July', detail: 'FQ3 print — margin commentary & China update' },
    ],
  },
  MSFT: {
    summary:
      'Azure AI workloads comping >35% with strong OpenAI attach; Copilot monetization broadening to security SKUs. Watching enterprise optimization cycle for fatigue.',
    positioning: 'Maintain core overweight, scale adds around 50-day support with tight risk markers.',
    quickStats: [
      { label: 'Fundamental Bias', value: 'Positive', tone: 'positive' },
      { label: 'Catalyst Window', value: 'Ignite + Inspire', tone: 'neutral' },
      { label: 'Risk Flag', value: 'Enterprise optimization', tone: 'caution' },
    ],
    diligence: [
      { title: 'Copilot seat adoption tracker', owner: 'Enterprise SaaS', due: 'Updated daily' },
      { title: 'Azure consumption telemetry', owner: 'Cloud Ops', due: 'Due Monday' },
    ],
    catalysts: [
      { label: 'June', detail: 'Copilot pricing expansion to security bundle' },
      { label: 'July', detail: 'FY4Q print — AI contribution disclosure' },
    ],
  },
  NVDA: {
    summary:
      'Blackwell transition pacing clean with enterprise backlog visibility through CY25; supply chain risk shifting to advanced packaging. Monitoring hyperscaler capex cadence.',
    positioning: 'Core overweight with hedged gamma; allow for volatility around semi cap prints.',
    quickStats: [
      { label: 'Fundamental Bias', value: 'Strong Positive', tone: 'positive' },
      { label: 'Catalyst Window', value: 'GTC EU updates', tone: 'neutral' },
      { label: 'Risk Flag', value: 'Packaging capacity & export controls', tone: 'caution' },
    ],
    diligence: [
      { title: 'Hyperscaler orderbook audit', owner: 'Data Infrastructure', due: 'This week' },
      { title: 'Supply chain policy watch', owner: 'Regulatory Desk', due: 'Continuous' },
    ],
    catalysts: [
      { label: 'Mid-June', detail: 'Computex follow-through — enterprise design wins' },
      { label: 'Late August', detail: '2Q FY25 results — Blackwell revenue mix' },
    ],
  },
  GOOGL: {
    summary:
      'Gemini integration stabilizing search economics with commerce recovery; YouTube shoppable traction improving. Keeping guardrails around AI infra spend.',
    positioning: 'Overweight pivoting to core ad recovery with defensive stance on TAC inflation.',
    quickStats: [
      { label: 'Fundamental Bias', value: 'Constructive', tone: 'positive' },
      { label: 'Catalyst Window', value: 'Marketing Live · mid-June', tone: 'neutral' },
      { label: 'Risk Flag', value: 'AI traffic acquisition costs', tone: 'caution' },
    ],
    diligence: [
      { title: 'Retail ad vertical scrub', owner: 'Performance Media', due: 'Due Tuesday' },
      { title: 'Gemini UX studies', owner: 'Design Research', due: 'Rolling' },
    ],
    catalysts: [
      { label: 'June', detail: 'Marketing Live — shopping roadmap' },
      { label: 'Late July', detail: 'Q2 earnings — TAC disclosure' },
    ],
  },
};

const SCREENER_PRESETS = {
  AAPL: {
    summary: 'Premium franchise with stable cash generation; screening for incremental upside via services growth.',
    metrics: [
      { label: 'Fair Value', value: '$213', delta: '+8%', tone: 'positive' },
      { label: 'Upside vs Spot', value: '+9.6%', tone: 'positive' },
      { label: 'Momentum Score', value: '58', tone: 'neutral' },
    ],
    topIdeas: [
      { symbol: 'AAPL', upside: '+9%', thesis: 'Services ARPU driving multiple support' },
      { symbol: 'CRM', upside: '+15%', thesis: 'GenAI attach into core cloud deals' },
      { symbol: 'ADBE', upside: '+12%', thesis: 'Firefly monetization broadening TAM' },
    ],
  },
  MSFT: {
    summary: 'Enterprise AI leadership screen highlights premium cash flow durability with optionality in security.',
    metrics: [
      { label: 'Fair Value', value: '$465', delta: '+11%', tone: 'positive' },
      { label: 'Upside vs Spot', value: '+7.8%', tone: 'positive' },
      { label: 'Momentum Score', value: '62', tone: 'positive' },
    ],
    topIdeas: [
      { symbol: 'MSFT', upside: '+8%', thesis: 'Copilot monetization with strong renewals' },
      { symbol: 'NOW', upside: '+13%', thesis: 'Platform AI adoption accelerating workflows' },
      { symbol: 'SNOW', upside: '+18%', thesis: 'Consumption recovery with AI workloads' },
    ],
  },
  NVDA: {
    summary: 'Accelerated compute complex — screening for downstream beneficiaries and thermal risks.',
    metrics: [
      { label: 'Fair Value', value: '$1,200', delta: '+14%', tone: 'positive' },
      { label: 'Upside vs Spot', value: '+10.2%', tone: 'positive' },
      { label: 'Momentum Score', value: '74', tone: 'positive' },
    ],
    topIdeas: [
      { symbol: 'NVDA', upside: '+10%', thesis: 'Blackwell cycle extends datacenter demand' },
      { symbol: 'ASML', upside: '+16%', thesis: 'High-NA EUV leverage to AI capex' },
      { symbol: 'AVGO', upside: '+11%', thesis: 'Custom accelerators & networking tailwinds' },
    ],
  },
  GOOGL: {
    summary: 'AI-enabled advertising rebuild — screening for monetization lift and margin resiliency.',
    metrics: [
      { label: 'Fair Value', value: '$192', delta: '+9%', tone: 'positive' },
      { label: 'Upside vs Spot', value: '+6.5%', tone: 'positive' },
      { label: 'Momentum Score', value: '55', tone: 'neutral' },
    ],
    topIdeas: [
      { symbol: 'GOOGL', upside: '+7%', thesis: 'Search share stabilizes with Gemini roll-out' },
      { symbol: 'META', upside: '+14%', thesis: 'Reels monetization scaling across surfaces' },
      { symbol: 'TTD', upside: '+19%', thesis: 'Retail media network expansion' },
    ],
  },
};

function normalizeSymbol(symbol) {
  return (symbol || '').trim().toUpperCase() || 'AAPL';
}

export function getResearchLabInsights(symbol) {
  const key = normalizeSymbol(symbol);
  const payload = LAB_FOCUS[key] || {
    summary: 'No dedicated research streams yet. Use the Research Lab to capture diligence findings for this ticker.',
    positioning: 'Establish baseline coverage with quick peer benchmarking and macro overlays.',
    quickStats: [
      { label: 'Coverage Status', value: 'Initiate', tone: 'neutral' },
      { label: 'Catalyst Window', value: 'TBD', tone: 'neutral' },
      { label: 'Risk Flag', value: 'Pending', tone: 'caution' },
    ],
    diligence: [
      { title: 'Assign sector lead', owner: 'Research Ops', due: 'Unassigned' },
      { title: 'Outline diligence cadence', owner: 'Team Lead', due: 'TBD' },
    ],
    catalysts: [],
  };

  return {
    symbol: key,
    meta: {
      source: 'mock',
      kind: 'research_lab',
      reason: 'static_sample',
      label: 'Research Lab',
      title: 'Source: Research Lab insights (sample data)',
    },
    ...payload,
  };
}

export function getScreenerSnapshot(symbol) {
  const key = normalizeSymbol(symbol);
  const payload = SCREENER_PRESETS[key] || {
    summary: 'Run a focused quant screen to populate comparative valuation and momentum signals for this symbol.',
    metrics: [
      { label: 'Fair Value', value: '—', delta: 'n/a', tone: 'neutral' },
      { label: 'Upside vs Spot', value: '—', tone: 'neutral' },
      { label: 'Momentum Score', value: '—', tone: 'neutral' },
    ],
    topIdeas: [],
  };

  return {
    symbol: key,
    meta: {
      source: 'mock',
      kind: 'quant_screener',
      reason: 'static_sample',
      label: 'Quant Screener',
      title: 'Source: Quant Screener snapshot (sample data)',
    },
    ...payload,
  };
}
