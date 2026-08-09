/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Regression test for the lazy facade/implementation split of
 * SessionLockManager.
 *
 * All checks run in fresh Bun subprocesses so that process-wide static state
 * (the cached import promise) is not contaminated by other test files in the
 * same suite run.  This proves:
 *
 * - Importing SessionLockManager.ts (the facade) does NOT eagerly evaluate
 *   the heavy internals module.
 * - Sync path methods work without loading the internals.
 * - An async operation triggers the lazy load.
 * - Importing the recording barrel (which re-exports the facade) does NOT
 *   eagerly load the internals.
 * - Importing the core public root (which eagerly imports the recording
 *   barrel) does NOT eagerly load the internals — this is the exact
 *   cold-start path that caused the regression.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P11
 */

import { describe, it, expect } from 'bun:test';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Run a Bun subprocess with the given inline script and return stdout.
 * Rejects on non-zero exit, timeout (default 30s), or spawn error.
 */
function runBunScript(code: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn('bun', ['-e', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

    child.on('close', (code: number | null) => {
      cleanup();
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`Process exited with code ${code}\nstderr: ${stderr}`),
        );
    });

    child.on('error', (err: Error) => {
      cleanup();
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited.
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

/** Absolute path to the facade module (resolved at test load time). */
const FACADE_PATH = path.resolve(__dirname, 'SessionLockManager.js');
/** Absolute path to the recording barrel. */
const BARREL_PATH = path.resolve(__dirname, 'index.js');
/** Absolute path to the core public root. */
const CORE_ROOT_PATH = path.resolve(__dirname, '..', 'index.js');

describe('SessionLockManager lazy loading @plan:PLAN-20260211-SESSIONRECORDING.P11', () => {
  it('importing the facade does not eagerly load the heavy implementation', async () => {
    const result = await runBunScript(
      `const { SessionLockManager } = require(${JSON.stringify(FACADE_PATH)});` +
        `process.stdout.write(Object.keys(require.cache).some((loadedPath) => loadedPath.includes('SessionLockManager.internals')) ? 'LOADED' : 'NOT_LOADED');`,
    );
    expect(result.trim()).toBe('NOT_LOADED');
  });

  it('sync getLockPath and getLockPathFromFilePath work without loading the heavy implementation', async () => {
    const result = await runBunScript(
      `const { SessionLockManager } = require(${JSON.stringify(FACADE_PATH)});` +
        `SessionLockManager.getLockPath('/tmp/chats', 'abc');` +
        `SessionLockManager.getLockPathFromFilePath('/tmp/chats/session-abc.jsonl');` +
        `process.stdout.write(Object.keys(require.cache).some((loadedPath) => loadedPath.includes('SessionLockManager.internals')) ? 'LOADED' : 'NOT_LOADED');`,
    );
    expect(result.trim()).toBe('NOT_LOADED');
  });

  it('an async operation loads the heavy implementation (lazy)', async () => {
    const result = await runBunScript(
      `const { SessionLockManager } = require(${JSON.stringify(FACADE_PATH)});` +
        `(async () => {` +
        `const before = Object.keys(require.cache).some((loadedPath) => loadedPath.includes('SessionLockManager.internals'));` +
        `await SessionLockManager.isLocked('/tmp/nonexistent-lazy-check', 'x');` +
        `const after = Object.keys(require.cache).some((loadedPath) => loadedPath.includes('SessionLockManager.internals'));` +
        `process.stdout.write(before ? '1' : '0');` +
        `process.stdout.write(after ? '1' : '0');` +
        `})();`,
    );
    // before=0 (not loaded), after=1 (loaded by async call)
    expect(result.trim()).toBe('01');
  });

  it('importing the recording barrel does not eagerly load the heavy lock implementation', async () => {
    const result = await runBunScript(
      `const mod = require(${JSON.stringify(BARREL_PATH)});` +
        `process.stdout.write(Object.keys(require.cache).some((loadedPath) => loadedPath.includes('SessionLockManager.internals')) ? 'LOADED' : 'NOT_LOADED');`,
    );
    expect(result.trim()).toBe('NOT_LOADED');
  });

  it('importing the core public root does not eagerly load the heavy lock implementation', async () => {
    const result = await runBunScript(
      `const mod = require(${JSON.stringify(CORE_ROOT_PATH)});` +
        `process.stdout.write(Object.keys(require.cache).some((loadedPath) => loadedPath.includes('SessionLockManager.internals')) ? 'LOADED' : 'NOT_LOADED');`,
    );
    expect(result.trim()).toBe('NOT_LOADED');
  }, 35000);
});
