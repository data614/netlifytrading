// Test direct Tiingo API connectivity
import { getTiingoToken } from './netlify/functions/lib/env.js';

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

async function testDirectApiAccess() {
  console.log(`${colors.magenta}=== Testing Direct Tiingo API Access ====${colors.reset}`);
  
  const token = getTiingoToken();
  
  if (!token) {
    console.log(`${colors.red}No Tiingo token found in environment variables${colors.reset}`);
    return false;
  }
  
  console.log(`${colors.cyan}Token found:${colors.reset} ${token.slice(0, 4)}...${token.slice(-4)}`);
  
  // Test the /api/test endpoint which should work with any valid token
  console.log(`\n${colors.cyan}Testing /api/test endpoint:${colors.reset}`);
  try {
    const testResponse = await fetch(`${API_BASE}/api/test`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${token}`
      }
    });
    
    const testStatus = testResponse.status;
    const testText = await testResponse.text();
    let testData;
    
    try {
      testData = JSON.parse(testText);
    } catch (e) {
      testData = null;
    }
    
    console.log(`Status: ${testStatus}`);
    console.log(`Response: ${testText ? testText : 'Empty response'}`);
    
    if (testResponse.ok) {
      console.log(`${colors.green}✓ API test endpoint successful${colors.reset}`);
    } else {
      console.log(`${colors.red}✗ API test endpoint failed${colors.reset}`);
      if (testStatus === 403) {
        console.log(`${colors.yellow}The token appears to be invalid.${colors.reset}`);
      }
    }
  } catch (error) {
    console.log(`${colors.red}✗ API test request failed:${colors.reset}`);
    console.error(error);
    return false;
  }
  
  // Test a simple data endpoint
  console.log(`\n${colors.cyan}Testing data endpoint (daily prices for AAPL):${colors.reset}`);
  try {
    const dataUrl = new URL(`/tiingo/daily/AAPL/prices`, API_BASE);
    dataUrl.searchParams.set('startDate', '2023-01-01');
    dataUrl.searchParams.set('resampleFreq', 'daily');
    dataUrl.searchParams.set('limit', '1');
    
    const dataResponse = await fetch(dataUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${token}`
      }
    });
    
    const dataStatus = dataResponse.status;
    const dataText = await dataResponse.text();
    let dataJson;
    
    try {
      dataJson = JSON.parse(dataText);
    } catch (e) {
      dataJson = null;
    }
    
    console.log(`Status: ${dataStatus}`);
    
    if (dataResponse.ok && Array.isArray(dataJson)) {
      console.log(`${colors.green}✓ Data endpoint successful${colors.reset}`);
      console.log(`Sample data: ${JSON.stringify(dataJson[0]).slice(0, 100)}...`);
    } else {
      console.log(`${colors.red}✗ Data endpoint failed${colors.reset}`);
      console.log(`Response: ${dataText ? dataText.slice(0, 200) : 'Empty response'}`);
      
      if (dataStatus === 403) {
        console.log(`${colors.yellow}The token appears to be invalid or doesn't have access to this endpoint.${colors.reset}`);
      }
    }
  } catch (error) {
    console.log(`${colors.red}✗ Data endpoint request failed:${colors.reset}`);
    console.error(error);
    return false;
  }
  
  return true;
}

// Run the test
testDirectApiAccess().catch(err => {
  console.error(`${colors.red}Test failed:${colors.reset}`, err);
  process.exit(1);
});