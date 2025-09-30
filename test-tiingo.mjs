// Test file for tiingo integration
import tiingoHandler from './netlify/functions/tiingo-data.js';

async function main() {
  try {
    const mockRequest = new Request('http://localhost:8888/.netlify/functions/tiingo?symbol=AAPL&kind=eod');
    const response = await tiingoHandler(mockRequest);
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error testing tiingo:', error);
  }
}

main();