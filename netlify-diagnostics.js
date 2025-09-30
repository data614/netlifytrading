// Netlify Environment Diagnostics
// This script helps diagnose issues with the Netlify development environment

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkFile(filePath, description) {
  console.log(`\n📄 Checking ${description} (${filePath})...`);
  try {
    if (fs.existsSync(filePath)) {
      console.log(`✅ File exists`);
      const stats = fs.statSync(filePath);
      console.log(`   - Size: ${stats.size} bytes`);
      console.log(`   - Modified: ${stats.mtime}`);
      
      // For smaller text files, show a preview
      if (stats.size < 10000 && !filePath.endsWith('.png') && !filePath.endsWith('.jpg')) {
        const content = fs.readFileSync(filePath, 'utf8');
        console.log(`   - Preview: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
      }
      return true;
    } else {
      console.log(`❌ File does not exist`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error checking file: ${error.message}`);
    return false;
  }
}

function checkNetlifyConfig() {
  console.log('\n🔍 Checking Netlify configuration...');
  
  // Check netlify.toml
  checkFile('netlify.toml', 'Netlify config file');
  
  // Check .netlify directory
  console.log('\n📁 Checking .netlify directory...');
  try {
    if (fs.existsSync('.netlify')) {
      console.log(`✅ .netlify directory exists`);
      const files = fs.readdirSync('.netlify');
      console.log(`   - Contains: ${files.join(', ')}`);
    } else {
      console.log(`❓ .netlify directory does not exist (may be normal for some setups)`);
    }
  } catch (error) {
    console.log(`❌ Error checking .netlify directory: ${error.message}`);
  }
}

function checkEnvironment() {
  console.log('\n🌐 Checking environment...');
  
  // Check .env file
  checkFile('.env', 'Environment variables file');
  
  // Check for specific variables
  console.log('\n🔑 Checking for Tiingo environment variables...');
  const tiingoVars = [
    'TIINGO_API_KEY',
    'TIINGO_KEY',
    'TIINGO_TOKEN'
  ];
  
  tiingoVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName} is set to ${process.env[varName].substring(0, 4)}...`);
    } else {
      console.log(`❓ ${varName} is not set in process.env`);
    }
  });
}

function checkNetlifyFunctions() {
  console.log('\n⚙️ Checking Netlify functions...');
  
  // Check functions directory
  console.log('\n📁 Checking functions directory structure...');
  try {
    if (fs.existsSync('netlify/functions')) {
      console.log(`✅ functions directory exists`);
      const files = fs.readdirSync('netlify/functions');
      console.log(`   - Contains: ${files.join(', ')}`);
      
      // Check for our specific functions
      ['env-check.js', 'tiingo-data.js'].forEach(funcFile => {
        if (files.includes(funcFile)) {
          console.log(`✅ Found ${funcFile}`);
        } else {
          console.log(`❌ Missing ${funcFile}`);
        }
      });
    } else {
      console.log(`❌ netlify/functions directory does not exist`);
    }
  } catch (error) {
    console.log(`❌ Error checking functions directory: ${error.message}`);
  }
}

function checkNetlifyCliVersion() {
  console.log('\n🛠️ Checking Netlify CLI version...');
  try {
    const output = execSync('npx netlify --version', { encoding: 'utf8' });
    console.log(`✅ Netlify CLI: ${output.trim()}`);
  } catch (error) {
    console.log(`❌ Error checking Netlify CLI: ${error.message}`);
  }
}

function checkNodeVersion() {
  console.log('\n🟢 Checking Node.js environment...');
  console.log(`Node version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Architecture: ${process.arch}`);
}

function runDiagnostics() {
  console.log('🔍 Starting Netlify Environment Diagnostics...');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Working directory: ${process.cwd()}`);
  
  checkNodeVersion();
  checkNetlifyCliVersion();
  checkNetlifyConfig();
  checkNetlifyFunctions();
  checkEnvironment();
  
  console.log('\n✅ Diagnostics complete!');
  console.log('\nIf you\'re having issues with the Netlify dev server:');
  console.log('1. Try stopping any running servers with Ctrl+C');
  console.log('2. Try running: npx netlify dev --debug');
  console.log('3. Check if ports 8888 or 3999 are already in use');
  console.log('4. Ensure your .env file contains the necessary variables');
}

runDiagnostics();