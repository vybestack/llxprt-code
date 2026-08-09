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
 * Behavioral tests for the cross-process janitor lease (AC-6).
 *
 * Tests use real temporary filesystems and real subprocess competition.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { JanitorLease } from './janitorLease.js';
import type { JanitorLeaseHandle } from './janitorLease.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-lease-'));
}

/**
 * Tracks any lease acquired by a test so afterEach can reliably release it
 * (and stop the heartbeat timer) even if an assertion throws before the
 * test's own release call.
 */
let trackedLease: JanitorLeaseHandle | null = null;

afterEach(async () => {
  if (trackedLease) {
    await trackedLease.release().catch(() => {});
    trackedLease = null;
  }
});

describe('JanitorLease — single-process acquisition', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('acquires a lease when no lease exists', async () => {
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  });

  it('returns null when a lease is already held (skip-on-busy)', async () => {
    const lease1 = await JanitorLease.tryAcquire(tempDir);
    expect(lease1).not.toBeNull();
    trackedLease = lease1;

    const lease2 = await JanitorLease.tryAcquire(tempDir);
    expect(lease2).toBeNull();

    await lease1!.release();
    trackedLease = null;
  });

  it('releases the lease so another process can acquire', async () => {
    const lease1 = await JanitorLease.tryAcquire(tempDir);
    expect(lease1).not.toBeNull();
    trackedLease = lease1;
    await lease1!.release();
    trackedLease = null;

    const lease2 = await JanitorLease.tryAcquire(tempDir);
    expect(lease2).not.toBeNull();
    trackedLease = lease2;
    await lease2!.release();
    trackedLease = null;
  });

  it("owner-checked release does not remove another owner's lease", async () => {
    const lease1 = await JanitorLease.tryAcquire(tempDir);
    expect(lease1).not.toBeNull();
    trackedLease = lease1;

    // Simulate another process writing a different lease file.
    const leasePath = path.join(tempDir, '.llxprt-janitor.lease');
    const content = JSON.stringify({
      ownerToken: 'different-owner-token',
      pid: 999999,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
    await fs.writeFile(leasePath, content);

    // Release lease1 — should NOT remove the replacement.
    await lease1!.release();
    trackedLease = null;

    // The replacement lease file should still exist.
    const afterContent = await fs.readFile(leasePath, 'utf-8');
    expect(JSON.parse(afterContent).ownerToken).toBe('different-owner-token');
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'tryAcquire propagates I/O errors instead of masking them as busy',
    async () => {
      // Make the temp dir read-only so temp-file creation fails with EACCES.
      await fs.chmod(tempDir, 0o555);
      try {
        let threw = false;
        try {
          await JanitorLease.tryAcquire(tempDir);
        } catch {
          threw = true;
        }
        // A genuine I/O error must propagate — not be swallowed as null (busy).
        expect(threw).toBe(true);
      } finally {
        await fs.chmod(tempDir, 0o755);
      }
    },
  );
});

describe('JanitorLease — stale recovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('takes over a stale lease from a dead PID', async () => {
    const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

    // Write a stale lease with a dead PID.
    const oldTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'stale-token',
        pid: 999999, // Almost certainly dead.
        hostname: os.hostname(),
        createdAt: oldTime,
        heartbeatAt: oldTime,
      }),
    );

    // Should be able to acquire.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  });

  it('does not take over a lease with a live PID and recent heartbeat', async () => {
    const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

    // Write a live lease using our own PID.
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'live-token',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
    );

    // Should NOT be able to acquire — lease is live.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).toBeNull();
  });

  it('takes over a lease with a live PID but stale heartbeat exceeding the absolute PID-reuse bound', async () => {
    const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

    // Write a lease with our PID but createdAt/heartbeatAt far beyond the
    // absolute PID-reuse bound (2 hours).  Even though the PID is alive,
    // the absolute bound ensures the lease is reclaimable.
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'frozen-token',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: staleTime,
        heartbeatAt: staleTime,
      }),
    );

    // Should be able to acquire — exceeds the absolute PID-reuse bound.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  });

  it('does NOT take over a live-PID lease with stale heartbeat within the PID-reuse bound', async () => {
    const leasePath = path.join(tempDir, '.llxprt-janitor.lease');

    // Heartbeat is stale (60 min > 10 min) but PID is alive and createdAt
    // is within the 2-hour PID-reuse bound.
    const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'alive-frozen',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: staleTime,
        heartbeatAt: staleTime,
      }),
    );

    // Should NOT be able to acquire — PID is alive and within PID-reuse bound.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).toBeNull();
  });
});

describe('JanitorLease — real subprocess concurrency (AC-6)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('exactly one of two concurrent subprocesses wins the lease', async () => {
    // Spawn two child processes that each try to acquire the lease.
    const script = `
      const { JanitorLease } = require(${JSON.stringify(path.resolve(__dirname, 'janitorLease.js'))});
      const tempDir = process.env.TEST_TEMP_DIR;
      (async () => {
        try {
          const lease = await JanitorLease.tryAcquire(tempDir);
          if (lease) {
            // Hold for 500ms then release.
            await new Promise(r => setTimeout(r, 500));
            await lease.release();
            process.stdout.write('WON');
          } else {
            process.stdout.write('SKIP');
          }
        } catch (e) {
          process.stdout.write('SKIP');
        }
      })();
    `;

    // Use bun to run the script
    const results = await Promise.all([
      runBunScript(script, { TEST_TEMP_DIR: tempDir }),
      runBunScript(script, { TEST_TEMP_DIR: tempDir }),
    ]);

    const winners = results.filter((r) => r === 'WON');
    expect(winners.length).toBe(1);
  }, 30000);
});

/**
 * Helper: run a Bun script and return its stdout.
 *
 * Manages the child lifecycle explicitly so timeout, error, or rejection
 * always terminates only this exact child — no orphaned processes.
 */
function runBunScript(
  code: string,
  env?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['-e', code], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 15000);

    const cleanup = () => {
      clearTimeout(timer);
    };

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`Process exited with code ${code}
stderr: ${stderr}`),
        );
    });

    child.on('error', (err) => {
      cleanup();
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited — ignore.
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}
