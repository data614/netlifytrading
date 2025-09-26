import { describe, it, expect, afterEach } from 'vitest';
import {
  getRegisteredRedactionPatterns,
  registerRedactionPatterns,
  resetSecurityRegistry,
  getRegisteredSecretKeyHints,
  registerSecretKeyHints,
} from '../netlify/functions/lib/security-registry.js';

const stripeStyleKey = 'sk_live_ABC1234567890TOKEN';

const patternMatches = (value, patterns) =>
  patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });

describe('security registry', () => {
  afterEach(() => {
    resetSecurityRegistry();
  });

  it('includes underscore-aware Stripe style tokens by default', () => {
    const patterns = getRegisteredRedactionPatterns();
    expect(patternMatches(stripeStyleKey, patterns)).toBe(true);
  });

  it('allows registering additional patterns without mutating defaults', () => {
    const initialPatterns = getRegisteredRedactionPatterns();
    expect(patternMatches('not-a-secret', initialPatterns)).toBe(false);

    registerRedactionPatterns([/not-a-secret/g]);

    const updatedPatterns = getRegisteredRedactionPatterns();
    expect(patternMatches('not-a-secret', updatedPatterns)).toBe(true);

    // ensure the original snapshot was not mutated
    expect(patternMatches('not-a-secret', initialPatterns)).toBe(false);
  });

  it('normalizes custom secret key hints', () => {
    registerSecretKeyHints(['customHint', '  api  ']);
    const hints = getRegisteredSecretKeyHints();
    expect(hints).toContain('CUSTOMHINT');
    expect(hints).toContain('API');
  });
});
