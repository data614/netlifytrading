const corsHeaders = {
  'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const MAX_LENGTH = 8000;
const SUPPORTED_PROTOCOLS = new Set(['https:', 'http:']);

const stripHtml = (html = '') => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<\/(div|p|br|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const truncate = (text = '', limit = MAX_LENGTH) => (text.length > limit ? text.slice(0, limit) : text);

const respond = (payload, init = {}) => Response.json(payload, { headers: corsHeaders, ...init });

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return respond({ error: 'invalid_json', detail: 'Expected JSON body.' }, { status: 400 });
  }
  const urlValue = `${body?.url || ''}`.trim();
  if (!urlValue) {
    return respond({ error: 'missing_url', detail: 'Provide a document URL to fetch.' }, { status: 400 });
  }
  let url;
  try {
    url = new URL(urlValue);
  } catch (error) {
    return respond({ error: 'invalid_url', detail: 'URL must be absolute and valid.' }, { status: 400 });
  }
  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    return respond({ error: 'unsupported_protocol', detail: 'Only HTTP(S) documents are supported.' }, { status: 400 });
  }
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NetlifyTrading-DocumentFetcher/1.0 (mailto:ops@example.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upstream ${response.status}: ${text.slice(0, 200)}`);
    }
    const contentType = response.headers.get('content-type') || 'text/plain';
    if (/pdf/i.test(contentType)) {
      return respond({
        url: url.toString(),
        content: '',
        truncated: false,
        contentType,
        warning: 'PDF documents are not converted server-side. Download locally and paste the relevant excerpts.',
      });
    }
    const raw = await response.text();
    const cleaned = stripHtml(raw);
    const truncated = truncate(cleaned);
    return respond({
      url: url.toString(),
      content: truncated,
      truncated: cleaned.length > truncated.length,
      contentType,
      warning: cleaned.length > truncated.length ? 'Document truncated to 8,000 characters for AI analysis.' : '',
    });
  } catch (error) {
    console.error('document-fetch error', error);
    return respond({ error: 'document_fetch_failed', detail: String(error) }, { status: 502 });
  }
}

export default handle;

export const handler = async (event) => {
  const rawQuery = event?.rawQuery ?? event?.rawQueryString ?? '';
  const path = event?.path || '/api/document-fetch';
  const host = event?.headers?.host || 'example.org';
  const url = event?.rawUrl || `https://${host}${path}${rawQuery ? `?${rawQuery}` : ''}`;
  const method = event?.httpMethod || 'POST';
  const body = method === 'GET' || method === 'HEAD' ? undefined : event?.body;
  const request = new Request(url, { method, headers: event?.headers || {}, body });
  const response = await handle(request);
  const headers = {}; response.headers.forEach((value, key) => { headers[key] = value; });
  return { statusCode: response.status, headers, body: await response.text() };
};
