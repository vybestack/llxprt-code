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
 * Behavioral tests for the global session scanner (AC-5, AC-10).
 *
 * Creates real project-hash directories with real JSONL session files and
 * verifies the scanner discovers them globally. Covers multiple hash dirs,
 * non-hash dirs, symlinks, unknown files, and archive scanning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanGlobalSessions, ARCHIVE_DIR_NAME } from './sessionScanner.js';
import { SessionRecordingService } from '../SessionRecordingService.js';
import type { SessionRecordingServiceConfig } from '../types.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-scan-'));
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

async function createSessionFile(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): Promise<{ filePath: string; sessionId: string }> {
  const config = { ...makeConfig(chatsDir), ...overrides };
  const svc = new SessionRecordingService(config);
  try {
    svc.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'test message' }],
    });
    await svc.flush();
  } finally {
    await svc.dispose();
  }
  const filePath = svc.getFilePath();
  if (!filePath) throw new Error('No file path');
  return { filePath, sessionId: config.sessionId };
}

async function createArchiveFile(
  archiveDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  await fs.mkdir(archiveDir, { recursive: true });
  const filePath = path.join(archiveDir, fileName);
  await fs.writeFile(filePath, content);
  return filePath;
}

describe('scanGlobalSessions — raw session discovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('discovers real SessionRecordingService files', async () => {
    const hash1 = validHash64();
    const chatsDir1 = path.join(tempDir, hash1, 'chats');
    await fs.mkdir(chatsDir1, { recursive: true });
    const { filePath, sessionId } = await createSessionFile(chatsDir1);

    const { candidates, chatsDirs } = await scanGlobalSessions(tempDir);

    expect(candidates.length).toBe(1);
    expect(candidates[0].filePath).toBe(filePath);
    expect(candidates[0].sessionId).toBe(sessionId);
    expect(candidates[0].kind).toBe('raw');
    expect(chatsDirs).toContain(chatsDir1);
  });

  it('scans multiple 64-hex project dirs globally (AC-5)', async () => {
    const hash1 = validHash64();
    const hash2 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    const chats2 = path.join(tempDir, hash2, 'chats');
    await fs.mkdir(chats1, { recursive: true });
    await fs.mkdir(chats2, { recursive: true });

    await createSessionFile(chats1);
    await createSessionFile(chats2);

    const { candidates } = await scanGlobalSessions(tempDir);
    expect(candidates.filter((c) => c.kind === 'raw').length).toBe(2);
  });

  it('ignores non-64-hex top-level directories', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    await fs.mkdir(chats1, { recursive: true });
    await createSessionFile(chats1);

    // Non-hash dir.
    await fs.mkdir(path.join(tempDir, 'not-a-hash', 'chats'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tempDir, 'not-a-hash', 'chats', 'session-fake.jsonl'),
      JSON.stringify({ type: 'session_start', payload: { sessionId: 'x' } }) +
        '\n',
    );

    const { candidates } = await scanGlobalSessions(tempDir);
    expect(candidates.length).toBe(1); // Only the real one in hash1.
  });

  it('ignores uppercase hex dirs', async () => {
    const upperHash = 'A'.repeat(64);
    await fs.mkdir(path.join(tempDir, upperHash, 'chats'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, upperHash, 'chats', 'session-fake.jsonl'),
      'data\n',
    );

    const { candidates } = await scanGlobalSessions(tempDir);
    expect(candidates.length).toBe(0);
  });

  it('ignores non-jsonl files in chats dir', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    await fs.mkdir(chats1, { recursive: true });
    await createSessionFile(chats1);

    // Unknown files should not be discovered.
    await fs.writeFile(path.join(chats1, 'logs.json'), '{}');
    await fs.writeFile(path.join(chats1, 'shell_history'), 'history');
    await fs.writeFile(path.join(chats1, 'token-usage.json'), '{}');
    await fs.mkdir(path.join(chats1, 'checkpoints'), { recursive: true });

    const { candidates } = await scanGlobalSessions(tempDir);
    expect(candidates.length).toBe(1); // Only the real session.
  });

  it('marks the current session correctly', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    await fs.mkdir(chats1, { recursive: true });
    const { sessionId } = await createSessionFile(chats1);

    const { candidates } = await scanGlobalSessions(tempDir, sessionId);
    expect(candidates[0].isCurrentSession).toBe(true);
  });

  it('does not mark non-matching sessions as current', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    await fs.mkdir(chats1, { recursive: true });
    await createSessionFile(chats1);

    const { candidates } = await scanGlobalSessions(
      tempDir,
      'different-session-id',
    );
    expect(candidates[0].isCurrentSession).toBe(false);
  });

  it('isCurrentSession is false when both parsed and current IDs are absent', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    await fs.mkdir(chats1, { recursive: true });

    // Create a session file whose header has NO sessionId (malformed but
    // parseable JSON) so the scanner reports sessionId=null.
    await fs.writeFile(
      path.join(chats1, 'session-noid.jsonl'),
      JSON.stringify({ type: 'session_start', payload: {} }) + '\n',
    );

    // Scan without a currentSessionId — both sides are absent.
    const { candidates } = await scanGlobalSessions(tempDir);
    expect(candidates.length).toBe(1);
    expect(candidates[0].sessionId).toBeNull();
    expect(candidates[0].isCurrentSession).toBe(false);
  });
});

describe('scanGlobalSessions — archive discovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('discovers gzip archives under chats/archive/ (AC-4)', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    const archiveDir = path.join(chats1, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });
    await createArchiveFile(
      archiveDir,
      'session-2026-01-01T00-00-00-abc123.jsonl.gz',
      'compressed-data',
    );

    const { candidates } = await scanGlobalSessions(tempDir);
    const archives = candidates.filter((c) => c.kind === 'archive');
    expect(archives.length).toBe(1);
    expect(archives[0].fileName).toBe(
      'session-2026-01-01T00-00-00-abc123.jsonl.gz',
    );
  });

  it('counts both raw and archive sizes toward the global budget', async () => {
    const hash1 = validHash64();
    const chats1 = path.join(tempDir, hash1, 'chats');
    const archiveDir = path.join(chats1, ARCHIVE_DIR_NAME);
    await fs.mkdir(chats1, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });

    await createSessionFile(chats1);
    await createArchiveFile(
      archiveDir,
      'session-2026-01-01T00-00-00-old.jsonl.gz',
      'archive-content',
    );

    const { candidates } = await scanGlobalSessions(tempDir);
    const raws = candidates.filter((c) => c.kind === 'raw');
    const archives = candidates.filter((c) => c.kind === 'archive');
    expect(raws.length).toBe(1);
    expect(archives.length).toBe(1);

    const totalBytes = candidates.reduce((sum, c) => sum + c.sizeBytes, 0);
    expect(totalBytes).toBeGreaterThan(0);
  });
});

describe('scanGlobalSessions — symlink safety (AC-10)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'does not follow symlinks to project-hash dirs',
    async () => {
      const hash1 = validHash64();
      const realChats = path.join(tempDir, hash1, 'chats');
      await fs.mkdir(realChats, { recursive: true });
      await createSessionFile(realChats);

      // Create a symlink that looks like a hash dir pointing outside.
      const symlinkHash = validHash64();
      const symlinkPath = path.join(tempDir, symlinkHash);
      await fs.symlink(tempDir, symlinkPath, 'dir');

      const { candidates } = await scanGlobalSessions(tempDir);
      // Should find sessions but not double-count through the symlink.
      const raws = candidates.filter((c) => c.kind === 'raw');
      expect(raws.length).toBe(1);
    },
  );
  it.skipIf(process.platform === 'win32')(
    'does not follow a symlinked chats directory (AC-10)',
    async () => {
      const hash = validHash64();
      const hashDir = path.join(tempDir, hash);
      await fs.mkdir(hashDir, { recursive: true });

      // A real chats dir with a session elsewhere.
      const realChats = path.join(tempDir, 'real-chats');
      await fs.mkdir(realChats, { recursive: true });
      await createSessionFile(realChats);

      // Replace chats with a symlink to the outside dir.
      await fs.symlink(realChats, path.join(hashDir, 'chats'), 'dir');

      const { candidates } = await scanGlobalSessions(tempDir);
      // The symlinked chats dir must not be traversed.
      expect(candidates.length).toBe(0);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not follow a symlinked archive directory (AC-10)',
    async () => {
      const hash = validHash64();
      const chatsDir = path.join(tempDir, hash, 'chats');
      await fs.mkdir(chatsDir, { recursive: true });

      // A real archive dir outside the tree with a fake archive file.
      const outsideArchive = path.join(tempDir, 'outside-archive');
      await fs.mkdir(outsideArchive, { recursive: true });
      await fs.writeFile(
        path.join(outsideArchive, 'session-fake.jsonl.gz'),
        'data',
      );

      // Symlink archive -> outside.
      await fs.symlink(outsideArchive, path.join(chatsDir, 'archive'), 'dir');

      const { candidates } = await scanGlobalSessions(tempDir);
      // The symlinked archive must not be traversed.
      const archives = candidates.filter((c) => c.kind === 'archive');
      expect(archives.length).toBe(0);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not follow a symlinked archive file (AC-10)',
    async () => {
      const hash = validHash64();
      const chatsDir = path.join(tempDir, hash, 'chats');
      const archiveDir = path.join(chatsDir, 'archive');
      await fs.mkdir(archiveDir, { recursive: true });

      // A target file outside.
      const target = path.join(tempDir, 'secret.txt');
      await fs.writeFile(target, 'secret');

      // Symlink a fake archive file to the outside target.
      await fs.symlink(target, path.join(archiveDir, 'session-fake.jsonl.gz'));

      const { candidates } = await scanGlobalSessions(tempDir);
      const archives = candidates.filter((c) => c.kind === 'archive');
      expect(archives.length).toBe(0);
    },
  );

  /**
   * OCR finding 38: when the archive entry is a regular file (not a
   * directory), the scanner must skip it without crashing (ENOTDIR).
   */
  it('skips an archive path that is a regular file, not a directory (OCR 38)', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a regular FILE named "archive" instead of a directory.
    await fs.writeFile(path.join(chatsDir, ARCHIVE_DIR_NAME), 'not-a-dir');

    const { candidates, scanErrorCount } = await scanGlobalSessions(tempDir);
    // No crash, no archives discovered.
    const archives = candidates.filter((c) => c.kind === 'archive');
    expect(archives.length).toBe(0);
    expect(scanErrorCount).toBe(0);
  });

  /**
   * OCR finding 39: non-ENOENT errors during archive directory scanning
   * (e.g. EACCES) must be counted in scanErrorCount, not silently treated
   * as "directory doesn't exist".
   */
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'counts non-ENOENT archive readdir errors in scanErrorCount (OCR 39)',
    async () => {
      const hash = validHash64();
      const chatsDir = path.join(tempDir, hash, 'chats');
      const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.writeFile(
        path.join(archiveDir, 'session-real.jsonl.gz'),
        'data',
      );

      // Remove read+execute permission on the archive dir so readdir fails
      // with EACCES (we are not root).
      await fs.chmod(archiveDir, 0o000);

      try {
        const { scanErrorCount } = await scanGlobalSessions(tempDir);
        expect(scanErrorCount).toBeGreaterThanOrEqual(1);
      } finally {
        await fs.chmod(archiveDir, 0o755);
      }
    },
  );

  /**
   * OCR finding 39: ENOENT races remain benign (not counted as errors).
   */
  it('does not count ENOENT archive races as scan errors', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
    // No archive directory exists — ENOENT is benign.

    const { scanErrorCount } = await scanGlobalSessions(tempDir);
    expect(scanErrorCount).toBe(0);
  });
});
