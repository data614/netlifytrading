
import fetch from 'node-fetch';

async function main() {
  try {
    const response = await fetch('http://localhost:8888/.netlify/functions/env-check');
    const data = await response.json();
    console.log('ENV CHECK RESPONSE:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('ERROR:', error);
  }
}

main();

