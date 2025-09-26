import { describe, it, expect } from 'vitest';
import normalizeAiAnalystPayload from '../utils/ai-analyst-normalizer.js';

describe('normalizeAiAnalystPayload', () => {
  it('returns legacy payloads unchanged when data property is present', () => {
    const legacy = { data: { foo: 'bar' }, warning: 'Heads up' };
    const result = normalizeAiAnalystPayload(legacy, { warningHeader: 'ignored' });
    expect(result.data).toEqual({ foo: 'bar' });
    expect(result.warning).toBe('Heads up');
  });

  it('normalizes modern orchestrator responses into desk-compatible shape', () => {
    const body = {
      symbol: 'msft',
      generatedAt: '2024-05-01T00:00:00.000Z',
      tiingo: {
        data: {
          valuation: { price: 100, valuation: { fairValue: 120 } },
          fundamentals: { metrics: { revenuePerShare: 10 } },
          news: [
            {
              headline: 'Earnings beat expectations',
              summary: 'Revenue up 20%.',
              source: 'Reuters',
              url: 'https://example.com/news',
              publishedAt: '2024-04-20T10:00:00.000Z',
              sentiment: 0.6,
            },
          ],
          documents: [
            { headline: '10-Q Filing', url: 'https://example.com/doc', publishedAt: '2024-04-15' },
          ],
          actions: {
            dividends: [
              { exDate: '2024-03-01', payDate: '2024-03-10', amount: 0.68, currency: 'USD' },
            ],
            splits: [
              { exDate: '2023-06-15', numerator: 2, denominator: 1 },
            ],
          },
          priceHistory: [
            { date: '2024-01-01', close: 90 },
            { date: '2024-04-30', close: 110 },
          ],
        },
        responses: {
          valuation: { status: 200 },
        },
      },
      narrative: {
        text: 'MSFT maintains strong cloud momentum with resilient fundamentals.',
        source: 'chatgpt-codex',
        codex: { model: 'gpt-codex' },
      },
      warnings: ['Limited filings available'],
      quant: { priceToEarnings: 28 },
    };

    const result = normalizeAiAnalystPayload(body, { warningHeader: 'Upstream notice' });

    expect(result.data.symbol).toBe('MSFT');
    expect(result.data.aiSummary).toContain('cloud momentum');
    expect(Array.isArray(result.data.timeline)).toBe(true);
    expect(result.data.timeline.length).toBeGreaterThan(0);
    expect(result.data.documents[0]).toMatchObject({ headline: '10-Q Filing', documentType: 'Filing' });
    expect(result.data.valuation.fundamentals).toEqual({ metrics: { revenuePerShare: 10 } });
    expect(result.warning).toContain('Upstream notice');
    expect(result.warning).toContain('Limited filings available');
    expect(result.meta.narrativeSource).toBe('chatgpt-codex');
  });
});
