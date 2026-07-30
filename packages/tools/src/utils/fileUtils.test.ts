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

import sharp from 'sharp';
import { detectFileType, processSingleFileContent } from './fileUtils.js';

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

describe('processSingleFileContent media displayName @issue:2608', () => {
  let tempRootDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempRootDir = actualNodeFs.mkdtempSync(
      path.join(os.tmpdir(), 'tools-fileUtils-pdf-test-'),
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

  it('preserves the source basename as inlineData.displayName for a PDF', async () => {
    mockMimeLookup.mockReturnValue('application/pdf');
    const pdfPath = path.join(tempRootDir, 'sub', 'quarterly-report.pdf');
    actualNodeFs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    actualNodeFs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n%bin\n'));

    const result = await processSingleFileContent(pdfPath, tempRootDir);

    expect(result.llmContent).toMatchObject({
      inlineData: expect.objectContaining({
        displayName: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
      }),
    });
  });
});

describe('processSingleFileContent image resizing', () => {
  let tempRootDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempRootDir = actualNodeFs.mkdtempSync(
      path.join(os.tmpdir(), 'tools-fileUtils-image-test-'),
    );
    mockMimeLookup.mockReturnValue('image/png');
  });

  afterEach(() => {
    actualNodeFs.rmSync(tempRootDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('resizes real image bytes through the shared media path', async () => {
    const imagePath = path.join(tempRootDir, 'large.png');
    const original = await sharp({
      create: {
        width: 240,
        height: 120,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .png()
      .toBuffer();
    actualNodeFs.writeFileSync(imagePath, original);

    const result = await processSingleFileContent(
      imagePath,
      tempRootDir,
      undefined,
      undefined,
      { maxLongEdge: 120 },
    );
    if (typeof result.llmContent === 'string') {
      throw new Error(result.llmContent);
    }
    const resized = Buffer.from(
      result.llmContent.inlineData?.data ?? '',
      'base64',
    );
    const metadata = await sharp(resized).metadata();

    expect(metadata.autoOrient).toEqual({ width: 120, height: 60 });
    expect(result.llmContent.inlineData?.mimeType).toBe('image/png');
    expect(result.llmContent.inlineData?.displayName).toBe('large.png');
  });

  it('keeps compliant image bytes unchanged through the shared media path', async () => {
    const imagePath = path.join(tempRootDir, 'small.png');
    const original = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .png()
      .toBuffer();
    actualNodeFs.writeFileSync(imagePath, original);

    const result = await processSingleFileContent(
      imagePath,
      tempRootDir,
      undefined,
      undefined,
      { maxLongEdge: 120 },
    );
    if (typeof result.llmContent === 'string') {
      throw new Error(result.llmContent);
    }

    expect(
      Buffer.from(result.llmContent.inlineData?.data ?? '', 'base64'),
    ).toEqual(original);
  });

  it('does not apply image policy to SVG or other media', async () => {
    const svgPath = path.join(tempRootDir, 'diagram.svg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>';
    actualNodeFs.writeFileSync(svgPath, svg);

    const result = await processSingleFileContent(
      svgPath,
      tempRootDir,
      undefined,
      undefined,
      { maxLongEdge: 1 },
    );

    expect(result.llmContent).toBe(svg);
  });

  it('preserves a structured image-resize failure', async () => {
    const imagePath = path.join(tempRootDir, 'corrupt.png');
    actualNodeFs.writeFileSync(imagePath, Buffer.from('corrupt image bytes'));

    const result = await processSingleFileContent(
      imagePath,
      tempRootDir,
      undefined,
      undefined,
      { maxLongEdge: 1 },
    );

    expect(result).toMatchObject({
      errorKind: 'image-resize',
      error: expect.stringContaining('Unable to resize image corrupt.png'),
    });
  });
});
