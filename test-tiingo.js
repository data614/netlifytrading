// Usage: node test-tiingo.js
// Make sure your Netlify dev server is running: netlify dev

const fetch = require('node-fetch');

const LOCAL_TIINGO_URL = 'http://localhost:8888/api/tiingo?symbol=AAPL&kind=eod';

async function testTiingo() {
  console.log(`Testing local Tiingo endpoint: ${LOCAL_TIINGO_URL}`);
  try {
    const resp = await fetch(LOCAL_TIINGO_URL);
    const data = await resp.json();
    console.log('Response:', data);

    if (data.warning) {
      console.warn('Warning from endpoint:', data.warning);
      if (data.warning.toLowerCase().includes('api key missing') || data.warning.toLowerCase().includes('sample data')) {
        console.log('Result: Mock/sample data returned. Your API key may not be present or valid.');
      } else {
        console.log('Result: Received warning, but some data may be real.');
      }
    } else {
      console.log('Result: No warning. Should be real Tiingo data!');
    }

    if (Array.isArray(data.data)) {
      console.log(`Returned ${data.data.length} data points.`);
      // Optionally print first data point
      console.log('First data point:', data.data[0]);
    }
  } catch (err) {
    console.error('Error testing Tiingo endpoint:', err);
  }
}

testTiingo();
