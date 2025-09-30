// Direct Function Tester
// This script tests Netlify functions directly without using the local server

// Import the functions directly
import envCheckFunction from './netlify/functions/env-check.js';
import tiingoDataFunction from './netlify/functions/tiingo-data.js';

// Helper to simulate Netlify function environment
async function invokeFunction(func, path, params = {}) {
  // Create mock request object
  const url = new URL(`https://example.com${path}`);
  Object.keys(params).forEach(key => url.searchParams.set(key, params[key]));
  
  const mockRequest = {
    url: url.toString(),
    headers: {},
    method: 'GET'
  };
  
  console.log(`\n📡 Testing function with path: ${path}`);
  console.log(`Params:`, params);
  
  try {
    // Invoke the function
    const result = await func.default(mockRequest);
    
    console.log(`Status: ${result.status || 'unknown'}`);
    
    // Parse the response body
    let body;
    if (result.body) {
      if (typeof result.body === 'string') {
        try {
          body = JSON.parse(result.body);
        } catch (e) {
          body = result.body;
        }
      } else {
        body = result.body;
      }
      
      console.log(`✅ Success! Received response`);
      console.log(`Sample: ${JSON.stringify(body, null, 2).substring(0, 300)}${JSON.stringify(body, null, 2).length > 300 ? '...' : ''}`);
    } else {
      console.log(`❓ No body in response`);
    }
    
    return { success: true, result };
  } catch (error) {
    console.log(`❌ Function execution failed: ${error.message}`);
    console.log(error.stack);
    return { success: false, error: error.message };
  }
}

async function runFunctionTests() {
  console.log('🧪 Testing Netlify functions directly...');
  
  // Test env-check function
  console.log('\n----- Testing env-check function -----');
  await invokeFunction(envCheckFunction, '/.netlify/functions/env-check');
  
  // Test tiingo-data function with different endpoints
  console.log('\n----- Testing tiingo-data function: EOD endpoint -----');
  await invokeFunction(
    tiingoDataFunction, 
    '/.netlify/functions/tiingo-data/eod', 
    { tickers: 'AAPL', startDate: '2023-01-01', endDate: '2023-01-05' }
  );
  
  console.log('\n----- Testing tiingo-data function: IEX endpoint -----');
  await invokeFunction(
    tiingoDataFunction, 
    '/.netlify/functions/tiingo-data/iex', 
    { tickers: 'AAPL', startDate: '2023-01-01', resampleFreq: '5min' }
  );
  
  console.log('\n----- Testing tiingo-data function: Latest endpoint -----');
  await invokeFunction(
    tiingoDataFunction, 
    '/.netlify/functions/tiingo-data/latest', 
    { tickers: 'AAPL' }
  );
  
  console.log('\n✅ All function tests complete!');
}

runFunctionTests().catch(err => {
  console.error('❌ Tests failed with error:', err);
});