// Enhanced Tiingo API test script
// This script tests both authentication methods and verifies connectivity

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read token from .env.test file
function getTokenFromEnvFile() {
  try {
    const envPath = path.join(process.cwd(), '.env.test');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/TIINGO_TEST_TOKEN=(.+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (err) {
    console.log('Error reading .env.test file:', err.message);
  }
  return null;
}

async function testTiingoEndpoint(endpoint, params = {}, token, authMethod = 'header') {
  const API_BASE = 'https://api.tiingo.com';
  const url = new URL(endpoint, API_BASE);
  
  // Add any query parameters
  Object.keys(params).forEach(key => {
    url.searchParams.set(key, params[key]);
  });
  
  // Setup request options
  const options = { };
  
  if (authMethod === 'header') {
    options.headers = { 
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json'
    };
  } else if (authMethod === 'url') {
    url.searchParams.set('token', token);
  }
  
  console.log(`\n📡 Testing ${endpoint} with ${authMethod} auth...`);
  console.log(`URL: ${url.toString().replace(token, '***TOKEN***')}`);
  
  try {
    const response = await fetch(url, options);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
      const sample = Array.isArray(data) ? data.slice(0, 1) : data;
      console.log(`✅ Success! Received ${Array.isArray(data) ? data.length + ' items' : 'data'}`);
      console.log(`Sample: ${JSON.stringify(sample, null, 2).substring(0, 300)}${JSON.stringify(sample, null, 2).length > 300 ? '...' : ''}`);
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

async function runTests() {
  // Get token from command line arg or .env.test file
  let token = process.argv[2];
  if (!token) {
    token = getTokenFromEnvFile();
    if (!token) {
      console.log('❌ No token provided. Please either:');
      console.log('1. Pass token as argument: node enhanced-tiingo-test.js YOUR_TOKEN');
      console.log('2. Create .env.test file with TIINGO_TEST_TOKEN=YOUR_TOKEN');
      return;
    }
  }
  
  console.log(`🔑 Using token: ${token.substring(0, 4)}...${token.substring(token.length - 4)}`);
  
  // Test the API test endpoint with both auth methods
  await testTiingoEndpoint('/api/test', {}, token, 'header');
  await testTiingoEndpoint('/api/test', {}, token, 'url');
  
  // Test the IEX endpoint (latest quotes)
  await testTiingoEndpoint('/iex', { tickers: 'AAPL' }, token, 'header');
  
  // Test the EOD endpoint
  await testTiingoEndpoint('/tiingo/daily/AAPL/prices', { startDate: '2023-01-01', endDate: '2023-01-05' }, token, 'header');
  
  console.log('\n✅ All tests complete!');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
});