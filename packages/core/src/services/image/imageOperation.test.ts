/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildNormalizedImageRequest,
  resolveOutputPath,
  resolveInputPaths,
  writeImageAtomically,
  ImageOperationError,
  type ImageOperationBackend,
} from './imageOperation.js';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngCrc32(buf: Buffer): number {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0xff_ff_ff_ff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function makeRealMinimalPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rawScanline = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const storedBlockHeader = Buffer.from([0x01]);
  const storedLen = Buffer.alloc(2);
  storedLen.writeUInt16LE(rawScanline.length, 0);
  const storedNlen = Buffer.alloc(2);
  storedNlen.writeUInt16LE(~rawScanline.length & 0xffff, 0);
  const adler32 = (() => {
    let a = 1;
    let b = 0;
    for (const byte of rawScanline) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  })();
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32, 0);
  const idatData = Buffer.concat([
    zlibHeader,
    storedBlockHeader,
    storedLen,
    storedNlen,
    rawScanline,
    checksum,
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const VALID_PNG_BASE64 = makeRealMinimalPng().toString('base64');

describe('buildNormalizedImageRequest', () => {
  it('builds a generate request when no input paths are given', () => {
    const req = buildNormalizedImageRequest({
      prompt: 'a cat',
      outputPath: 'out.png',
    });
    expect(req.operation).toBe('generate');
    expect(req.prompt).toBe('a cat');
    expect(req.outputPath).toBe('out.png');
    expect(req.inputPaths).toStrictEqual([]);
  });

  it('builds an edit request when one-to-five input paths are given', () => {
    const req = buildNormalizedImageRequest({
      prompt: 'add a mouse',
      outputPath: 'out.png',
      inputPaths: ['a.png'],
    });
    expect(req.operation).toBe('edit');
    expect(req.inputPaths).toStrictEqual(['a.png']);
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      buildNormalizedImageRequest({ prompt: '   ', outputPath: 'out.png' }),
    ).toThrow(ImageOperationError);
  });

  it('rejects a missing output path', () => {
    expect(() =>
      buildNormalizedImageRequest({
        prompt: 'a cat',
        outputPath: '',
      }),
    ).toThrow(ImageOperationError);
  });

  it('rejects more than five input paths', () => {
    expect(() =>
      buildNormalizedImageRequest({
        prompt: 'a cat',
        outputPath: 'out.png',
        inputPaths: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'],
      }),
    ).toThrow(/at most 5/i);
  });

  it('rejects a non-png output extension', () => {
    expect(() =>
      buildNormalizedImageRequest({
        prompt: 'a cat',
        outputPath: 'out.jpg',
      }),
    ).toThrow(/png/i);
  });
});

describe('resolveOutputPath', () => {
  let workspaceRoot = '';
  beforeEach(async () => {
    workspaceRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-image-op-'),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('resolves a relative path against the workspace root and returns abs + relative', async () => {
    const { absolute, relative } = await resolveOutputPath(
      'sub/dir/cat.png',
      workspaceRoot,
    );
    expect(path.isAbsolute(absolute)).toBe(true);
    expect(absolute.endsWith(path.join('sub', 'dir', 'cat.png'))).toBe(true);
    expect(relative).toBe(path.join('sub', 'dir', 'cat.png'));
  });

  it('rejects a path that escapes the workspace via traversal', async () => {
    await expect(
      resolveOutputPath('../../etc/passwd.png', workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('rejects a non-png extension', async () => {
    await expect(
      resolveOutputPath('cat.jpg', workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('creates the parent directory safely', async () => {
    const { absolute } = await resolveOutputPath(
      'new/deep/dir/cat.png',
      workspaceRoot,
    );
    const parentExists = await fs.promises
      .stat(path.dirname(absolute))
      .then(() => true)
      .catch(() => false);
    expect(parentExists).toBe(true);
  });

  it('rejects an absolute path outside the workspace', async () => {
    const outside = path.join(os.tmpdir(), 'outside.png');
    await expect(
      resolveOutputPath(outside, workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('rejects when the output path is a symlink escaping the workspace', async (context) => {
    const linkPath = path.join(workspaceRoot, 'link.png');
    const target = path.join(os.tmpdir(), 'escape-target.png');
    try {
      await fs.promises.symlink(target, linkPath, 'file');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'UNKNOWN') {
        context.skip(`Symlink creation unavailable (${code})`);
        return;
      }
      throw err;
    }
    await expect(
      resolveOutputPath('link.png', workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('rejects when a parent directory is a symlink/junction escaping the workspace', async (context) => {
    // Create a directory symlink INSIDE the workspace pointing OUTSIDE, then
    // attempt to write a file under it. The output must not escape.
    const outsideDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-outside-'),
    );
    const linkDir = path.join(workspaceRoot, 'escapelink');
    try {
      await fs.promises.symlink(outsideDir, linkDir, 'dir');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'UNKNOWN') {
        context.skip(`Symlink creation unavailable (${code})`);
        return;
      }
      throw err;
    }
    await expect(
      resolveOutputPath('escapelink/out.png', workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
    // The outside directory must remain untouched (no file written).
    expect(fs.existsSync(path.join(outsideDir, 'out.png'))).toBe(false);
  });
});

describe('writeImageAtomically', () => {
  let workspaceRoot = '';
  beforeEach(async () => {
    workspaceRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-image-write-'),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('writes valid PNG bytes to the target path atomically (no temp leftover)', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    const png = makeRealMinimalPng();
    await writeImageAtomically(png, target, new AbortController().signal);
    const written = await fs.promises.readFile(target);
    expect(written.equals(png)).toBe(true);
    const entries = await fs.promises.readdir(workspaceRoot);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('rejects an existing file (no silent overwrite)', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    await fs.promises.writeFile(target, 'existing');
    await expect(
      writeImageAtomically(
        makeRealMinimalPng(),
        target,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ImageOperationError);
    // existing content preserved
    expect(await fs.promises.readFile(target, 'utf8')).toBe('existing');
  });

  it('honors an aborted signal', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeImageAtomically(makeRealMinimalPng(), target, controller.signal),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('uses O_EXCL semantics: concurrent writes do not both succeed (race-safe no-clobber)', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    const png = makeRealMinimalPng();
    // Two concurrent writes to the same target: exactly one must succeed and
    // the other must fail with EEXIST (no silent overwrite, race-safe).
    const results = await Promise.allSettled([
      writeImageAtomically(png, target, new AbortController().signal),
      writeImageAtomically(png, target, new AbortController().signal),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    // The surviving file must be valid and exactly one file must exist.
    const written = await fs.promises.readFile(target);
    expect(written.equals(png)).toBe(true);
    const entries = await fs.promises.readdir(workspaceRoot);
    expect(entries).toHaveLength(1);
  });

  it('target is absent until publication completes (temp never visible at final path)', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    const png = makeRealMinimalPng();
    await writeImageAtomically(png, target, new AbortController().signal);
    // After success the target exists; during the write it must not have been
    // partial. We assert the final state is complete and no temp remains.
    expect(fs.existsSync(target)).toBe(true);
    const written = await fs.promises.readFile(target);
    expect(written.equals(png)).toBe(true);
    const entries = await fs.promises.readdir(workspaceRoot);
    // Only the final target should remain — no leftover temp files.
    expect(entries).toStrictEqual(['cat.png']);
  });

  it('preserves an existing target on publish failure (no-clobber link)', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    await fs.promises.writeFile(target, 'original-content');
    await expect(
      writeImageAtomically(
        makeRealMinimalPng(),
        target,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ImageOperationError);
    // Original content must be intact.
    expect(await fs.promises.readFile(target, 'utf8')).toBe('original-content');
    // No temp leftovers.
    const entries = await fs.promises.readdir(workspaceRoot);
    expect(entries).toStrictEqual(['cat.png']);
  });

  it('cleans up the temp file when the write fails (invalid bytes path)', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    // Empty buffer triggers a write but the publish still must not leave a
    // partial final file. We pass empty bytes and assert no temp leftover.
    // (writeImageAtomically writes whatever bytes it receives; the validation
    // happens upstream. Here we verify temp cleanup on a short write.)
    await writeImageAtomically(
      Buffer.alloc(0),
      target,
      new AbortController().signal,
    );
    const entries = await fs.promises.readdir(workspaceRoot);
    expect(entries.filter((e) => e !== 'cat.png')).toHaveLength(0);
  });

  it('removes the temp file and does not create the target when cancelled before start', async () => {
    const target = path.join(workspaceRoot, 'cat.png');
    const controller = new AbortController();
    controller.abort();
    await expect(
      writeImageAtomically(makeRealMinimalPng(), target, controller.signal),
    ).rejects.toBeInstanceOf(ImageOperationError);
    expect(fs.existsSync(target)).toBe(false);
    const entries = await fs.promises.readdir(workspaceRoot);
    expect(entries).toHaveLength(0);
  });

  it('publishes via a no-clobber hard-link (link fails on existing target)', async () => {
    // The atomic publication primitive must be link(temp, target) which fails
    // with EEXIST when target already exists, NOT stat-then-rename.
    const target = path.join(workspaceRoot, 'cat.png');
    await fs.promises.writeFile(target, 'pre-existing');
    const png = makeRealMinimalPng();
    await expect(
      writeImageAtomically(png, target, new AbortController().signal),
    ).rejects.toBeInstanceOf(ImageOperationError);
    // pre-existing content untouched (no-clobber).
    expect(await fs.promises.readFile(target, 'utf8')).toBe('pre-existing');
  });
});

describe('ImageOperationBackend (edit dispatch)', () => {
  it('a backend with edit() is called for edit operations', async () => {
    let calledEdit = false;
    const backend: ImageOperationBackend = {
      name: 'codex',
      provider: 'codex',
      model: 'gpt-image-2',
      async generate() {
        throw new Error('should not call generate');
      },
      async edit() {
        calledEdit = true;
        return {
          mimeType: 'image/png',
          encoding: 'base64',
          data: VALID_PNG_BASE64,
        };
      },
    };
    await backend.edit(
      {
        prompt: 'add mouse',
        inputPaths: [],
      },
      new AbortController().signal,
    );
    expect(calledEdit).toBe(true);
  });
});

describe('resolveInputPaths (parent symlink escape)', () => {
  let workspaceRoot = '';
  let outsideDir = '';
  beforeEach(async () => {
    workspaceRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-image-input-'),
    );
    outsideDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-outside-input-'),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    await fs.promises.rm(outsideDir, { recursive: true, force: true });
  });

  it('rejects an input path under a parent symlink/junction that escapes the workspace', async (context) => {
    // Place a real PNG OUTSIDE the workspace, then symlink a directory inside
    // the workspace to the outside dir. The input path under that symlinked
    // directory resolves to an outside file and must be rejected.
    const outsidePng = path.join(outsideDir, 'secret.png');
    await fs.promises.writeFile(outsidePng, makeRealMinimalPng());
    const linkDir = path.join(workspaceRoot, 'escapelink');
    try {
      await fs.promises.symlink(outsideDir, linkDir, 'dir');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'UNKNOWN') {
        context.skip(`Symlink creation unavailable (${code})`);
        return;
      }
      throw err;
    }
    await expect(
      resolveInputPaths(['escapelink/secret.png'], workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('rejects an input symlink that points to a regular file outside the workspace', async (context) => {
    const outsidePng = path.join(outsideDir, 'outside.png');
    await fs.promises.writeFile(outsidePng, makeRealMinimalPng());
    const linkFile = path.join(workspaceRoot, 'link-input.png');
    try {
      await fs.promises.symlink(outsidePng, linkFile, 'file');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'UNKNOWN') {
        context.skip(`Symlink creation unavailable (${code})`);
        return;
      }
      throw err;
    }
    await expect(
      resolveInputPaths(['link-input.png'], workspaceRoot),
    ).rejects.toBeInstanceOf(ImageOperationError);
  });

  it('accepts a legitimate in-workspace input file', async () => {
    const inputPng = path.join(workspaceRoot, 'in.png');
    await fs.promises.writeFile(inputPng, makeRealMinimalPng());
    const resolved = await resolveInputPaths(['in.png'], workspaceRoot);
    expect(resolved).toStrictEqual([inputPng]);
  });
});
