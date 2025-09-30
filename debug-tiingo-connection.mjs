// Debug script for Tiingo API and local functions server
import fetch from 'node-fetch';

// Configuration
const TIINGO_TOKEN = 'aab69a760ed80b5c6c84a5a6f5e76423b3828b90';
const LOCAL_SERVER = 'http://localhost:8888';

async function runTests() {
  console.log('=============================================');
  console.log('🔍 TIINGO API DIRECT & LOCAL FUNCTIONS TESTER');
  console.log('=============================================\n');
  
  // Test direct Tiingo API connection
  console.log('1️⃣ TESTING DIRECT TIINGO API CONNECTION');
  await testDirectTiingo();
  
  // Test env-check function
  console.log('\n2️⃣ TESTING LOCAL ENV-CHECK FUNCTION');
  await testLocalFunction('env-check');
  
  // Test tiingo-data EOD endpoint
  console.log('\n3️⃣ TESTING LOCAL TIINGO-DATA EOD ENDPOINT');
  await testLocalFunction('tiingo-data/eod?tickers=AAPL&startDate=2023-01-01&endDate=2023-01-05');
  
  // Test tiingo-data IEX (intraday) endpoint
  console.log('\n4️⃣ TESTING LOCAL TIINGO-DATA IEX ENDPOINT');
  await testLocalFunction('tiingo-data/iex?tickers=AAPL&startDate=2023-01-01&resampleFreq=5min');
  
  // Test tiingo-data latest endpoint
  console.log('\n5️⃣ TESTING LOCAL TIINGO-DATA LATEST ENDPOINT');
  await testLocalFunction('tiingo-data/latest?tickers=AAPL');
  
  console.log('\n✅ ALL TESTS COMPLETED');
}

async function testDirectTiingo() {
  try {
    // Test basic API endpoint
    const apiUrl = 'https://api.tiingo.com/api/test';
    console.log(`📡 Testing URL: ${apiUrl}`);
    
    // Test with Authorization header
    const headerResult = await fetch(apiUrl, {
      headers: { 'Authorization': `Token ${TIINGO_TOKEN}` }
    });
    
    console.log(`🔐 Auth Header Method: Status ${headerResult.status}`);
    if (headerResult.ok) {
      const data = await headerResult.json();
      console.log(`   Response: ${JSON.stringify(data)}`);
    } else {
      console.log(`   Error: ${await headerResult.text()}`);
    }
    
    // Test with URL param
    const urlParamResult = await fetch(`${apiUrl}?token=${TIINGO_TOKEN}`);
    console.log(`🔑 URL Param Method: Status ${urlParamResult.status}`);
    if (urlParamResult.ok) {
      const data = await urlParamResult.json();
      console.log(`   Response: ${JSON.stringify(data)}`);
    } else {
      console.log(`   Error: ${await urlParamResult.text()}`);
    }
    
    // Test IEX endpoint
    const iexUrl = 'https://api.tiingo.com/iex?tickers=AAPL';
    console.log(`\n📡 Testing IEX URL: ${iexUrl}`);
    
    const iexResult = await fetch(iexUrl, {
      headers: { 'Authorization': `Token ${TIINGO_TOKEN}` }
    });
    
    console.log(`🔐 IEX Endpoint: Status ${iexResult.status}`);
    if (iexResult.ok) {
      const data = await iexResult.json();
      console.log(`   Got ${Array.isArray(data) ? data.length : 0} items`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   First item: ${JSON.stringify(data[0]).substring(0, 200)}...`);
      }
    } else {
      console.log(`   Error: ${await iexResult.text()}`);
    }
  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
  }
}

async function testLocalFunction(endpoint) {
  try {
    const url = `${LOCAL_SERVER}/.netlify/functions/${endpoint}`;
    console.log(`📡 Testing URL: ${url}`);
    
    const result = await fetch(url);
    console.log(`📊 Status: ${result.status}`);
    
    if (result.ok) {
      const data = await result.json();
      console.log(`✅ SUCCESS: Got valid JSON response`);
      console.log(`   Response preview: ${JSON.stringify(data).substring(0, 300)}...`);
    } else {
      console.log(`❌ ERROR: ${await result.text()}`);
    }
  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
    console.log('   This typically means the local server is not running or is inaccessible.');
    console.log('   Make sure to run: npx netlify dev');
  }
}

// Run all tests
runTests().catch(error => {
  console.error(`❌ FATAL ERROR: ${error.message}`);
});