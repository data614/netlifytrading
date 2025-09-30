// Quick test to verify API routing works correctly
const BASE_URL = 'http://localhost:8888';

async function testEndpoint(url, description) {
    console.log(`\n🧪 Testing ${description}: ${url}`);
    
    try {
        const response = await fetch(url);
        console.log(`   Status: ${response.status}`);
        console.log(`   Content-Type: ${response.headers.get('content-type')}`);
        
        // Check for debugging headers
        const chosenKey = response.headers.get('x-tiingo-chosen-key');
        const tokenPreview = response.headers.get('x-tiingo-token-preview');
        const fallback = response.headers.get('x-tiingo-fallback');
        const source = response.headers.get('X-Tiingo-Source');
        
        if (chosenKey) console.log(`   x-tiingo-chosen-key: ${chosenKey}`);
        if (tokenPreview) console.log(`   x-tiingo-token-preview: ${tokenPreview}`);
        if (fallback) console.log(`   x-tiingo-fallback: ${fallback}`);
        if (source) console.log(`   X-Tiingo-Source: ${source}`);
        
        const text = await response.text();
        
        // Try to parse as JSON
        try {
            const data = JSON.parse(text);
            console.log(`   ✅ Valid JSON response`);
            if (data.symbol) console.log(`   Symbol: ${data.symbol}`);
            if (data.data && Array.isArray(data.data)) {
                console.log(`   Data points: ${data.data.length}`);
                if (data.data[0]) {
                    console.log(`   Latest close: ${data.data[0].close}`);
                }
            }
            if (data.meta) console.log(`   Meta source: ${data.meta.source}`);
        } catch (e) {
            console.log(`   ❌ Invalid JSON response`);
            console.log(`   Response text (first 200 chars): ${text.substring(0, 200)}...`);
        }
        
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
    }
}

async function main() {
    console.log('🚀 Starting API endpoint tests...');
    
    // Test the intended route
    await testEndpoint(`${BASE_URL}/api/tiingo?symbol=AAPL`, 'Frontend route');
    
    // Test the direct function call
    await testEndpoint(`${BASE_URL}/.netlify/functions/tiingo?symbol=AAPL`, 'Direct function');
    
    // Test with different symbol
    await testEndpoint(`${BASE_URL}/api/tiingo?symbol=MSFT`, 'Frontend route (MSFT)');
    
    console.log('\n🏁 Test complete!');
}

main().catch(console.error);