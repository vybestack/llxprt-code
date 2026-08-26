/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';

import * as actualNodeFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import sharp from 'sharp';
import { detectFileType, processSingleFileContent } from './fileUtils.js';

function textOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

type ProcessedFileResult = Awaited<ReturnType<typeof processSingleFileContent>>;
type InlineFileResult = ProcessedFileResult & {
  readonly llmContent: Exclude<ProcessedFileResult['llmContent'], string>;
};

function requireInlineFileResult(
  result: ProcessedFileResult,
): asserts result is InlineFileResult {
  if (typeof result.llmContent === 'string') {
    throw new Error(result.llmContent);
  }
}

const mockMimeLookup = vi.fn<(filename: string) => string | false>();

void vi.mock('mime-types', () => ({
  default: { lookup: mockMimeLookup },
  lookup: mockMimeLookup,
}));

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

  // --- Content-signature verification for media classification (#2723) ---

  it.each([
    {
      label: 'png',
      file: 'file.png',
      mime: 'image/png',
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    {
      label: 'jpeg',
      file: 'file.jpg',
      mime: 'image/jpeg',
      content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    },
    {
      label: 'gif',
      file: 'file.gif',
      mime: 'image/gif',
      content: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    },
    {
      label: 'webp',
      file: 'file.webp',
      mime: 'image/webp',
      content: Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x1c, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
    },
    {
      label: 'bmp',
      file: 'file.bmp',
      mime: 'image/bmp',
      content: Buffer.from([0x42, 0x4d, 0x00, 0x00]),
    },
    {
      label: 'heic',
      file: 'photo.heic',
      mime: 'image/heic',
      content: Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      ]),
    },
  ])(
    'should classify real $label image as image when signature verifies (#2723)',
    async ({ file, mime: mimeType, content }) => {
      const filePath = path.join(tempRootDir, file);
      actualNodeFs.writeFileSync(filePath, content);
      mockMimeLookup.mockReturnValueOnce(mimeType);
      expect(await detectFileType(filePath)).toBe('image');
    },
  );

  it.each([
    {
      label: 'mp3',
      file: 'song.mp3',
      mime: 'audio/mpeg',
      content: Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]),
    },
    {
      label: 'wav',
      file: 'sound.wav',
      mime: 'audio/wav',
      content: Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]),
    },
    {
      label: 'flac',
      file: 'audio.flac',
      mime: 'audio/flac',
      content: Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00]),
    },
    {
      label: 'ogg',
      file: 'audio.ogg',
      mime: 'audio/ogg',
      content: Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00]),
    },
    {
      label: 'm4a',
      file: 'track.m4a',
      mime: 'audio/mp4',
      content: Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
      ]),
    },
  ])(
    'should classify real $label audio as audio when signature verifies (#2723)',
    async ({ file, mime: mimeType, content }) => {
      const filePath = path.join(tempRootDir, file);
      actualNodeFs.writeFileSync(filePath, content);
      mockMimeLookup.mockReturnValueOnce(mimeType);
      expect(await detectFileType(filePath)).toBe('audio');
    },
  );

  it.each([
    {
      label: 'mp4',
      file: 'movie.mp4',
      mime: 'video/mp4',
      content: Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]),
    },
    {
      label: 'avi',
      file: 'clip.avi',
      mime: 'video/x-msvideo',
      content: Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
      ]),
    },
    {
      label: 'webm',
      file: 'video.webm',
      mime: 'video/webm',
      content: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]),
    },
    {
      label: 'mpegts',
      file: 'movie.m2ts',
      mime: 'video/mp2t',
      content: (() => {
        const buf = Buffer.alloc(189, 0x10);
        buf[0] = 0x47;
        buf[188] = 0x47;
        return buf;
      })(),
    },
  ])(
    'should classify real $label video as video when signature verifies (#2723)',
    async ({ file, mime: mimeType, content }) => {
      const filePath = path.join(tempRootDir, file);
      actualNodeFs.writeFileSync(filePath, content);
      mockMimeLookup.mockReturnValueOnce(mimeType);
      expect(await detectFileType(filePath)).toBe('video');
    },
  );

  it('should classify real pdf as pdf when signature verifies (#2723)', async () => {
    const filePath = path.join(tempRootDir, 'document.pdf');
    actualNodeFs.writeFileSync(
      filePath,
      Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]),
    );
    mockMimeLookup.mockReturnValueOnce('application/pdf');
    expect(await detectFileType(filePath)).toBe('pdf');
  });

  it.each([
    { label: 'image', file: 'shader.png', mime: 'image/png' },
    { label: 'audio', file: 'config.mp3', mime: 'audio/mpeg' },
    { label: 'video', file: 'data.mp4', mime: 'video/mp4' },
    { label: 'pdf', file: 'notes.pdf', mime: 'application/pdf' },
  ])(
    'should reclassify text content with $label mime as text, not media (#2723)',
    async ({ file, mime: mimeType }) => {
      const filePath = path.join(tempRootDir, file);
      actualNodeFs.writeFileSync(filePath, 'console.log("hello world");');
      mockMimeLookup.mockReturnValueOnce(mimeType);
      expect(await detectFileType(filePath)).toBe('text');
    },
  );

  it('should classify binary content with unverified signature as binary (#2723)', async () => {
    const filePath = path.join(tempRootDir, 'mystery.png');
    actualNodeFs.writeFileSync(
      filePath,
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]),
    );
    mockMimeLookup.mockReturnValueOnce('image/png');
    expect(await detectFileType(filePath)).toBe('binary');
  });

  it('should reject partial RIFF match (AND semantics) as non-media text (#2723)', async () => {
    const filePath = path.join(tempRootDir, 'fake.webp');
    actualNodeFs.writeFileSync(
      filePath,
      Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x41, 0x42, 0x43, 0x44, 0x58, 0x58, 0x58, 0x58,
      ]),
    );
    mockMimeLookup.mockReturnValueOnce('image/webp');
    expect(await detectFileType(filePath)).toBe('text');
  });

  it('should fall through to text for non-existent file with media mime (#2723)', async () => {
    const filePath = path.join(tempRootDir, 'nonexistent.png');
    mockMimeLookup.mockReturnValueOnce('image/png');
    expect(await detectFileType(filePath)).toBe('text');
  });

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

  const observeResizesRealImageBytesThroughTheSharedMediaPathAt337 =
    async () => {
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
      requireInlineFileResult(result);
      const resized = Buffer.from(
        result.llmContent.inlineData?.data ?? '',
        'base64',
      );
      const metadata = await sharp(resized).metadata();
      return { result, metadata };
    };

  it('resizes real image bytes through the shared media path', async () => {
    const { result, metadata } =
      await observeResizesRealImageBytesThroughTheSharedMediaPathAt337();
    expect(metadata.autoOrient).toStrictEqual({ width: 120, height: 60 });
    expect(result.llmContent.inlineData?.mimeType).toBe('image/png');
    expect(result.llmContent.inlineData?.displayName).toBe('large.png');
  });

  const observeKeepsCompliantImageBytesUnchangedThroughTheSharedMediaPathAt372 =
    async () => {
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
      requireInlineFileResult(result);
      return { original, result };
    };

  it('keeps compliant image bytes unchanged through the shared media path', async () => {
    const { original, result } =
      await observeKeepsCompliantImageBytesUnchangedThroughTheSharedMediaPathAt372();
    expect(
      Buffer.from(textOrEmpty(result.llmContent.inlineData?.data), 'base64'),
    ).toStrictEqual(original);
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
    actualNodeFs.writeFileSync(
      imagePath,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
        0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
      ]),
    );

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
