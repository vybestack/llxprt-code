#!/usr/bin/env node
/* eslint-env node */
import { spawn } from 'child_process';

// Test ACP integration with provider profiles
// Usage: node scripts/test-acp-integration.mjs [profile-name]
//   or: LLXPRT_PROFILE=profilename node scripts/test-acp-integration.mjs

const args = process.argv.slice(2);
const profileName = args[0] || process.env.LLXPRT_PROFILE;

const llxprtArgs = ['bundle/llxprt.js', '--experimental-acp'];
if (profileName && !process.env.LLXPRT_PROFILE) {
  llxprtArgs.splice(1, 0, '--profile-load', profileName);
}

console.log('Starting ACP integration test...');
if (profileName) {
  console.log(`Using profile: ${profileName}`);
}

const llxprt = spawn('node', llxprtArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd(),
});

// Send initialize with CORRECT fs capabilities structure
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
  },
};

console.log('Sending initialize request...');
llxprt.stdin.write(JSON.stringify(initRequest) + '\n');

let testPassed = false;
let buffer = '';

llxprt.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);

        // If initialize succeeded, send newSession
        if (parsed.id === 1 && parsed.result) {
          console.log('✓ Initialize succeeded');

          const newSessionRequest = {
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: {
              cwd: process.cwd(),
              mcpServers: [],
            },
          };

          console.log('Sending session/new request...');
          llxprt.stdin.write(JSON.stringify(newSessionRequest) + '\n');
        }

        // Check for session created successfully
        if (parsed.id === 2 && parsed.result && parsed.result.sessionId) {
          console.log(`✓ Session created with ID: ${parsed.result.sessionId}`);
          testPassed = true;
        }

        // Check for errors
        if (parsed.error) {
          console.error(`✗ Error: ${parsed.error.message}`);
          if (
            parsed.error.message.includes(
              'Content generator config not initialized',
            )
          ) {
            console.error(
              '  This indicates the provider authentication failed',
            );
          }
        }
      } catch (_e) {
        // Not JSON, ignore
      }
    }
  }
});

// Capture stderr for critical errors only
llxprt.stderr.on('data', (data) => {
  const lines = data.toString().split('\n');
  lines.forEach((line) => {
    if (line.includes('ERROR') && !line.includes('DeprecationWarning')) {
      console.error('STDERR:', line);
    }
  });
});

setTimeout(() => {
  llxprt.kill();
  if (testPassed) {
    console.log('\n✅ ACP integration test PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ ACP integration test FAILED');
    process.exit(1);
  }
}, 2000);
