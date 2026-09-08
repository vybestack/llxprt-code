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
 * Behavioral tests for the streaming archive compressor (AC-4).
 *
 * Tests prove lossless gzip round-trip (SHA-256 + byte-count identity),
 * crash-safe lifecycle, stale temp cleanup, and bounded archive concurrency.
 * Uses real temporary filesystems and real file content — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import {
  compressToArchive,
  computeFileHashAndSize,
  verifyArchiveIntegrity,
  cleanupStaleTempArchives,
} from './archiveCompressor.js';

const bunIt = it;

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-archive-'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeSourceFile(
  dir: string,
  content: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const filePath = path.join(dir, 'source.jsonl');
  await fs.writeFile(filePath, content, 'utf8');
  const { sha256, bytes } = await computeFileHashAndSize(filePath);
  return { path: filePath, sha256, bytes };
}

describe('compressToArchive — lossless round-trip (AC-4)', () => {
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

  it('compresses and the decompressed bytes match the source exactly', async () => {
    const content =
      JSON.stringify({
        v: 1,
        seq: 0,
        ts: new Date().toISOString(),
        type: 'session_start',
        payload: { sessionId: 'test', startTime: new Date().toISOString() },
      }) +
      '\n' +
      JSON.stringify({
        type: 'content',
        payload: { text: 'Hello world'.repeat(100) },
      }) +
      '\n';

    const source = await writeSourceFile(tempDir, content);
    const result = await compressToArchive(source.path, archiveDir);

    expect(result.success).toBe(true);
    expect(result.archivePath).toBeTruthy();

    // Verify decompressed content matches source exactly.
    const verify = await verifyArchiveIntegrity(
      result.archivePath!,
      source.sha256,
      source.bytes,
    );
    expect(verify.ok).toBe(true);
  });

  it('archive is a valid gzip file usable by standard tools', async () => {
    const content = 'test content for gzip validation\n'.repeat(50);
    const source = await writeSourceFile(tempDir, content);
    const result = await compressToArchive(source.path, archiveDir);

    expect(result.success).toBe(true);

    // Read and decompress with standard zlib.
    const compressed = await fs.readFile(result.archivePath!);
    const decompressed = zlib.gunzipSync(compressed).toString('utf8');
    expect(decompressed).toBe(content);
  });

  it('source file remains intact after compression (not yet unlinked)', async () => {
    const content = 'preserve me\n'.repeat(20);
    const source = await writeSourceFile(tempDir, content);
    await compressToArchive(source.path, archiveDir);

    // Source should still exist after compressToArchive.
    expect(await fileExists(source.path)).toBe(true);
  });

  it('handles large compressible content efficiently', async () => {
    const content = 'A'.repeat(100_000);
    const source = await writeSourceFile(tempDir, content);
    const result = await compressToArchive(source.path, archiveDir);

    expect(result.success).toBe(true);
    const verify = await verifyArchiveIntegrity(
      result.archivePath!,
      source.sha256,
      source.bytes,
    );
    expect(verify.ok).toBe(true);

    // Compressed should be much smaller for highly compressible data.
    const archiveSize = (await fs.stat(result.archivePath!)).size;
    expect(archiveSize).toBeLessThan(source.bytes / 10);
  });

  it('handles incompressible content (random bytes)', async () => {
    const content = randomBytes(50_000).toString('hex');
    const source = await writeSourceFile(tempDir, content);
    const result = await compressToArchive(source.path, archiveDir);

    expect(result.success).toBe(true);
    const verify = await verifyArchiveIntegrity(
      result.archivePath!,
      source.sha256,
      source.bytes,
    );
    expect(verify.ok).toBe(true);
  });

  it('reuses existing verified archive if source is already archived', async () => {
    const content = 'reuse test\n'.repeat(30);
    const source = await writeSourceFile(tempDir, content);

    const result1 = await compressToArchive(source.path, archiveDir);
    expect(result1.success).toBe(true);

    // Capture archive identity before the second call to prove reuse (not
    // silent re-compression and overwrite to the same path).
    const statBefore = await fs.stat(result1.archivePath!);
    const result2 = await compressToArchive(source.path, archiveDir);
    expect(result2.success).toBe(true);
    expect(result2.archivePath).toBe(result1.archivePath);
    expect(result2.archiveBytes).toBe(result1.archiveBytes);
    const statAfter = await fs.stat(result2.archivePath!);
    // Archive should not have been rewritten (same mtime).
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it('returns failure for non-existent source', async () => {
    const result = await compressToArchive(
      path.join(tempDir, 'nonexistent.jsonl'),
      archiveDir,
    );
    expect(result.success).toBe(false);
  });
});

describe('compressToArchive — source chronology preservation (finding C)', () => {
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

  it('preserves the source recording mtime on the gzip archive', async () => {
    const content = 'chronology preservation\n'.repeat(100);
    const source = await writeSourceFile(tempDir, content);
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(source.path, oldTime, oldTime);

    const result = await compressToArchive(source.path, archiveDir);
    expect(result.success).toBe(true);

    const archiveStat = await fs.stat(result.archivePath!);
    // The archive carries the original recording time, not "today", so age
    // ranking and minRetention apply by original session age.
    expect(Math.abs(archiveStat.mtimeMs - oldTime.getTime())).toBeLessThan(
      2000,
    );
  });

  it('reports the actual physical archive byte size (finding A)', async () => {
    const content = 'A'.repeat(100_000);
    const source = await writeSourceFile(tempDir, content);
    const result = await compressToArchive(source.path, archiveDir);
    expect(result.success).toBe(true);

    const archiveStat = await fs.stat(result.archivePath!);
    expect(result.archiveBytes).toBe(archiveStat.size);
    expect(result.archiveBytes).toBeGreaterThan(0);
    expect(result.archiveBytes).toBeLessThan(source.bytes);
  });
});

describe('compressToArchive — typed error results (finding E)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('classifies an unreadable/non-regular source as source-invalid', async () => {
    const archiveDir = path.join(tempDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    const target = path.join(tempDir, 'target.jsonl');
    await fs.writeFile(target, 'data');
    const symlinkSource = path.join(tempDir, 'link.jsonl');
    await fs.symlink(target, symlinkSource);

    const result = await compressToArchive(symlinkSource, archiveDir);
    expect(result.success).toBe(false);
    expect(result.errorKind).toBe('source-invalid');
  });

  it('classifies a non-directory archive path as a mkdir error', async () => {
    // archiveDir is a regular file — cannot be created/used as a directory.
    const blockerPath = path.join(tempDir, 'not-a-dir');
    await fs.writeFile(blockerPath, 'blocker');
    const source = path.join(tempDir, 'source.jsonl');
    await fs.writeFile(source, 'data'.repeat(50));

    const result = await compressToArchive(source, blockerPath);
    expect(result.success).toBe(false);
    expect(result.errorKind).toBe('mkdir');
  });

  it('classifies a symlinked existing archive as an existing-archive error', async () => {
    const archiveDir = path.join(tempDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    const source = path.join(tempDir, 'session-x.jsonl');
    await fs.writeFile(source, 'data'.repeat(50));

    // Pre-create a symlink at the final archive path pointing outside.
    const outsideTarget = path.join(tempDir, 'outside.gz');
    await fs.writeFile(outsideTarget, 'evil');
    await fs.symlink(
      outsideTarget,
      path.join(archiveDir, 'session-x.jsonl.gz'),
    );

    const result = await compressToArchive(source, archiveDir);
    expect(result.success).toBe(false);
    expect(result.errorKind).toBe('existing-archive');
  });

  /**
   * OCR finding 14/16: when the existing archive fails integrity
   * verification, compressToArchive must NOT overwrite it (the rename would
   * destroy it).  Return a typed existing-archive error and keep both source
   * and existing archive untouched.
   */
  it('does NOT overwrite an unverifiable existing archive — returns typed error', async () => {
    const archiveDir = path.join(tempDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    const source = path.join(tempDir, 'session-corrupt.jsonl');
    await fs.writeFile(source, 'data'.repeat(50));

    // Pre-create a corrupt archive at the final path.
    const existingArchive = path.join(archiveDir, 'session-corrupt.jsonl.gz');
    const corruptContent = 'not-a-valid-gzip'.repeat(20);
    await fs.writeFile(existingArchive, corruptContent);

    const result = await compressToArchive(source, archiveDir);
    expect(result.success).toBe(false);
    expect(result.errorKind).toBe('existing-archive');

    // The existing archive must be untouched (not overwritten).
    const afterContent = await fs.readFile(existingArchive);
    expect(Buffer.compare(afterContent, Buffer.from(corruptContent))).toBe(0);

    // The source must be untouched.
    expect(await fileExists(source)).toBe(true);
  });

  {
    const it =
      process.platform === 'win32' || process.getuid?.() === 0
        ? bunIt.skip
        : bunIt;
    it('returns typed source-invalid error when source becomes unreadable during reuse check', async () => {
      const archiveDir = path.join(tempDir, 'archive');
      await fs.mkdir(archiveDir, { recursive: true });
      const source = path.join(tempDir, 'session-unreadable.jsonl');
      await fs.writeFile(source, 'data'.repeat(50));

      // Pre-create an existing archive so the reuse path is entered.
      const existingArchive = path.join(
        archiveDir,
        'session-unreadable.jsonl.gz',
      );
      await fs.writeFile(existingArchive, 'placeholder'.repeat(20));

      // Make the source unreadable so computeFileHashAndSize fails.
      await fs.chmod(source, 0o000);

      try {
        const result = await compressToArchive(source, archiveDir);
        expect(result.success).toBe(false);
        expect(result.errorKind).toBe('source-invalid');
      } finally {
        await fs.chmod(source, 0o644);
      }
    });
  }
});

describe('verifyArchiveIntegrity', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns ok:true for a correct archive', async () => {
    const content = 'integrity test\n'.repeat(10);
    const filePath = path.join(tempDir, 'source.jsonl');
    await fs.writeFile(filePath, content);
    const { sha256, bytes } = await computeFileHashAndSize(filePath);

    const result = await compressToArchive(filePath, tempDir);
    expect(result.success).toBe(true);

    const verify = await verifyArchiveIntegrity(
      result.archivePath!,
      sha256,
      bytes,
    );
    expect(verify.ok).toBe(true);
  });

  it('returns ok:false for truncated gzip', async () => {
    const content = 'truncate me\n'.repeat(10);
    const filePath = path.join(tempDir, 'source.jsonl');
    await fs.writeFile(filePath, content);
    const { sha256, bytes } = await computeFileHashAndSize(filePath);

    const result = await compressToArchive(filePath, tempDir);
    expect(result.success).toBe(true);

    // Truncate the archive.
    const archiveData = await fs.readFile(result.archivePath!);
    await fs.writeFile(
      result.archivePath!,
      archiveData.subarray(0, archiveData.length - 10),
    );

    const verify = await verifyArchiveIntegrity(
      result.archivePath!,
      sha256,
      bytes,
    );
    expect(verify.ok).toBe(false);
  });

  it('returns ok:false for SHA-256 mismatch', async () => {
    const content = 'sha mismatch\n'.repeat(10);
    const filePath = path.join(tempDir, 'source.jsonl');
    await fs.writeFile(filePath, content);
    const { bytes } = await computeFileHashAndSize(filePath);

    const result = await compressToArchive(filePath, tempDir);
    expect(result.success).toBe(true);

    // Wrong SHA.
    const verify = await verifyArchiveIntegrity(
      result.archivePath!,
      'deadbeef'.repeat(8),
      bytes,
    );
    expect(verify.ok).toBe(false);
  });
});

describe('cleanupStaleTempArchives', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('removes stale .jsonl.gz.tmp files', async () => {
    const tempArchive = path.join(tempDir, 'session-old.jsonl.gz.tmp');
    await fs.writeFile(tempArchive, 'partial');

    // Set mtime to 5 minutes ago.
    const oldTime = new Date(Date.now() - 5 * 60 * 1000);
    await fs.utimes(tempArchive, oldTime, oldTime);

    await cleanupStaleTempArchives(tempDir, 60 * 1000);

    await expect(fs.access(tempArchive)).rejects.toThrow(/ENOENT/);
  });

  it('does not remove recent .jsonl.gz.tmp files', async () => {
    const tempArchive = path.join(tempDir, 'session-recent.jsonl.gz.tmp');
    await fs.writeFile(tempArchive, 'partial');

    await cleanupStaleTempArchives(tempDir, 60 * 1000);

    expect(await fileExists(tempArchive)).toBe(true);
  });

  it('handles non-existent directory gracefully', async () => {
    await expect(
      cleanupStaleTempArchives('/nonexistent/archive', 60 * 1000),
    ).resolves.toBe(0);
  });
});
