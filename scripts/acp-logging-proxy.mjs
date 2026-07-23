#!/usr/bin/env node
/**
 * ACP logging proxy: sits between Zed and the real llxprt ACP agent.
 *
 * Zed spawns THIS script as its agent server. This script then spawns the
 * real llxprt ACP agent as a child process, forwarding all stdin/stdout
 * bidirectionally while logging every ACP message to a log file.
 *
 * This lets us observe the full ACP protocol exchange when Zed interacts
 * with the agent, including any errors from the `task` tool or the pause tool.
 *
 * Usage: Set this as the Zed agent server command instead of bun directly.
 *        The real agent binary and args are passed after a -- separator.
 *
 * Example Zed config:
 *   "command": "node",
 *   "args": ["scripts/acp-logging-proxy.mjs", "--", "bun", "packages/cli/index.ts", "--experimental-acp", ...]
 */

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse args after "--" to find the real agent command
const sepIndex = process.argv.indexOf('--');
const agentArgs = sepIndex >= 0 ? process.argv.slice(sepIndex + 1) : [];
const agentCmd = agentArgs[0] || 'bun';
const agentCmdArgs = agentArgs.slice(1);

if (agentArgs.length === 0) {
  process.stderr.write('acp-logging-proxy: no agent command after "--"\n');
  process.exit(1);
}

// Log directory
const logDir =
  process.env.ACP_PROXY_LOG_DIR || join(__dirname, '..', '.acp-proxy-logs');
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = join(logDir, `acp-${timestamp}.jsonl`);
const logStream = createWriteStream(logFile, { flags: 'a' });

function logEntry(direction, data) {
  const entry = {
    ts: new Date().toISOString(),
    direction, // 'zed->agent' or 'agent->zed'
    raw: typeof data === 'string' ? data : data.toString(),
  };
  // Try to parse as JSON for prettier logging
  try {
    entry.parsed = JSON.parse(entry.raw);
    delete entry.raw;
  } catch {
    // Keep raw if not JSON
  }
  logStream.write(JSON.stringify(entry) + '\n');
}

logStream.write(
  JSON.stringify({
    ts: new Date().toISOString(),
    event: 'proxy-start',
    agentCmd,
    agentCmdArgs,
    pid: process.pid,
  }) + '\n',
);

// Spawn the real agent
const child = spawn(agentCmd, agentCmdArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

// zed -> agent (stdin forwarding with logging)
process.stdin.on('data', (chunk) => {
  logEntry('zed->agent', chunk);
  child.stdin.write(chunk);
});

process.stdin.on('end', () => {
  child.stdin.end();
});

// agent -> zed (stdout forwarding with logging)
child.stdout.on('data', (chunk) => {
  logEntry('agent->zed', chunk);
  process.stdout.write(chunk);
});

// agent stderr -> our stderr (for debug logs)
child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  // Log errors specially
  if (
    text.includes('isRunning') ||
    text.includes('not a function') ||
    text.includes('ERROR')
  ) {
    logStream.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'STDERR_ERROR',
        text: text.trim(),
      }) + '\n',
    );
  }
  process.stderr.write(chunk);
});

// Handle process lifecycle
child.on('error', (err) => {
  logStream.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'child-error',
      error: err.message,
    }) + '\n',
  );
  process.exit(1);
});

child.on('exit', (code, signal) => {
  logStream.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'child-exit',
      code,
      signal,
    }) + '\n',
  );
  logStream.end();
  process.exit(code ?? 1);
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
process.on('SIGINT', () => {
  child.kill('SIGINT');
});
