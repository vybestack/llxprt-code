#!/usr/bin/env node
/* eslint-env node */
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

// Test ACP integration with provider profiles
// Usage: bun scripts/test-acp-integration.ts [profile-name]
//   or: LLXPRT_PROFILE=profilename bun scripts/test-acp-integration.ts

const args = process.argv.slice(2);
const profileName = args[0] || process.env.LLXPRT_PROFILE;

const llxprtArgs = ['packages/cli/index.ts', '--experimental-acp'];
if (profileName && !process.env.LLXPRT_PROFILE) {
  llxprtArgs.splice(1, 0, '--profile-load', profileName);
}

console.log('Starting ACP integration test...');
if (profileName) {
  console.log(`Using profile: ${profileName}`);
}

const env = { ...process.env, DEBUG: 'llxprt:*' };
console.log('Spawning with args:', llxprtArgs);
console.log('DEBUG env set to:', env.DEBUG);
const llxprt = spawn('bun', llxprtArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd(),
  env,
});

llxprt.on('spawn', () => {
  console.log('Process spawned successfully with PID:', llxprt.pid);
});

llxprt.on('error', (err) => {
  console.error('Failed to spawn process:', err);
});

llxprt.on('exit', (code, signal) => {
  console.log(`Process exited immediately with code ${code}, signal ${signal}`);
});

// Wait a bit for the process to be ready
setTimeout(() => {
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
  console.log('Request:', JSON.stringify(initRequest));
  llxprt.stdin.write(JSON.stringify(initRequest) + '\n');
}, 500);

let testPassed = false;
let buffer = '';

interface JsonRpcMessage {
  readonly id: number;
  readonly result?: Record<string, unknown>;
  readonly error?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!isRecord(value)) {
    return false;
  }
  const obj = value;
  if (typeof obj.id !== 'number') {
    return false;
  }
  if (obj.result !== undefined && !isRecord(obj.result)) {
    return false;
  }
  if (obj.error !== undefined && !isRecord(obj.error)) {
    return false;
  }
  return true;
}

function extractErrorMessage(error: unknown): string {
  if (!isRecord(error)) {
    return String(error);
  }
  const message = error.message;
  if (Array.isArray(message)) {
    return message.join('\n');
  }
  return typeof message === 'string' ? message : String(message ?? '');
}

/**
 * Handle a single parsed JSON-RPC message from the ACP server.
 */
function handleParsedMessage(
  parsed: unknown,
  llxprt: ChildProcessWithoutNullStreams,
) {
  if (!isJsonRpcMessage(parsed)) {
    return;
  }

  // If initialize succeeded, send newSession
  if (parsed.id === 1 && parsed.result) {
    console.log('[OK] Initialize succeeded');

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
    console.log(
      `[OK] Session created with ID: ${String(parsed.result.sessionId)}`,
    );
    testPassed = true;
  }

  // Check for errors
  if (parsed.error) {
    reportAcpError(extractErrorMessage(parsed.error));
  }
}

/**
 * Report an ACP error, surfacing auth-specific context when relevant.
 */
function reportAcpError(message: string) {
  console.error(`\u2717 Error: ${message}`);
  if (message.includes('Content generator config not initialized')) {
    console.error('  This indicates the provider authentication failed');
  }
}

llxprt.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      handleParsedMessage(JSON.parse(line), llxprt);
    } catch (_e) {
      // Not JSON, ignore
    }
  }
});

// Capture stderr for critical errors only
llxprt.stderr.on('data', (data) => {
  const lines = data.toString().split('\n');
  lines.forEach((line: string) => {
    if (line.includes('ERROR') && !line.includes('DeprecationWarning')) {
      console.error('STDERR:', line);
    }
  });
});

setTimeout(() => {
  // Check if process is still alive
  if (llxprt.killed) {
    console.log('Process was already dead');
  } else {
    console.log('Process is still running, killing it');
    llxprt.kill();
  }

  if (testPassed) {
    console.log('\n✅ ACP integration test PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ ACP integration test FAILED');
    process.exit(1);
  }
}, 2000);
