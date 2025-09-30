// Advanced Tiingo API test with debugging
import { getTiingoToken, getTiingoTokenDetail } from './netlify/functions/lib/env.js';

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const API_BASE = 'https://api.tiingo.com';

// Try different authentication methods
async function testWithDifferentAuthMethods() {
  console.log(`${colors.magenta}=== Testing Tiingo API with Different Auth Methods ====${colors.reset}`);
  
  const token = getTiingoToken();
  if (!token) {
    console.log(`${colors.red}No Tiingo token found in environment variables${colors.reset}`);
    return false;
  }
  
  console.log(`${colors.cyan}Token found:${colors.reset} ${token}`);
  console.log(`${colors.cyan}Token length:${colors.reset} ${token.length} characters`);
  
  // Test with token in URL parameter
  await testEndpoint(
    'URL parameter auth (?token=)',
    '/tiingo/daily/AAPL/prices',
    { startDate: '2023-01-01', limit: 1, token },
    {}
  );
  
  // Test with token in Authorization header
  await testEndpoint(
    'Auth header (Authorization: Token ...)',
    '/tiingo/daily/AAPL/prices',
    { startDate: '2023-01-01', limit: 1 },
    { 'Authorization': `Token ${token}` }
  );
  
  // Test with token in Authorization header without "Token " prefix
  await testEndpoint(
    'Auth header without prefix (Authorization: ...)',
    '/tiingo/daily/AAPL/prices',
    { startDate: '2023-01-01', limit: 1 },
    { 'Authorization': token }
  );
  
  // Test simple test endpoint with token in URL parameter
  await testEndpoint(
    'Simple test endpoint with URL param',
    '/api/test',
    { token },
    {}
  );

  // Test simple test endpoint with token in Authorization header
  await testEndpoint(
    'Simple test endpoint with auth header',
    '/api/test',
    {},
    { 'Authorization': `Token ${token}` }
  );
}

async function testEndpoint(name, path, params, headers) {
  console.log(`\n${colors.cyan}Testing ${name}:${colors.reset}`);
  
  try {
    const url = new URL(path, API_BASE);
    
    // Add parameters to URL
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
    
    console.log(`Request URL: ${url.toString()}`);
    console.log(`Headers: ${JSON.stringify(headers)}`);
    
    // Make the request
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    const status = response.status;
    const text = await response.text();
    let data = null;
    
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      // Ignore parsing errors
    }
    
    console.log(`Status: ${status}`);
    console.log(`Response: ${text ? (text.length > 300 ? text.slice(0, 300) + '...' : text) : 'Empty response'}`);
    
    if (response.ok) {
      console.log(`${colors.green}✓ Request successful${colors.reset}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`${colors.green}✓ Received data array with ${data.length} items${colors.reset}`);
      }
    } else {
      console.log(`${colors.red}✗ Request failed${colors.reset}`);
    }
    
    return { success: response.ok, status, data, text };
  } catch (error) {
    console.log(`${colors.red}✗ Request failed with error:${colors.reset}`);
    console.error(error);
    return { success: false, error };
  }
}

// Run the tests
testWithDifferentAuthMethods().catch(err => {
  console.error(`${colors.red}Test failed:${colors.reset}`, err);
});