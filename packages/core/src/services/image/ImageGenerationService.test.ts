/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ImageValidationError,
  validateImagePrompt,
  persistBase64ImageResult,
  ImagePersistenceError,
  type ImageResult,
} from './ImageGenerationService.js';

/**
 * Runs `operation` expecting rejection and returns the rejection reason.
 * Fails closed by throwing if the operation fulfills, so tests cannot pass
 * silently when the promise resolves with an Error-shaped value.
 */
const NOT_REJECTED = Symbol('not-rejected');

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  const outcome: unknown = await operation.then(
    () => NOT_REJECTED,
    (error: unknown) => error,
  );
  if (outcome === NOT_REJECTED) {
    throw new Error('expected the operation to reject');
  }
  return outcome;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Probe symlink support once at module load.
 *
 * Symlink creation requires elevation or Developer Mode on Windows. The skip
 * decision is made at declaration time via `it.skipIf` rather than through the
 * vitest per-test context, because a test callback that declares a parameter
 * is interpreted by Bun's runner as a `done`-callback test and would hang.
 */
const SYMLINKS_SUPPORTED = ((): boolean => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-symprobe-'));
  try {
    fs.symlinkSync(path.join(probeDir, 'target'), path.join(probeDir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
})();

/**
 * Compute the PNG CRC32 for a chunk's type+data bytes.
 * PNG uses the IEEE 802.3 CRC-32 polynomial (reflected), init 0xffffffff,
 * final xor 0xffffffff. Implemented inline so the test adds no dependency.
 */
function pngCrc32(buf: Buffer): number {
  // Standard CRC-32 table.
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

/**
 * Build a complete PNG chunk: [length:uint32BE][type][data][crc:uint32BE].
 */
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * Build a real, structurally valid minimal 1x1 PNG (signature + IHDR + IDAT
 * + IEND). The IDAT is a valid zlib stream for a single zero pixel. This
 * replaces the previous fake signature-only fixture.
 */
function makeRealMinimalPng(): Buffer {
  // IHDR: width=1, height=1, bit depth=8, color type=2 (RGB), compression=0,
  // filter=0, interlace=0. That is 13 bytes — the only legal IHDR length.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // A single scanline: filter byte 0 + 3 bytes RGB. Then zlib-deflate it.
  // We use the stored (no-compression) zlib block so the test stays
  // dependency-free and deterministic.
  const rawScanline = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const storedBlockHeader = Buffer.from([0x01]); // BFINAL=1, BTYPE=00 (stored)
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

function makePngResult(caption?: string): ImageResult {
  return {
    mimeType: 'image/png',
    encoding: 'base64',
    data: makeRealMinimalPng().toString('base64'),
    caption,
  };
}

describe('validateImagePrompt', () => {
  it('throws ImageValidationError for an empty string', () => {
    expect(() => validateImagePrompt('')).toThrow(ImageValidationError);
  });

  it('throws ImageValidationError for a whitespace-only string', () => {
    expect(() => validateImagePrompt('   \t\n  ')).toThrow(
      ImageValidationError,
    );
  });

  // String(null)/String(undefined) produce the literal words "null"/"undefined",
  // which are non-empty strings. The validator correctly accepts them; the A4
  // contract is about empty/whitespace rejection, not JavaScript coercion
  // semantics. These tests document that boundary.
  it('accepts the literal string "null" produced by String(null)', () => {
    expect(() => validateImagePrompt(String(null))).not.toThrow();
  });

  it('accepts the literal string "undefined" produced by String(undefined)', () => {
    expect(() => validateImagePrompt(String(undefined))).not.toThrow();
  });

  it('accepts a normal prompt without throwing', () => {
    expect(() => validateImagePrompt('a cat wearing a tiny hat')).not.toThrow();
  });

  it('accepts a prompt with leading and trailing whitespace', () => {
    expect(() =>
      validateImagePrompt('   a cat wearing a tiny hat   '),
    ).not.toThrow();
  });

  it('produces a message describing the validation failure', () => {
    expect(() => validateImagePrompt('   ')).toThrow(/prompt/i);
  });
});

describe('persistBase64ImageResult', () => {
  // Suite-scoped temp workspace root. Lifecycle hooks are declared directly
  // inside this describe (not via a top-level helper) so vitest's
  // require-top-level-describe rule is satisfied and cleanup is preserved.
  let workspaceRoot = '';
  beforeEach(async () => {
    workspaceRoot = await fs.promises.realpath(
      await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-image-persist-'),
      ),
    );
  });
  afterEach(async () => {
    if (workspaceRoot !== '') {
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('writes the decoded PNG bytes beneath generated-images and returns an absolute final path', async () => {
    const result = makePngResult('a cat');

    const finalPath = await persistBase64ImageResult(result, workspaceRoot);

    expect(path.isAbsolute(finalPath)).toBe(true);
    expect(finalPath).toContain('generated-images');
    expect(finalPath.endsWith('.png')).toBe(true);

    const written = await fs.promises.readFile(finalPath);
    expect(written.equals(makeRealMinimalPng())).toBe(true);

    // On macOS, os.tmpdir() may report a non-canonical prefix such as /var
    // while the production persistence canonicalizes via fs.realpath to
    // /private/var. Comparing against the realpath of workspaceRoot keeps the
    // security assertion accurate across platforms without weakening it.
    const canonicalWorkspaceRoot = await fs.promises.realpath(workspaceRoot);
    const relative = path.relative(canonicalWorkspaceRoot, finalPath);
    expect(relative.startsWith('generated-images')).toBe(true);
    expect(relative).not.toMatch(/\.\./);
  });

  it('leaves no temporary file behind after a successful write', async () => {
    const result = makePngResult();

    const finalPath = await persistBase64ImageResult(result, workspaceRoot);

    const dir = path.dirname(finalPath);
    const entries = await fs.promises.readdir(dir);
    const tempFiles = entries.filter((e) => e.endsWith('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  it('rejects a workspace root that cannot be canonicalized without creating it', async () => {
    const missingRoot = path.join(workspaceRoot, 'missing-workspace');

    expect(
      await captureRejection(
        persistBase64ImageResult(makePngResult(), missingRoot),
      ),
    ).toBeInstanceOf(ImagePersistenceError);
    expect(await captureRejection(fs.promises.stat(missingRoot))).toMatchObject(
      {
        code: 'ENOENT',
      },
    );
  });

  it('normalizes output-directory creation failures to ImagePersistenceError', async () => {
    await fs.promises.writeFile(
      path.join(workspaceRoot, 'generated-images'),
      'not a directory',
    );

    expect(
      await captureRejection(
        persistBase64ImageResult(makePngResult(), workspaceRoot),
      ),
    ).toBeInstanceOf(ImagePersistenceError);
  });

  it('rejects a non-PNG mimeType with ImagePersistenceError', async () => {
    const result: ImageResult = {
      mimeType: 'image/jpeg',
      encoding: 'base64',
      data: makeRealMinimalPng().toString('base64'),
    };

    expect(
      await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
    ).toBeInstanceOf(ImagePersistenceError);
  });

  it('rejects a non-base64 encoding with ImagePersistenceError', async () => {
    const result = {
      mimeType: 'image/png',
      encoding: 'url',
      data: 'https://example.invalid/image.png',
    } as ImageResult;

    expect(
      await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
    ).toBeInstanceOf(ImagePersistenceError);
  });

  describe('strict base64 validation', () => {
    it('rejects garbage that is not valid base64', async () => {
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: '!!!not-valid-base64!!!',
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('normalizes non-string data to ImagePersistenceError', async () => {
      const result = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: undefined,
      } as unknown as ImageResult;

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects base64 with trailing characters appended after valid data', async () => {
      const valid = makeRealMinimalPng().toString('base64');
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: `${valid}XXXX`,
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects base64 with missing/invalid padding', async () => {
      // Construct a payload that requires padding (byte length not a multiple
      // of 3) but has the padding stripped, leaving a length that is not a
      // multiple of 4. Canonical base64 requires padding to a multiple of 4.
      const stripped = 'iVBORw0KGgo';
      expect(stripped.length % 4).not.toBe(0);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: stripped,
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects base64 with padding in the wrong position', async () => {
      // A '=' in the middle of the data is never valid canonical base64.
      const valid = makeRealMinimalPng().toString('base64');
      const midPadding = `${valid.slice(0, 10)}=${valid.slice(11)}`;
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: midPadding,
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects an empty decoded payload', async () => {
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: '',
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });
  });

  describe('strict PNG structural validation', () => {
    it('rejects bytes that are signature-only / truncated (no IHDR)', async () => {
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: PNG_SIGNATURE.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects a payload missing the terminal IEND chunk', async () => {
      const truncated = Buffer.concat([
        PNG_SIGNATURE,
        pngChunk(
          'IHDR',
          (() => {
            const ihdr = Buffer.alloc(13);
            ihdr.writeUInt32BE(1, 0);
            ihdr.writeUInt32BE(1, 4);
            ihdr[8] = 8;
            ihdr[9] = 2;
            return ihdr;
          })(),
        ),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: truncated.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects a payload with a bad chunk CRC', async () => {
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(1, 0);
      ihdr.writeUInt32BE(1, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const typeBuf = Buffer.from('IHDR', 'ascii');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(ihdr.length, 0);
      // Intentionally wrong CRC.
      const badCrc = Buffer.alloc(4);
      badCrc.writeUInt32BE(0xde_ad_be_ef, 0);
      const corrupted = Buffer.concat([
        PNG_SIGNATURE,
        length,
        typeBuf,
        ihdr,
        badCrc,
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: corrupted.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects a payload with trailing bytes after IEND', async () => {
      const valid = makeRealMinimalPng();
      const withTrailer = Buffer.concat([valid, Buffer.from([0x00, 0x00])]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: withTrailer.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects bytes that do not have a valid PNG signature', async () => {
      const notPng = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: notPng.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects an IHDR chunk whose length is not 13', async () => {
      const wrongLength = Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', Buffer.alloc(12)), // wrong length
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: wrongLength.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects an IHDR with zero dimensions', async () => {
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(0, 0); // width 0
      ihdr.writeUInt32BE(1, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const zeroDim = Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: zeroDim.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects a payload whose first chunk is not IHDR', async () => {
      const notFirst = Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IDAT', Buffer.from([0x00])),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: notFirst.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects a second IHDR chunk', async () => {
      const valid = makeRealMinimalPng();
      const ihdrChunk = valid.subarray(
        PNG_SIGNATURE.length,
        PNG_SIGNATURE.length + 25,
      );
      const duplicateIhdr = Buffer.concat([
        valid.subarray(0, valid.length - 12),
        ihdrChunk,
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: duplicateIhdr.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });

    it('rejects an IEND chunk with nonzero data length', async () => {
      const valid = makeRealMinimalPng();
      const nonemptyIend = Buffer.concat([
        valid.subarray(0, valid.length - 12),
        pngChunk('IEND', Buffer.from([0x00])),
      ]);
      const result: ImageResult = {
        mimeType: 'image/png',
        encoding: 'base64',
        data: nonemptyIend.toString('base64'),
      };

      expect(
        await captureRejection(persistBase64ImageResult(result, workspaceRoot)),
      ).toBeInstanceOf(ImagePersistenceError);
    });
  });

  describe('symlink/reparse-point escape prevention', () => {
    it.skipIf(!SYMLINKS_SUPPORTED)(
      'rejects persistence when the output directory is a symlink/junction to outside the workspace and leaves the target empty',
      async () => {
        // Outside temp directory that the symlink would point at.
        const outsideDir = await fs.promises.realpath(
          await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'llxprt-image-escape-'),
          ),
        );
        try {
          const linkDir = path.join(workspaceRoot, 'generated-images');
          await fs.promises.symlink(outsideDir, linkDir, 'dir');

          const result = makePngResult();

          expect(
            await captureRejection(
              persistBase64ImageResult(result, workspaceRoot),
            ),
          ).toBeInstanceOf(ImagePersistenceError);

          // The outside directory must remain empty — nothing was written there.
          const outsideEntries = await fs.promises.readdir(outsideDir);
          expect(outsideEntries).toHaveLength(0);
        } finally {
          await fs.promises.rm(outsideDir, { recursive: true, force: true });
        }
      },
    );
  });

  describe('cleanup-in-catch error masking', () => {
    it('surfaces the original ImagePersistenceError even when temp cleanup fails', async () => {
      // When the write/rename fails AND the cleanup fs.rm also rejects
      // (e.g. EPERM/EBUSY on Windows), the original ImagePersistenceError
      // with its cause must always win — the raw rm rejection must not
      // propagate instead.
      //
      // We spy on fs.promises.rename to simulate a real filesystem rename
      // failure (the original persistence error), and fs.promises.rm to
      // simulate the platform-specific cleanup rejection. Both are external
      // filesystem conditions that are non-deterministic in CI.
      const renameError = new Error('EXDEV: cross-device link');
      const rmSpy = vi
        .spyOn(fs.promises, 'rm')
        .mockRejectedValue(
          Object.assign(new Error('EPERM: cleanup failed'), { code: 'EPERM' }),
        );
      const renameSpy = vi
        .spyOn(fs.promises, 'rename')
        .mockRejectedValue(renameError);

      try {
        const error = await persistBase64ImageResult(
          makePngResult(),
          workspaceRoot,
        ).catch((e) => e);

        // The surfaced error must be the ImagePersistenceError, NOT the
        // raw EPERM cleanup error.
        expect(error).toBeInstanceOf(ImagePersistenceError);
        const persistError = error as ImagePersistenceError;
        // The cause must be the original rename failure, NOT the cleanup EPERM.
        expect(persistError.message).toMatch(/Failed to persist/i);
        expect(persistError.cause).toBe(renameError);
        expect((persistError.cause as Error).message).not.toMatch(/EPERM/i);
      } finally {
        renameSpy.mockRestore();
        rmSpy.mockRestore();
      }
    });
  });
});
