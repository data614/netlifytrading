// Simple ES Module Tiingo API Test
// Uses ESM syntax compatible with "type": "module" in package.json

/**
 * Test direct Tiingo API connection using provided token
 * @param {string} token - Your Tiingo API token
 */
async function testTiingoAPI(token) {
  if (!token) {
    console.error('❌ No token provided. Usage: node esm-tiingo-test.mjs YOUR_TOKEN');
    return;
  }

  const API_BASE = 'https://api.tiingo.com';
  console.log(`🔑 Using token: ${token.substring(0, 4)}...${token.substring(token.length - 4)}`);

  // Test auth methods
  await testEndpoint('/api/test', {}, token, 'header');
  await testEndpoint('/api/test', {}, token, 'url');
  
  // Test data endpoints
  await testEndpoint('/iex', { tickers: 'AAPL' }, token, 'header');
  await testEndpoint('/tiingo/daily/AAPL/prices', 
    { startDate: '2023-01-01', endDate: '2023-01-05' }, token, 'header');
}

async function testEndpoint(endpoint, params = {}, token, authMethod = 'header') {
  const API_BASE = 'https://api.tiingo.com';
  const url = new URL(endpoint, API_BASE);
  
  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  
  const options = {};
  
  // Apply authentication method
  if (authMethod === 'header') {
    options.headers = { 
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json'
    };
    console.log(`\n📡 Testing ${endpoint} with Authorization header`);
  } else {
    url.searchParams.set('token', token);
    console.log(`\n📡 Testing ${endpoint} with URL token parameter`);
  }
  
  // Log URL with hidden token
  const logUrl = url.toString().replace(token, '***TOKEN***');
  console.log(`URL: ${logUrl}`);
  
  try {
    const response = await fetch(url, options);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.log(`❌ Request failed with status ${response.status}`);
      const text = await response.text();
      console.log(`Error: ${text.substring(0, 200)}`);
      return { success: false, status: response.status, error: text };
    }
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
      const preview = JSON.stringify(
        Array.isArray(data) ? data.slice(0, 1) : data, 
        null, 2
      ).substring(0, 300);
      
      console.log(`✅ Success! ${Array.isArray(data) ? `Got ${data.length} items` : 'Got data'}`);
      console.log(`Data preview: ${preview}${preview.length === 300 ? '...' : ''}`);
      return { success: true, data };
    } catch (e) {
      console.log(`❌ Error parsing JSON: ${e.message}`);
      console.log(`Raw response: ${text.substring(0, 100)}...`);
      return { success: false, error: 'JSON parse error', text };
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Get token from command line args
const token = process.argv[2];
testTiingoAPI(token)
  .then(() => console.log('\n✅ All tests complete!'))
  .catch(err => console.error('\n❌ Test failed with error:', err));