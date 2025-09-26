const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

const HTML_ESCAPE_MAP = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

const HTML_ESCAPE_REGEX = /[&<>"']/g;

const toDisplayString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  }
  if (typeof value.toString === 'function') {
    return value.toString();
  }
  return '';
};

export const sanitizeText = (value) => toDisplayString(value).replace(CONTROL_CHAR_PATTERN, '');

export const escapeHtml = (value) =>
  sanitizeText(value).replace(HTML_ESCAPE_REGEX, (char) => HTML_ESCAPE_MAP[char] || char);

export const sanitizeAttribute = (value, { maxLength } = {}) => {
  let text = sanitizeText(value);
  if (Number.isFinite(maxLength) && maxLength > 0 && text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1)}…`;
  }
  return text;
};

export default escapeHtml;
