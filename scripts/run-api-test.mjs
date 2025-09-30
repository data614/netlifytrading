#!/usr/bin/env node

/**
 * Run API Test Page Helper
 * 
 * This script starts the Netlify dev server and opens the API test page
 * in your default browser without installation prompts.
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import open from 'open';

// Determine the script's directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up colors for console output
const colors = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// Display welcome message
console.log(`${colors.blue}${colors.bold}=== Tiingo API Test Page Runner ===${colors.reset}`);
console.log(`${colors.yellow}Starting local development server...${colors.reset}`);

// Start Netlify dev server
const netlifyProcess = spawn('netlify', ['dev'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
  cwd: process.cwd(),
});

let serverStarted = false;

// Process server output
netlifyProcess.stdout.on('data', async (data) => {
  const output = data.toString();
  
  // Check if server is ready
  if (output.includes('Local dev server ready') && !serverStarted) {
    serverStarted = true;
    console.log(`${colors.green}✓ Dev server running at http://localhost:8888${colors.reset}`);
    
    // Wait for the server to fully initialize
    await setTimeout(2000);
    
    // Open the API test page
    console.log(`${colors.yellow}Opening API test page in browser...${colors.reset}`);
    try {
      await open('http://localhost:8888/api-test');
      console.log(`${colors.green}✓ API test page opened${colors.reset}`);
      console.log(`${colors.blue}Server is running. Press Ctrl+C to stop.${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}Failed to open browser: ${error.message}${colors.reset}`);
    }
  }
  
  // Log important server messages
  if (output.includes('Loaded function')) {
    const functionName = output.match(/Loaded function (\S+)/);
    if (functionName && functionName[1]) {
      console.log(`${colors.green}✓ Loaded function: ${functionName[1]}${colors.reset}`);
    }
  }
});

// Handle errors
netlifyProcess.stderr.on('data', (data) => {
  console.error(`${colors.red}${data.toString()}${colors.reset}`);
});

// Clean up on exit
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Shutting down server...${colors.reset}`);
  netlifyProcess.kill();
  process.exit(0);
});