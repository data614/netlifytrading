// Test the tiingo-data.js file directly
import { default as tiingoHandler } from './netlify/functions/tiingo-data.js';

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

async function testTiingoDataHandler() {
  console.log(`${colors.magenta}=== Testing tiingo-data.js Handler ====${colors.reset}`);
  
  // Create test cases
  const testCases = [
    { name: 'EOD Data', url: 'http://localhost:8888/.netlify/functions/tiingo?symbol=AAPL&kind=eod&limit=5' },
    { name: 'Intraday Data', url: 'http://localhost:8888/.netlify/functions/tiingo?symbol=MSFT&kind=intraday&limit=5' },
    { name: 'Latest Quote', url: 'http://localhost:8888/.netlify/functions/tiingo?symbol=GOOGL&kind=intraday_latest' },
  ];
  
  // Run each test case
  for (const testCase of testCases) {
    console.log(`\n${colors.cyan}Testing ${testCase.name}:${colors.reset}`);
    try {
      // Create a mock request
      const request = new Request(testCase.url);
      
      // Call the handler
      const response = await tiingoHandler(request);
      
      // Get the fallback header to check if mock data was used
      const fallback = response.headers.get('x-tiingo-fallback');
      
      // Parse response data
      const data = await response.json();
      
      // Print results
      console.log(`Status: ${response.status}`);
      console.log(`Used mock data: ${fallback === 'mock' ? 'Yes' : 'No'}`);
      console.log(`Data type: ${Array.isArray(data.data) ? `Array with ${data.data.length} items` : typeof data.data}`);
      
      if (data.warning) {
        console.log(`Warning: ${data.warning}`);
      }
      
      // Print sample data
      if (Array.isArray(data.data) && data.data.length > 0) {
        console.log(`\nSample data item:`);
        console.log(JSON.stringify(data.data[0], null, 2).slice(0, 300));
      }
      
      if (fallback === 'mock') {
        console.log(`${colors.yellow}⚠ Using mock data${colors.reset}`);
      } else {
        console.log(`${colors.green}✓ Using real API data${colors.reset}`);
      }
    } catch (error) {
      console.log(`${colors.red}✗ Test failed with error:${colors.reset}`);
      console.error(error);
    }
  }
}

// Run the test
testTiingoDataHandler().catch(err => {
  console.error(`${colors.red}Test failed:${colors.reset}`, err);
});