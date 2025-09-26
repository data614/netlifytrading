import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';

const BUILD_DIR = process.env.NETLIFY_DEPLOY_DIR ?? 'build';
const STAGING_ALIAS = process.env.NETLIFY_DEPLOY_ALIAS ?? 'staging';
const DEPLOY_MESSAGE = process.env.NETLIFY_DEPLOY_MESSAGE ?? `Staging deploy ${new Date().toISOString()}`;
const SITE_ID = process.env.NETLIFY_STAGING_SITE_ID;
const AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const SKIP_BUILD = (process.env.NETLIFY_SKIP_BUILD ?? '').toLowerCase() === 'true';

function assertEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    let capturedStdout = '';
    if (options.captureStdout) {
      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        capturedStdout += text;
        process.stdout.write(text);
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(capturedStdout);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function ensureBuildArtifacts() {
  if (!SKIP_BUILD) {
    await runCommand('npm', ['run', 'build']);
  }

  try {
    await access(path.resolve(BUILD_DIR), constants.F_OK);
  } catch (error) {
    throw new Error(`Expected build output directory "${BUILD_DIR}" does not exist.`);
  }
}

async function deploy() {
  assertEnv(SITE_ID, 'NETLIFY_STAGING_SITE_ID');
  assertEnv(AUTH_TOKEN, 'NETLIFY_AUTH_TOKEN');

  await ensureBuildArtifacts();

  const deployArgs = [
    'netlify-cli@latest',
    'deploy',
    '--dir',
    BUILD_DIR,
    '--alias',
    STAGING_ALIAS,
    '--site',
    SITE_ID,
    '--message',
    DEPLOY_MESSAGE,
    '--json',
  ];

  const stdout = await runCommand('npx', deployArgs, {
    env: { ...process.env, NETLIFY_AUTH_TOKEN: AUTH_TOKEN },
    stdio: ['inherit', 'pipe', 'inherit'],
    captureStdout: true,
  });

  const lines = stdout?.trim().split('\n') ?? [];
  const lastLine = lines.reverse().find((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('{') && trimmed.endsWith('}');
  });

  if (!lastLine) {
    console.log('\nNetlify deploy command completed. Review the log above for deployment details.');
    return;
  }

  try {
    const parsed = JSON.parse(lastLine);
    if (parsed?.url) {
      console.log(`\nStaging deployment available at: ${parsed.url}`);
    } else {
      console.log('\nNetlify deploy command completed. Review the log above for deployment details.');
    }
  } catch (error) {
    console.warn('Unable to parse Netlify deploy output as JSON. Review the log above for deployment details.');
  }
}

deploy().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
