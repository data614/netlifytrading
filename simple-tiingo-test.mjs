// Simple direct test script for Tiingo API
// Usage: node simple-tiingo-test.mjs YOUR_TOKEN

async function testTiingoConnectivity(token) {
  const API_BASE = 'https://api.tiingo.com';
  
  if (!token) {
    console.log('No token provided. Usage: node simple-tiingo-test.mjs YOUR_TOKEN');
    return;
  }
  
  console.log('Using token:', `${token.slice(0, 4)}...${token.slice(-4)}`);
  
  // Test direct connection to Tiingo API
  try {
    const url = new URL('/iex', API_BASE);
    url.searchParams.set('tickers', 'AAPL');
    console.log('Testing with URL:', url.toString());
    
    console.log('Using Authorization header method...');
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
        console.log('First item sample:', JSON.stringify(parsed[0], null, 2));
      }
    } catch (e) {
      console.log('Failed to parse JSON:', e.message);
      console.log('Raw text sample:', text.slice(0, 200));
    }
    
    // Also test URL parameter method
    console.log('\nTesting URL parameter method...');
    const urlWithToken = new URL('/iex', API_BASE);
    urlWithToken.searchParams.set('tickers', 'AAPL');
    urlWithToken.searchParams.set('token', token);
    console.log('Testing with URL:', urlWithToken.toString());
    
    const respUrl = await fetch(urlWithToken);
    console.log('Response status:', respUrl.status);
    const textUrl = await respUrl.text();
    console.log('Response size:', textUrl.length, 'bytes');
    
    try {
      const parsedUrl = JSON.parse(textUrl);
      console.log('Parsed data:', Array.isArray(parsedUrl) ? `Array with ${parsedUrl.length} items` : parsedUrl);
      if (Array.isArray(parsedUrl) && parsedUrl.length > 0) {
        console.log('First item sample:', JSON.stringify(parsedUrl[0], null, 2));
      }
    } catch (e) {
      console.log('Failed to parse JSON:', e.message);
      console.log('Raw text sample:', textUrl.slice(0, 200));
    }
    
  } catch (error) {
    console.error('Error testing connectivity:', error.message);
  }
}

// Get token from command line argument
const token = process.argv[2];
testTiingoConnectivity(token)
  .then(() => console.log('Test complete'))
  .catch(err => console.error('Test failed:', err.message));