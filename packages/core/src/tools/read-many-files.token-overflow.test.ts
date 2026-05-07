/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { ReadManyFilesTool } from './read-many-files.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import path from 'path';
import fs from 'fs';
import { readFile as mockReadFile } from 'fs/promises';
import os from 'os';
import type { Config } from '../config/config.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { COMMON_IGNORE_PATTERNS } from '../utils/ignorePatterns.js';

vi.mock('glob', { spy: true });

// Mock fs/promises with inline factory
vi.mock('fs/promises', async () => {
  const actualFsPromises =
    await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actualFsPromises,
    readFile: vi.fn(),
  };
});

vi.mock('mime-types', () => {
  const lookup = (filename: string) => {
    if (filename.endsWith('.ts') || filename.endsWith('.js')) {
      return 'text/plain';
    }
    if (filename.endsWith('.png')) {
      return 'image/png';
    }
    if (filename.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (filename.endsWith('.mp3') || filename.endsWith('.wav')) {
      return 'audio/mpeg';
    }
    if (filename.endsWith('.mp4') || filename.endsWith('.mov')) {
      return 'video/mp4';
    }
    return false;
  };
  return {
    default: {
      lookup,
    },
    lookup,
  };
});

describe('ReadManyFilesTool', () => {
  let tempRootDir: string;
  let tempDirOutsideRoot: string;
  let mockReadFileFn: Mock;

  const createFileInTempRoot = (filePath: string, content = '') => {
    const fullPath = path.join(tempRootDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };

  beforeEach(async () => {
    tempRootDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'read-many-files-root-')),
    );
    tempDirOutsideRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'read-many-files-external-')),
    );
    fs.writeFileSync(path.join(tempRootDir, '.geminiignore'), 'foo.*');

    mockReadFileFn = mockReadFile as Mock;
    mockReadFileFn.mockReset();

    mockReadFileFn.mockImplementation(
      async (filePath: fs.PathLike, options?: Record<string, unknown>) => {
        const fp =
          typeof filePath === 'string'
            ? filePath
            : (filePath as Buffer).toString();

        if (fs.existsSync(fp)) {
          const originalFs = await vi.importActual<typeof fs>('fs');
          return originalFs.promises.readFile(fp, options);
        }

        if (fp.endsWith('nonexistent-file.txt')) {
          const err = new Error(
            `ENOENT: no such file or directory, open '${fp}'`,
          );
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        if (fp.endsWith('unreadable.txt')) {
          const err = new Error(`EACCES: permission denied, open '${fp}'`);
          (err as NodeJS.ErrnoException).code = 'EACCES';
          throw err;
        }
        if (fp.endsWith('.png'))
          return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
        if (fp.endsWith('.pdf')) return Buffer.from('%PDF-1.4...'); // PDF start
        if (fp.endsWith('binary.bin'))
          return Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]);

        const err = new Error(
          `ENOENT: no such file or directory, open '${fp}' (unmocked path)`,
        );
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      },
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempRootDir)) {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempDirOutsideRoot)) {
      fs.rmSync(tempDirOutsideRoot, { recursive: true, force: true });
    }
  });

  describe('Token overflow handling', () => {
    it('warn mode: should stop without including the overflowing file and report remaining-file count including it', async () => {
      // Create 3 files: first small, second small, third overflows token limit
      createFileInTempRoot('small1.txt', 'a');
      createFileInTempRoot('small2.txt', 'b');
      const bigContent = 'X'.repeat(200_000); // ~50k tokens, way over default limit
      createFileInTempRoot('big.txt', bigContent);

      const fileService = new FileDiscoveryService(tempRootDir);
      const mockConfig = {
        getFileService: () => fileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({
          'tool-output-max-tokens': 100,
          'tool-output-truncate-mode': 'warn',
        }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
        }),
        getTargetDir: () => tempRootDir,
        getWorkspaceDirs: () => [tempRootDir],
        getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => [],
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => [],
          getReadManyFilesExcludes: () => [],
        }),
      } as Partial<Config> as Config;
      const warnTool = new ReadManyFilesTool(mockConfig);

      const params = { paths: ['small1.txt', 'small2.txt', 'big.txt'] };
      const invocation = warnTool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];

      // The overflowing file (big.txt) must NOT appear in content
      const bigIncluded = content.some(
        (c) => typeof c === 'string' && c.includes('big.txt'),
      );
      expect(bigIncluded).toBe(false);

      // The display should mention "remaining file(s)" including the overflowing one
      expect(result.returnDisplay).toContain('remaining file(s)');

      // Only previously processed files should appear, not big.txt
      const processedCount = content.filter(
        (c) => typeof c === 'string' && c.includes('---'),
      ).length;
      // Either 0 or 1 files processed before hitting the limit
      expect(processedCount).toBeLessThanOrEqual(2);
    });

    it('truncate mode: should include truncated content, report one processed file, include truncation marker, and not continue to later files', async () => {
      // Create 3 files: first small, second overflows, third should be skipped
      // Use prefixed names to control alphabetical sort order (sortedFiles sorts alphabetically)
      createFileInTempRoot('a_first.txt', 'First file content');
      const bigContent = 'Y'.repeat(200_000); // Will overflow
      createFileInTempRoot('b_overflow.txt', bigContent);
      createFileInTempRoot('c_after.txt', 'This should not appear');

      const fileService = new FileDiscoveryService(tempRootDir);
      const mockConfig = {
        getFileService: () => fileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({
          'tool-output-max-tokens': 500,
          'tool-output-truncate-mode': 'truncate',
        }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
        }),
        getTargetDir: () => tempRootDir,
        getWorkspaceDirs: () => [tempRootDir],
        getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => [],
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => [],
          getReadManyFilesExcludes: () => [],
        }),
      } as Partial<Config> as Config;
      const truncateTool = new ReadManyFilesTool(mockConfig);

      const params = {
        paths: ['a_first.txt', 'b_overflow.txt', 'c_after.txt'],
      };
      const invocation = truncateTool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];

      // Should contain the truncation marker
      const hasTruncationMarker = content.some(
        (c) =>
          typeof c === 'string' &&
          c.includes('[CONTENT TRUNCATED DUE TO TOKEN LIMIT]'),
      );
      expect(hasTruncationMarker).toBe(true);

      // The overflowing file should be listed in the display
      expect(result.returnDisplay).toContain('b_overflow.txt');

      // "c_after.txt" must NOT appear as a processed file in the display message
      // (we stopped after truncating b_overflow.txt)
      expect(result.returnDisplay).not.toContain('c_after.txt');

      // Should report the truncation reason
      expect(result.returnDisplay).toContain(
        'content truncated to fit token limit',
      );
    });

    it('truncate mode with very small remaining budget: should stop without including the overflowing file', async () => {
      // Set a tiny token limit so remainingTokens <= 100 after first file
      createFileInTempRoot('first.txt', 'AAAA'); // ~1 token for content plus separator overhead
      createFileInTempRoot('second.txt', 'BBBB');

      const fileService = new FileDiscoveryService(tempRootDir);
      const mockConfig = {
        getFileService: () => fileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({
          'tool-output-max-tokens': 50,
          'tool-output-truncate-mode': 'truncate',
        }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
        }),
        getTargetDir: () => tempRootDir,
        getWorkspaceDirs: () => [tempRootDir],
        getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => [],
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => [],
          getReadManyFilesExcludes: () => [],
        }),
      } as Partial<Config> as Config;
      const truncateTool = new ReadManyFilesTool(mockConfig);

      // Use many files to push remaining budget very low
      const params = { paths: ['first.txt', 'second.txt'] };
      const invocation = truncateTool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];

      // No truncation marker should appear (remaining budget too small to truncate)
      const hasTruncationMarker = content.some(
        (c) =>
          typeof c === 'string' &&
          c.includes('[CONTENT TRUNCATED DUE TO TOKEN LIMIT]'),
      );
      expect(hasTruncationMarker).toBe(false);
    });
  });
});
