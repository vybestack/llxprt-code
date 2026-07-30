/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD, REQ-TEST-FIXTURE-COUPLING
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filesystem Tool Group Behavioral Tests
 *
 * Verifies observable behavior of filesystem tools (Read, Write, Edit,
 * etc.) through injected service interfaces. Tests use infrastructure
 * fakes (temp directory, in-memory services) but assert on ToolResult
 * content, filesystem state, and provider output — NOT method calls.
 *
 * STATUS: RED — These tests compile (GREEN for typecheck) but will
 * fail at runtime until P11 moves real tool code into packages/tools
 * and adapters are wired up. Stub runtime behavior causes
 * EXPECTED_BEHAVIORAL_RED failures.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { IToolHost, IStorageService } from '../interfaces/index.js';
import {
  DeleteLineRangeTool,
  GlobTool,
  GrepTool,
  InsertAtLineTool,
  LSTool,
  ReadFileTool,
  ReadLineRangeTool,
  RipGrepTool,
  WriteFileTool,
} from '../index.js';
import {
  READ_FILE_FIXTURE,
  WRITE_FILE_FIXTURE,
  GLOB_FIXTURE,
} from './fixtures/filesystem-tool-fixtures.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';
import type { ToolResult } from '../index.js';

/**
 * Create a temp directory for filesystem tests.
 * Returns the directory path and a cleanup function.
 */
function createTempDir(prefix = 'llxprt-fs-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
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

/**
 * Minimal structural fake for IToolHost providing a temp directory.
 */
function _createFakeFileHost(
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
    getEphemeralSettings: () => ({ ...ephemeralSettings }),
    getDebugMode: () => false,
  };
}

function createGrepHost(
  targetDir: string,
  options: {
    respectGitIgnore: boolean;
    respectLlxprtIgnore: boolean;
    llxprtIgnoreFilePath: string | null;
  },
): IToolHost {
  return {
    ..._createFakeFileHost(targetDir),
    getFileFilteringOptions: () => ({
      respectGitIgnore: options.respectGitIgnore,
      respectLlxprtIgnore: options.respectLlxprtIgnore,
    }),
    getLlxprtIgnoreFilePath: () => options.llxprtIgnoreFilePath,
  };
}

/**
 * Minimal structural fake for IStorageService using real filesystem.
 */
function _createFakeStorageService(baseDir: string): IStorageService {
  return {
    getGlobalMemoryDir: () => baseDir,
    getGlobalDataDir: () => baseDir,
    readFile: async (path: string) => readFileSync(path, 'utf-8'),
    writeFile: async (path: string, content: string) =>
      writeFileSync(path, content, 'utf-8'),
    ensureDir: async (path: string) => mkdirSync(path, { recursive: true }),
  };
}

async function executeDeclarativeToolForBehavioralAssertion(
  tool: {
    build(params: unknown): {
      execute(signal: AbortSignal): Promise<ToolResult>;
    };
  },
  params: unknown,
): Promise<ToolResult> {
  try {
    return await tool.build(params).execute(new AbortController().signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      llmContent: '',
      returnDisplay: '',
      error: { message },
    };
  }
}

function readInlineImage(result: ToolResult): {
  data: Buffer;
  mimeType: string | undefined;
  displayName: string | undefined;
} {
  if (typeof result.llmContent === 'string') {
    throw new Error(result.llmContent);
  }
  const inlineData = result.llmContent.inlineData;
  if (inlineData?.data === undefined) {
    throw new Error('Expected inline image data');
  }
  return {
    data: Buffer.from(inlineData.data, 'base64'),
    mimeType: inlineData.mimeType,
    displayName: inlineData.displayName,
  };
}

async function createPngFixture(
  targetDir: string,
  fileName: string,
  background: { r: number; g: number; b: number },
): Promise<{ filePath: string; original: Buffer }> {
  const filePath = join(targetDir, fileName);
  const original = await sharp({
    create: { width: 240, height: 120, channels: 3, background },
  })
    .png()
    .toBuffer();
  writeFileSync(filePath, original);
  return { filePath, original };
}

describe('Filesystem Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('ReadFileTool behavioral contract', () => {
    it('reads a temp file and returns content with correct ToolResult.llmContent', async () => {
      // Write a real temp file
      const filePath = join(tempDir, 'read-test.txt');

      writeFileSync(filePath, READ_FILE_FIXTURE.exampleContent, 'utf-8');

      // Assert: File was written successfully (observable filesystem state)
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe(
        READ_FILE_FIXTURE.exampleContent,
      );

      const tool = new ReadFileTool(_createFakeFileHost(tempDir));
      const result = await executeToolForBehavioralAssertion(tool, {
        file_path: filePath,
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(READ_FILE_FIXTURE.exampleContent);
      expect(result.returnDisplay).toContain(READ_FILE_FIXTURE.exampleContent);
    });

    it('returns error ToolResult when reading a nonexistent file', async () => {
      const nonexistentPath = join(tempDir, 'does-not-exist.txt');
      expect(existsSync(nonexistentPath)).toBe(false);

      const result = await executeToolForBehavioralAssertion(
        new ReadFileTool(_createFakeFileHost(tempDir)),
        { file_path: nonexistentPath },
      );

      expect(result.error).toContain('does-not-exist.txt');
      expect(result.llmContent).toContain('does-not-exist.txt');
    });

    it('resizes an oversized image according to effective profile limits', async () => {
      const { filePath } = await createPngFixture(tempDir, 'oversized.png', {
        r: 90,
        g: 120,
        b: 150,
      });
      const tool = new ReadFileTool(
        _createFakeFileHost(tempDir, {
          'image-resize.maxLongEdge': 120,
        }),
      );

      const result = await executeToolForBehavioralAssertion(tool, {
        file_path: filePath,
      });
      const image = readInlineImage(result);
      const metadata = await sharp(image.data).metadata();

      expect(metadata.autoOrient).toEqual({ width: 120, height: 60 });
      expect(image.mimeType).toBe('image/png');
      expect(image.displayName).toBe('oversized.png');
    });

    it('preserves original bytes when profile resizing is explicitly disabled', async () => {
      const { filePath, original } = await createPngFixture(
        tempDir,
        'disabled.png',
        { r: 120, g: 90, b: 60 },
      );
      const tool = new ReadFileTool(
        _createFakeFileHost(tempDir, {
          'image-resize.enabled': false,
          'image-resize.maxLongEdge': 120,
        }),
      );

      const result = await executeToolForBehavioralAssertion(tool, {
        file_path: filePath,
      });

      expect(readInlineImage(result).data).toEqual(original);
    });

    it('exposes and honors skip_image_resize for a single image read', async () => {
      const { filePath, original } = await createPngFixture(
        tempDir,
        'original.png',
        { r: 30, g: 60, b: 90 },
      );
      const tool = new ReadFileTool(
        _createFakeFileHost(tempDir, {
          'image-resize.maxLongEdge': 120,
        }),
      );

      expect(tool.schema.parametersJsonSchema).toMatchObject({
        properties: {
          skip_image_resize: { type: 'boolean' },
        },
      });
      const result = await executeToolForBehavioralAssertion(tool, {
        file_path: filePath,
        skip_image_resize: true,
      });

      expect(readInlineImage(result).data).toEqual(original);
    });

    it('preserves exact image bytes when no resize policy is configured', async () => {
      const { filePath, original } = await createPngFixture(
        tempDir,
        'absent-policy.png',
        { r: 15, g: 45, b: 75 },
      );

      const result = await executeToolForBehavioralAssertion(
        new ReadFileTool(_createFakeFileHost(tempDir)),
        { file_path: filePath },
      );

      expect(readInlineImage(result).data).toEqual(original);
    });

    it('returns a clear error for malformed image resize settings', async () => {
      const { filePath } = await createPngFixture(
        tempDir,
        'invalid-policy.png',
        {
          r: 15,
          g: 30,
          b: 45,
        },
      );
      const tool = new ReadFileTool(
        _createFakeFileHost(tempDir, {
          'image-resize.maxLongEdge': 0,
        }),
      );

      const result = await executeToolForBehavioralAssertion(tool, {
        file_path: filePath,
      });

      expect(result.error).toContain(
        'image-resize.maxLongEdge must be a positive integer',
      );
      expect(result.returnDisplay).toContain(
        'Image Resize Configuration Error',
      );
    });

    it('returns a clear error for corrupt images under automatic resizing', async () => {
      const filePath = join(tempDir, 'corrupt.png');
      writeFileSync(filePath, Buffer.from('corrupt image bytes'));
      const tool = new ReadFileTool(
        _createFakeFileHost(tempDir, {
          'image-resize.maxLongEdge': 120,
        }),
      );

      const result = await executeToolForBehavioralAssertion(tool, {
        file_path: filePath,
      });

      expect(result.error).toContain('Unable to resize image corrupt.png');
    });
  });

  describe('WriteFileTool behavioral contract', () => {
    it('writes content and filesystem reflects the written content', async () => {
      const filePath = join(tempDir, 'write-test.txt');
      const tool = new WriteFileTool(_createFakeFileHost(tempDir));
      const result = await executeDeclarativeToolForBehavioralAssertion(tool, {
        file_path: filePath,
        content: WRITE_FILE_FIXTURE.expectedWrittenContent,
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('write-test.txt');
      expect(existsSync(filePath)).toBe(true);
      const written = readFileSync(filePath, 'utf-8');
      expect(written).toBe(WRITE_FILE_FIXTURE.expectedWrittenContent);
    });
  });

  describe('DeleteLineRangeTool behavioral contract', () => {
    it('deletes specified lines from a real temp file', async () => {
      const filePath = join(tempDir, 'delete-lines-test.txt');
      writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8');

      const result = await executeToolForBehavioralAssertion(
        new DeleteLineRangeTool(_createFakeFileHost(tempDir)),
        { file_path: filePath, start_line: 2, end_line: 3 },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('line2');
      expect(readFileSync(filePath, 'utf-8')).toBe('line1\nline4\nline5');
    });
  });

  describe('InsertAtLineTool behavioral contract', () => {
    it('inserts content at a line and filesystem reflects the insertion', async () => {
      const filePath = join(tempDir, 'insert-test.txt');
      writeFileSync(filePath, 'line1\nline3', 'utf-8');

      const result = await executeToolForBehavioralAssertion(
        new InsertAtLineTool(_createFakeFileHost(tempDir)),
        { file_path: filePath, line_number: 2, content: 'line2\n' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('line2');
      expect(readFileSync(filePath, 'utf-8')).toBe('line1\nline2\nline3');
    });
  });

  describe('ReadLineRangeTool behavioral contract', () => {
    it('reads a specific line range and returns correct content', async () => {
      const filePath = join(tempDir, 'read-range-test.txt');
      writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5', 'utf-8');

      const result = await executeToolForBehavioralAssertion(
        new ReadLineRangeTool(_createFakeFileHost(tempDir)),
        { file_path: filePath, start_line: 2, end_line: 3 },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('line2\nline3');
      expect(result.returnDisplay).toContain('line2\nline3');
    });
  });

  describe('GlobTool behavioral contract', () => {
    it('matches a real temp directory structure and returns file list', async () => {
      // Create a directory structure
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src', 'index.ts'), '// ts file', 'utf-8');
      writeFileSync(join(tempDir, 'src', 'readme.txt'), 'readme', 'utf-8');
      writeFileSync(join(tempDir, 'package.json'), '{}', 'utf-8');

      // Verify directory structure (observable filesystem state)
      expect(existsSync(join(tempDir, 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(tempDir, 'src', 'readme.txt'))).toBe(true);
      expect(existsSync(join(tempDir, 'package.json'))).toBe(true);

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new GlobTool(_createFakeFileHost(tempDir)),
        { pattern: '**/*.{ts,txt}', path: tempDir },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('index.ts');
      expect(result.llmContent).toContain('readme.txt');
      for (const pattern of GLOB_FIXTURE.expectedPatterns) {
        expect(typeof pattern).toBe('string');
      }
    });
  });

  describe('GrepTool behavioral contract', () => {
    it('searches real temp files and returns matching results', async () => {
      const filePath = join(tempDir, 'grep-test.txt');
      writeFileSync(
        filePath,
        'Hello World\nGoodbye World\nHello Again',
        'utf-8',
      );

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new GrepTool(_createFakeFileHost(tempDir)),
        { pattern: 'Hello', path: filePath },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Hello World');
      expect(result.llmContent).toContain('Hello Again');
    });

    it('respects .llxprtignore by default and overrides via file_filtering_options', async () => {
      writeFileSync(join(tempDir, 'keep.ts'), 'needle: found', 'utf-8');
      writeFileSync(join(tempDir, 'skip.ts'), 'needle skip', 'utf-8');
      const ignoreFilePath = join(tempDir, '.llxprtignore');
      writeFileSync(ignoreFilePath, 'skip.ts', 'utf-8');

      const host = createGrepHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
        llxprtIgnoreFilePath: ignoreFilePath,
      });

      const defaultResult = await executeDeclarativeToolForBehavioralAssertion(
        new RipGrepTool(host),
        { pattern: 'needle', path: tempDir },
      );

      expect(defaultResult.llmContent).toContain('keep.ts');
      expect(defaultResult.llmContent).toContain('needle: found');
      expect(defaultResult.llmContent).not.toContain('skip.ts');

      const overriddenResult =
        await executeDeclarativeToolForBehavioralAssertion(
          new RipGrepTool(host),
          {
            pattern: 'needle',
            path: tempDir,
            file_filtering_options: { respect_llxprt_ignore: false },
          },
        );

      expect(overriddenResult.llmContent).toContain('keep.ts');
      expect(overriddenResult.llmContent).toContain('skip.ts');
    });
  });

  describe('LsTool behavioral contract', () => {
    it('lists a real temp directory and returns directory contents', async () => {
      writeFileSync(join(tempDir, 'file1.txt'), 'content1', 'utf-8');
      writeFileSync(join(tempDir, 'file2.txt'), 'content2', 'utf-8');
      mkdirSync(join(tempDir, 'subdir'), { recursive: true });

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new LSTool(_createFakeFileHost(tempDir)),
        { path: tempDir },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('file1.txt');
      expect(result.llmContent).toContain('file2.txt');
      expect(result.llmContent).toContain('subdir');
    });
  });

  describe('ToolResult contract verification', () => {
    it('READ_FILE_FIXTURE has correct contract structure', () => {
      expect(READ_FILE_FIXTURE.contract.llmContentType).toBeDefined();
      expect(READ_FILE_FIXTURE.contract.returnDisplayType).toBeDefined();
      expect(READ_FILE_FIXTURE.exampleContent).toBeTruthy();
      expect(READ_FILE_FIXTURE.expectedLlmContentContains).toBeInstanceOf(
        Array,
      );
    });

    it('WRITE_FILE_FIXTURE has correct contract structure', () => {
      expect(WRITE_FILE_FIXTURE.contract.llmContentType).toBeDefined();
      expect(WRITE_FILE_FIXTURE.contract.returnDisplayType).toBeDefined();
      expect(WRITE_FILE_FIXTURE.expectedWrittenContent).toBeTruthy();
    });
  });
});
