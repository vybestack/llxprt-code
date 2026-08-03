/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createRealToolHost as createRealHost } from './helpers/create-real-tool-host.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-read-many-files-behavior-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function stringifyLlmContent(result: ToolResult): string {
  return Array.isArray(result.llmContent)
    ? result.llmContent
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('\n')
    : String(result.llmContent);
}
function findInlineImage(result: ToolResult): Buffer {
  if (!Array.isArray(result.llmContent)) {
    throw new Error('Expected multipart read-many-files content');
  }
  for (const part of result.llmContent) {
    if (typeof part !== 'string' && part.inlineData?.data !== undefined) {
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }
  throw new Error('Expected inline image data');
}
function createHostWithSettings(
  targetDir: string,
  settings: Readonly<Record<string, unknown>>,
) {
  const baseHost = createRealHost(targetDir, {
    respectGitIgnore: true,
    respectLlxprtIgnore: true,
  });
  return {
    ...baseHost,
    getEphemeralSettings: () => ({
      ...baseHost.getEphemeralSettings(),
      ...settings,
    }),
  };
}

describe('ReadManyFilesTool real behavioral filtering', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;

    mkdirSync(join(tempDir, '.git'), { recursive: true });
    mkdirSync(join(tempDir, 'secrets'), { recursive: true });
    writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
    writeFileSync(join(tempDir, '.llxprtignore'), 'secrets/\n');
    writeFileSync(join(tempDir, 'debug.log'), 'log content', 'utf-8');
    writeFileSync(join(tempDir, 'keep.txt'), 'visible content', 'utf-8');
    writeFileSync(
      join(tempDir, 'secrets', 'key.txt'),
      'secret content',
      'utf-8',
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('both flags true filters both gitignored and llxprtignored files', async () => {
    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({ paths: ['**/*.txt', '**/*.log'] });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    expect(content).not.toContain('secret content');
    expect(content).not.toContain('log content');
  });

  it('respect_git_ignore false keeps gitignored files but still filters llxprtignored files', async () => {
    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({
      paths: ['**/*.txt', '**/*.log'],
      file_filtering_options: { respect_git_ignore: false },
    });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    expect(content).not.toContain('secret content');
    expect(content).toContain('log content');
  });

  it('respect_llxprt_ignore false keeps llxprtignored files but still filters gitignored files', async () => {
    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({
      paths: ['**/*.txt', '**/*.log'],
      file_filtering_options: { respect_llxprt_ignore: false },
    });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    expect(content).toContain('secret content');
    expect(content).not.toContain('log content');
  });

  it('both flags false keeps gitignored and llxprtignored files', async () => {
    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({
      paths: ['**/*.txt', '**/*.log'],
      file_filtering_options: {
        respect_git_ignore: false,
        respect_llxprt_ignore: false,
      },
    });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    expect(content).toContain('secret content');
    expect(content).toContain('log content');
  });

  it('allows .llxprtignore negation to un-ignore a gitignored file', async () => {
    writeFileSync(join(tempDir, '.gitignore'), '*.txt\n');
    writeFileSync(join(tempDir, '.llxprtignore'), '!keep.txt\n');

    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({ paths: ['**/*.txt'] });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    // The broad .gitignore rule still excludes other .txt files; this assertion
    // keeps the focus on keep.txt being restored by the .llxprtignore negation.
    expect(content).not.toContain('secret content');
  });

  it('resizes explicitly requested images through the shared media path', async () => {
    const filePath = join(tempDir, 'large.png');
    const original = await sharp({
      create: {
        width: 240,
        height: 120,
        channels: 3,
        background: { r: 45, g: 90, b: 135 },
      },
    })
      .png()
      .toBuffer();
    writeFileSync(filePath, original);
    const host = createHostWithSettings(tempDir, {
      'image-resize.maxLongEdge': 120,
    });

    const result = await new ReadManyFilesTool(host).execute({
      paths: ['large.png'],
    });
    const metadata = await sharp(findInlineImage(result)).metadata();

    expect(metadata.autoOrient).toEqual({ width: 120, height: 60 });
  });

  it('preserves image bytes when no resize limit is configured', async () => {
    const filePath = join(tempDir, 'legacy.png');
    const original = await sharp({
      create: {
        width: 240,
        height: 120,
        channels: 3,
        background: { r: 135, g: 90, b: 45 },
      },
    })
      .png()
      .toBuffer();
    writeFileSync(filePath, original);
    const host = createRealHost(tempDir, {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    });

    const result = await new ReadManyFilesTool(host).execute({
      paths: ['legacy.png'],
    });

    expect(findInlineImage(result)).toEqual(original);
  });

  it('resizes an explicitly requested noisy image before enforcing returned-byte limits', async () => {
    const filePath = join(tempDir, 'noisy.png');
    const original = await sharp(randomBytes(900 * 700 * 3), {
      raw: { width: 900, height: 700, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(original.byteLength).toBeGreaterThan(512 * 1024);
    writeFileSync(filePath, original);
    const host = createHostWithSettings(tempDir, {
      'image-resize.maxLongEdge': 64,
      'tool-output-item-size-limit': 512 * 1024,
    });

    const result = await new ReadManyFilesTool(host).execute({
      paths: ['noisy.png'],
    });
    const resized = findInlineImage(result);

    expect(result.error).toBeUndefined();
    expect(resized.byteLength).toBeLessThanOrEqual(512 * 1024);
    expect((await sharp(resized).metadata()).width).toBeLessThanOrEqual(64);
  });

  it('returns a clear ToolResult error for malformed resize settings', async () => {
    const host = createHostWithSettings(tempDir, {
      'image-resize.maxLongEdge': 0,
    });

    const result = await new ReadManyFilesTool(host).execute({
      paths: ['keep.txt'],
    });

    expect(result.error).toMatchObject({
      message: expect.stringContaining(
        'image-resize.maxLongEdge must be a positive integer',
      ),
    });
    expect(result.returnDisplay).toContain('Image Resize Error');
  });

  it.each([
    {
      name: 'corrupt',
      extension: 'png',
      create: async () =>
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02,
          0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
        ]),
    },
    {
      name: 'unsupported',
      extension: 'tiff',
      create: async () =>
        sharp({
          create: {
            width: 200,
            height: 100,
            channels: 3,
            background: { r: 20, g: 40, b: 60 },
          },
        })
          .tiff()
          .toBuffer(),
    },
  ])(
    'returns a clear ToolResult error for $name image resizing',
    async (fixture) => {
      const fileName = `${fixture.name}.${fixture.extension}`;
      writeFileSync(join(tempDir, fileName), await fixture.create());
      const host = createHostWithSettings(tempDir, {
        'image-resize.maxLongEdge': 50,
      });

      const result = await new ReadManyFilesTool(host).execute({
        paths: [fileName],
      });

      expect(result.error).toMatchObject({
        message: expect.stringContaining(`Unable to resize image ${fileName}`),
      });
      expect(result.returnDisplay).toContain('Image Resize Error');
    },
  );

  it('skips an image whose estimate exceeds tool-output-max-tokens under the new estimator', async () => {
    // A 1092x1092 PNG under the default family costs 1000 tokens — well above
    // the old hardcoded 85. Set a token budget that the old 85 would have passed
    // but the new 1000 does not.
    const filePath = join(tempDir, 'big.png');
    const original = await sharp({
      create: {
        width: 1092,
        height: 1092,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();
    writeFileSync(filePath, original);
    const host = createHostWithSettings(tempDir, {
      'tool-output-max-tokens': 100,
    });

    const result = await new ReadManyFilesTool(host).execute({
      paths: ['big.png'],
    });

    // The image must be skipped — the new estimate (1000) exceeds the 100
    // budget, whereas the old 85 would have been admitted.
    expect(result.returnDisplay).toContain('would exceed token limit');
    expect(result.returnDisplay).toContain('big.png');
  });

  it('reflects the new image token estimate in the reported total', async () => {
    // A small image (10x10) under the default family still costs 1000 tokens
    // (the default flat estimate). With a generous budget the image is
    // admitted and the reported total reflects the new estimator, not 85.
    const filePath = join(tempDir, 'small.png');
    const original = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .png()
      .toBuffer();
    writeFileSync(filePath, original);
    const host = createHostWithSettings(tempDir, {
      'tool-output-max-tokens': 50000,
    });

    const result = await new ReadManyFilesTool(host).execute({
      paths: ['small.png'],
    });

    expect(result.error).toBeUndefined();
    // The default-family estimate for any image is 1000 tokens.
    expect(result.returnDisplay).toContain('1,000 tokens');
  });
});
