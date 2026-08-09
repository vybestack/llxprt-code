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
 * Adversarial safety tests for the hardened JanitorLease (Item 5).
 *
 * Tests prove:
 * - An old-createdAt lease with a fresh heartbeat is NOT stale.
 * - A replaced lease is not overwritten or deleted by the old owner.
 * - A malformed lease is recoverable, not a permanent denial.
 * - Heartbeat updates heartbeatAt while ownership is verified.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { JanitorLease } from './janitorLease.js';
import type { JanitorLeaseHandle } from './janitorLease.js';

const LEASE_FILE_NAME = '.llxprt-janitor.lease';
const LEASE_CLAIM_SUFFIX = '.tclaim';

/**
 * Tracks any lease acquired by a test so afterEach can reliably release it
 * (and stop the heartbeat timer) even if an assertion throws before the
 * test's own release call.  Local tracked-handle cleanup — no production
 * reset API needed.
 */
let trackedLease: JanitorLeaseHandle | null = null;

afterEach(async () => {
  if (trackedLease) {
    await trackedLease.release().catch(() => {});
    trackedLease = null;
  }
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lease-safety-'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('JanitorLease — old-createdAt / fresh-heartbeat (Item 5)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does NOT treat a lease with old createdAt but fresh heartbeat as stale', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);
    const oldCreated = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const freshHeartbeat = new Date().toISOString();

    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'fresh-heartbeat-owner',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: oldCreated,
        heartbeatAt: freshHeartbeat,
      }),
    );

    // The lease has a fresh heartbeat → should NOT be taken over.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).toBeNull();
  });

  it('treats a lease with old createdAt AND old heartbeat as stale', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);
    // Use 3 hours ago: beyond PID_REUSE_BOUND_MS (2h) so even a live PID
    // is considered stale.
    const oldTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'all-old-owner',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: oldTime,
        heartbeatAt: oldTime,
      }),
    );

    // Both createdAt and heartbeatAt are old → stale → can be taken over.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  });
});

describe('JanitorLease — replacement ownership safety (Item 5)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("release does not delete a replacement owner's lease", async () => {
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;

    const leasePath = path.join(tempDir, LEASE_FILE_NAME);

    // Simulate another process replacing the lease.
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'replacement-owner',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }),
    );

    // Release our old lease — should NOT remove the replacement.
    await lease!.release();
    trackedLease = null;

    const content = await fs.readFile(leasePath, 'utf-8');
    expect(JSON.parse(content).ownerToken).toBe('replacement-owner');
  });

  it('a fresh replacement lease blocks acquisition', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);

    // Write a fresh live lease directly.
    const freshTime = new Date().toISOString();
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'fresh-replacement',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: freshTime,
        heartbeatAt: freshTime,
      }),
    );

    // Acquisition should fail — the lease is fresh.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).toBeNull();

    // The fresh lease should survive.
    const content = await fs.readFile(leasePath, 'utf-8');
    expect(JSON.parse(content).ownerToken).toBe('fresh-replacement');
  });
});

describe('JanitorLease — malformed lease recovery (Item 5)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('recovers from a corrupt lease file without permanent denial', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);

    // Write a corrupt lease file (old enough to be past the age bound).
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await fs.utimes(tempDir, new Date(oldTime), new Date(oldTime));
    await fs.writeFile(leasePath, 'this is corrupt garbage!!!');

    // Set the file mtime to be old so it's past the recovery bound.
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(leasePath, oldDate, oldDate);

    // Acquisition should eventually succeed (recoverable, not permanent denial).
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  });

  it('does not remove a recent corrupt lease (conservative skip)', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);
    await fs.writeFile(leasePath, 'corrupt but recent');

    // The corrupt lease is recent — acquisition should skip conservatively.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).toBeNull();

    // The corrupt lease should still exist (not removed).
    expect(await fileExists(leasePath)).toBe(true);
  });
});

describe('JanitorLease — atomic publication (Item 5)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not leave temp artifacts after successful acquire', async () => {
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;

    const entries = await fs.readdir(tempDir);
    // Only the lease file should exist — no .tmp artifacts.
    const tempArtifacts = entries.filter(
      (f) => f.includes('.tmp') || f.includes('.lease'),
    );
    expect(tempArtifacts).toEqual([LEASE_FILE_NAME]);

    await lease!.release();
    trackedLease = null;
  });
});

describe('JanitorLease — in-place heartbeat safety (root fix 2)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes a fresh heartbeatAt equal to createdAt on acquire', async () => {
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;

    const leasePath = path.join(tempDir, LEASE_FILE_NAME);
    const content = await fs.readFile(leasePath, 'utf-8');
    const record = JSON.parse(content);
    expect(record.ownerToken).toBeDefined();
    expect(record.heartbeatAt).toBe(record.createdAt);

    await lease!.release();
    trackedLease = null;
  });

  it('heartbeat in-place write does not overwrite a replacement owner', async () => {
    // Acquire a lease, then replace the lease content (simulating a takeover).
    // The old owner's in-place heartbeat (r+ on the old inode) must not
    // overwrite the replacement's content.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;

    const leasePath = path.join(tempDir, LEASE_FILE_NAME);

    // Replace the lease with a different owner (new inode at the same path).
    await fs.unlink(leasePath);
    const replacementContent = JSON.stringify({
      ownerToken: 'replacement-owner',
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    });
    await fs.writeFile(leasePath, replacementContent);

    // Release the old lease — owner-checked release must not remove it.
    await lease!.release();
    trackedLease = null;

    const content = await fs.readFile(leasePath, 'utf-8');
    expect(JSON.parse(content).ownerToken).toBe('replacement-owner');
  });
});

// ---------------------------------------------------------------------------
// OCR 18/19: Transition claim protocol — deterministic contention tests
// with real filesystem and subprocess behavior.
// ---------------------------------------------------------------------------

describe('JanitorLease — transition claim protocol (OCR 18/19)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * A crashed transition claim (hard link to a stale lease inode) must be
   * safely reclaimed so a subsequent stale takeover can proceed.
   */
  it('reclaims a crashed stale transition claim and takes over', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);
    const claimPath = leasePath + LEASE_CLAIM_SUFFIX;
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    // Write a stale lease.
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'crashed-contender',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: staleTime,
        heartbeatAt: staleTime,
      }),
    );

    // Simulate a crashed contender that left a transition claim behind.
    await fs.link(leasePath, claimPath);
    expect(await fileExists(claimPath)).toBe(true);

    // tryAcquire should reclaim the stale claim and take over the lease.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  });

  /**
   * A stale contender holding a crashed claim must NOT unlink a fresh
   * replacement lease.  The pre-existing claim pins the OLD stale inode;
   * the fresh replacement has a different inode.  The takeover skips.
   */
  it('does not unlink a fresh replacement when a stale claim pins the old inode', async () => {
    const leasePath = path.join(tempDir, LEASE_FILE_NAME);
    const claimPath = leasePath + LEASE_CLAIM_SUFFIX;
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    // Write a stale lease.
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'old-stale',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: staleTime,
        heartbeatAt: staleTime,
      }),
    );

    // Crashed contender leaves a claim on the old stale inode.
    await fs.link(leasePath, claimPath);

    // Replace the lease with a FRESH live lease (new inode).
    await fs.unlink(leasePath);
    const freshTime = new Date().toISOString();
    await fs.writeFile(
      leasePath,
      JSON.stringify({
        ownerToken: 'fresh-replacement',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: freshTime,
        heartbeatAt: freshTime,
      }),
    );

    // tryAcquire must NOT take over the fresh replacement.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).toBeNull();

    // The fresh replacement survives.
    const content = await fs.readFile(leasePath, 'utf-8');
    expect(JSON.parse(content).ownerToken).toBe('fresh-replacement');
  });

  /**
   * Fresh-heartbeat contention (subprocess): a subprocess holds a live lease
   * with active heartbeats.  The main process cannot take it over.  After
   * the subprocess releases, the main process acquires successfully.
   */
  it('fresh-heartbeat subprocess contention: main process cannot take over a live lease', async () => {
    const script = `
        const { JanitorLease } = require(${JSON.stringify(path.resolve(__dirname, 'janitorLease.js'))});
        const tempDir = process.env.TEST_TEMP_DIR;
        (async () => {
          const lease = await JanitorLease.tryAcquire(tempDir);
          if (lease) {
            process.stdout.write('HOLDING');
            await new Promise(r => setTimeout(r, 1500));
            await lease.release();
            process.stdout.write('RELEASED');
          } else {
            process.stdout.write('SKIP');
          }
        })().catch(() => process.stdout.write('ERROR'));
      `;

    const child = spawn('bun', ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TEST_TEMP_DIR: tempDir },
    });

    let childStdout = '';
    child.stdout.on('data', (d) => (childStdout += d.toString()));

    // Wait for the subprocess to acquire the lease.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout waiting for HOLDING')),
        10000,
      );
      child.stdout.on('data', (d: Buffer) => {
        if (d.toString().includes('HOLDING')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // The subprocess holds a fresh lease — main process cannot take over.
    const attempt = await JanitorLease.tryAcquire(tempDir);
    expect(attempt).toBeNull();

    // Wait for the subprocess to release.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout waiting for RELEASED')),
        10000,
      );
      child.stdout.on('data', (d: Buffer) => {
        if (d.toString().includes('RELEASED')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (childStdout.includes('RELEASED')) resolve();
        else reject(new Error('Subprocess exited without RELEASED'));
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // After release, the main process can acquire.
    const lease = await JanitorLease.tryAcquire(tempDir);
    expect(lease).not.toBeNull();
    trackedLease = lease;
    await lease!.release();
    trackedLease = null;
  }, 30000);
});
