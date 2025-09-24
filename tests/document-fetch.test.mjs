import test from 'node:test';
import assert from 'node:assert/strict';

const { handler } = await import('../netlify/functions/document-fetch.js');

const baseEvent = {
  httpMethod: 'POST',
  path: '/api/document-fetch',
  headers: { 'content-type': 'application/json' },
};

const withFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

test('rejects invalid URLs', async () => {
  const response = await handler({ ...baseEvent, body: JSON.stringify({ url: 'not-a-url' }) });
  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, 'invalid_url');
});

test('fetches and cleans HTML content', async () => {
  await withFetch(async () => new Response('<html><body><h1>Title</h1><p>Paragraph</p></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }), async () => {
    const response = await handler({ ...baseEvent, body: JSON.stringify({ url: 'https://example.com/doc' }) });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.ok(payload.content.includes('Title'));
    assert.equal(payload.contentType, 'text/html');
  });
});

test('warns on PDF documents', async () => {
  await withFetch(async () => new Response('', {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  }), async () => {
    const response = await handler({ ...baseEvent, body: JSON.stringify({ url: 'https://example.com/file.pdf' }) });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.ok(payload.warning.includes('PDF'));
    assert.equal(payload.content, '');
  });
});
