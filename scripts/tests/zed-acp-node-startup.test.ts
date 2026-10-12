/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
// Runs against built output, so it belongs to the scripts shard, which builds
// the workspaces before it runs (the package shards resolve TypeScript source).
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
interface StartupResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function initializeAndClose(
  args: readonly string[],
  request: string,
): Promise<StartupResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('node', args, {
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
  it('starts the built CLI with --experimental-acp, answers initialize and exits cleanly on EOF', async () => {
    const request = {
      jsonrpc: '2.0',
      id: 854,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    };
    const result = await initializeAndClose(
      [resolve(root, 'packages/cli/dist/index.js'), '--experimental-acp'],
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
