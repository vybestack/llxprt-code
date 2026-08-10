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
 * Behavioral tests for the session janitor orchestrator (AC-1 through AC-11).
 *
 * Uses real temporary filesystems, real SessionRecordingService output, real
 * session files, and real lock files.  No mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runSessionCleanup,
  runSessionCleanupWithSettings,
} from './sessionJanitor.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { SessionRecordingService } from '../SessionRecordingService.js';
import { SessionLockManager } from '../SessionLockManager.js';
import { JanitorLease } from './janitorLease.js';
import type { SessionRecordingServiceConfig } from '../types.js';
import { ARCHIVE_DIR_NAME } from './sessionScanner.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-int-'));
}

function validHash64(): string {
  return crypto.randomUUID().replace(/-/g, '').repeat(2).slice(0, 64);
}

function makeConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: 'session-' + crypto.randomUUID(),
    projectHash: validHash64(),
    chatsDir,
    workspaceDirs: [chatsDir],
    provider: 'test',
    model: 'test',
  };
}

/** Create a real session file, optionally with content events. */
async function createSession(
  chatsDir: string,
  opts: {
    ageMs?: number;
    content?: string;
    sessionId?: string;
  } = {},
): Promise<{ filePath: string; sessionId: string }> {
  await fs.mkdir(chatsDir, { recursive: true });
  const sessionId = opts.sessionId ?? 'session-' + crypto.randomUUID();
  const config: SessionRecordingServiceConfig = {
    ...makeConfig(chatsDir),
    sessionId,
  };
  const svc = new SessionRecordingService(config);
  svc.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: opts.content ?? 'test message' }],
  });
  await svc.flush();
  await svc.dispose();
  const filePath = svc.getFilePath();
  if (!filePath) throw new Error('No file path');

  // Optionally set old mtime.
  if (opts.ageMs !== undefined) {
    const oldTime = new Date(Date.now() - opts.ageMs);
    await fs.utimes(filePath, oldTime, oldTime);
  }

  return { filePath, sessionId };
}

async function makeArchive(
  archiveDir: string,
  fileName: string,
  content: string,
  ageMs?: number,
): Promise<string> {
  await fs.mkdir(archiveDir, { recursive: true });
  const filePath = path.join(archiveDir, fileName);
  await fs.writeFile(filePath, content);
  if (ageMs !== undefined) {
    const oldTime = new Date(Date.now() - ageMs);
    await fs.utimes(filePath, oldTime, oldTime);
  }
  return filePath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('runSessionCleanup — defaults and discovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('is default-on and discovers real SessionRecordingService files', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000, // 2 days old
    });

    const config = resolveRetentionConfig(undefined);
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.disabled).toBe(false);
    expect(result.janitorWonLease).toBe(true);
    expect(result.scanned).toBe(1);
    // Under budget — should not archive or delete.
    expect(result.archived).toBe(0);
    expect(result.rawDeleted).toBe(0);
    // Old session survives when under budget (no default maxAge).
    expect(await fileExists(filePath)).toBe(true);
  });

  it('does not age-delete an old under-budget session (AC-3)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath } = await createSession(chatsDir, {
      ageMs: 365 * 24 * 60 * 60 * 1000, // 1 year old
    });

    const config = resolveRetentionConfig(undefined);
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // No default maxAge → session retained even though very old.
    expect(result.rawDeleted).toBe(0);
    expect(await fileExists(filePath)).toBe(true);
  });

  it('returns disabled=true when cleanup is explicitly disabled', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await createSession(chatsDir);

    const config = resolveRetentionConfig({ enabled: false });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.disabled).toBe(true);
    expect(result.janitorWonLease).toBe(false);
  });
  it('retains the 4 GiB default at runtime for a partial settings object (AC-2)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await createSession(chatsDir, { ageMs: 2 * 24 * 60 * 60 * 1000 });

    // A partial settings object that only sets maxAge — size budget must
    // default to 4 GiB at the consumer so this small session is retained.
    const result = await runSessionCleanupWithSettings(tempDir, undefined, {
      maxAge: '30d',
    });

    expect(result.disabled).toBe(false);
    expect(result.configuredByteLimit).toBe(4096 * 1024 * 1024);
    expect(result.archived).toBe(0);
    expect(result.rawDeleted).toBe(0);
  });
});

describe('runSessionCleanup — explicit maxAge (AC-3)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('archives sessions older than an explicit maxAge', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const { filePath: oldFile } = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000, // 5 days old
    });
    const { filePath: recentFile } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000, // 2 days old
    });

    // maxAge 3d: the 5-day session is beyond the limit; the 2-day is within.
    // Explicit age/count policy uses direct deletion (lock-owned).
    const config = resolveRetentionConfig({ maxAge: '3d' });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.rawDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldFile)).toBe(false);
    // Within maxAge and under budget — retained.
    expect(await fileExists(recentFile)).toBe(true);
  });

  it('retains all eligible sessions when none exceed maxAge', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const { filePath: a } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
    });
    const { filePath: b } = await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
    });

    const config = resolveRetentionConfig({ maxAge: '30d' });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.archived).toBe(0);
    expect(await fileExists(a)).toBe(true);
    expect(await fileExists(b)).toBe(true);
  });
});

describe('runSessionCleanup — explicit maxCount (AC-3)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps only the N most recent sessions under maxCount', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const oldest = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
    });
    const middle = await createSession(chatsDir, {
      ageMs: 4 * 24 * 60 * 60 * 1000,
    });
    const newest = await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
    });

    const config = resolveRetentionConfig({ maxCount: 2 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Only the 2 most recent survive; the oldest is directly deleted
    // (explicit count policy uses lock-owned direct deletion).
    expect(result.rawDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldest.filePath)).toBe(false);
    expect(await fileExists(middle.filePath)).toBe(true);
    expect(await fileExists(newest.filePath)).toBe(true);
  });

  it('retains all when count is within maxCount', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const a = await createSession(chatsDir, { ageMs: 3 * 24 * 60 * 60 * 1000 });
    const b = await createSession(chatsDir, { ageMs: 2 * 24 * 60 * 60 * 1000 });

    const config = resolveRetentionConfig({ maxCount: 5 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.archived).toBe(0);
    expect(await fileExists(a.filePath)).toBe(true);
    expect(await fileExists(b.filePath)).toBe(true);
  });
});

describe('runSessionCleanup — protection (AC-7)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('protects the current session from deletion', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath, sessionId } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'x'.repeat(1024 * 1024 * 10), // 10MB to ensure over-budget
    });

    // Tiny budget to force size-driven reclamation.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 1 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      currentSessionId: sessionId,
      config,
    });

    // Current session should survive and be counted as protected.
    expect(await fileExists(filePath)).toBe(true);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('protects recent sessions (within minRetention)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath } = await createSession(chatsDir, {
      content: 'x'.repeat(1024 * 1024 * 10), // 10MB
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 1 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Recent session (within 1d default minRetention) should survive.
    expect(await fileExists(filePath)).toBe(true);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('protects sessions with a live lock', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath, sessionId } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'x'.repeat(1024 * 1024 * 10),
    });

    // Acquire a live lock.
    const lock = await SessionLockManager.acquire(chatsDir, sessionId);

    try {
      const config = resolveRetentionConfig({ maxTotalSizeMB: 1 });
      const result = await runSessionCleanup({
        globalTempDir: tempDir,
        config,
      });

      // Live-locked session should survive.
      expect(await fileExists(filePath)).toBe(true);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    } finally {
      await lock.release();
    }
  });

  it('protects unreadable recordings and counts them (AC-7)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a session file with garbage content.
    const garbagePath = path.join(
      chatsDir,
      'session-2026-01-01T00-00-00-garbage.jsonl',
    );
    await fs.writeFile(garbagePath, 'this is not valid JSON\n');
    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(garbagePath, oldTime, oldTime);

    const config = resolveRetentionConfig({ maxTotalSizeMB: 1 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Unreadable recording should survive.
    expect(await fileExists(garbagePath)).toBe(true);
    expect(result.scanned).toBeGreaterThanOrEqual(1);
  });
});

describe('runSessionCleanup — size-driven archival (AC-4)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('archives eligible raw sessions when over budget', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a large old session.
    const { filePath } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(100_000), // ~100KB
    });

    // Small budget.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.01 }); // ~10KB
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Session should be archived (raw deleted, archive created).
    expect(result.archived).toBeGreaterThanOrEqual(1);
    expect(await fileExists(filePath)).toBe(false);

    // Archive should exist.
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    const archives = await fs.readdir(archiveDir);
    expect(archives.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves archive integrity (lossless round-trip)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const content = 'compressible content\n'.repeat(5000);
    const { filePath } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content,
    });

    // Read original content.
    const original = await fs.readFile(filePath, 'utf-8');

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.01 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Find the archive and decompress.
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    const archives = await fs.readdir(archiveDir);
    expect(archives.length).toBe(1);

    const zlib = await import('node:zlib');
    const archiveData = await fs.readFile(path.join(archiveDir, archives[0]));
    const decompressed = zlib.gunzipSync(archiveData).toString('utf-8');

    expect(decompressed).toBe(original);
  });

  it('archives count toward the same budget and are evicted oldest-first', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    // Create old raw sessions and old archives.
    await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    await makeArchive(
      archiveDir,
      'session-very-old.jsonl.gz',
      'x'.repeat(50_000),
      10 * 24 * 60 * 60 * 1000, // 10 days old
    );

    // Budget smaller than total.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.05 }); // ~50KB
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Some data should have been reclaimed.
    expect(result.bytesAfter).toBeLessThanOrEqual(config.maxTotalSizeBytes);
  });

  it('evicts the oldest archive by exact identity, not just budget', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Three archives with distinct ages and content.
    const oldest = await makeArchive(
      archiveDir,
      'session-oldest-aaa.jsonl.gz',
      'x'.repeat(50_000),
      10 * 24 * 60 * 60 * 1000, // 10 days
    );
    const middle = await makeArchive(
      archiveDir,
      'session-middle-bbb.jsonl.gz',
      'y'.repeat(50_000),
      8 * 24 * 60 * 60 * 1000, // 8 days
    );
    const newest = await makeArchive(
      archiveDir,
      'session-newest-ccc.jsonl.gz',
      'z'.repeat(50_000),
      6 * 24 * 60 * 60 * 1000, // 6 days
    );

    // Budget: 0.12 MB (~125 KB). Three archives total ~150 KB.
    // After evicting the oldest: ~100 KB < 125 KB → stop.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.12 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The OLDEST archive is evicted; the two newer survive.
    expect(result.archiveDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldest)).toBe(false);
    expect(await fileExists(middle)).toBe(true);
    expect(await fileExists(newest)).toBe(true);
  });
});

describe('runSessionCleanup — stale lock cleanup (AC-8)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('removes stale lock files in chats directories', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a stale lock (dead PID).
    const staleLockPath = path.join(chatsDir, 'stale-session-id.lock');
    await fs.writeFile(
      staleLockPath,
      JSON.stringify({
        pid: 999999,
        timestamp: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const config = resolveRetentionConfig(undefined);
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.staleLocksRemoved).toBeGreaterThanOrEqual(1);
    expect(await fileExists(staleLockPath)).toBe(false);
  });

  it('preserves live lock files', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a live lock (current PID, recent timestamp).
    const liveLockPath = path.join(chatsDir, 'live-session-id.lock');
    await fs.writeFile(
      liveLockPath,
      JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString(),
      }),
    );

    const config = resolveRetentionConfig(undefined);
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.staleLocksRemoved).toBe(0);
    expect(await fileExists(liveLockPath)).toBe(true);
  });

  it('removes a live-PID lock whose timestamp exceeds the 48h PID-reuse bound', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a lock with a LIVE PID (process.pid) but a timestamp 49 hours
    // ago.  The PID is alive, so checkStaleWithPidReuse does NOT return true
    // via ESRCH — it must use the 48-hour timestamp override.
    const lockSessionId = 'pid-reuse-stale';
    const staleLockPath = path.join(chatsDir, lockSessionId + '.lock');
    const oldTimestamp = new Date(
      Date.now() - 49 * 60 * 60 * 1000,
    ).toISOString();
    await fs.writeFile(
      staleLockPath,
      JSON.stringify({
        pid: process.pid,
        timestamp: oldTimestamp,
        sessionId: lockSessionId,
      }),
    );

    const config = resolveRetentionConfig(undefined);
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The 48h PID-reuse override marks it stale and removes it.
    expect(result.staleLocksRemoved).toBeGreaterThanOrEqual(1);
    expect(await fileExists(staleLockPath)).toBe(false);
  });
});

describe('runSessionCleanup — blast radius (AC-10)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('never touches unknown files in chats dir', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create various non-session files.
    const logPath = path.join(chatsDir, 'logs.json');
    const backupPath = path.join(chatsDir, 'backup.bak');
    const historyPath = path.join(chatsDir, 'shell_history');
    await fs.writeFile(logPath, '{}');
    await fs.writeFile(backupPath, 'backup');
    await fs.writeFile(historyPath, 'history');

    // Also create a session.
    await createSession(chatsDir, { ageMs: 2 * 24 * 60 * 60 * 1000 });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Unknown files should survive.
    expect(await fileExists(logPath)).toBe(true);
    expect(await fileExists(backupPath)).toBe(true);
    expect(await fileExists(historyPath)).toBe(true);
  });

  it('removes genuinely empty chats and hash dirs (non-recursive)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a session that will be archived+deleted, then the archive
    // also evicted because even compressed bytes exceed the tiny budget.
    await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    // Budget so small that even the compressed archive exceeds it.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.00001 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The chats dir and hash dir should be removed (non-recursive rmdir).
    expect(await fileExists(chatsDir)).toBe(false);
    expect(await fileExists(path.join(tempDir, hash))).toBe(false);
  });

  it('does not remove non-empty dirs', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create an unknown file that prevents dir removal.
    const unknownPath = path.join(chatsDir, 'unknown.dat');
    await fs.writeFile(unknownPath, 'data');

    const config = resolveRetentionConfig(undefined);
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Dir should survive because it's not empty.
    expect(await fileExists(chatsDir)).toBe(true);
    expect(await fileExists(unknownPath)).toBe(true);
  });
});

describe('runSessionCleanup — structured result (AC-11)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports bytesBefore, bytesAfter, and configuredByteLimit', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'data',
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 4096 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.bytesBefore).toBeGreaterThan(0);
    expect(result.bytesAfter).toBeGreaterThan(0);
    expect(result.configuredByteLimit).toBe(4096 * 1024 * 1024);
    expect(result.overBudgetBytes).toBe(0); // Under budget.
  });

  it('reports overBudgetBytes when protected data exceeds budget', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create garbage file (unreadable → protected).
    const garbagePath = path.join(
      chatsDir,
      'session-2026-01-01T00-00-00-protected.jsonl',
    );
    await fs.writeFile(garbagePath, 'x'.repeat(50_000) + '\n');
    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(garbagePath, oldTime, oldTime);

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Protected data survives, overBudgetBytes > 0.
    expect(await fileExists(garbagePath)).toBe(true);
    expect(result.overBudgetBytes).toBeGreaterThan(0);
  });
});

/**
 * Lease contention (AC-6, finding 42).
 *
 * When another process holds the global janitor lease, cleanup must return
 * immediately with janitorWonLease: false and NO mutations.
 */
describe('runSessionCleanup — lease contention skip (AC-6, finding 42)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns janitorWonLease false and performs no mutations when lease is held', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create an old session that WOULD be cleaned up if the janitor won.
    const { filePath } = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    // Pre-acquire the lease so cleanup cannot win it.
    const blockingLease = await JanitorLease.tryAcquire(tempDir);
    expect(blockingLease).not.toBeNull();

    try {
      const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
      const result = await runSessionCleanup({
        globalTempDir: tempDir,
        config,
      });

      // Cleanup did not win the lease.
      expect(result.janitorWonLease).toBe(false);
      // No mutations performed.
      expect(result.scanned).toBe(0);
      expect(result.archived).toBe(0);
      expect(result.rawDeleted).toBe(0);
      expect(result.archiveDeleted).toBe(0);
      // The old session must survive — no mutation happened.
      expect(await fileExists(filePath)).toBe(true);
    } finally {
      await blockingLease!.release();
    }
  });
});
