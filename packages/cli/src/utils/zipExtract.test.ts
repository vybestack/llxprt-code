/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createWriteStream } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import archiver from 'archiver';
import { extractZipSafe, type ZipExtractOptions } from './zipExtract.js';

interface ArchiveEntry {
  name: string;
  content?: string;
  symlink?: string;
}

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-extract-test-'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

async function buildArchive(entries: ArchiveEntry[]): Promise<string> {
  const archivePath = path.join(workspace, 'archive.zip');
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const entry of entries) {
      if (entry.symlink !== undefined) {
        archive.symlink(entry.symlink, entry.name);
      } else {
        archive.append(entry.content ?? '', { name: entry.name });
      }
    }
    void archive.finalize();
  });
  return archivePath;
}

interface BuiltEntry {
  name: string;
  content?: string;
  mode?: number;
  /** Store the payload deflated (method 8); default is stored (method 0). */
  deflated?: boolean;
  /** Declared uncompressed size; defaults to the content byte length. */
  declaredSize?: number;
  /** Emit as a directory entry (name ends with '/'). */
  directory?: boolean;
}

function crc32(data: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function buildZip(entries: BuiltEntry[]): Uint8Array {
  const fileBytes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const spec of entries) {
    const nameBuffer = Buffer.from(spec.name, 'utf8');
    const raw = Buffer.from(spec.content ?? '', 'utf8');
    const payload = spec.deflated === true ? deflateRawSync(raw) : raw;
    const declared = spec.declaredSize ?? raw.length;
    const method = spec.deflated === true ? 8 : 0;
    const checksum = crc32(raw);
    const mode = spec.mode;
    let unixMode: number;
    if (spec.directory === true) {
      unixMode = mode ?? 0o40755;
    } else {
      unixMode = mode ?? 0o100644;
    }
    const externalAttributes =
      ((unixMode & 0xffff) * 0x10000 + (unixMode & 0xff)) >>> 0;

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    fileBytes.push(local, payload);

    const descriptor = Buffer.alloc(46 + nameBuffer.length);
    descriptor.writeUInt32LE(0x02014b50, 0);
    descriptor.writeUInt16LE(0x031e, 4);
    descriptor.writeUInt16LE(20, 6);
    descriptor.writeUInt16LE(0, 8);
    descriptor.writeUInt16LE(method, 10);
    descriptor.writeUInt16LE(0, 12);
    descriptor.writeUInt32LE(checksum, 16);
    descriptor.writeUInt32LE(payload.length, 20);
    descriptor.writeUInt32LE(declared, 24);
    descriptor.writeUInt16LE(nameBuffer.length, 28);
    descriptor.writeUInt32LE(0, 30);
    descriptor.writeUInt32LE(0, 34);
    descriptor.writeUInt32LE(externalAttributes, 38);
    descriptor.writeUInt32LE(offset, 42);
    nameBuffer.copy(descriptor, 46);
    central.push(descriptor);
    offset += local.length + payload.length;
  }

  const centralBuffer = Buffer.concat([...central]);
  const endOfDirectory = Buffer.alloc(22);
  endOfDirectory.writeUInt32LE(0x06054b50, 0);
  endOfDirectory.writeUInt16LE(central.length, 8);
  endOfDirectory.writeUInt16LE(central.length, 10);
  endOfDirectory.writeUInt32LE(centralBuffer.length, 12);
  endOfDirectory.writeUInt32LE(offset, 16);
  return Buffer.concat([...fileBytes, centralBuffer, endOfDirectory]);
}

async function writeZip(name: string, entries: BuiltEntry[]): Promise<string> {
  const archivePath = path.join(workspace, name);
  await fs.writeFile(archivePath, buildZip(entries));
  return archivePath;
}

interface Errno {
  readonly code?: string;
}

function isErrno(error: unknown): error is Errno {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isAggregateError(error: unknown): error is AggregateError {
  return error instanceof AggregateError;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function noStagingDirsRemain(destDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(destDir);
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') return;
    throw error;
  }
  const leftovers = entries.filter((name) =>
    name.startsWith('.llxprt-zip-stage-'),
  );
  expect(leftovers).toEqual([]);
}

const posixIt = process.platform === 'win32' ? it.skip : it;

describe('extractZipSafe', () => {
  it('extracts files and nested directories', async () => {
    const archive = await buildArchive([
      { name: 'root.txt', content: 'hello' },
      { name: 'nested/deep/file.txt', content: 'deep' },
    ]);
    const dest = path.join(workspace, 'out');

    const result = await extractZipSafe(archive, dest);

    expect(await fs.readFile(path.join(dest, 'root.txt'), 'utf8')).toBe(
      'hello',
    );
    expect(
      await fs.readFile(path.join(dest, 'nested/deep/file.txt'), 'utf8'),
    ).toBe('deep');
    expect(result.files).toHaveLength(2);
  });

  it('rejects a parent traversal entry and leaves the destination untouched', async () => {
    const archivePath = await writeZip('traversal.zip', [
      { name: 'a/../escape.txt', content: 'bad' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /traversal|invalid relative path|resolves outside/,
    );

    expect(await exists(path.join(workspace, 'escape.txt'))).toBe(false);
  });

  it('rejects a POSIX absolute entry from a real archive', async () => {
    const archivePath = await writeZip('abs.zip', [
      { name: '/escape.txt', content: 'bad' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /absolute path|resolves outside/,
    );
  });

  it('rejects a Windows drive-qualified entry from a real archive', async () => {
    const archivePath = await writeZip('drive.zip', [
      { name: 'C:\\escape.txt', content: 'bad' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /absolute path|invalid/,
    );
  });

  it('rejects a backslash traversal entry from a real archive', async () => {
    const archivePath = await writeZip('back.zip', [
      { name: '..\\escape.txt', content: 'bad' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /absolute path|invalid/,
    );

    expect(await exists(path.join(workspace, 'escape.txt'))).toBe(false);
  });

  it('accepts a contained name that merely starts with two dots', async () => {
    const archivePath = await writeZip('dots.zip', [
      { name: '..valid/file.txt', content: 'dotdot' },
    ]);
    const dest = path.join(workspace, 'out');

    const result = await extractZipSafe(archivePath, dest);

    expect(
      await fs.readFile(path.join(dest, '..valid', 'file.txt'), 'utf8'),
    ).toBe('dotdot');
    expect(result.files).toEqual([
      path.join(path.resolve(dest), '..valid', 'file.txt'),
    ]);
  });

  it('rejects a symlink entry from a real archive', async () => {
    const archive = await buildArchive([
      { name: 'link', symlink: '/etc/passwd' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archive, dest)).rejects.toThrow(
      /symlink entries are not supported/,
    );
  });

  it('removes partial output and preserves a preexisting destination sentinel on failure', async () => {
    const archive = await buildArchive([
      { name: 'good.txt', content: 'ok' },
      { name: 'a/../escape.txt', content: 'bad' },
    ]);
    const dest = path.join(workspace, 'out');
    await fs.mkdir(dest);
    await fs.writeFile(path.join(dest, 'sentinel.txt'), 'keep');

    await expect(extractZipSafe(archive, dest)).rejects.toThrow(
      /traversal|invalid relative path|resolves outside/,
    );

    expect(await fs.readFile(path.join(dest, 'sentinel.txt'), 'utf8')).toBe(
      'keep',
    );
    expect(await exists(path.join(dest, 'good.txt'))).toBe(false);
    expect(await exists(path.join(workspace, 'escape.txt'))).toBe(false);
    await noStagingDirsRemain(dest);
  });

  it('removes a destination it created when nothing is published', async () => {
    const dest = path.join(workspace, 'created-out');
    const archivePath = await writeZip('created-out.zip', [
      { name: 'a/../escape.txt', content: 'bad' },
    ]);

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /traversal|invalid relative path|resolves outside/,
    );

    expect(await exists(path.join(workspace, 'created-out'))).toBe(false);
  });

  it('does not let a preexisting symlink directory inside the destination redirect writes', async () => {
    const archive = await buildArchive([
      { name: 'evil/linked.txt', content: 'archive' },
    ]);
    const symlinkRoot = path.join(workspace, 'redirect-target');
    await fs.mkdir(symlinkRoot);
    await fs.writeFile(path.join(symlinkRoot, 'escape.txt'), 'redirected');
    const dest = path.join(workspace, 'out');
    await fs.mkdir(dest);
    await fs.symlink(symlinkRoot, path.join(dest, 'evil'));

    await expect(extractZipSafe(archive, dest)).rejects.toThrow(
      /already contains: evil/,
    );

    expect(await exists(path.join(symlinkRoot, 'linked.txt'))).toBe(false);
    expect(
      await fs.readFile(path.join(symlinkRoot, 'escape.txt'), 'utf8'),
    ).toBe('redirected');
  });

  it('fails on a collision with a preexisting file and preserves its content', async () => {
    const archive = await buildArchive([
      { name: 'keep.txt', content: 'archive' },
    ]);
    const dest = path.join(workspace, 'out');
    await fs.mkdir(dest);
    await fs.writeFile(path.join(dest, 'keep.txt'), 'preexisting');

    await expect(extractZipSafe(archive, dest)).rejects.toThrow(
      /already contains: keep\.txt/,
    );

    expect(await fs.readFile(path.join(dest, 'keep.txt'), 'utf8')).toBe(
      'preexisting',
    );
    await noStagingDirsRemain(dest);
  });

  it('rejects a case-insensitive collision with a preexisting entry without replacing it', async () => {
    const archivePath = await writeZip('case.zip', [
      { name: 'readme.md', content: 'new' },
    ]);
    const dest = path.join(workspace, 'out');
    await fs.mkdir(dest);
    await fs.writeFile(path.join(dest, 'README.md'), 'keep');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /already contains: readme\.md|already contains: README\.md|invalid|collision/i,
    );

    expect(await fs.readFile(path.join(dest, 'README.md'), 'utf8')).toBe(
      'keep',
    );
    // On case-insensitive file systems `readme.md` is the same entry as
    // `README.md`; the assertion that matters is that the archive content never
    // replaced it.
    expect(await fs.readFile(path.join(dest, 'readme.md'), 'utf8')).toBe(
      'keep',
    );
    await noStagingDirsRemain(dest);
  });

  it('rejects two archive roots that collide only case-insensitively and publishes neither', async () => {
    const archivePath = await writeZip('dup.zip', [
      { name: 'Doc.txt', content: 'first' },
      { name: 'doc.txt', content: 'second' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /duplicate archive path/i,
    );

    expect(await exists(path.join(dest, 'Doc.txt'))).toBe(false);
    expect(await exists(path.join(dest, 'doc.txt'))).toBe(false);
    await noStagingDirsRemain(dest);
  });

  it('rejects a nested case-only collision inside a directory and publishes none of it', async () => {
    const archivePath = await writeZip('nested-case.zip', [
      { name: 'root/A.txt', content: 'capital' },
      { name: 'root/a.txt', content: 'lower' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /duplicate archive path/i,
    );

    expect(await exists(path.join(dest, 'root'))).toBe(false);
    await noStagingDirsRemain(dest);
  });

  it('rejects an exact duplicate path within a directory and publishes none of it', async () => {
    const archivePath = await writeZip('dup-exact.zip', [
      { name: 'root/file.txt', content: 'first' },
      { name: 'root/file.txt', content: 'second' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /duplicate archive path/i,
    );

    expect(await exists(path.join(dest, 'root'))).toBe(false);
    await noStagingDirsRemain(dest);
  });

  it('rejects path aliases that normalize to an existing archive target', async () => {
    const aliases = ['root//file.txt', 'root/./file.txt'];

    for (const [index, alias] of aliases.entries()) {
      const archivePath = await writeZip(`alias-${index}.zip`, [
        { name: 'root/file.txt', content: 'first' },
        { name: alias, content: 'second' },
      ]);
      const dest = path.join(workspace, `out-${index}`);

      await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
        /duplicate archive path/i,
      );
      expect(await exists(path.join(dest, 'root'))).toBe(false);
      await noStagingDirsRemain(dest);
    }
  });

  it('rejects a file/directory conflict at the same normalized path and publishes none of it', async () => {
    const archivePath = await writeZip('dir-file.zip', [
      { name: 'root/thing/', directory: true },
      { name: 'root/thing', content: 'x' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archivePath, dest)).rejects.toThrow(
      /duplicate archive path/i,
    );

    expect(await exists(path.join(dest, 'root'))).toBe(false);
    await noStagingDirsRemain(dest);
  });

  it('publishes none of the earlier valid entries when a later entry is malicious', async () => {
    const archive = await buildArchive([
      { name: 'good.txt', content: 'ok' },
      { name: 'a/../escape.txt', content: 'bad' },
    ]);
    const dest = path.join(workspace, 'out');

    await expect(extractZipSafe(archive, dest)).rejects.toThrow(
      /traversal|invalid relative path|resolves outside/,
    );

    expect(await exists(path.join(dest, 'good.txt'))).toBe(false);
  });

  it('rolls back an earlier published root when a later exclusive publication fails', async () => {
    const archivePath = await writeZip('rollback.zip', [
      { name: 'a/file.txt', content: 'first' },
      { name: 'b/x.txt', content: 'second' },
    ]);
    const dest = path.join(workspace, 'out');
    await fs.mkdir(dest);
    const options: ZipExtractOptions = {
      beforePublish: async (name, target) => {
        if (name === 'b') await fs.writeFile(target, 'keep');
      },
    };

    await expect(extractZipSafe(archivePath, dest, options)).rejects.toThrow(
      /already contains: b/,
    );

    expect(await exists(path.join(dest, 'a'))).toBe(false);
    expect(await fs.readFile(path.join(dest, 'b'), 'utf8')).toBe('keep');
    await noStagingDirsRemain(dest);
  });

  it('preserves an unrelated sentinel on successful extraction', async () => {
    const archive = await buildArchive([{ name: 'new.txt', content: 'fresh' }]);
    const dest = path.join(workspace, 'out');
    await fs.mkdir(dest);
    await fs.writeFile(path.join(dest, 'sentinel.txt'), 'keep');
    await fs.mkdir(path.join(dest, 'existing-dir'));

    const result = await extractZipSafe(archive, dest);

    expect(await fs.readFile(path.join(dest, 'sentinel.txt'), 'utf8')).toBe(
      'keep',
    );
    expect(await fs.readFile(path.join(dest, 'new.txt'), 'utf8')).toBe('fresh');
    expect(result.files).toEqual([path.join(path.resolve(dest), 'new.txt')]);
  });

  it('returns absolute published paths even when destDir is relative', async () => {
    const archive = await buildArchive([{ name: 'rel.txt', content: 'rel' }]);
    const processCwd = process.cwd();
    const dest = path.join(workspace, 'relative-out');

    try {
      const base = path.dirname(workspace);
      const relDest = path.relative(base, dest);
      process.chdir(base);
      const result = await extractZipSafe(archive, relDest);
      expect(path.isAbsolute(result.files[0] ?? '')).toBe(true);
      const expected = path.join(path.resolve(dest), 'rel.txt');
      expect(await fs.realpath(result.files[0] ?? '')).toBe(
        await fs.realpath(expected),
      );
    } finally {
      process.chdir(processCwd);
    }
  });

  describe('explicit empty directories', () => {
    it('preserves an explicit empty directory', async () => {
      const archivePath = await writeZip('empty.zip', [
        { name: 'empty-dir/', directory: true },
      ]);
      const dest = path.join(workspace, 'out');

      const result = await extractZipSafe(archivePath, dest);

      const dirStat = await fs.stat(path.join(dest, 'empty-dir'));
      expect(dirStat.isDirectory()).toBe(true);
      expect(await fs.readdir(path.join(dest, 'empty-dir'))).toEqual([]);
      expect(result.files).toEqual([]);
    });

    posixIt('preserves a nested empty directory with a safe mode', async () => {
      const archivePath = await writeZip('nested-empty.zip', [
        { name: 'outer/inner/deep/', directory: true, mode: 0o40755 },
      ]);
      const dest = path.join(workspace, 'out');

      await extractZipSafe(archivePath, dest);

      const deep = await fs.stat(path.join(dest, 'outer', 'inner', 'deep'));
      expect(deep.isDirectory()).toBe(true);
      expect(
        await fs.readdir(path.join(dest, 'outer', 'inner', 'deep')),
      ).toEqual([]);
      expect(deep.mode & 0o700).toBe(0o700);
    });
  });

  describe('resource limits', () => {
    it('rejects an archive with more entries than the limit and cleans up', async () => {
      const archivePath = await writeZip('count.zip', [
        { name: 'f1.txt', content: '1' },
        { name: 'f2.txt', content: '2' },
        { name: 'f3.txt', content: '3' },
      ]);
      const dest = path.join(workspace, 'out');

      await expect(
        extractZipSafe(archivePath, dest, { limits: { maxEntries: 2 } }),
      ).rejects.toThrow(/more than 2 entries/);

      expect(await exists(path.join(dest, 'f1.txt'))).toBe(false);
      await noStagingDirsRemain(dest);
    });

    it('rejects an entry whose name exceeds the length limit and cleans up', async () => {
      const archivePath = await writeZip('long.zip', [
        { name: 'this-name-is-too-long.txt', content: 'x' },
      ]);
      const dest = path.join(workspace, 'out');

      await expect(
        extractZipSafe(archivePath, dest, {
          limits: { maxFileNameLength: 10 },
        }),
      ).rejects.toThrow(/name.*limit|limit.*name/i);

      expect(await exists(path.join(dest, 'this-name-is-too-long.txt'))).toBe(
        false,
      );
      await noStagingDirsRemain(dest);
    });

    it('rejects an entry that declares more bytes than the per-entry limit before writing it', async () => {
      const archivePath = await writeZip('big.zip', [
        { name: 'big.bin', content: 'x'.repeat(64) },
      ]);
      const dest = path.join(workspace, 'out');

      await expect(
        extractZipSafe(archivePath, dest, {
          limits: { maxEntryUncompressedBytes: 32 },
        }),
      ).rejects.toThrow(/declares .*bytes.*limit|limit.*bytes/i);

      expect(await exists(path.join(dest, 'big.bin'))).toBe(false);
      await noStagingDirsRemain(dest);
    });

    it('rejects declared cumulative bytes beyond the total limit', async () => {
      const archivePath = await writeZip('total.zip', [
        { name: 'a.txt', content: 'aaaaa' },
        { name: 'b.txt', content: 'bbbbb' },
      ]);
      const dest = path.join(workspace, 'out');

      await expect(
        extractZipSafe(archivePath, dest, {
          limits: {
            maxEntryUncompressedBytes: 10,
            maxTotalUncompressedBytes: 8,
          },
        }),
      ).rejects.toThrow(/cumulative.*limit|total.*limit|limit/i);

      expect(await exists(path.join(dest, 'a.txt'))).toBe(false);
      await noStagingDirsRemain(dest);
    });

    it('rejects an entry that streams more bytes than the per-entry limit despite a lying declared size', async () => {
      const archivePath = await writeZip('bomb-per.zip', [
        {
          name: 'bomb.bin',
          content: 'x'.repeat(300),
          deflated: true,
          declaredSize: 10,
        },
      ]);
      const dest = path.join(workspace, 'out');

      await expect(
        extractZipSafe(archivePath, dest, {
          limits: { maxEntryUncompressedBytes: 100 },
        }),
      ).rejects.toThrow(/streamed .*bytes.*limit|limit/i);

      expect(await exists(path.join(dest, 'bomb.bin'))).toBe(false);
      await noStagingDirsRemain(dest);
    });

    it('rejects cumulative stream bytes beyond the total limit despite lying declared sizes', async () => {
      const archivePath = await writeZip('bomb-total.zip', [
        {
          name: 'b1.bin',
          content: 'y'.repeat(300),
          deflated: true,
          declaredSize: 10,
        },
        {
          name: 'b2.bin',
          content: 'z'.repeat(300),
          deflated: true,
          declaredSize: 10,
        },
      ]);
      const dest = path.join(workspace, 'out');

      await expect(
        extractZipSafe(archivePath, dest, {
          limits: {
            maxEntryUncompressedBytes: 1000,
            maxTotalUncompressedBytes: 400,
          },
        }),
      ).rejects.toThrow(/streamed .*bytes.*limit|limit/i);

      expect(await exists(path.join(dest, 'b1.bin'))).toBe(false);
      await noStagingDirsRemain(dest);
    });
  });

  describe('rollback and cleanup error aggregation', () => {
    it('retains the primary and rollback/cleanup errors when removal is injected to fail', async () => {
      const archivePath = await writeZip('agg.zip', [
        { name: 'a/file.txt', content: 'first' },
        { name: 'b/x.txt', content: 'second' },
      ]);
      const dest = path.join(workspace, 'out');
      await fs.mkdir(dest);

      const options: ZipExtractOptions = {
        beforePublish: async (name, target) => {
          if (name === 'b') await fs.writeFile(target, 'keep');
        },
        remove: async () => {
          throw new Error('injected remove failure');
        },
      };

      const outcome = await extractZipSafe(archivePath, dest, options).catch(
        (error: unknown) => error,
      );

      expect(isAggregateError(outcome)).toBe(true);
      if (!isAggregateError(outcome)) {
        throw new Error('expected AggregateError');
      }
      const messages = outcome.errors.map((item: unknown) =>
        item instanceof Error ? item.message : String(item),
      );
      expect(messages.some((m) => /already contains: b/.test(m))).toBe(true);
      expect(
        messages.filter((message) =>
          message.includes('injected remove failure'),
        ),
      ).toHaveLength(2);
      // The rollback failed, so the owned output is still present; the
      // preexisting entry is untouched.
      expect(await exists(path.join(dest, 'a'))).toBe(true);
      expect(await fs.readFile(path.join(dest, 'b'), 'utf8')).toBe('keep');
    });
  });

  describe('archive permissions', () => {
    posixIt('preserves safe executable bits on regular files', async () => {
      const archivePath = await writeZip('exec.zip', [
        { name: 'run.sh', content: '#!/bin/sh\necho hi\n', mode: 0o755 },
      ]);
      const dest = path.join(workspace, 'out');

      const result = await extractZipSafe(archivePath, dest);

      const stat = await fs.stat(path.join(dest, 'run.sh'));
      expect(stat.mode & 0o777).toBe(0o755);
      expect(result.files).toEqual([path.join(path.resolve(dest), 'run.sh')]);
    });

    posixIt(
      'defaults regular files to 0644 and strips special bits',
      async () => {
        const archivePath = await writeZip('special.zip', [
          { name: 'plain.txt', content: 'text' },
          { name: 'setuid.sh', content: '#!/bin/sh\n', mode: 0o4755 },
        ]);
        const dest = path.join(workspace, 'out');

        await extractZipSafe(archivePath, dest);

        const plain = await fs.stat(path.join(dest, 'plain.txt'));
        expect(plain.mode & 0o777).toBe(0o644);
        const setuid = await fs.stat(path.join(dest, 'setuid.sh'));
        expect(setuid.mode & 0o777).toBe(0o755);
        expect(setuid.mode & 0o7777).toBe(0o755);
      },
    );

    posixIt(
      'stages files beneath a readonly directory declared with mode 0555',
      async () => {
        const archivePath = await writeZip('readonly.zip', [
          { name: 'readonly/', directory: true, mode: 0o40555 },
          { name: 'readonly/file.txt', content: 'inside' },
        ]);
        const dest = path.join(workspace, 'out');

        try {
          const result = await extractZipSafe(archivePath, dest);

          expect(
            await fs.readFile(path.join(dest, 'readonly', 'file.txt'), 'utf8'),
          ).toBe('inside');
          expect(result.files).toEqual([
            path.join(path.resolve(dest), 'readonly', 'file.txt'),
          ]);
          const dirStat = await fs.stat(path.join(dest, 'readonly'));
          expect(dirStat.mode & 0o777).toBe(0o555);
        } finally {
          // Re-open the archived mode so the shared workspace can be removed.
          await fs
            .chmod(path.join(dest, 'readonly'), 0o700)
            .catch((error: unknown) => {
              if (!(isErrno(error) && error.code === 'ENOENT')) throw error;
            });
        }
      },
    );

    posixIt('preserves safe directory modes', async () => {
      const archivePath = await writeZip('dirmode.zip', [
        { name: 'writable/', directory: true, mode: 0o40755 },
        { name: 'restricted/', directory: true, mode: 0o40700 },
      ]);
      const dest = path.join(workspace, 'out');

      await extractZipSafe(archivePath, dest);

      const writable = await fs.stat(path.join(dest, 'writable'));
      expect(writable.isDirectory()).toBe(true);
      expect(writable.mode & 0o777).toBe(0o755);
      const restricted = await fs.stat(path.join(dest, 'restricted'));
      expect(restricted.isDirectory()).toBe(true);
      expect(restricted.mode & 0o777).toBe(0o700);
    });
  });
});
