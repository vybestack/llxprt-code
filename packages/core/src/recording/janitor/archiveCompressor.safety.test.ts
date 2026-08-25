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
 * Adversarial safety tests for archive compressor (Items 1, 6, 8).
 *
 * Tests prove:
 * - A symlinked archive directory is rejected.
 * - A symlinked source file is rejected.
 * - Stale temp cleanup matches ONLY the exact janitor-generated grammar.
 * - Temp cleanup uses lstat (rejects symlink temp files).
 * - Temp cleanup does not remove non-matching files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compressToArchive,
  cleanupStaleTempArchives,
} from './archiveCompressor.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'archive-safety-'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('compressToArchive — symlink safety (Item 1)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked archive directory',
    async () => {
      const chatsDir = path.join(tempDir, 'chats');
      const archiveDir = path.join(chatsDir, 'archive');
      await fs.mkdir(chatsDir, { recursive: true });

      // Create an outside directory and symlink archive → it.
      const outsideDir = path.join(tempDir, 'outside');
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.symlink(outsideDir, archiveDir, 'dir');

      const sourcePath = path.join(chatsDir, 'session-test.jsonl');
      await fs.writeFile(sourcePath, '{"type":"session_start","payload":{}}\n');

      const result = await compressToArchive(sourcePath, archiveDir);
      expect(result.success).toBe(false);
      expect(result.archivePath).toBeNull();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked source file',
    async () => {
      const chatsDir = path.join(tempDir, 'chats');
      const archiveDir = path.join(chatsDir, 'archive');
      await fs.mkdir(chatsDir, { recursive: true });

      // Create a real target file and symlink the source to it.
      const targetPath = path.join(tempDir, 'real-target.jsonl');
      await fs.writeFile(targetPath, '{"type":"session_start","payload":{}}\n');
      const sourcePath = path.join(chatsDir, 'session-symlinked.jsonl');
      await fs.symlink(targetPath, sourcePath);

      const result = await compressToArchive(sourcePath, archiveDir);
      expect(result.success).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects existing-archive reuse through a symlinked archive directory',
    async () => {
      const realArchiveDir = path.join(tempDir, 'real-archive');
      await fs.mkdir(realArchiveDir, { recursive: true });

      // Create a valid source and archive it into the real directory first.
      const sourcePath = path.join(tempDir, 'session-reuse-symlink.jsonl');
      const content = '{"type":"session_start","payload":{}}\n'.repeat(50);
      await fs.writeFile(sourcePath, content);
      const result1 = await compressToArchive(sourcePath, realArchiveDir);
      expect(result1.success).toBe(true);

      // Symlink a new archiveDir name to the real directory.
      const symlinkArchiveDir = path.join(tempDir, 'symlink-archive');
      await fs.symlink(realArchiveDir, symlinkArchiveDir, 'dir');

      // The final archive path resolves through the symlink to the real
      // existing archive.  The archiveDir identity check must reject the
      // symlink BEFORE attempting reuse so the real directory is never
      // mutated through the symlink.
      const result2 = await compressToArchive(sourcePath, symlinkArchiveDir);
      expect(result2.success).toBe(false);
    },
  );
});

describe('cleanupStaleTempArchives — exact grammar (Item 8)', () => {
  let tempDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    archiveDir = path.join(tempDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('removes only files matching the exact janitor temp grammar', async () => {
    const oldTime = new Date(Date.now() - 120 * 1000);

    // Valid janitor temp file (old enough).
    const validTemp = path.join(
      archiveDir,
      'session-2026-01-01T00-00-00-abc.jsonl.550e8400-e29b-41d4-a716-446655440000.gz.tmp',
    );
    await fs.writeFile(validTemp, 'temp');
    await fs.utimes(validTemp, oldTime, oldTime);

    // Non-matching: wrong suffix.
    const wrongSuffix = path.join(archiveDir, 'session-data.bak');
    await fs.writeFile(wrongSuffix, 'bak');
    await fs.utimes(wrongSuffix, oldTime, oldTime);

    // Non-matching: not a session file.
    const notSession = path.join(archiveDir, 'random.gz.tmp');
    await fs.writeFile(notSession, 'random');
    await fs.utimes(notSession, oldTime, oldTime);

    // Non-matching: normal archive file.
    const realArchive = path.join(
      archiveDir,
      'session-2026-01-01T00-00-00-xyz.jsonl.gz',
    );
    await fs.writeFile(realArchive, 'archive');
    await fs.utimes(realArchive, oldTime, oldTime);

    const removed = await cleanupStaleTempArchives(archiveDir, 60 * 1000);

    expect(removed).toBe(1);
    expect(await fileExists(validTemp)).toBe(false);
    expect(await fileExists(wrongSuffix)).toBe(true);
    expect(await fileExists(notSession)).toBe(true);
    expect(await fileExists(realArchive)).toBe(true);
  });

  it('does not remove temp files younger than the age threshold', async () => {
    const youngTemp = path.join(
      archiveDir,
      'session-2026-01-01T00-00-00-abc.jsonl.550e8400-e29b-41d4-a716-446655440000.gz.tmp',
    );
    await fs.writeFile(youngTemp, 'fresh temp');

    const removed = await cleanupStaleTempArchives(archiveDir, 60 * 1000);
    expect(removed).toBe(0);
    expect(await fileExists(youngTemp)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'uses lstat — does not follow symlinked temp files',
    async () => {
      // Create a target file outside the archive dir.
      const target = path.join(tempDir, 'target.txt');
      await fs.writeFile(target, 'target');

      // Symlink that looks like a valid temp file.
      const symlinkTemp = path.join(
        archiveDir,
        'session-2026-01-01T00-00-00-abc.jsonl.550e8400-e29b-41d4-a716-446655440000.gz.tmp',
      );
      await fs.symlink(target, symlinkTemp);

      // Make it old.
      const oldTime = new Date(Date.now() - 120 * 1000);
      await fs.utimes(symlinkTemp, oldTime, oldTime).catch(() => {});

      const removed = await cleanupStaleTempArchives(archiveDir, 60 * 1000);

      // Symlink temp should NOT be removed (lstat rejects it).
      expect(removed).toBe(0);
      expect(await fileExists(target)).toBe(true);
    },
  );
});

describe('compressToArchive — fsync directory durability (Item 6)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // A successful compress-and-rename must report durableCommit on every
  // platform. This assertion used to read
  // `process.platform === 'win32' || result.durableCommit`, which tolerated
  // false on Windows and so encoded the bug that made the janitor archive
  // files without ever reclaiming them: reclamationEngine refuses to unlink a
  // source whose archive is not durably committed, so raws accumulated
  // forever. Windows cannot fsync a directory handle, but the archive file is
  // fsynced before the rename, which is the durability the platform offers.
  it('reports durableCommit=true after a successful rename on every platform', async () => {
    const chatsDir = path.join(tempDir, 'chats');
    const archiveDir = path.join(chatsDir, 'archive');
    await fs.mkdir(chatsDir, { recursive: true });

    const sourcePath = path.join(chatsDir, 'session-test.jsonl');
    const sourceContent = '{"type":"session_start","payload":{}}\n'.repeat(100);
    await fs.writeFile(sourcePath, sourceContent);

    const result = await compressToArchive(sourcePath, archiveDir);
    expect(result.success).toBe(true);
    expect(result.archivePath).not.toBeNull();
    expect(result.durableCommit).toBe(true);
  });
});
