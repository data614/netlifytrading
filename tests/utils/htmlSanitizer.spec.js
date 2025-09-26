import { describe, expect, it } from 'vitest';
import escapeHtml, { sanitizeAttribute, sanitizeText } from '../../utils/html-sanitizer.js';

describe('html sanitizer utilities', () => {
  it('escapes html significant characters', () => {
    const value = "<script>alert('xss') & more";
    expect(escapeHtml(value)).toBe('&lt;script&gt;alert(&#39;xss&#39;) &amp; more');
  });

  it('removes control characters from text content', () => {
    const value = 'hello\u0000world\u0008!';
    expect(sanitizeText(value)).toBe('helloworld!');
  });

  it('converts primitives safely', () => {
    expect(escapeHtml(123)).toBe('123');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('sanitizes attribute values with optional truncation', () => {
    const value = 'This is a long attribute value with <tags> inside';
    expect(sanitizeAttribute(value, { maxLength: 20 })).toBe('This is a long attr…');
    expect(sanitizeAttribute(value)).toBe('This is a long attribute value with <tags> inside');
  });
});
