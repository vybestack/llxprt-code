/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
interface StartupResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function initializeAndClose(
  program: string,
  request: string,
): Promise<StartupResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('node', ['--input-type=module', '-e', program], {
      cwd: root,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Node ACP initialize did not complete'));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes('\n')) child.stdin.end();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr });
    });
    child.stdin.write(request);
  });
}

describe('default Node ACP startup and disposal', () => {
  it('initializes a real connection, disposes on EOF and removes its process signal listeners', async () => {
    const request = {
      jsonrpc: '2.0',
      id: 854,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    };
    const result = await initializeAndClose(
      `
import assert from 'node:assert/strict';
import { Config } from '@vybestack/llxprt-code-core';
import { runZedIntegration } from '@vybestack/llxprt-code-zed-acp';
const config = new Config({
  sessionId: '854-node-startup-test', targetDir: process.cwd(), cwd: process.cwd(),
  debugMode: false, model: 'no-provider-startup-probe', folderTrust: false,
  telemetry: { enabled: false }, usageStatisticsEnabled: false,
});
const signals = ['SIGINT', 'SIGTERM'];
const before = signals.map(signal => process.listenerCount(signal));
let disposed = false;
await runZedIntegration(config, { onExitCleanup: () => { disposed = true; } });
assert.equal(disposed, true);
assert.deepEqual(signals.map(signal => process.listenerCount(signal)), before);
`,
      JSON.stringify(request) + '\n',
    );
    if (result.status !== 0) throw new Error(result.stderr);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      jsonrpc: '2.0',
      id: 854,
      result: { protocolVersion: 1 },
    });
  }, 35_000);
});
