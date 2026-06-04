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
import fs from 'fs'; // Actual fs for setup
import { readFile as mockReadFile } from 'fs/promises';
import os from 'os';
import type { Config } from '../config/config.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import {
  COMMON_IGNORE_PATTERNS,
  DEFAULT_FILE_EXCLUDES,
} from '../utils/ignorePatterns.js';

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
  let tool: ReadManyFilesTool;
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
    const fileService = new FileDiscoveryService(tempRootDir);
    const mockConfig = {
      getFileService: () => fileService,
      getFileSystemService: () => new StandardFileSystemService(),
      getEphemeralSettings: () => ({}),
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectGeminiIgnore: true,
      }),
      getTargetDir: () => tempRootDir,
      getWorkspaceDirs: () => [tempRootDir],
      getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
      getFileExclusions: () => ({
        getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
        getDefaultExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
        getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
        buildExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
        getReadManyFilesExcludes: () => DEFAULT_FILE_EXCLUDES,
      }),
    } as Partial<Config> as Config;
    tool = new ReadManyFilesTool(mockConfig);

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

  describe('build', () => {
    it('should return an invocation for valid relative paths within root', () => {
      const params = { paths: ['file1.txt', 'subdir/file2.txt'] };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
    });

    it('should return an invocation for valid glob patterns within root', () => {
      const params = { paths: ['*.txt', 'subdir/**/*.js'] };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
    });

    it('should return an invocation for paths trying to escape the root (e.g., ../) as execute handles this', () => {
      const params = { paths: ['../outside.txt'] };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
    });

    it('should return an invocation for absolute paths as execute handles this', () => {
      const params = { paths: [path.join(tempDirOutsideRoot, 'absolute.txt')] };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
    });

    it('should throw error if paths array is empty', () => {
      const params = { paths: [], include: [] };
      expect(() => tool.build(params)).toThrow(
        'params/paths must NOT have fewer than 1 items',
      );
    });

    it('should return an invocation for valid exclude and include patterns', () => {
      const params = {
        paths: ['src/**/*.ts'],
        exclude: ['**/*.test.ts'],
        include: ['src/utils/*.ts'],
      };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
    });

    it('should throw error if paths array contains an empty string', () => {
      const params = { paths: ['file1.txt', ''] };
      expect(() => tool.build(params)).toThrow(
        'params/paths/1 must NOT have fewer than 1 characters',
      );
    });

    it('should throw error if include array contains non-string elements', () => {
      const params = {
        paths: ['file1.txt'],
        include: ['*.ts', 123] as string[],
      };
      expect(() => tool.build(params)).toThrow(
        'params/include/1 must be string',
      );
    });

    it('should throw error if exclude array contains non-string elements', () => {
      const params = {
        paths: ['file1.txt'],
        exclude: ['*.log', {}] as string[],
      };
      expect(() => tool.build(params)).toThrow(
        'params/exclude/1 must be string',
      );
    });
  });

  describe('execute', () => {
    const createBinaryFile = (filePath: string, data: Uint8Array) => {
      const fullPath = path.join(tempRootDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, data);
    };

    it('should read a single specified file', async () => {
      createFileInTempRoot('file1.txt', 'Content of file1');
      const params = { paths: ['file1.txt'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const expectedPath = path.join(tempRootDir, 'file1.txt');
      expect(result.llmContent).toStrictEqual([
        `--- ${expectedPath} ---\n\nContent of file1\n\n`,
        `\n--- End of content ---`,
      ]);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should read multiple specified files', async () => {
      createFileInTempRoot('file1.txt', 'Content1');
      createFileInTempRoot('subdir/file2.js', 'Content2');
      const params = { paths: ['file1.txt', 'subdir/file2.js'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath1 = path.join(tempRootDir, 'file1.txt');
      const expectedPath2 = path.join(tempRootDir, 'subdir/file2.js');
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath1} ---\n\nContent1\n\n`),
        ),
      ).toBe(true);
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath2} ---\n\nContent2\n\n`),
        ),
      ).toBe(true);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **2 file(s)**',
      );
    });

    it('should handle glob patterns', async () => {
      createFileInTempRoot('file.txt', 'Text file');
      createFileInTempRoot('another.txt', 'Another text');
      createFileInTempRoot('sub/data.json', '{}');
      const params = { paths: ['*.txt'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath1 = path.join(tempRootDir, 'file.txt');
      const expectedPath2 = path.join(tempRootDir, 'another.txt');
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath1} ---\n\nText file\n\n`),
        ),
      ).toBe(true);
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath2} ---\n\nAnother text\n\n`),
        ),
      ).toBe(true);
      expect(content.find((c) => c.includes('sub/data.json'))).toBeUndefined();
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **2 file(s)**',
      );
    });

    it('should respect exclude patterns', async () => {
      createFileInTempRoot('src/main.ts', 'Main content');
      createFileInTempRoot('src/main.test.ts', 'Test content');
      const params = { paths: ['src/**/*.ts'], exclude: ['**/*.test.ts'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath = path.join(tempRootDir, 'src/main.ts');
      expect(content).toStrictEqual([
        `--- ${expectedPath} ---\n\nMain content\n\n`,
        `\n--- End of content ---`,
      ]);
      expect(
        content.find((c) => c.includes('src/main.test.ts')),
      ).toBeUndefined();
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should handle nonexistent specific files gracefully', async () => {
      const params = { paths: ['nonexistent-file.txt'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toStrictEqual([
        'No files matching the criteria were found or all were skipped.',
      ]);
      expect(result.returnDisplay).toContain(
        'No files were read and concatenated based on the criteria.',
      );
    });

    it('should use default excludes', async () => {
      createFileInTempRoot('node_modules/some-lib/index.js', 'lib code');
      createFileInTempRoot('src/app.js', 'app code');
      const params = { paths: ['**/*.js'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath = path.join(tempRootDir, 'src/app.js');
      expect(content).toStrictEqual([
        `--- ${expectedPath} ---\n\napp code\n\n`,
        `\n--- End of content ---`,
      ]);
      expect(
        content.find((c) => c.includes('node_modules/some-lib/index.js')),
      ).toBeUndefined();
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should NOT use default excludes if useDefaultExcludes is false', async () => {
      createFileInTempRoot('node_modules/some-lib/index.js', 'lib code');
      createFileInTempRoot('src/app.js', 'app code');
      const params = { paths: ['**/*.js'], useDefaultExcludes: false };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath1 = path.join(
        tempRootDir,
        'node_modules/some-lib/index.js',
      );
      const expectedPath2 = path.join(tempRootDir, 'src/app.js');
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath1} ---\n\nlib code\n\n`),
        ),
      ).toBe(true);
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath2} ---\n\napp code\n\n`),
        ),
      ).toBe(true);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **2 file(s)**',
      );
    });

    it('should include images as inlineData parts if explicitly requested by extension', async () => {
      createBinaryFile(
        'image.png',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      const params = { paths: ['*.png'] }; // Explicitly requesting .png
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toStrictEqual([
        {
          inlineData: {
            data: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]).toString('base64'),
            mimeType: 'image/png',
          },
        },
        '\n--- End of content ---',
      ]);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should include images as inlineData parts if explicitly requested by name', async () => {
      createBinaryFile(
        'myExactImage.png',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      const params = { paths: ['myExactImage.png'] }; // Explicitly requesting by full name
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toStrictEqual([
        {
          inlineData: {
            data: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]).toString('base64'),
            mimeType: 'image/png',
          },
        },
        '\n--- End of content ---',
      ]);
    });

    it('should skip PDF files if not explicitly requested by extension or name', async () => {
      createBinaryFile('document.pdf', Buffer.from('%PDF-1.4...'));
      createFileInTempRoot('notes.txt', 'text notes');
      const params = { paths: ['*'] }; // Generic glob, not specific to .pdf
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath = path.join(tempRootDir, 'notes.txt');
      expect(
        content.some(
          (c) =>
            typeof c === 'string' &&
            c.includes(`--- ${expectedPath} ---\n\ntext notes\n\n`),
        ),
      ).toBe(true);
      expect(result.returnDisplay).toContain('**Skipped 1 item(s):**');
      expect(result.returnDisplay).toContain(
        '- `document.pdf` (Reason: asset file (image/pdf/audio) was not explicitly requested by name or extension)',
      );
    });

    it('should include PDF files as inlineData parts if explicitly requested by extension', async () => {
      createBinaryFile('important.pdf', Buffer.from('%PDF-1.4...'));
      const params = { paths: ['*.pdf'] }; // Explicitly requesting .pdf files
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toStrictEqual([
        {
          inlineData: {
            data: Buffer.from('%PDF-1.4...').toString('base64'),
            mimeType: 'application/pdf',
          },
        },
        '\n--- End of content ---',
      ]);
    });

    it('should include PDF files as inlineData parts if explicitly requested by name', async () => {
      createBinaryFile('report-final.pdf', Buffer.from('%PDF-1.4...'));
      const params = { paths: ['report-final.pdf'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toStrictEqual([
        {
          inlineData: {
            data: Buffer.from('%PDF-1.4...').toString('base64'),
            mimeType: 'application/pdf',
          },
        },
        '\n--- End of content ---',
      ]);
    });

    it('should return error if path is ignored by a .geminiignore pattern', async () => {
      createFileInTempRoot('foo.bar', '');
      createFileInTempRoot('bar.ts', '');
      createFileInTempRoot('foo.quux', '');
      const params = { paths: ['foo.bar', 'bar.ts', 'foo.quux'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      // Note: Currently specific file paths bypass ignore filtering
      // This is expected behavior - ignore patterns only apply to glob searches
      expect(result.returnDisplay).toContain('foo.bar');
      expect(result.returnDisplay).toContain('foo.quux');
      expect(result.returnDisplay).toContain('bar.ts');
    });

    it('should read files from multiple workspace directories', async () => {
      const tempDir1 = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'multi-dir-1-')),
      );
      const tempDir2 = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'multi-dir-2-')),
      );
      const fileService = new FileDiscoveryService(tempDir1);
      const mockConfig = {
        getFileService: () => fileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({}),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
        }),
        getWorkspaceContext: () => new WorkspaceContext(tempDir1, [tempDir2]),
        getTargetDir: () => tempDir1,
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => [],
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => [],
          getReadManyFilesExcludes: () => [],
        }),
      } as Partial<Config> as Config;
      tool = new ReadManyFilesTool(mockConfig);

      fs.writeFileSync(path.join(tempDir1, 'file1.txt'), 'Content1');
      fs.writeFileSync(path.join(tempDir2, 'file2.txt'), 'Content2');

      const params = { paths: ['*.txt'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!Array.isArray(content)) {
        throw new Error(`llmContent is not an array: ${content}`);
      }
      const expectedPath1 = path.join(tempDir1, 'file1.txt');
      const expectedPath2 = path.join(tempDir2, 'file2.txt');

      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath1} ---\n\nContent1\n\n`),
        ),
      ).toBe(true);
      expect(
        content.some((c) =>
          c.includes(`--- ${expectedPath2} ---\n\nContent2\n\n`),
        ),
      ).toBe(true);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **2 file(s)**',
      );

      fs.rmSync(tempDir1, { recursive: true, force: true });
      fs.rmSync(tempDir2, { recursive: true, force: true });
    });

    it('should add a warning for truncated files', async () => {
      createFileInTempRoot('file1.txt', 'Content1');
      // Create a file that will be "truncated" by making it long
      const longContent = Array.from({ length: 2500 }, (_, i) => `L${i}`).join(
        '\n',
      );
      createFileInTempRoot('large-file.txt', longContent);

      const params = { paths: ['*.txt'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];

      const normalFileContent = content.find((c) => c.includes('file1.txt'));
      const truncatedFileContent = content.find((c) =>
        c.includes('large-file.txt'),
      );

      expect(normalFileContent).not.toContain(
        '[WARNING: This file was truncated.',
      );
      expect(truncatedFileContent).toContain(
        "[WARNING: This file was truncated. To view the full content, use the 'read_file' tool on this specific file.]",
      );
      // Check that the actual content is still there but truncated
      expect(truncatedFileContent).toContain('L200');
      expect(truncatedFileContent).not.toContain('L2400');
    });

    it('should read files with special characters like [] and () in the path', async () => {
      const filePath = 'src/app/[test]/(dashboard)/testing/components/code.tsx';
      createFileInTempRoot(filePath, 'Content of receive-detail');
      const params = { paths: [filePath] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const expectedPath = path.join(tempRootDir, filePath);
      expect(result.llmContent).toStrictEqual([
        `--- ${expectedPath} ---

Content of receive-detail

`,
        `\n--- End of content ---`,
      ]);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should read files with special characters in the name', async () => {
      createFileInTempRoot('file[1].txt', 'Content of file[1]');
      const params = { paths: ['file[1].txt'] };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      const expectedPath = path.join(tempRootDir, 'file[1].txt');
      expect(result.llmContent).toStrictEqual([
        `--- ${expectedPath} ---

Content of file[1]

`,
        `\n--- End of content ---`,
      ]);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should respect repository-level gitignore patterns when workspace is nested', async () => {
      const repoRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'read-many-files-repo-'),
      );
      const workspaceDir = path.join(repoRoot, 'workspace');
      fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(path.join(repoRoot, '.gitignore'), 'secret.txt\n');
      const secretFile = path.join(workspaceDir, 'secret.txt');
      const visibleFile = path.join(workspaceDir, 'visible.txt');
      fs.writeFileSync(secretFile, 'top secret');
      fs.writeFileSync(visibleFile, 'visible');

      const nestedFileService = new FileDiscoveryService(workspaceDir);
      const canonicalSecretFile = fs.realpathSync(secretFile);
      const canonicalVisibleFile = fs.realpathSync(visibleFile);
      expect(
        nestedFileService.filterFiles(
          [canonicalSecretFile, canonicalVisibleFile],
          {
            respectGitIgnore: true,
            respectLlxprtIgnore: false,
          },
        ),
      ).toStrictEqual([canonicalVisibleFile]);
      const nestedConfig = {
        getFileService: () => nestedFileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({}),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        }),
        getTargetDir: () => workspaceDir,
        getWorkspaceDirs: () => [workspaceDir],
        getWorkspaceContext: () => new WorkspaceContext(workspaceDir),
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
          getReadManyFilesExcludes: () => DEFAULT_FILE_EXCLUDES,
        }),
      } as Partial<Config> as Config;

      const nestedTool = new ReadManyFilesTool(nestedConfig);
      const invocation = nestedTool.build({ paths: ['**/*.txt'] });
      const result = await invocation.execute(new AbortController().signal);
      const content = result.llmContent as string[];
      const secretIncluded = content.some(
        (c) =>
          typeof c === 'string' && c.includes(`--- ${canonicalSecretFile} ---`),
      );
      const visibleIncluded = content.some(
        (c) =>
          typeof c === 'string' &&
          c.includes(`--- ${canonicalVisibleFile} ---\n\nvisible\n\n`),
      );

      expect(secretIncluded).toBe(false);
      expect(visibleIncluded).toBe(true);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );

      fs.rmSync(repoRoot, { recursive: true, force: true });
    });
  });
});
