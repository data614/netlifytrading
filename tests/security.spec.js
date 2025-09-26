import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { redactSecrets, sanitizeErrorDetail, logError, resetEnvSecretCache } from '../netlify/functions/lib/security.js';

const ORIGINAL_ENV = { ...process.env };

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
  resetEnvSecretCache();
};

describe('security utilities', () => {
  beforeEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('redacts obvious tokens using default patterns', () => {
    const input = 'Access token sk_live_ABC1234567890TOKEN should be hidden.';
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain('sk_live_ABC1234567890TOKEN');
    expect(redacted).toContain('[redacted]');
  });

  it('redacts values discovered from environment variables', () => {
    process.env.SECRET_KEY = 'envSecretValue1234567890';
    resetEnvSecretCache();
    const message = 'Leaked envSecretValue1234567890 in error log.';
    const redacted = redactSecrets(message);
    expect(redacted).not.toContain('envSecretValue1234567890');
    expect(redacted).toContain('[redacted]');
  });

  it('sanitizes error details with fallback and max length', () => {
    const error = new Error('Token leak sk_test_1234567890123456 should not appear.');
    const detail = sanitizeErrorDetail(error, { maxLength: 40 });
    expect(detail.length).toBeLessThanOrEqual(40);
    expect(detail).not.toContain('sk_test_1234567890123456');
  });

  it('logs sanitized errors and returns the detail', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const detail = logError('secure log', 'API key sk_secret_abcdefghijklmnopqrstuvwxyz1234 leaked');
    expect(detail).toContain('[redacted]');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('secure log');
    expect(spy.mock.calls[0][1]).toContain('[redacted]');
  });
});
