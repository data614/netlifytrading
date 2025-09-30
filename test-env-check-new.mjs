// Test script to check the env-check endpoint
const response = await fetch('http://localhost:8888/.netlify/functions/env-check');
const data = await response.json();
console.log(JSON.stringify(data, null, 2));