// Simple test for env-check.js function using ESM syntax
import dotenv from './netlify/functions/lib/dotenv.js';
import { getTiingoTokenDetail } from './netlify/functions/lib/env.js';

// Load environment variables
dotenv.config();

async function testEnvCheck() {
  console.log('Testing environment check and Tiingo token detection...');
  
  const API_BASE = 'https://api.tiingo.com';
  const tokenDetail = getTiingoTokenDetail();
  
  console.log('Tiingo token detail:', tokenDetail);
  
  if (!tokenDetail.token) {
    console.log('❌ No Tiingo token found');
    return;
  }
  
  console.log(`✅ Found token from: ${tokenDetail.key}`);
  console.log(`Token preview: ${tokenDetail.token.substring(0, 4)}...${tokenDetail.token.substring(tokenDetail.token.length - 4)}`);
  
  // Test direct connection to Tiingo API
  try {
    const url = new URL('/iex', API_BASE);
    url.searchParams.set('tickers', 'AAPL');
    console.log('Testing with URL:', url.toString());
    
    console.log('Using Authorization header...');
    const resp = await fetch(url, {
      headers: { Authorization: `Token ${tokenDetail.token}` },
    });
    
    console.log('Response status:', resp.status);
    
    if (resp.ok) {
      const data = await resp.json();
      console.log(`✅ API test successful! Received ${data.length} items`);
    } else {
      const text = await resp.text();
      console.log(`❌ API test failed. Error: ${text}`);
    }
  } catch (error) {
    console.error('❌ Error testing connectivity:', error.message);
  }
}

// Run the test
testEnvCheck()
  .then(() => console.log('Test complete'))
  .catch(err => console.error('Test failed:', err));