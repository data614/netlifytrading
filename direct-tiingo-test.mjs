// Direct test without importing from env.js
// For testing purposes only, using environment variables directly

async function testTiingoConnectivity() {
  const API_BASE = 'https://api.tiingo.com';
  
  // Try to get token from environment
  const token = process.env.TIINGO_KEY || process.env.TIINGO_API_KEY;
  const key = token ? 'TIINGO_KEY or TIINGO_API_KEY' : null;
  const reason = token ? 'found' : 'not found';
  
  if (!token) {
    console.log('No token found in environment variables');
    return;
  }
  
  console.log('Found token:', key, 'Preview:', `${token.slice(0, 4)}...${token.slice(-4)}`);
  
  // Test direct connection to Tiingo API
  try {
    const url = new URL('/iex', API_BASE);
    url.searchParams.set('tickers', 'AAPL');
    console.log('Testing with URL:', url.toString());
    
    const resp = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
    });
    
    console.log('Response status:', resp.status);
    const text = await resp.text();
    console.log('Response size:', text.length, 'bytes');
    
    try {
      const parsed = JSON.parse(text);
      console.log('Parsed data:', Array.isArray(parsed) ? `Array with ${parsed.length} items` : parsed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log('First item sample:', parsed[0]);
      }
    } catch (e) {
      console.log('Failed to parse JSON:', e.message);
      console.log('Raw text sample:', text.slice(0, 200));
    }
  } catch (error) {
    console.error('Error testing connectivity:', error.message);
  }
}

testTiingoConnectivity()
  .then(() => console.log('Test complete'))
  .catch(err => console.error('Test failed:', err.message));