import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTiingoHandler = vi.fn();
const mockGenerateCodexContent = vi.fn();
const mockGenerateGrokContent = vi.fn();
const mockGenerateGeminiContent = vi.fn();

vi.mock('../netlify/functions/tiingo.js', () => ({
  __esModule: true,
  default: mockTiingoHandler,
}));

vi.mock('../netlify/functions/lib/codex.js', () => ({
  __esModule: true,
  getCodexKeyDetail: vi.fn(() => ({ key: 'CHATGPT_CODEX_API_KEY', token: 'codex-token' })),
  getCodexModel: vi.fn(() => 'gpt-codex'),
  generateCodexContent: mockGenerateCodexContent,
}));

vi.mock('../netlify/functions/lib/grok.js', () => ({
  __esModule: true,
  getGrokKeyDetail: vi.fn(() => ({ key: 'GROK_API_KEY', token: 'grok-token' })),
  getGrokModel: vi.fn(() => 'grok-beta'),
  generateGrokContent: mockGenerateGrokContent,
}));

vi.mock('../netlify/functions/lib/gemini.js', () => ({
  __esModule: true,
  getGeminiKeyDetail: vi.fn(() => ({ key: 'GEMINI_API_KEY', token: 'gemini-token' })),
  getGeminiModel: vi.fn(() => 'gemini-1.5'),
  generateGeminiContent: mockGenerateGeminiContent,
}));

const valuationDataset = {
  valuation: {
    price: 120,
    fairValue: 140,
    suggestedEntry: 110,
    marginOfSafety: 0.15,
    growth: { base: 0.08, bull: 0.12, bear: 0.04 },
    scenarios: { bull: 160, bear: 90 },
  },
  price: 120,
  fundamentals: {
    metrics: {
      earningsPerShare: 6,
      revenuePerShare: 45,
      freeCashFlowPerShare: 5,
      bookValuePerShare: 25,
      revenueGrowth: 0.07,
      epsGrowth: 0.08,
      fcfGrowth: 0.06,
    },
    latest: {
      totalDebt: 2000,
      shareholderEquity: 1500,
      netDebt: 1800,
      ebitda: 600,
      netIncome: 320,
    },
  },
};

const buildTiingoResponse = (kind) => {
  switch (kind) {
    case 'valuation':
      return { data: valuationDataset };
    case 'news':
      return { data: [
        { publishedAt: '2024-01-10T00:00:00Z', headline: 'Earnings beat', summary: 'Beating expectations', source: 'Wire', sentiment: 0.5 },
      ] };
    case 'documents':
      return { data: [
        { publishedAt: '2024-01-05T00:00:00Z', headline: '10-Q filing', source: 'SEC', documentType: '10-Q' },
      ] };
    case 'actions':
      return { data: {
        dividends: [{ exDate: '2023-12-15', amount: 0.24, currency: 'USD' }],
        splits: [],
      } };
    case 'eod':
      return { data: [
        { date: '2023-12-01', close: 110 },
        { date: '2023-12-29', close: 120 },
      ] };
    default:
      return { data: null };
  }
};

const mockTiingoRequest = async (request) => {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const payload = buildTiingoResponse(kind);
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-tiingo-source': `mock-${kind}`,
    },
  });
};

const importHandler = async () => {
  const module = await import('../netlify/functions/ai-analyst.js');
  return module.handleRequest;
};

describe('ai-analyst orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTiingoHandler.mockImplementation(mockTiingoRequest);
    mockGenerateCodexContent.mockReset();
    mockGenerateGrokContent.mockReset();
    mockGenerateGeminiContent.mockReset();
  });

  it('prefers ChatGPT Codex response when available and enriches prompt with quant metrics', async () => {
    mockGenerateCodexContent.mockResolvedValue({ text: 'Codex narrative', model: 'gpt-codex' });

    const handleRequest = await importHandler();
    const response = await handleRequest(new Request('https://example.com/.netlify/functions/ai-analyst', {
      method: 'POST',
      body: JSON.stringify({ symbol: 'TEST' }),
      headers: { 'content-type': 'application/json' },
    }));

    const body = await response.json();
    expect(body.narrative.source).toBe('chatgpt-codex');
    expect(body.narrative.text).toBe('Codex narrative');
    expect(body.prompt.user).toMatch(/Quantitative Ratios/);
    expect(body.quant.priceToEarnings).toBeGreaterThan(0);
    expect(mockGenerateGrokContent).not.toHaveBeenCalled();
    expect(mockGenerateGeminiContent).not.toHaveBeenCalled();
  });

  it('falls back to Grok then Gemini when prior services fail', async () => {
    mockGenerateCodexContent.mockRejectedValue(new Error('codex down'));
    mockGenerateGrokContent.mockResolvedValue({ text: 'Grok verdict', model: 'grok-beta' });

    const handleRequest = await importHandler();
    const response = await handleRequest(new Request('https://example.com/.netlify/functions/ai-analyst?symbol=demo'));
    const body = await response.json();

    expect(mockGenerateCodexContent).toHaveBeenCalled();
    expect(mockGenerateGrokContent).toHaveBeenCalled();
    expect(body.narrative.source).toBe('grok');
    expect(body.narrative.text).toBe('Grok verdict');
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.join(' ')).toMatch(/codex down/);
  });

  it('uses Gemini then valuation fallback when all LLM calls fail', async () => {
    mockGenerateCodexContent.mockRejectedValue(new Error('codex down'));
    mockGenerateGrokContent.mockRejectedValue(new Error('grok down'));
    mockGenerateGeminiContent.mockRejectedValue(new Error('gemini down'));

    const handleRequest = await importHandler();
    const response = await handleRequest(new Request('https://example.com/.netlify/functions/ai-analyst?symbol=demo'));
    const body = await response.json();

    expect(body.narrative.source).toBe('fallback');
    expect(body.narrative.text).toContain('DEMO');
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.join(' ')).toMatch(/gemini down/);
  });
});
