const BASELINES = {
  AAPL: {
    price: 188.4,
    valuation: {
      fairValue: 206.5,
      suggestedEntry: 183.5,
      scenarios: {
        bull: 234,
        base: 206.5,
        bear: 170.2,
      },
    },
    assumptions: {
      revenueCagr: 11.2,
      terminalGrowth: 3.1,
      ebitdaMargin: 27.5,
      operatingLeverage: 'balanced',
      fcfConversion: 82,
      costMode: 'opex',
      discountRate: 8.3,
      debtRatio: 0.9,
      buyback: 'neutral',
    },
    narrative:
      'Baseline calibration anchored by services resilience and hardware refresh cadence. Upside requires continued App Store ARPU acceleration and successful Vision Pro ecosystem scaling.',
  },
  MSFT: {
    price: 415.1,
    valuation: {
      fairValue: 455.2,
      suggestedEntry: 402.5,
      scenarios: {
        bull: 497,
        base: 455.2,
        bear: 375.4,
      },
    },
    assumptions: {
      revenueCagr: 12.5,
      terminalGrowth: 3.2,
      ebitdaMargin: 43.5,
      operatingLeverage: 'balanced',
      fcfConversion: 94,
      costMode: 'opex',
      discountRate: 8,
      debtRatio: 1.1,
      buyback: 'aggressive',
    },
    narrative:
      'Cloud AI attach and seat monetization remain the primary levers. Watch for enterprise optimization fatigue and net retention drift.',
  },
  NVDA: {
    price: 910.6,
    valuation: {
      fairValue: 990.3,
      suggestedEntry: 862.8,
      scenarios: {
        bull: 1175,
        base: 990.3,
        bear: 720.5,
      },
    },
    assumptions: {
      revenueCagr: 28,
      terminalGrowth: 4,
      ebitdaMargin: 51,
      operatingLeverage: 'balanced',
      fcfConversion: 78,
      costMode: 'capex',
      discountRate: 9.6,
      debtRatio: 1.2,
      buyback: 'neutral',
    },
    narrative:
      'Blackwell cycle strength priced in. Monitor packaging supply and hyperscaler capex pacing for signs of fatigue.',
  },
  GOOGL: {
    price: 176.9,
    valuation: {
      fairValue: 192.4,
      suggestedEntry: 170.2,
      scenarios: {
        bull: 215.6,
        base: 192.4,
        bear: 156.5,
      },
    },
    assumptions: {
      revenueCagr: 10.5,
      terminalGrowth: 3,
      ebitdaMargin: 33.4,
      operatingLeverage: 'steady',
      fcfConversion: 88,
      costMode: 'opex',
      discountRate: 8.6,
      debtRatio: 0.6,
      buyback: 'aggressive',
    },
    narrative:
      'Search and commerce normalization with AI guardrails on TAC. Watch core margin trajectory as Gemini spending scales.',
  },
};

const DEFAULT_BASELINE = {
  price: 50,
  valuation: {
    fairValue: 54,
    suggestedEntry: 47,
    scenarios: {
      bull: 62,
      base: 54,
      bear: 38,
    },
  },
  assumptions: {
    revenueCagr: 9,
    terminalGrowth: 2.5,
    ebitdaMargin: 22,
    operatingLeverage: 'steady',
    fcfConversion: 75,
    costMode: 'opex',
    discountRate: 9,
    debtRatio: 1.3,
    buyback: 'neutral',
  },
  narrative:
    'No internal coverage baseline available. Apply house assumptions and align diligence cadence before using live outputs.',
};

const clamp = (value, min, max) => {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const lookupImpact = (key, table, fallback = 0) => {
  if (!key) return fallback;
  return table[key] ?? fallback;
};

function normalizeNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function mergeAssumptions(snapshot, baseline) {
  const assumptionSource = snapshot?.assumptions;
  if (!assumptionSource) return { ...baseline };
  return {
    ...baseline,
    ...assumptionSource,
  };
}

function computeAdjustment(inputs, anchors) {
  const growthDelta = (normalizeNumber(inputs.revenueCagr, anchors.revenueCagr) - anchors.revenueCagr) / Math.max(anchors.revenueCagr, 1);
  const marginDelta = (normalizeNumber(inputs.ebitdaMargin, anchors.ebitdaMargin) - anchors.ebitdaMargin) / 100;
  const terminalDelta = (normalizeNumber(inputs.terminalGrowth, anchors.terminalGrowth) - anchors.terminalGrowth) / 100;
  const conversionDelta = (normalizeNumber(inputs.fcfConversion, anchors.fcfConversion) - anchors.fcfConversion) / 100;
  const discountDelta = (normalizeNumber(inputs.discountRate, anchors.discountRate) - anchors.discountRate) / 100;
  const debtDelta = normalizeNumber(inputs.debtRatio, anchors.debtRatio) - anchors.debtRatio;

  let adjustment = 0;
  adjustment += growthDelta * 0.42;
  adjustment += marginDelta * 0.3;
  adjustment += terminalDelta * 0.12;
  adjustment += conversionDelta * 0.08;
  adjustment -= discountDelta * 0.38;

  if (debtDelta > 0) {
    adjustment -= Math.min(debtDelta * 0.07, 0.12);
  } else if (debtDelta < 0) {
    adjustment += Math.min(Math.abs(debtDelta) * 0.04, 0.08);
  }

  adjustment += lookupImpact(inputs.growthMode, {
    accelerating: 0.03,
    steady: 0,
    decelerating: -0.05,
  });

  adjustment += lookupImpact(inputs.operatingLeverage, {
    light: 0.02,
    balanced: 0,
    'capital-intensive': -0.025,
  });

  adjustment += lookupImpact(inputs.costMode, {
    opex: 0.015,
    capex: -0.015,
  });

  adjustment += lookupImpact(inputs.buyback, {
    aggressive: 0.02,
    neutral: 0,
    paused: -0.02,
  });

  return clamp(adjustment, -0.4, 0.5);
}

function deriveScenarios(baseFairValue, adjustment, inputs) {
  const upsideBias = lookupImpact(inputs.growthMode, {
    accelerating: 0.04,
    steady: 0,
    decelerating: -0.04,
  });
  const bullSpread = clamp(0.18 + Math.max(adjustment, 0) * 0.5 + upsideBias, 0.12, 0.38);
  const bearSpread = clamp(0.22 + Math.max(-adjustment, 0) * 0.45 - upsideBias * 0.8, 0.14, 0.4);

  const bull = baseFairValue * (1 + bullSpread);
  const bear = baseFairValue * (1 - bearSpread);
  return {
    bull,
    base: baseFairValue,
    bear: Math.max(bear, baseFairValue * 0.35),
  };
}

function buildNarrative(symbol, baseNarrative, adjustment, inputs) {
  const direction = adjustment > 0.02 ? 'upward bias to fair value' : adjustment < -0.02 ? 'downward bias to fair value' : 'steady-state valuation bias';
  const growthDescriptor = lookupImpact(inputs.growthMode, {
    accelerating: 'accelerating top-line cadence',
    steady: 'steady revenue glide path',
    decelerating: 'moderating growth slope',
  }, 'balanced trajectory');
  const costDescriptor = lookupImpact(inputs.costMode, {
    opex: 'opex discipline',
    capex: 'capex flexibility program',
  }, 'cost posture');
  const leverageDescriptor = lookupImpact(inputs.operatingLeverage, {
    light: 'asset-light mix supporting higher incremental margins',
    balanced: 'balanced leverage framework',
    'capital-intensive': 'heavier capital intensity pressuring returns',
  }, 'capital deployment stance');

  const tilt = adjustment > 0 ? 'expansion' : adjustment < 0 ? 'compression' : 'balance';

  return `${symbol} valuation framework indicates ${direction} with ${growthDescriptor} and ${costDescriptor}. Operating model ${tilt} reflects ${leverageDescriptor}. ${baseNarrative}`;
}

function computeSensitivity(adjustment, inputs) {
  const growthModeImpact = lookupImpact(inputs.growthMode, {
    accelerating: 0.9,
    steady: 0.4,
    decelerating: -0.6,
  });
  const costModeImpact = lookupImpact(inputs.costMode, {
    opex: 0.6,
    capex: -0.4,
  });
  const leverageImpact = lookupImpact(inputs.operatingLeverage, {
    light: 0.7,
    balanced: 0.2,
    'capital-intensive': -0.5,
  });

  return {
    revenue: {
      positive: (0.6 + adjustment * 1.2 + growthModeImpact * 0.2).toFixed(1),
      neutral: (0.2 + adjustment * 0.4).toFixed(1),
      negative: (-0.5 + adjustment * 0.3).toFixed(1),
    },
    margins: {
      positive: (0.8 + costModeImpact * 0.6).toFixed(1),
      neutral: (0.3 + adjustment * 0.3).toFixed(1),
      negative: (-0.6 + costModeImpact * 0.4).toFixed(1),
    },
    discount: {
      positive: (-0.9 - adjustment * 0.5).toFixed(1),
      neutral: (-0.5 - adjustment * 0.3).toFixed(1),
      negative: (0.1 - adjustment * 0.2).toFixed(1),
    },
  };
}

function computeDiagnostics(baseFairValue, adjustment, inputs, price) {
  const dispersion = clamp(12 + Math.abs(adjustment) * 48, 10, 45);
  const p90 = baseFairValue * (1 + dispersion / 100);
  const p10 = baseFairValue * (1 - dispersion / 100);
  const confidence = clamp(62 + (0.5 - Math.abs(inputs.discountRate - 8)) * 4 - Math.abs(adjustment) * 18, 35, 92);
  const riskTilt = adjustment >= 0 ? 'balanced-to-upside' : 'balanced-to-downside';

  return {
    dispersion,
    distribution: {
      p10,
      median: baseFairValue,
      p90,
    },
    confidence,
    riskTilt,
    sensitivity: computeSensitivity(adjustment, inputs),
    peerPositioning: {
      pe: adjustment >= 0 ? 1.4 : 0.8,
      sales: adjustment >= 0 ? 0.9 : 0.7,
      fcf: adjustment >= 0 ? -0.3 : 0.2,
      rule40: 1.1 + adjustment * 0.6,
    },
    price,
  };
}

export function getBaseline(symbol) {
  const key = (symbol || '').trim().toUpperCase();
  if (!key) return DEFAULT_BASELINE;
  return BASELINES[key] || DEFAULT_BASELINE;
}

export function buildValuationView({ symbol, snapshot, overrides = {} }) {
  const baseline = getBaseline(symbol);
  const valuationSource = snapshot?.valuation || {};
  const price = normalizeNumber(snapshot?.price, baseline.price);
  const baseFairValue = normalizeNumber(valuationSource.fairValue, baseline.valuation.fairValue);
  const baseEntry = normalizeNumber(valuationSource.suggestedEntry, baseline.valuation.suggestedEntry);
  const baseScenarios = {
    bull: normalizeNumber(valuationSource.scenarios?.bull, baseline.valuation.scenarios.bull),
    base: normalizeNumber(valuationSource.scenarios?.base, baseline.valuation.scenarios.base),
    bear: normalizeNumber(valuationSource.scenarios?.bear, baseline.valuation.scenarios.bear),
  };

  const assumptions = mergeAssumptions(snapshot, baseline.assumptions);
  const inputs = {
    revenueCagr: normalizeNumber(overrides.revenueCagr, assumptions.revenueCagr),
    terminalGrowth: normalizeNumber(overrides.terminalGrowth, assumptions.terminalGrowth),
    growthMode: overrides.growthMode || assumptions.growthMode,
    ebitdaMargin: normalizeNumber(overrides.ebitdaMargin, assumptions.ebitdaMargin),
    operatingLeverage: overrides.operatingLeverage || assumptions.operatingLeverage,
    fcfConversion: normalizeNumber(overrides.fcfConversion, assumptions.fcfConversion),
    costMode: overrides.costMode || assumptions.costMode,
    discountRate: normalizeNumber(overrides.discountRate, assumptions.discountRate),
    debtRatio: normalizeNumber(overrides.debtRatio, assumptions.debtRatio),
    buyback: overrides.buyback || assumptions.buyback,
  };

  const adjustment = computeAdjustment(inputs, assumptions);
  const fairValue = (baseFairValue || baseline.valuation.fairValue) * (1 + adjustment);
  const suggestedEntry = clamp(
    fairValue * (0.88 - (inputs.discountRate - assumptions.discountRate) * 0.015 + lookupImpact(inputs.buyback, {
      aggressive: 0.01,
      neutral: 0,
      paused: -0.01,
    })),
    fairValue * 0.6,
    fairValue * 0.97,
  );

  const scenarios = deriveScenarios(fairValue, adjustment, inputs);
  const fallbackScenarios = {
    bull: baseScenarios.bull,
    base: baseScenarios.base,
    bear: baseScenarios.bear,
  };
  const blendedScenarios = {
    bull: (scenarios.bull * 0.7) + (fallbackScenarios.bull * 0.3),
    base: (scenarios.base * 0.7) + (fallbackScenarios.base * 0.3),
    bear: (scenarios.bear * 0.7) + (fallbackScenarios.bear * 0.3),
  };

  const narrative = buildNarrative(
    (symbol || '').toUpperCase() || 'TICKER',
    snapshot?.narrative || baseline.narrative,
    adjustment,
    inputs,
  );

  const diagnostics = computeDiagnostics(fairValue, adjustment, inputs, price);

  return {
    symbol: (symbol || '').toUpperCase() || 'AAPL',
    price,
    valuation: {
      price,
      fairValue,
      suggestedEntry,
      upside: price ? (fairValue - price) / price : 0,
      scenarios: blendedScenarios,
      adjustment,
      inputs,
    },
    narrative,
    diagnostics,
    meta: {
      baselineUsed: baseline !== DEFAULT_BASELINE,
      lastUpdated: new Date(),
    },
  };
}

export function createScenarioCsv(view) {
  if (!view?.valuation) return '';
  const { valuation } = view;
  const rows = [
    ['Scenario', 'Value', 'Delta vs Price'],
  ];
  const price = valuation.price || 0;
  const { scenarios } = valuation;
  [['Bull', scenarios?.bull], ['Base', scenarios?.base], ['Bear', scenarios?.bear]].forEach(([label, value]) => {
    if (!Number.isFinite(Number(value))) return;
    const delta = price ? (Number(value) - price) / price : null;
    rows.push([
      label,
      Number(value).toFixed(2),
      delta === null ? 'n/a' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
    ]);
  });
  return rows.map((row) => row.join(',')).join('\n');
}
