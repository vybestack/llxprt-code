/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';

import * as actualNodeFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import mime from 'mime-types';

import { detectFileType } from './fileUtils.js';

vi.mock('mime-types', () => ({
  default: { lookup: vi.fn() },
  lookup: vi.fn(),
}));

const mockMimeLookup = mime.lookup as Mock;

describe('fileUtils.detectFileType', () => {
  let tempRootDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempRootDir = actualNodeFs.mkdtempSync(
      path.join(os.tmpdir(), 'tools-fileUtils-test-'),
    );
  });

  afterEach(() => {
    try {
      if (actualNodeFs.existsSync(tempRootDir)) {
        actualNodeFs.rmSync(tempRootDir, { recursive: true, force: true });
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('should detect typescript extensions as text (ts, mts, cts, tsx)', async () => {
    expect(await detectFileType('file.ts')).toBe('text');
    expect(await detectFileType('file.mts')).toBe('text');
    expect(await detectFileType('file.cts')).toBe('text');
    expect(await detectFileType('component.tsx')).toBe('text');
  });

  it('should detect svg by extension', async () => {
    expect(await detectFileType('image.svg')).toBe('svg');
    expect(await detectFileType('image.icon.svg')).toBe('svg');
  });

  it.each([
    { ext: '.fh', file: 'shader.fh' },
    { ext: '.fh4', file: 'shader.fh4' },
    { ext: '.fh5', file: 'shader.fh5' },
    { ext: '.fh7', file: 'shader.fh7' },
    { ext: '.fhc', file: 'shader.fhc' },
  ])(
    'should classify text $ext as text, not image, despite image/x-freehand mime (#2719)',
    async ({ file }) => {
      const fhPath = path.join(tempRootDir, file);
      actualNodeFs.writeFileSync(fhPath, '// fragment shader text\n');
      mockMimeLookup.mockReturnValueOnce('image/x-freehand');
      expect(await detectFileType(fhPath)).toBe('text');
    },
  );

  it('should classify binary .fh content as binary, not image (#2719)', async () => {
    const fhPath = path.join(tempRootDir, 'binary.fh');
    actualNodeFs.writeFileSync(
      fhPath,
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    );
    mockMimeLookup.mockReturnValueOnce('image/x-freehand');
    expect(await detectFileType(fhPath)).toBe('binary');
  });

  it.each([
    { type: 'image', file: 'file.png', mime: 'image/png' },
    { type: 'pdf', file: 'file.pdf', mime: 'application/pdf' },
    { type: 'audio', file: 'song.mp3', mime: 'audio/mpeg' },
    { type: 'video', file: 'movie.mp4', mime: 'video/mp4' },
  ])(
    'should detect $type type for $file by mime',
    async ({ file, mime: mimeType, type }) => {
      mockMimeLookup.mockReturnValueOnce(mimeType);
      expect(await detectFileType(file)).toBe(type);
    },
  );

  it('should default to text if mime is unknown and content is not binary', async () => {
    mockMimeLookup.mockReturnValueOnce(false);
    const textPath = path.join(tempRootDir, 'unknown.xyz');
    actualNodeFs.writeFileSync(textPath, 'plain text content\n');
    expect(await detectFileType(textPath)).toBe('text');
  });
});
