// Test for env-check.js functionality
import envCheck from './netlify/functions/env-check.js';

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

async function testEnvCheck() {
  console.log(`${colors.magenta}=== Testing env-check.js ====${colors.reset}`);
  
  try {
    const response = await envCheck();
    const data = await response.json();
    
    console.log(`${colors.cyan}Environment variables detected:${colors.reset}`);
    const tiingoVars = Object.entries(data.env)
      .filter(([key]) => key.includes('TIINGO'))
      .filter(([, value]) => value === true);
    
    if (tiingoVars.length > 0) {
      console.log(`${colors.green}✓ Found Tiingo token variables:${colors.reset}`);
      tiingoVars.forEach(([key]) => console.log(`  - ${key}`));
    } else {
      console.log(`${colors.yellow}⚠ No Tiingo token variables found${colors.reset}`);
    }
    
    console.log(`\n${colors.cyan}Tiingo connectivity:${colors.reset}`);
    const tiingoMeta = data.meta?.tiingo || {};
    
    console.log(`Token present: ${tiingoMeta.hasToken ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
    console.log(`Token preview: ${tiingoMeta.tokenPreview || 'N/A'}`);
    console.log(`Chosen key: ${tiingoMeta.chosenKey || 'N/A'}`);
    
    if (tiingoMeta.tokenDetail) {
      console.log(`\n${colors.cyan}Token details:${colors.reset}`);
      console.log(`Source key: ${tiingoMeta.tokenDetail.key || 'N/A'}`);
      console.log(`Detection method: ${tiingoMeta.tokenDetail.reason || 'N/A'}`);
    }
    
    if (tiingoMeta.authMethod) {
      console.log(`\n${colors.cyan}Authentication method:${colors.reset}`);
      console.log(`Method: ${tiingoMeta.authMethod}`);
    }
    
    // Test API connectivity if available
    if (data.apiConnectivity) {
      console.log(`\n${colors.cyan}API connectivity test:${colors.reset}`);
      const conn = data.apiConnectivity;
      if (conn.ok) {
        console.log(`${colors.green}✓ Connected successfully${colors.reset}`);
        console.log(`Status: ${conn.status}`);
      } else {
        console.log(`${colors.yellow}⚠ Connection test failed${colors.reset}`);
        console.log(`Status: ${conn.status}`);
        console.log(`Reason: ${conn.reason}`);
        console.log(`Message: ${conn.message}`);
      }
    }
    
    return true;
  } catch (error) {
    console.log(`${colors.red}✗ Test failed with error:${colors.reset}`);
    console.error(error);
    return false;
  }
}

// Run the test
testEnvCheck().catch(err => {
  console.error(`${colors.red}Test failed:${colors.reset}`, err);
  process.exit(1);
});