import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODULE_PATH = '../netlify/functions/aiAnalyst.js';
const originalFetch = global.fetch;

const buildRequest = (body) => new Request('https://example.org/.netlify/functions/aiAnalyst', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('aiAnalyst Netlify function', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
    delete process.env.GPT5_API_KEY;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns informative fallback when API key is missing', async () => {
    const { default: aiAnalyst } = await import(`${MODULE_PATH}?case=fallback`);
    const response = await aiAnalyst(buildRequest({ symbol: 'AAPL' }));
    const payload = await response.json();
    expect(payload.mock).toBe(true);
    expect(payload.analysis).toMatch(/chatgpt-5 staging mode/i);
  });

  it('passes payload to OpenAI and returns structured analysis', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const aiResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              narrative: 'Fair value supported by durable FCF.',
              valuation: { fairValue: 320, confidence: 0.72, bias: 'Bullish', marginOfSafety: 0.18 },
              checklist: [
                { item: 'Revenue momentum', signal: 'Positive' },
                { item: 'Balance sheet', signal: 'Positive' },
              ],
              meta: { message: 'Valuation rendered successfully.' },
            }),
          },
        },
      ],
    };

    global.fetch = vi.fn(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      expect(url.pathname).toBe('/v1/chat/completions');
      const parsed = JSON.parse(init.body);
      expect(parsed.model).toBeDefined();
      return new Response(JSON.stringify(aiResponse), { status: 200 });
    });

    const { default: aiAnalyst } = await import(`${MODULE_PATH}?case=live`);
    const response = await aiAnalyst(buildRequest({ symbol: 'MSFT', timeframe: '1Y' }));
    const payload = await response.json();

    expect(payload.valuation.fairValue).toBe(320);
    expect(payload.checklist).toHaveLength(2);
    expect(payload.message).toMatch(/valuation rendered successfully/i);
  });
});

