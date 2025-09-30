// Test script to check the tiingo-data integration
async function testEndpoints() {
  console.log('Testing Tiingo integration...');
  
  // Test env-check
  try {
    console.log('\n1. Testing env-check endpoint:');
    const envCheck = await fetch('http://localhost:8888/.netlify/functions/env-check');
    const envData = await envCheck.json();
    console.log('  Status:', envCheck.status);
    console.log('  Tiingo connectivity:', 
      envData.meta?.tiingo?.connectivity?.ok ? '✅ Connected' : '❌ Failed');
    console.log('  Auth method:', envData.meta?.tiingo?.connectivity?.authMethod);
  } catch (error) {
    console.error('  Error testing env-check:', error.message);
  }

  // Test EOD endpoint
  try {
    console.log('\n2. Testing EOD data endpoint:');
    const eodResp = await fetch('http://localhost:8888/.netlify/functions/tiingo-data/eod?tickers=AAPL&startDate=2023-01-01&endDate=2023-01-05');
    const eodData = await eodResp.json();
    console.log('  Status:', eodResp.status);
    console.log('  Data points:', eodData.data?.length || 0);
    console.log('  First entry:', eodData.data?.[0] ? '✅ Present' : '❌ Missing');
  } catch (error) {
    console.error('  Error testing EOD endpoint:', error.message);
  }

  // Test IEX endpoint
  try {
    console.log('\n3. Testing IEX (intraday) endpoint:');
    const iexResp = await fetch('http://localhost:8888/.netlify/functions/tiingo-data/iex?tickers=AAPL&startDate=2023-01-01&resampleFreq=5min');
    const iexData = await iexResp.json();
    console.log('  Status:', iexResp.status);
    console.log('  Data points:', iexData.data?.length || 0);
    console.log('  First entry:', iexData.data?.[0] ? '✅ Present' : '❌ Missing');
    console.log('  Fallback to EOD:', iexData.meta?.fallbackToEod ? '✅ Yes' : '❌ No');
  } catch (error) {
    console.error('  Error testing IEX endpoint:', error.message);
  }

  // Test latest endpoint
  try {
    console.log('\n4. Testing latest quotes endpoint:');
    const latestResp = await fetch('http://localhost:8888/.netlify/functions/tiingo-data/latest?tickers=AAPL');
    const latestData = await latestResp.json();
    console.log('  Status:', latestResp.status);
    console.log('  Data points:', latestData.data?.length || 0);
    console.log('  First entry:', latestData.data?.[0] ? '✅ Present' : '❌ Missing');
  } catch (error) {
    console.error('  Error testing latest endpoint:', error.message);
  }
}

await testEndpoints();