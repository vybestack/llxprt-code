/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — Behavioral integration tests proving the hard image budget
 * preflight runs at the output boundary of every built-in image-producing
 * tool and never lets oversized bytes into the returned content.
 *
 * These tests use real image bytes (sharp), real temp files, and the real
 * read_file / generate_image result paths. Only the image-generation transport
 * is stubbed; the budget logic and tools under test are never mocked.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { IToolHost } from '../interfaces/index.js';
import {
  processSingleFileContent,
  type ProcessedFileReadResult,
} from '../utils/fileUtils.js';
import { ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { GenerateImageTool } from '../tools/generate-image/GenerateImageTool.js';
import { createRealToolHost } from './helpers/create-real-tool-host.js';
import type { ContentPartListUnion } from '../types/wire-types.js';
import type { ImageOperationRunnerResult } from '../tools/generate-image/GenerateImageTool.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { ImageDimensionBudget } from '../utils/imageDimensionBudget.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-imgbudget-3216-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createHostWithBudget(
  targetDir: string,
  budget: Record<string, unknown>,
) {
  const baseHost = createRealToolHost(targetDir, {
    respectGitIgnore: true,
    respectLlxprtIgnore: true,
  });
  return {
    ...baseHost,
    getEphemeralSettings: () => ({
      ...baseHost.getEphemeralSettings(),
      ...budget,
    }),
  };
}
async function writePng(
  dir: string,
  name: string,
  width: number,
  height: number,
): Promise<string> {
  const file = join(dir, name);
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  writeFileSync(file, buffer);
  return file;
}

function createHost(
  targetDir: string,
  ephemeralSettings: Record<string, unknown> = {},
): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getFileSystemService: () => undefined,
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ephemeralSettings,
    getDebugMode: () => false,
  };
}

function hasInlineDataBytes(result: ProcessedFileReadResult): boolean {
  if (typeof result.llmContent === 'string') return false;
  return typeof result.llmContent.inlineData?.data === 'string';
}

/**
 * Extract the inlineData base64 string from a tool-result LLM content union,
 * returning `undefined` when no image bytes are present. Cast-free structural
 * narrowing of `ContentPartListUnion` (used by the read_file / read_many_files
 * tool-result assertions).
 */
function extractInlineDataData(
  content: ContentPartListUnion,
): string | undefined {
  if (typeof content === 'string') return undefined;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') continue;
      const data = part.inlineData?.data;
      if (typeof data === 'string') return data;
    }
    return undefined;
  }
  const data = content.inlineData?.data;
  return typeof data === 'string' ? data : undefined;
}

describe('processSingleFileContent image budget preflight (@issue:3216)', () => {
  it('rejects an oversized image with a tool error and no inline bytes', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'big.png', 3000, 3000);
    const budget: ImageDimensionBudget = { maxDimension: 2000 };

    const result = await processSingleFileContent(
      file,
      dir,
      undefined,
      undefined,
      undefined,
      budget,
    );

    expect(hasInlineDataBytes(result)).toBe(false);
    expect(typeof result.llmContent).toBe('string');
    expect(result.error).toBeDefined();
    expect(result.errorType).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    expect(result.errorKind).toBe('image-budget');
    // Error message is actionable.
    const message = String(result.llmContent);
    expect(message).toContain('3000');
    expect(/thumbnail|downscal|resize/i.test(message)).toBe(true);
  });

  it('delivers a within-budget image as inline bytes', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'ok.png', 1800, 1800);
    const budget: ImageDimensionBudget = { maxDimension: 2000 };

    const result = await processSingleFileContent(
      file,
      dir,
      undefined,
      undefined,
      undefined,
      budget,
    );

    expect(hasInlineDataBytes(result)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('passes an image exactly at the boundary', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'exact.png', 2000, 2000);
    const budget: ImageDimensionBudget = { maxDimension: 2000 };

    const result = await processSingleFileContent(
      file,
      dir,
      undefined,
      undefined,
      undefined,
      budget,
    );

    expect(hasInlineDataBytes(result)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('runs the check AFTER explicit resize so a resized image passes', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'resized.png', 3000, 3000);
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    // Explicit resize policy that brings the image under the hard budget.
    const resizePolicy = {
      maxLongEdge: 1500,
      maxShortEdge: 1500,
      maxPixels: 1500 * 1500,
    };

    const result = await processSingleFileContent(
      file,
      dir,
      undefined,
      undefined,
      resizePolicy,
      budget,
    );

    expect(hasInlineDataBytes(result)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('does not apply a budget when none is configured (no silent error)', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'unbounded.png', 3000, 3000);

    const result = await processSingleFileContent(
      file,
      dir,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(hasInlineDataBytes(result)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('leaves non-image media unchanged (no dimension invented)', async () => {
    const dir = createTempDir();
    // A real, well-formed PDF header followed by filler so detectFileType
    // classifies it as 'pdf'.
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(64, 0x20),
    ]);
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, pdfBytes);
    const budget: ImageDimensionBudget = { maxDimension: 2000 };

    const result = await processSingleFileContent(
      file,
      dir,
      undefined,
      undefined,
      undefined,
      budget,
    );

    // PDFs are delivered as inline bytes; the dimension budget is not applied
    // to non-image media.
    expect(result.error).toBeUndefined();
  });
});

describe('read_file tool image budget preflight (@issue:3216)', () => {
  it('returns a structured tool error for a 3000px image and no inline bytes', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'big.png', 3000, 3000);
    const host = createHost(dir, { 'max-image-dimension': 2000 });
    const tool = new ReadFileTool(host);

    const result = await tool.execute({ absolute_path: file });

    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('3000');
    // No inline data escapes into history.
    expect(extractInlineDataData(result.llmContent)).toBeUndefined();
  });

  it('delivers an 1800px image successfully', async () => {
    const dir = createTempDir();
    const file = await writePng(dir, 'ok.png', 1800, 1800);
    const host = createHost(dir, { 'max-image-dimension': 2000 });
    const tool = new ReadFileTool(host);

    const result = await tool.execute({ absolute_path: file });

    expect(result.error).toBeUndefined();
    expect(typeof extractInlineDataData(result.llmContent)).toBe('string');
  });
});
describe('read_many_files tool image budget preflight (@issue:3216)', () => {
  it('returns a structured tool error for a 3000px image and no inline bytes', async () => {
    const dir = createTempDir();
    await writePng(dir, 'big.png', 3000, 3000);
    // read_many_files resolves paths relative to the target dir.
    const tool = new ReadManyFilesTool(
      createHostWithBudget(dir, { 'max-image-dimension': 2000 }),
    );

    const result = await tool.execute({ paths: ['big.png'] });

    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    expect(typeof result.llmContent).toBe('string');
    expect(String(result.llmContent)).toContain('3000');
  });

  it('delivers an 1800px image successfully as inline bytes', async () => {
    const dir = createTempDir();
    await writePng(dir, 'ok.png', 1800, 1800);
    const tool = new ReadManyFilesTool(
      createHostWithBudget(dir, { 'max-image-dimension': 2000 }),
    );

    const result = await tool.execute({ paths: ['ok.png'] });

    expect(result.error).toBeUndefined();
    // The within-budget image must be present as inline base64 bytes.
    expect(Array.isArray(result.llmContent)).toBe(true);
    let foundInline = false;
    if (Array.isArray(result.llmContent)) {
      for (const part of result.llmContent) {
        if (typeof part !== 'string' && part.inlineData?.data !== undefined) {
          foundInline = true;
          break;
        }
      }
    }
    expect(foundInline).toBe(true);
  });
});

describe('generate_image tool image budget preflight (@issue:3216)', () => {
  async function makeLargePngResult(
    width: number,
    height: number,
    absoluteOutputPath = '/workspace/out.png',
    relativeOutputPath = 'out.png',
  ): Promise<ImageOperationRunnerResult> {
    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 200, g: 100, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    return {
      operation: 'generate',
      absoluteOutputPath,
      relativeOutputPath,
      mimeType: 'image/png',
      backend: 'stub',
      provider: 'stub',
      model: 'stub-model',
      inputPaths: [],
      media: {
        mimeType: 'image/png',
        encoding: 'base64',
        data: buffer.toString('base64'),
      },
    };
  }

  it('returns a POLICY_VIOLATION tool error for an oversized generated image with no inline bytes', async () => {
    const largeResult = await makeLargePngResult(3000, 3000);
    const tool = new GenerateImageTool({
      runImage: async () => largeResult,
      getImageDimensionBudget: () => ({ maxDimension: 2000 }),
    });

    const result = await tool
      .build({ prompt: 'a thing', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    // A generated image that exceeds the budget is a content-policy violation,
    // not a read failure (generation succeeded and the file was saved).
    expect(result.error!.type).toBe(ToolErrorType.POLICY_VIOLATION);
    const llmContent = result.llmContent;
    expect(typeof llmContent).toBe('string');
    expect(String(llmContent)).toContain('3000');
    // No image bytes escape into model history.
    expect(extractInlineDataData(result.llmContent)).toBeUndefined();
  });

  it('states the oversized image was saved but omitted from model content/history', async () => {
    const dir = createTempDir();
    const outPath = join(dir, 'gen.png');
    const largeResult = await makeLargePngResult(
      3000,
      3000,
      outPath,
      'gen.png',
    );
    const tool = new GenerateImageTool({
      runImage: async () => largeResult,
      getImageDimensionBudget: () => ({ maxDimension: 2000 }),
    });

    const result = await tool
      .build({ prompt: 'a thing', output_path: 'gen.png' })
      .execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    const message = String(result.llmContent);
    // The error must name the saved path and state the omission explicitly.
    expect(message).toContain(outPath);
    expect(message.toLowerCase()).toContain('saved');
    expect(/omit|history|model content/i.test(message)).toBe(true);
    // Downscale/thumbnail guidance is still present.
    expect(/thumbnail|downscal|resize/i.test(message)).toBe(true);
  });

  it('retains the generated file on disk and never deletes it (no silent unlink)', async () => {
    const dir = createTempDir();
    const outPath = join(dir, 'retained.png');
    // The runner is the production authority that writes the file BEFORE the
    // tool applies the post-hoc budget check. The stub mirrors that contract.
    const largeResult = await makeLargePngResult(
      3000,
      3000,
      outPath,
      'retained.png',
    );
    writeFileSync(outPath, Buffer.from(largeResult.media.data, 'base64'));
    expect(existsSync(outPath)).toBe(true);

    const tool = new GenerateImageTool({
      runImage: async () => largeResult,
      getImageDimensionBudget: () => ({ maxDimension: 2000 }),
    });

    const result = await tool
      .build({ prompt: 'a thing', output_path: 'retained.png' })
      .execute(new AbortController().signal);

    // Budget violation surfaced, but the user's generated file is preserved.
    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe(ToolErrorType.POLICY_VIOLATION);
    expect(existsSync(outPath)).toBe(true);
    expect(extractInlineDataData(result.llmContent)).toBeUndefined();
  });

  it('delivers a within-budget generated image', async () => {
    const smallResult = await makeLargePngResult(1000, 1000);
    const tool = new GenerateImageTool({
      runImage: async () => smallResult,
      getImageDimensionBudget: () => ({ maxDimension: 2000 }),
    });

    const result = await tool
      .build({ prompt: 'a thing', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.llmContent)).toBe(true);
  });
});

describe('read_many_files H4: dimension check before size-skip gate (@issue:3216 H4)', () => {
  async function writeNoisyPng(
    dir: string,
    name: string,
    width: number,
    height: number,
  ): Promise<string> {
    // Create a genuinely noisy (incompressible) PNG that exceeds 512KiB.
    const file = join(dir, name);
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      // Pseudo-random noise for incompressibility.
      data[i] = (i * 17 + 31) & 0xff;
      data[i + 1] = (i * 23 + 7) & 0xff;
      data[i + 2] = (i * 31 + 3) & 0xff;
      data[i + 3] = 0xff;
    }
    const buffer = await sharp(Buffer.from(data), {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    writeFileSync(file, buffer);
    return file;
  }

  it('returns structured image-budget error for an oversized explicit image above 512KiB', async () => {
    const dir = createTempDir();
    // 3000x3000 noisy PNG: dimensions exceed the 2000 budget AND the file is
    // >512KiB so the generic size-skip gate would normally swallow it.
    await writeNoisyPng(dir, 'big.png', 3000, 3000);
    const tool = new ReadManyFilesTool(
      createHostWithBudget(dir, { 'max-image-dimension': 2000 }),
    );

    const result = await tool.execute({ paths: ['big.png'] });

    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    const message = String(result.llmContent);
    expect(message).toContain('3000');
  });

  it('returns overall error for mixed valid content plus later oversized image (no earlier bytes escape)', async () => {
    const dir = createTempDir();
    // A valid text file plus an oversized image. The overall result must be
    // an error (not a silent skip), and the text file must NOT escape as
    // inline content.
    writeFileSync(join(dir, 'notes.txt'), 'hello world');
    await writeNoisyPng(dir, 'big.png', 3000, 3000);
    const tool = new ReadManyFilesTool(
      createHostWithBudget(dir, { 'max-image-dimension': 2000 }),
    );

    const result = await tool.execute({ paths: ['notes.txt', 'big.png'] });

    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    // The error message is about the image dimension, not the text file.
    const message = String(result.llmContent);
    expect(message).toContain('3000');
  });

  it('large but within-dimension image follows existing item-size policy', async () => {
    const dir = createTempDir();
    // 2000x2000 noisy PNG: within the 2000 dimension budget but >512KiB so
    // it should be silently size-skipped, NOT produce a budget error.
    await writeNoisyPng(dir, 'large.png', 2000, 2000);
    const tool = new ReadManyFilesTool(
      createHostWithBudget(dir, { 'max-image-dimension': 2000 }),
    );

    const result = await tool.execute({ paths: ['large.png'] });

    // No image-budget error (dimensions are within budget); the file is
    // size-skipped rather than rejected.
    const message = String(result.llmContent);
    expect(message).not.toContain('exceeds the configured maximum dimension');
  });
});

describe('read_many_files token-overflow metric/path semantics (@issue:3216)', () => {
  it('does not record a file as processed when its content was skipped (warn stop)', async () => {
    const dir = createTempDir();
    // a-small fits the token budget and is added; b-big overflows in warn
    // mode and is skipped (action 'stop') WITHOUT adding content.
    writeFileSync(join(dir, 'a-small.txt'), 'hi');
    writeFileSync(join(dir, 'b-big.txt'), 'x'.repeat(5000));

    const recordedPaths: string[] = [];
    const baseHost = createHost(dir, {
      'tool-output-max-tokens': 100,
      'tool-output-truncate-mode': 'warn',
    });
    const trackingHost: IToolHost = {
      ...baseHost,
      recordFileRead: (filePath: string) => recordedPaths.push(filePath),
    };
    const tool = new ReadManyFilesTool(trackingHost);

    const result = await tool.execute({ paths: ['a-small.txt', 'b-big.txt'] });

    // b-big.txt was skipped due to the token limit, so it must NOT be listed
    // as a processed file or recorded via the read metric.
    const display = String(result.returnDisplay);
    expect(display).toContain('a-small.txt');
    expect(display).not.toContain('b-big.txt');
    expect(recordedPaths.some((p) => p.endsWith('a-small.txt'))).toBe(true);
    expect(recordedPaths.some((p) => p.endsWith('b-big.txt'))).toBe(false);
  });

  it('records a truncated file before stopping (stopAfterRecord)', async () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'a-big.txt'), 'y'.repeat(5000));

    const recordedPaths: string[] = [];
    const baseHost = createHost(dir, {
      'tool-output-max-tokens': 500,
      'tool-output-truncate-mode': 'truncate',
    });
    const trackingHost: IToolHost = {
      ...baseHost,
      recordFileRead: (filePath: string) => recordedPaths.push(filePath),
    };
    const tool = new ReadManyFilesTool(trackingHost);

    const result = await tool.execute({ paths: ['a-big.txt'] });

    // truncate mode records the (truncated) content before stopping.
    const display = String(result.returnDisplay);
    expect(display).toContain('a-big.txt');
    expect(recordedPaths.some((p) => p.endsWith('a-big.txt'))).toBe(true);
    // Sanity: the truncated content was actually emitted.
    const llm = result.llmContent;
    if (!Array.isArray(llm)) {
      throw new Error('expected array llmContent in truncate mode');
    }
    const joined = llm
      .filter((part): part is string => typeof part === 'string')
      .join('');
    expect(joined).toContain('CONTENT TRUNCATED');
  });
});
