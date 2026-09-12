/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInputImage } from './imageInput.js';
import { tinyPngBase64 } from './mlx-wire-fixtures.js';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'image-input-3627-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it.each(['', '   '])(
  'rejects empty paths %j before filesystem access',
  async (path) => {
    await expect(readInputImage(path)).rejects.toMatchObject({
      name: 'ImageValidationError',
      message: 'Input image path must not be empty.',
    });
  },
);
it('reads regular files from the opened descriptor', async () => {
  const path = join(directory, 'input.png');
  const bytes = Buffer.from(tinyPngBase64, 'base64');
  await writeFile(path, bytes);
  expect(await readInputImage(path)).toStrictEqual({
    bytes,
    mimeType: 'image/png',
  });
});
it.skipIf(process.platform === 'win32')('rejects symlink inputs', async () => {
  const path = join(directory, 'input.png');
  await writeFile(path, Buffer.from(tinyPngBase64, 'base64'));
  const link = join(directory, 'link.png');
  await symlink(path, link);
  await expect(readInputImage(link)).rejects.toMatchObject({
    name: 'ImageValidationError',
  });
});
it('preserves filesystem failure causes', async () => {
  await expect(
    readInputImage(join(directory, 'missing.png')),
  ).rejects.toMatchObject({
    name: 'ImageValidationError',
    cause: { code: 'ENOENT' },
  });
});
it('rejects directories', async () => {
  await expect(readInputImage(directory)).rejects.toMatchObject({
    name: 'ImageValidationError',
    message: expect.stringContaining('not a regular file'),
  });
});
it('rejects oversized files', async () => {
  const path = join(directory, 'large.png');
  await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1));
  await expect(readInputImage(path)).rejects.toMatchObject({
    name: 'ImageValidationError',
    message: expect.stringContaining('maximum size'),
  });
});
