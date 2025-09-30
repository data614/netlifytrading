// Simple test for env.js and token detection using ESM syntax
import { getTiingoTokenDetail } from './netlify/functions/lib/env.js';

async function testTokenDetection() {
  console.log('Testing Tiingo token detection from env.js...');
  
  // Test token detection
  const tokenDetail = getTiingoTokenDetail();
  
  console.log('Token detection result:', tokenDetail);
  
  // For testing, let's set a specific token
  const testToken = process.argv[2] || 'aab69a760ed80b5c6c84a5a6f5e76423b3828b90';
  
  if (!testToken) {
    console.log('❌ No test token provided');
    return;
  }
  
  console.log(`\nTesting with provided token: ${testToken.substring(0, 4)}...${testToken.substring(testToken.length - 4)}`);
  
  // Test API connection with the provided token
  const API_BASE = 'https://api.tiingo.com';
  
  try {
    // Test with header auth
    const url = new URL('/iex', API_BASE);
    url.searchParams.set('tickers', 'AAPL');
    
    console.log('\n1. Testing with Authorization header...');
    const resp = await fetch(url, {
      headers: { Authorization: `Token ${testToken}` },
    });
    
    console.log('Response status:', resp.status);
    
    if (resp.ok) {
      const data = await resp.json();
      console.log(`✅ Success! Received ${data.length} items`);
      console.log('Sample data:', JSON.stringify(data[0], null, 2).substring(0, 200));
    } else {
      const text = await resp.text();
      console.log(`❌ Failed. Error: ${text}`);
    }
    
    // Test with URL parameter
    const urlWithToken = new URL('/iex', API_BASE);
    urlWithToken.searchParams.set('tickers', 'AAPL');
    urlWithToken.searchParams.set('token', testToken);
    
    console.log('\n2. Testing with URL parameter...');
    const respUrl = await fetch(urlWithToken);
    
    console.log('Response status:', respUrl.status);
    
    if (respUrl.ok) {
      const dataUrl = await respUrl.json();
      console.log(`✅ Success! Received ${dataUrl.length} items`);
    } else {
      const textUrl = await respUrl.text();
      console.log(`❌ Failed. Error: ${textUrl}`);
    }
    
  } catch (error) {
    console.error('❌ Error testing API:', error.message);
  }
}

// Run the test
testTokenDetection()
  .then(() => console.log('\nTest complete'))
  .catch(err => console.error('Test failed:', err));