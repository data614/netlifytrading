# Tiingo API Integration Testing Guide

This guide provides instructions for testing the Tiingo API integration in different ways to help diagnose and resolve any issues.

## Prerequisites

1. A valid Tiingo API token (from your account at tiingo.com)
2. Node.js installed on your system

## Test Scripts

We've created several test scripts to help diagnose different aspects of the integration:

### 1. Direct Tiingo API Testing

This tests your Tiingo API token directly against the Tiingo API without going through Netlify functions:

```bash
# Option 1: Run with token as argument
node enhanced-tiingo-test.js YOUR_TOKEN_HERE

# Option 2: Create .env.test file first
echo "TIINGO_TEST_TOKEN=YOUR_TOKEN_HERE" > .env.test
node enhanced-tiingo-test.js
```

**What to look for:**
- Successful responses from both authentication methods (header and URL)
- Data being returned for each endpoint
- Any error messages that might indicate token or connectivity issues

### 2. Direct Function Testing

This tests the Netlify functions directly without going through the local server:

```bash
node test-functions-direct.js
```

**What to look for:**
- Successful execution of each function
- Any error messages related to the functions themselves
- Whether tokens are being found in the environment

### 3. Environment Diagnostics

This provides information about your Netlify setup and environment:

```bash
node netlify-diagnostics.js
```

**What to look for:**
- Whether all necessary files exist
- Environment variable configuration
- Netlify CLI version

## Common Issues and Solutions

### Connection Issues

If you see "fetch failed" errors:
1. Ensure the Netlify dev server is running in a separate terminal: `npx netlify dev`
2. Check if port 8888 is already in use by another application
3. Try restarting the server with debug mode: `npx netlify dev --debug`

### Authentication Issues

If you see 401 or 403 errors:
1. Verify your token is valid using the direct API testing script
2. Check that the token is properly set in your environment (in .env file)
3. Ensure the token is being accessed correctly in the functions

### Environment Variable Issues

If your token isn't being found:
1. Make sure your .env file exists in the project root
2. Verify it contains the right variable: `TIINGO_KEY=your_token_here`
3. Try restarting the Netlify server to pick up environment changes

## Debugging Workflow

1. First run the direct API tests to verify your token works
2. Then run the diagnostics to check your environment
3. Finally test the functions directly to isolate any issues
4. Once everything passes, try the local server again: `npx netlify dev`

## Deployment Considerations

When deploying to Netlify:
1. Make sure to add your `TIINGO_KEY` as an environment variable in the Netlify dashboard
2. Verify the functions are included in your deployment
3. Test the production endpoints after deployment

## Need More Help?

If issues persist:
1. Check Netlify logs in the dashboard
2. Review the Tiingo API documentation for any changes
3. Look for error messages in both console and network responses