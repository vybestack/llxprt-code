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
 * Behavioral tests for the reclamation engine items 1–4.
 *
 * Uses real temporary filesystems, real SessionRecordingService output, real
 * gzip archives, real locks, and a narrow unlink fault seam for Item 4.  No
 * mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { runSessionCleanup } from './sessionJanitor.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { setUnlinkFaultForTest } from './reclamationEngine.js';
import { SessionRecordingService } from '../SessionRecordingService.js';
import { SessionLockManager } from '../SessionLockManager.js';
import type { SessionRecordingServiceConfig } from '../types.js';
import { ARCHIVE_DIR_NAME } from './sessionScanner.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-reclaim-'));
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
  const gzipped = zlib.gzipSync(Buffer.from(content, 'utf-8'));
  await fs.writeFile(filePath, gzipped);
  if (ageMs !== undefined) {
    const oldTime = new Date(Date.now() - ageMs);
    await fs.utimes(filePath, oldTime, oldTime);
  }
  return filePath;
}

/**
 * Content gzip cannot meaningfully shrink, so the resulting archive's LOGICAL
 * size tracks the requested size on every platform.
 *
 * Budget accounting uses allocated blocks where the OS reports them and falls
 * back to logical size otherwise (getFileSize in sessionScanner). Node reports
 * `blocks: 0` on Windows, so a highly compressible fixture that only exceeds
 * the budget through POSIX 4 KiB block rounding sits *under* budget there and
 * no eviction runs at all — the sweep returns before it can record the
 * outcome these tests are about.
 */
function incompressible(bytes: number): string {
  const chunks: string[] = [];
  let length = 0;
  let seed = 1;
  while (length < bytes) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const chunk = seed.toString(36);
    chunks.push(chunk);
    length += chunk.length;
  }
  return chunks.join('').slice(0, bytes);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listArchives(chatsDir: string): Promise<string[]> {
  const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
  if (!(await fileExists(archiveDir))) return [];
  return fs.readdir(archiveDir);
}

// ===========================================================================
// Item 1: Actual-byte size reclamation
// ===========================================================================

describe('Item 1 — actual-byte size reclamation (no fixed estimate)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('compresses oldest incompressible raw first, then newer compressible raw', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Oldest: incompressible random data (~10 KB).
    const randomData = crypto
      .getRandomValues(Buffer.alloc(10_000))
      .toString('hex');
    const oldest = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: randomData,
    });

    // Newer: highly compressible repeated text (~50 KB).
    const compressible = await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'AB'.repeat(25_000),
    });

    // Budget tight enough that compressing both is needed.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.015 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // Both raws should be compressed (archived >= 2 means both were processed).
    expect(result.archived).toBeGreaterThanOrEqual(2);
    expect(await fileExists(oldest.filePath)).toBe(false);
    expect(await fileExists(compressible.filePath)).toBe(false);

    // Both archives should exist — no archive was evicted because compressing
    // both raws brought the total under budget.
    expect(result.archiveDeleted).toBe(0);
    const archives = await listArchives(chatsDir);
    expect(archives.length).toBe(2);
  });

  it('continues through all eligible raws after a skipped/failed first candidate', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const oldestId = 'session-oldest-fault-' + crypto.randomUUID().slice(0, 8);
    const oldest = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(40_000),
      sessionId: oldestId,
    });

    const newer = await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'B'.repeat(40_000),
    });

    // Inject an unlink fault for the oldest session's raw only.
    setUnlinkFaultForTest(async (filePath: string) => {
      if (filePath === oldest.filePath) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      await fs.unlink(filePath);
    });

    try {
      const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
      const result = await runSessionCleanup({
        globalTempDir: tempDir,
        config,
      });

      // Oldest: archive was created but source unlink failed.
      expect(result.archived).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBeGreaterThanOrEqual(1);

      // Newer: should still be processed despite the first failure.
      expect(await fileExists(newer.filePath)).toBe(false);
    } finally {
      setUnlinkFaultForTest(null);
    }
  });

  it('does NOT evict an archive while another useful eligible raw can be compressed', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    // Pre-existing old archive.
    const oldArchivePath = await makeArchive(
      archiveDir,
      'session-preexisting.jsonl.gz',
      'old archive data'.repeat(500),
      10 * 24 * 60 * 60 * 1000,
    );

    // Two eligible compressible raws.
    await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });
    await createSession(chatsDir, {
      ageMs: 4 * 24 * 60 * 60 * 1000,
      content: 'B'.repeat(50_000),
    });

    // Budget: compressing both raws brings total under budget, so the
    // pre-existing archive should survive.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.01 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    expect(result.archiveDeleted).toBe(0);
    expect(await fileExists(oldArchivePath)).toBe(true);
    expect(result.archived).toBeGreaterThanOrEqual(2);
  });

  it('evicts archives only after all eligible raws are exhausted', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    // Pre-existing old archive (large).
    const oldArchivePath = await makeArchive(
      archiveDir,
      'session-oldarchive.jsonl.gz',
      'x'.repeat(40_000),
      10 * 24 * 60 * 60 * 1000,
    );

    // One eligible incompressible raw.
    const randomData = crypto
      .getRandomValues(Buffer.alloc(30_000))
      .toString('hex');
    await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: randomData,
    });

    // Budget so tiny that even after compression, archives must be evicted.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.00001 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // The raw was compressed first (archived >= 1), then archives were evicted.
    expect(result.archived).toBeGreaterThanOrEqual(1);
    expect(result.archiveDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldArchivePath)).toBe(false);
  });
});

// ===========================================================================
// Item 2: Global explicit age/count semantics
// ===========================================================================

describe('Item 2 — global age/count over raw+archive corpus', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('removes an old archive by maxAge while under size budget', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Old archive (10 days old), no corresponding raw.
    const oldArchivePath = await makeArchive(
      archiveDir,
      'session-old-only.jsonl.gz',
      'archived session data'.repeat(100),
      10 * 24 * 60 * 60 * 1000,
    );

    // Large size budget so size reclamation does not kick in.
    // maxAge=5d removes the 10-day-old archive.
    const config = resolveRetentionConfig({
      maxAge: '5d',
      maxTotalSizeMB: 4096,
    });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    expect(result.archiveDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldArchivePath)).toBe(false);
  });

  it('removes excess archives by maxCount', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Three old archives.
    const oldest = await makeArchive(
      archiveDir,
      'session-aaa.jsonl.gz',
      'data-a'.repeat(100),
      10 * 24 * 60 * 60 * 1000,
    );
    const middle = await makeArchive(
      archiveDir,
      'session-bbb.jsonl.gz',
      'data-b'.repeat(100),
      8 * 24 * 60 * 60 * 1000,
    );
    await makeArchive(
      archiveDir,
      'session-ccc.jsonl.gz',
      'data-c'.repeat(100),
      6 * 24 * 60 * 60 * 1000,
    );

    // maxCount=2 → remove the oldest archive.
    const config = resolveRetentionConfig({
      maxCount: 2,
      maxTotalSizeMB: 4096,
    });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    expect(result.archiveDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldest)).toBe(false);
    expect(await fileExists(middle)).toBe(true);
  });

  it('reports shortfall when a protected session breaches an explicit limit', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Current session (old mtime, but protected because it is current).
    const currentSession = await createSession(chatsDir, {
      ageMs: 10 * 24 * 60 * 60 * 1000,
      content: 'current',
    });

    // Two newer eligible sessions.
    await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'newer-a',
    });
    await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'newer-b',
    });

    // maxCount=2 with 3 sessions: 1 excess.
    // The oldest (current session) is excess but protected → shortfall.
    const config = resolveRetentionConfig({
      maxCount: 2,
      maxTotalSizeMB: 4096,
    });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      currentSessionId: currentSession.sessionId,
      config,
    });

    expect(result.ageCountShortfall).toBeGreaterThanOrEqual(1);
    expect(await fileExists(currentSession.filePath)).toBe(true);
  });

  it('does not double-count a raw and its same-session archive for maxCount', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Group A: raw + archive (same session, 5 days old).
    const sessionA = 'session-groupa-' + crypto.randomUUID().slice(0, 8);
    const rawA = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'group-a-data',
      sessionId: sessionA,
    });
    const archiveAPath = path.join(
      archiveDir,
      path.basename(rawA.filePath) + '.gz',
    );
    const archiveContent = zlib.gzipSync(
      Buffer.from('group-a-archive', 'utf-8'),
    );
    await fs.writeFile(archiveAPath, archiveContent);
    const oldTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await fs.utimes(archiveAPath, oldTime, oldTime);

    // Group B: raw only (3 days old).
    const rawB = await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'group-b-data',
    });

    // Group C: raw only (2 days old).
    const rawC = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'group-c-data',
    });

    // maxCount=2 → 3 groups, 1 excess (Group A).
    // With duplicate counting, there would be 4 "sessions" (A raw, A archive,
    // B, C), causing 2 excess — Group A AND Group B would be removed.
    // Correct behaviour: only Group A is removed; B and C survive.
    const config = resolveRetentionConfig({
      maxCount: 2,
      maxTotalSizeMB: 4096,
    });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // Group A removed (raw + archive).
    expect(result.rawDeleted).toBeGreaterThanOrEqual(1);
    expect(result.archiveDeleted).toBeGreaterThanOrEqual(1);
    expect(await fileExists(rawA.filePath)).toBe(false);
    expect(await fileExists(archiveAPath)).toBe(false);

    // Groups B and C survive — no duplicate counting.
    expect(await fileExists(rawB.filePath)).toBe(true);
    expect(await fileExists(rawC.filePath)).toBe(true);
  });

  it('protects a live-locked session and reports it in the shortfall', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Oldest session with a live lock.
    const locked = await createSession(chatsDir, {
      ageMs: 10 * 24 * 60 * 60 * 1000,
      content: 'locked',
    });
    const lock = await SessionLockManager.acquire(chatsDir, locked.sessionId);

    // Two newer eligible sessions.
    await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'newer-a',
    });
    await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'newer-b',
    });

    // maxCount=2: 3 groups, 1 excess.  The locked session is oldest → excess
    // but protected → shortfall.
    const config = resolveRetentionConfig({
      maxCount: 2,
      maxTotalSizeMB: 4096,
    });
    let result;
    try {
      result = await runSessionCleanup({
        globalTempDir: tempDir,
        config,
      });

      expect(result.ageCountShortfall).toBeGreaterThanOrEqual(1);
      expect(await fileExists(locked.filePath)).toBe(true);
    } finally {
      await lock.release();
    }
  });
});

// ===========================================================================
// Item 3: Archive chronology / floor / order
// ===========================================================================

describe('Item 3 — archive chronology, minRetention floor, deterministic order', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('old raw compressed today retains old mtime ordering', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // A newer pre-existing archive (3 days old).
    await makeArchive(
      archiveDir,
      'session-newer.jsonl.gz',
      'newer archive'.repeat(100),
      3 * 24 * 60 * 60 * 1000,
    );

    // An old raw (5 days old) that will be compressed today.
    const oldRaw = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    // Tight budget forces compression of the raw but allows compressed
    // archives to survive (allocated blocks ~4 KB each).
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.01 });
    await runSessionCleanup({ globalTempDir: tempDir, config });

    // The archive created from the old raw should carry the 5-day-old mtime,
    // not today's date.
    const archives = await listArchives(chatsDir);
    const compressedArchive = archives.find(
      (f) => f === path.basename(oldRaw.filePath) + '.gz',
    );
    expect(compressedArchive).toBeTruthy();

    const archiveStat = await fs.stat(
      path.join(archiveDir, compressedArchive!),
    );
    const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
    // The archive mtime should be close to 5 days ago (within a tolerance).
    expect(Math.abs(archiveStat.mtimeMs - fiveDaysAgo)).toBeLessThan(5000);
  });

  it('a recent archive survives size pressure due to minRetention floor', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Recent archive within the default 1d minRetention floor.
    const recentArchivePath = await makeArchive(
      archiveDir,
      'session-recent.jsonl.gz',
      'x'.repeat(40_000),
      6 * 60 * 60 * 1000, // 6 hours ago
    );

    // An old eligible raw that will be compressed.
    await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(30_000),
    });

    // Tiny budget so both archives would need to be evicted if not for
    // minRetention.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.00001 });
    await runSessionCleanup({ globalTempDir: tempDir, config });

    // The recent archive survives the minRetention floor.
    expect(await fileExists(recentArchivePath)).toBe(true);
  });

  it('equal mtimes always choose the same lexicographically oldest archive', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Two archives with identical mtime.  The lexicographically smaller
    // filename should be evicted first.
    const alphaPath = await makeArchive(
      archiveDir,
      'session-aaa.jsonl.gz',
      incompressible(30_000),
    );
    const betaPath = await makeArchive(
      archiveDir,
      'session-zzz.jsonl.gz',
      incompressible(30_000),
    );
    // Set EXACT same mtime on both.
    const fixedTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await fs.utimes(alphaPath, fixedTime, fixedTime);
    await fs.utimes(betaPath, fixedTime, fixedTime);

    // Budget that admits exactly one of the two archives, derived from their
    // real on-disk size rather than hand-calibrated. A fixed literal would
    // depend on both the gzip ratio and on POSIX block rounding, and the
    // accounting differs by platform: allocated blocks where the OS reports
    // them, logical size otherwise.
    const oneArchiveBytes = (await fs.stat(alphaPath)).size;
    const config = resolveRetentionConfig({
      maxTotalSizeMB: (oneArchiveBytes * 1.5) / (1024 * 1024),
    });
    await runSessionCleanup({ globalTempDir: tempDir, config });

    // session-aaa (lexicographically smaller) should be evicted; session-zzz
    // survives.
    expect(await fileExists(alphaPath)).toBe(false);
    expect(await fileExists(betaPath)).toBe(true);
  });
});

// ===========================================================================
// Item 4: Failure isolation / diagnostics
// ===========================================================================

describe('Item 4 — failure isolation and diagnostics', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    setUnlinkFaultForTest(null);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('continues the sweep after a per-candidate compression failure', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // First (oldest) session: make it eligible but its file will be removed
    // before archival, causing revalidation failure (not a thrown exception,
    // but a graceful skip that the sweep must continue past).
    const oldest = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(40_000),
    });

    // Second session: eligible and will succeed.
    const newer = await createSession(chatsDir, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'B'.repeat(40_000),
    });

    // Inject unlink fault for the oldest only — the archive succeeds but
    // unlink fails.  The sweep must continue to the newer session.
    setUnlinkFaultForTest(async (filePath: string) => {
      if (filePath === oldest.filePath) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      await fs.unlink(filePath);
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // Oldest: archive created, but source not deleted (failed).
    expect(result.archived).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await fileExists(oldest.filePath)).toBe(true);

    // Newer: successfully archived and deleted despite the first failure.
    expect(await fileExists(newer.filePath)).toBe(false);
  });

  it('reports source unlink failure after successful archive and preserves duplicate', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    const { filePath } = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(40_000),
    });

    // Fault: ALL unlinks fail (platform-only fault).
    setUnlinkFaultForTest(async () => {
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // Archive was created (archived >= 1).
    expect(result.archived).toBeGreaterThanOrEqual(1);
    // Unlink failed (failed >= 1).
    expect(result.failed).toBeGreaterThanOrEqual(1);
    // Raw was NOT deleted.
    expect(await fileExists(filePath)).toBe(true);

    // Archive exists — duplicate state preserved for next sweep reconciliation.
    const archives = await listArchives(chatsDir);
    expect(archives.some((f) => f.endsWith('.jsonl.gz'))).toBe(true);

    // The duplicate can be reconciled on the next sweep: clear the fault and
    // run again.
    setUnlinkFaultForTest(null);
    const result2 = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Now the raw is deleted (existing archive is reused, source unlinked).
    expect(await fileExists(filePath)).toBe(false);
    expect(result2.archived).toBeGreaterThanOrEqual(1);
  });

  it('does not allow a single failure to abort the entire sweep', async () => {
    const hash1 = validHash64();
    const hash2 = validHash64();
    const chatsDir1 = path.join(tempDir, hash1, 'chats');
    const chatsDir2 = path.join(tempDir, hash2, 'chats');
    await fs.mkdir(chatsDir1, { recursive: true });
    await fs.mkdir(chatsDir2, { recursive: true });

    const session1 = await createSession(chatsDir1, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(40_000),
      sessionId: 'session-failtarget-' + crypto.randomUUID().slice(0, 8),
    });

    const session2 = await createSession(chatsDir2, {
      ageMs: 3 * 24 * 60 * 60 * 1000,
      content: 'B'.repeat(40_000),
    });

    // Fault on the first session only.
    setUnlinkFaultForTest(async (filePath: string) => {
      if (filePath === session1.filePath) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      await fs.unlink(filePath);
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // Sweep completed (did not throw) and processed both candidates.
    expect(result.archived).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await fileExists(session2.filePath)).toBe(false);
  });

  /**
   * OCR finding 27/28: ENOENT during archive eviction must be treated as
   * successful convergence (the desired end state is reached), counted as
   * archiveDeleted, and NOT counted as a failure.
   */
  it('treats archive ENOENT during eviction as successful convergence', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a real archive old enough to be evicted.
    const archivePath = await makeArchive(
      archiveDir,
      'session-enoent-test.jsonl.gz',
      incompressible(40_000),
      10 * 24 * 60 * 60 * 1000,
    );

    // Inject ENOENT for the archive path — the file vanished between scan
    // and unlink (concurrent process or prior sweep).
    setUnlinkFaultForTest(async (filePath: string) => {
      if (filePath === archivePath) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      await fs.unlink(filePath);
    });

    // maxTotalSizeMB: 0 forces immediate eviction of all archives.
    const config = resolveRetentionConfig({
      maxTotalSizeMB: 0.001,
      minRetention: '1d',
    });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // ENOENT is convergence — archiveDeleted incremented, no failure counted.
    expect(result.archiveDeleted).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });

  /**
   * OCR finding 27/28: platform errors (EPERM/EACCES/EBUSY) during archive
   * eviction must increment the truthful failure counter.
   */
  it('increments failed for EPERM during archive eviction', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(chatsDir, { recursive: true });

    const archivePath = await makeArchive(
      archiveDir,
      'session-eperm-test.jsonl.gz',
      incompressible(40_000),
      10 * 24 * 60 * 60 * 1000,
    );

    setUnlinkFaultForTest(async (filePath: string) => {
      if (filePath === archivePath) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      await fs.unlink(filePath);
    });

    const config = resolveRetentionConfig({
      maxTotalSizeMB: 0.001,
      minRetention: '1d',
    });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    expect(result.failed).toBeGreaterThanOrEqual(1);
    // The archive was NOT deleted (EPERM).
    expect(await fileExists(archivePath)).toBe(true);
  });
});

// ===========================================================================
// Finding 3: No double-counting of reused archive bytes
// ===========================================================================

describe('Finding 3 — reused archive bytes are not double-counted', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not evict reused archives when the actual total is within budget', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    // Create two old sessions with compressible content.
    const sessionA = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(100_000),
    });
    const sessionB = await createSession(chatsDir, {
      ageMs: 4 * 24 * 60 * 60 * 1000,
      content: 'B'.repeat(100_000),
    });

    // Pre-create valid archives for both sessions so compressToArchive reuses
    // them rather than creating fresh archives.
    const archivePathA = path.join(
      archiveDir,
      path.basename(sessionA.filePath) + '.gz',
    );
    const archivePathB = path.join(
      archiveDir,
      path.basename(sessionB.filePath) + '.gz',
    );
    const rawContentA = await fs.readFile(sessionA.filePath);
    const rawContentB = await fs.readFile(sessionB.filePath);
    await fs.writeFile(archivePathA, zlib.gzipSync(rawContentA));
    await fs.writeFile(archivePathB, zlib.gzipSync(rawContentB));
    const oldTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await fs.utimes(archivePathA, oldTime, oldTime);
    await fs.utimes(archivePathB, oldTime, oldTime);

    // Budget tuned between the actual post-archive total (two small archives)
    // and the double-counted total.  If reused archive bytes are added to the
    // running total a second time, the inflated total exceeds the budget and
    // triggers unnecessary archive eviction.
    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.012 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // Both raws should be archived (reusing existing archives) and deleted.
    expect(result.archived).toBeGreaterThanOrEqual(2);
    expect(result.rawDeleted).toBeGreaterThanOrEqual(2);
    expect(await fileExists(sessionA.filePath)).toBe(false);
    expect(await fileExists(sessionB.filePath)).toBe(false);

    // Both reused archives must survive — no double-counting eviction.
    expect(result.archiveDeleted).toBe(0);
    expect(await fileExists(archivePathA)).toBe(true);
    expect(await fileExists(archivePathB)).toBe(true);
  });
});

// ===========================================================================
// Finding 4: Compression platform failures increment failed
// ===========================================================================

describe('Finding 4 — compression platform failures are counted truthfully', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('increments failed when the archive directory is blocked by a file (mkdir error)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create an old eligible session.
    const session = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(40_000),
    });

    // Block the archive directory by creating a regular file at that path.
    // This triggers a mkdir error in compressToArchive — a platform failure.
    await fs.writeFile(path.join(chatsDir, ARCHIVE_DIR_NAME), 'blocker');

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({ globalTempDir: tempDir, config });

    // mkdir is a platform failure — must increment the failed counter.
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.archived).toBe(0);
    expect(await fileExists(session.filePath)).toBe(true);
  });
});
