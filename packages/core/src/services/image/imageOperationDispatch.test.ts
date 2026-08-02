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
  runImageOperation,
  type ImageOperationBackendResolver,
  type ImageOperationInput,
} from './imageOperationDispatch.js';
import { ImageOperationError } from './imageOperation.js';

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
  let a = 1;
  let b = 0;
  for (const byte of rawScanline) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler, 0);
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

function makeStubResolver(options: {
  generateResult?: { data: string };
  editResult?: { data: string };
  throwOnResolve?: Error;
  noBackend?: boolean;
}): ImageOperationBackendResolver {
  return () => {
    if (options.throwOnResolve) throw options.throwOnResolve;
    if (options.noBackend === true) return null;
    return {
      name: 'stub',
      provider: 'stub',
      model: 'stub-model',
      async generate() {
        return {
          mimeType: 'image/png',
          encoding: 'base64' as const,
          data: (options.generateResult ?? { data: VALID_PNG_BASE64 }).data,
        };
      },
      async edit() {
        return {
          mimeType: 'image/png',
          encoding: 'base64' as const,
          data: (options.editResult ?? { data: VALID_PNG_BASE64 }).data,
        };
      },
    };
  };
}

function makeTrackingResolver(): {
  resolver: ImageOperationBackendResolver;
  generateCalled: () => number;
  editCalled: () => number;
} {
  let genCalls = 0;
  let editCalls = 0;
  return {
    resolver: () => ({
      name: 'tracking',
      provider: 'tracking',
      model: 'tracking-model',
      async generate() {
        genCalls++;
        return {
          mimeType: 'image/png',
          encoding: 'base64' as const,
          data: VALID_PNG_BASE64,
        };
      },
      async edit() {
        editCalls++;
        return {
          mimeType: 'image/png',
          encoding: 'base64' as const,
          data: VALID_PNG_BASE64,
        };
      },
    }),
    generateCalled: () => genCalls,
    editCalled: () => editCalls,
  };
}

describe('runImageOperation', () => {
  let workspaceRoot = '';
  beforeEach(async () => {
    workspaceRoot = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-dispatch-')),
    );
  });
  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('generates an image and writes it to the resolved output path', async () => {
    const input: ImageOperationInput = {
      prompt: 'a cat',
      outputPath: 'cat.png',
    };
    const result = await runImageOperation(input, {
      workspaceRoot,
      resolveBackend: makeStubResolver({}),
    });

    expect(result.operation).toBe('generate');
    expect(result.absoluteOutputPath.endsWith('cat.png')).toBe(true);
    expect(result.mimeType).toBe('image/png');
    expect(result.backend).toBe('stub');
    expect(result.provider).toBe('stub');
    expect(result.model).toBe('stub-model');

    const written = await fs.promises.readFile(result.absoluteOutputPath);
    expect(written.equals(makeRealMinimalPng())).toBe(true);
  });

  it('edits an image using input paths', async () => {
    const inputPath = path.join(workspaceRoot, 'in.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());
    const input: ImageOperationInput = {
      prompt: 'add a mouse',
      outputPath: 'out.png',
      inputPaths: ['in.png'],
    };
    const result = await runImageOperation(input, {
      workspaceRoot,
      resolveBackend: makeStubResolver({}),
    });

    expect(result.operation).toBe('edit');
    expect(result.inputPaths).toStrictEqual([inputPath]);
  });

  it('returns a capability error when no backend resolves', async () => {
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png' },
        {
          workspaceRoot,
          resolveBackend: makeStubResolver({ noBackend: true }),
        },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'capability',
    });
  });

  it('propagates abort and does not call the backend (signal already aborted)', async () => {
    const { resolver, generateCalled } = makeTrackingResolver();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png' },
        {
          workspaceRoot,
          resolveBackend: resolver,
          signal: controller.signal,
        },
      ),
    ).rejects.toBeInstanceOf(ImageOperationError);
    // The backend must NOT have been called — no billable provider request.
    expect(generateCalled()).toBe(0);
  });

  it('rejects when the output path escapes the workspace', async () => {
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: '../../escape.png' },
        { workspaceRoot, resolveBackend: makeStubResolver({}) },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'output-resolution',
    });
  });

  it('rejects a non-png output', async () => {
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.jpg' },
        { workspaceRoot, resolveBackend: makeStubResolver({}) },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
    });
  });

  it('does not call the backend when an input path is invalid (missing file)', async () => {
    const { resolver, editCalled } = makeTrackingResolver();
    await expect(
      runImageOperation(
        {
          prompt: 'edit',
          outputPath: 'out.png',
          inputPaths: ['does-not-exist.png'],
        },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'input-validation',
    });
    expect(editCalled()).toBe(0);
  });

  it('does not call the backend when an input path is a URL', async () => {
    const { resolver, editCalled } = makeTrackingResolver();
    await expect(
      runImageOperation(
        {
          prompt: 'edit',
          outputPath: 'out.png',
          inputPaths: ['https://example.com/img.png'],
        },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'input-validation',
    });
    expect(editCalled()).toBe(0);
  });

  it('does not call the backend when an input path escapes the workspace', async () => {
    const { resolver, editCalled } = makeTrackingResolver();
    await expect(
      runImageOperation(
        {
          prompt: 'edit',
          outputPath: 'out.png',
          inputPaths: ['../../escape.png'],
        },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'input-validation',
    });
    expect(editCalled()).toBe(0);
  });

  it('does not call the backend when an input path is a non-png file', async () => {
    const { resolver, editCalled } = makeTrackingResolver();
    await fs.promises.writeFile(path.join(workspaceRoot, 'notimage.txt'), 'hi');
    await expect(
      runImageOperation(
        {
          prompt: 'edit',
          outputPath: 'out.png',
          inputPaths: ['notimage.txt'],
        },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'input-validation',
    });
    expect(editCalled()).toBe(0);
  });

  it('does not call the backend when an input path has an invalid PNG signature', async () => {
    const { resolver, editCalled } = makeTrackingResolver();
    await fs.promises.writeFile(
      path.join(workspaceRoot, 'fake.png'),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );
    await expect(
      runImageOperation(
        {
          prompt: 'edit',
          outputPath: 'out.png',
          inputPaths: ['fake.png'],
        },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'input-validation',
    });
    expect(editCalled()).toBe(0);
  });

  it('calls the backend with canonical absolute input paths', async () => {
    const inputPath = path.join(workspaceRoot, 'in.png');
    await fs.promises.writeFile(inputPath, makeRealMinimalPng());
    let receivedInputPaths: readonly string[] = [];
    const resolver: ImageOperationBackendResolver = () => ({
      name: 'spy',
      provider: 'spy',
      model: 'spy-model',
      async generate() {
        return {
          mimeType: 'image/png',
          encoding: 'base64',
          data: VALID_PNG_BASE64,
        };
      },
      async edit(req) {
        receivedInputPaths = req.inputPaths;
        return {
          mimeType: 'image/png',
          encoding: 'base64',
          data: VALID_PNG_BASE64,
        };
      },
    });
    await runImageOperation(
      {
        prompt: 'edit',
        outputPath: 'out.png',
        inputPaths: ['in.png'],
      },
      { workspaceRoot, resolveBackend: resolver },
    );
    expect(receivedInputPaths).toStrictEqual([inputPath]);
  });

  it('rejects malformed nonempty base64 before any write and leaves no output file', async () => {
    // Non-canonical base64 (trailing junk after valid group) must be rejected
    // by strictBase64Decode before writeImageAtomically runs.
    const malformed = `${VALID_PNG_BASE64}XXXX`;
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png' },
        {
          workspaceRoot,
          resolveBackend: makeStubResolver({
            generateResult: { data: malformed },
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'response-validation',
    });
    expect(fs.existsSync(path.join(workspaceRoot, 'cat.png'))).toBe(false);
    const entries = await fs.promises.readdir(workspaceRoot);
    expect(entries).toHaveLength(0);
  });

  it('rejects non-PNG bytes (valid base64, invalid structure) before any write', async () => {
    // Valid canonical base64 that decodes to non-PNG bytes must be rejected
    // by validatePngStructure before writeImageAtomically runs.
    const notPng = Buffer.from('not a png file at all').toString('base64');
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png' },
        {
          workspaceRoot,
          resolveBackend: makeStubResolver({
            generateResult: { data: notPng },
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'response-validation',
    });
    expect(fs.existsSync(path.join(workspaceRoot, 'cat.png'))).toBe(false);
  });

  it('rejects a PNG with a corrupted CRC before any write', async () => {
    const png = makeRealMinimalPng();
    // Corrupt a CRC byte in the IDAT chunk (after signature+IHDR).
    const corrupted = Buffer.from(png);
    corrupted[corrupted.length - 12] ^= 0xff;
    const corruptedBase64 = corrupted.toString('base64');
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png' },
        {
          workspaceRoot,
          resolveBackend: makeStubResolver({
            generateResult: { data: corruptedBase64 },
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'response-validation',
    });
    expect(fs.existsSync(path.join(workspaceRoot, 'cat.png'))).toBe(false);
  });

  it('honors a signal passed via input and does not call the backend (overrides deps signal)', async () => {
    const { resolver, generateCalled } = makeTrackingResolver();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png', signal: controller.signal },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toBeInstanceOf(ImageOperationError);
    // The backend must NOT have been called — no billable provider request.
    expect(generateCalled()).toBe(0);
  });

  it('rejects a backend result with a non-image/png mimeType before write', async () => {
    // Even though the bytes are valid PNG, a wrong mimeType (e.g. image/jpeg)
    // must be rejected for output MIME consistency.
    const resolver: ImageOperationBackendResolver = () => ({
      name: 'stub',
      provider: 'stub',
      model: 'stub-model',
      async generate() {
        return {
          mimeType: 'image/jpeg',
          encoding: 'base64',
          data: VALID_PNG_BASE64,
        };
      },
      async edit() {
        return {
          mimeType: 'image/png',
          encoding: 'base64',
          data: VALID_PNG_BASE64,
        };
      },
    });
    await expect(
      runImageOperation(
        { prompt: 'a cat', outputPath: 'cat.png' },
        { workspaceRoot, resolveBackend: resolver },
      ),
    ).rejects.toMatchObject({
      name: 'ImageOperationError',
      stage: 'response-validation',
    });
    expect(fs.existsSync(path.join(workspaceRoot, 'cat.png'))).toBe(false);
  });
});
