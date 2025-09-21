
// netlify/functions/sendEmail.js
// Sends transactional emails via EmailJS REST API using a PRIVATE key (server-to-server).
// Exposes POST /api/sendEmail
// Body: { template_params: {...}, service_id?, template_id? }
// Optional: override service_id/template_id in body; otherwise use env defaults.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const {
      service_id,
      template_id,
      template_params,
    } = JSON.parse(event.body || '{}');

    // Prefer body override, else env defaults
    const envValue = (...keys) => {
      for (const key of keys) {
        if (process.env[key]) return process.env[key];
      }
      return undefined;
    };

    const SERVICE_ID = service_id || envValue('EMAILJS_SERVICE_ID', 'EMAILS_SERVICE_ID');
    const TEMPLATE_ID = template_id || envValue('EMAILJS_TEMPLATE_ID', 'EMAILS_TEMPLATE_ID');
    const PRIVATE_KEY = envValue('EMAILJS_PRIVATE_KEY', 'EMAILS_PRIVATE_KEY');

    if (!PRIVATE_KEY || !SERVICE_ID || !TEMPLATE_ID) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error:
            'Missing EmailJS configuration. Ensure EMAILJS/EMAILS_PRIVATE_KEY, EMAILJS/EMAILS_SERVICE_ID and EMAILJS/EMAILS_TEMPLATE_ID are set.',
        }),
      };
    }

    // Defensive: ensure params object
    const params = typeof template_params === 'object' && template_params
      ? template_params
      : {};

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Private key auth (server-to-server)
        'Authorization': `Bearer ${PRIVATE_KEY}`,
      },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: TEMPLATE_ID,
        template_params: params,
      }),
    });

    // EmailJS returns 200 on success
    if (!res.ok) {
      const text = await res.text();
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'EmailJS error', details: text }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server error', message: err.message }),
    };
  }
};
