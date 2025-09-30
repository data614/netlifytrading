// Test Tiingo API integration
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import tiingoHandler from './netlify/functions/tiingo-data.js';
import { getTiingoToken, getTiingoTokenDetail } from './netlify/functions/lib/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Test cases for different Tiingo API endpoints
const testCases = [
  {
    name: 'EOD Data',
    url: 'http://localhost:8888/.netlify/functions/tiingo?symbol=AAPL&kind=eod&limit=5',
    validate: (data) => {
      return data && Array.isArray(data.data) && data.data.length > 0 && data.data[0].close;
    }
  },
  {
    name: 'Intraday Data',
    url: 'http://localhost:8888/.netlify/functions/tiingo?symbol=MSFT&kind=intraday&limit=5',
    validate: (data) => {
      return data && Array.isArray(data.data) && data.data.length > 0;
    }
  },
  {
    name: 'Latest Quote',
    url: 'http://localhost:8888/.netlify/functions/tiingo?symbol=GOOGL&kind=intraday_latest',
    validate: (data) => {
      return data && Array.isArray(data.data) && data.data.length > 0 && data.data[0].price;
    }
  }
];

// Test Tiingo token detection
async function testTiingoToken() {
  console.log(`\n${colors.cyan}Testing Tiingo token detection:${colors.reset}`);
  
  const tokenDetail = getTiingoTokenDetail();
  const token = getTiingoToken();
  
  console.log(`Token found: ${token ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
  console.log(`Source key: ${tokenDetail.key || 'Not found'}`);
  console.log(`Reason: ${tokenDetail.reason}`);
  
  if (token) {
    console.log(`Token preview: ${token.slice(0, 4)}...${token.slice(-4)}`);
    console.log(`Authentication method: Authorization header (Token)`);
  }
  
  return !!token;
}

// Run a single test case
async function runTest(testCase) {
  try {
    console.log(`\n${colors.cyan}Testing ${testCase.name}:${colors.reset}`);
    
    const request = new Request(testCase.url);
    const response = await tiingoHandler(request);
    const data = await response.json();
    
    let success = false;
    let usedMock = false;
    
    try {
      success = testCase.validate(data);
      usedMock = response.headers.get('x-tiingo-fallback') === 'mock';
      
      if (success) {
        console.log(`${colors.green}✓ Test passed${colors.reset}`);
        if (usedMock) {
          console.log(`${colors.yellow}⚠ Note: Used mock data${colors.reset}`);
        } else {
          console.log(`${colors.green}✓ Used real API data${colors.reset}`);
        }
        
        // Print sample of the data
        if (Array.isArray(data.data) && data.data.length > 0) {
          console.log('\nSample data:');
          console.log(JSON.stringify(data.data[0], null, 2).slice(0, 300) + (JSON.stringify(data.data[0], null, 2).length > 300 ? '...' : ''));
        }
      } else {
        console.log(`${colors.red}✗ Test failed: Invalid data format${colors.reset}`);
        console.log(JSON.stringify(data, null, 2).slice(0, 300));
      }
    } catch (validationError) {
      console.log(`${colors.red}✗ Test failed: Validation error${colors.reset}`);
      console.error(validationError);
    }
    
    return { success, usedMock };
  } catch (error) {
    console.log(`${colors.red}✗ Test failed with error:${colors.reset}`);
    console.error(error);
    return { success: false, usedMock: false, error };
  }
}

// Run all tests
async function runAllTests() {
  console.log(`${colors.magenta}=== Tiingo API Integration Test ====${colors.reset}`);
  console.log(`Running tests at ${new Date().toISOString()}`);
  
  const hasToken = await testTiingoToken();
  if (!hasToken) {
    console.log(`\n${colors.yellow}⚠ Warning: No Tiingo token found. Tests will use mock data.${colors.reset}`);
  }
  
  let passed = 0;
  let failed = 0;
  let usedMockData = 0;
  
  for (const testCase of testCases) {
    const result = await runTest(testCase);
    if (result.success) passed++;
    else failed++;
    if (result.usedMock) usedMockData++;
  }
  
  console.log(`\n${colors.magenta}=== Test Summary ====${colors.reset}`);
  console.log(`Total tests: ${testCases.length}`);
  console.log(`Passed: ${colors.green}${passed}${colors.reset}`);
  console.log(`Failed: ${colors.red}${failed}${colors.reset}`);
  console.log(`Using mock data: ${usedMockData} of ${testCases.length}`);
  
  if (passed === testCases.length) {
    console.log(`\n${colors.green}All tests passed!${colors.reset}`);
    if (usedMockData > 0) {
      console.log(`${colors.yellow}Note: ${usedMockData} test(s) used mock data.${colors.reset}`);
    }
  } else {
    console.log(`\n${colors.red}Some tests failed.${colors.reset}`);
  }
}

// Run the tests
runAllTests().catch(err => {
  console.error(`${colors.red}Test suite failed with error:${colors.reset}`, err);
  process.exit(1);
});