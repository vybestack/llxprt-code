/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { mockControl } from '../__mocks__/fs/promises.js';
import { ReadManyFilesTool } from './read-many-files.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import path from 'path';
import fs from 'fs'; // Actual fs for setup
import os from 'os';
import { Config } from '../config/config.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';

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

  beforeEach(async () => {
    tempRootDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'read-many-files-root-')),
    );
    tempDirOutsideRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'read-many-files-external-')),
    );
    fs.writeFileSync(path.join(tempRootDir, '.llxprtignore'), 'foo.*');
    const fileService = new FileDiscoveryService(tempRootDir);
    const mockConfig = {
      getFileService: () => fileService,

      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      getTargetDir: () => tempRootDir,
      getWorkspaceDirs: () => [tempRootDir],
      getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
      getEphemeralSettings: () => ({}) as Record<string, unknown>, // Return empty settings for default behavior
    } as Partial<Config> as Config;
    tool = new ReadManyFilesTool(mockConfig);

    mockReadFileFn = mockControl.mockReadFile;
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

  describe('validateParams', () => {
    it('should return null for valid relative paths within root', () => {
      const params = { paths: ['file1.txt', 'subdir/file2.txt'] };
      expect(tool.validateParams(params)).toBeNull();
    });

    it('should return null for valid glob patterns within root', () => {
      const params = { paths: ['*.txt', 'subdir/**/*.js'] };
      expect(tool.validateParams(params)).toBeNull();
    });

    it('should return null for paths trying to escape the root (e.g., ../) as execute handles this', () => {
      const params = { paths: ['../outside.txt'] };
      expect(tool.validateParams(params)).toBeNull();
    });

    it('should return null for absolute paths as execute handles this', () => {
      const params = { paths: [path.join(tempDirOutsideRoot, 'absolute.txt')] };
      expect(tool.validateParams(params)).toBeNull();
    });

    it('should return error if paths array is empty', () => {
      const params = { paths: [] };
      expect(tool.validateParams(params)).toBe(
        'params/paths must NOT have fewer than 1 items',
      );
    });

    it('should return null for valid exclude and include patterns', () => {
      const params = {
        paths: ['src/**/*.ts'],
        exclude: ['**/*.test.ts'],
        include: ['src/utils/*.ts'],
      };
      expect(tool.validateParams(params)).toBeNull();
    });

    it('should return error if paths array contains an empty string', () => {
      const params = { paths: ['file1.txt', ''] };
      expect(tool.validateParams(params)).toBe(
        'params/paths/1 must NOT have fewer than 1 characters',
      );
    });

    it('should return error if include array contains non-string elements', () => {
      const params = {
        paths: ['file1.txt'],
        include: ['*.ts', 123] as string[],
      };
      expect(tool.validateParams(params)).toBe(
        'params/include/1 must be string',
      );
    });

    it('should return error if exclude array contains non-string elements', () => {
      const params = {
        paths: ['file1.txt'],
        exclude: ['*.log', {}] as string[],
      };
      expect(tool.validateParams(params)).toBe(
        'params/exclude/1 must be string',
      );
    });
  });

  describe('execute', () => {
    const createFile = (filePath: string, content = '') => {
      const fullPath = path.join(tempRootDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    };
    const createBinaryFile = (filePath: string, data: Uint8Array) => {
      const fullPath = path.join(tempRootDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, data);
    };

    it('should read a single specified file', async () => {
      createFile('file1.txt', 'Content of file1');
      const params = { paths: ['file1.txt'] };
      const result = await tool.execute(params, new AbortController().signal);
      const expectedPath = path.join(tempRootDir, 'file1.txt');
      expect(result.llmContent).toEqual([
        `--- ${expectedPath} ---\n\nContent of file1\n\n`,
      ]);
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should read multiple specified files', async () => {
      createFile('file1.txt', 'Content1');
      createFile('subdir/file2.js', 'Content2');
      const params = { paths: ['file1.txt', 'subdir/file2.js'] };
      const result = await tool.execute(params, new AbortController().signal);
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
      createFile('file.txt', 'Text file');
      createFile('another.txt', 'Another text');
      createFile('sub/data.json', '{}');
      const params = { paths: ['*.txt'] };
      const result = await tool.execute(params, new AbortController().signal);
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
      createFile('src/main.ts', 'Main content');
      createFile('src/main.test.ts', 'Test content');
      const params = { paths: ['src/**/*.ts'], exclude: ['**/*.test.ts'] };
      const result = await tool.execute(params, new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath = path.join(tempRootDir, 'src/main.ts');
      expect(content).toEqual([`--- ${expectedPath} ---\n\nMain content\n\n`]);
      expect(
        content.find((c) => c.includes('src/main.test.ts')),
      ).toBeUndefined();
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should handle nonexistent specific files gracefully', async () => {
      const params = { paths: ['nonexistent-file.txt'] };
      const result = await tool.execute(params, new AbortController().signal);
      expect(result.llmContent).toEqual([
        'No files matching the criteria were found or all were skipped.',
      ]);
      expect(result.returnDisplay).toContain(
        'No files were read and concatenated based on the criteria.',
      );
    });

    it('should use default excludes', async () => {
      createFile('node_modules/some-lib/index.js', 'lib code');
      createFile('src/app.js', 'app code');
      const params = { paths: ['**/*.js'] };
      const result = await tool.execute(params, new AbortController().signal);
      const content = result.llmContent as string[];
      const expectedPath = path.join(tempRootDir, 'src/app.js');
      expect(content).toEqual([`--- ${expectedPath} ---\n\napp code\n\n`]);
      expect(
        content.find((c) => c.includes('node_modules/some-lib/index.js')),
      ).toBeUndefined();
      expect(result.returnDisplay).toContain(
        'Successfully read and concatenated content from **1 file(s)**',
      );
    });

    it('should NOT use default excludes if useDefaultExcludes is false', async () => {
      createFile('node_modules/some-lib/index.js', 'lib code');
      createFile('src/app.js', 'app code');
      const params = { paths: ['**/*.js'], useDefaultExcludes: false };
      const result = await tool.execute(params, new AbortController().signal);
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
      const result = await tool.execute(params, new AbortController().signal);
      expect(result.llmContent).toEqual([
        {
          inlineData: {
            data: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]).toString('base64'),
            mimeType: 'image/png',
          },
        },
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
      const result = await tool.execute(params, new AbortController().signal);
      expect(result.llmContent).toEqual([
        {
          inlineData: {
            data: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]).toString('base64'),
            mimeType: 'image/png',
          },
        },
      ]);
    });

    it('should skip PDF files if not explicitly requested by extension or name', async () => {
      createBinaryFile('document.pdf', Buffer.from('%PDF-1.4...'));
      createFile('notes.txt', 'text notes');
      const params = { paths: ['*'] }; // Generic glob, not specific to .pdf
      const result = await tool.execute(params, new AbortController().signal);
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
        '- `document.pdf` (Reason: asset file (image/pdf) was not explicitly requested by name or extension)',
      );
    });

    it('should include PDF files as inlineData parts if explicitly requested by extension', async () => {
      createBinaryFile('important.pdf', Buffer.from('%PDF-1.4...'));
      const params = { paths: ['*.pdf'] }; // Explicitly requesting .pdf files
      const result = await tool.execute(params, new AbortController().signal);
      expect(result.llmContent).toEqual([
        {
          inlineData: {
            data: Buffer.from('%PDF-1.4...').toString('base64'),
            mimeType: 'application/pdf',
          },
        },
      ]);
    });

    it('should include PDF files as inlineData parts if explicitly requested by name', async () => {
      createBinaryFile('report-final.pdf', Buffer.from('%PDF-1.4...'));
      const params = { paths: ['report-final.pdf'] };
      const result = await tool.execute(params, new AbortController().signal);
      expect(result.llmContent).toEqual([
        {
          inlineData: {
            data: Buffer.from('%PDF-1.4...').toString('base64'),
            mimeType: 'application/pdf',
          },
        },
      ]);
    });

    it('should return error if path is ignored by a .llxprtignore pattern', async () => {
      createFile('foo.bar', '');
      createFile('bar.ts', '');
      createFile('foo.quux', '');
      const params = { paths: ['foo.bar', 'bar.ts', 'foo.quux'] };
      const result = await tool.execute(params, new AbortController().signal);
      expect(result.returnDisplay).not.toContain('foo.bar');
      expect(result.returnDisplay).not.toContain('foo.quux');
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
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        }),
        getWorkspaceContext: () => new WorkspaceContext(tempDir1, [tempDir2]),
        getTargetDir: () => tempDir1,
        getEphemeralSettings: () => ({}) as Record<string, unknown>, // Return empty settings for default behavior
      } as Partial<Config> as Config;
      tool = new ReadManyFilesTool(mockConfig);

      fs.writeFileSync(path.join(tempDir1, 'file1.txt'), 'Content1');
      fs.writeFileSync(path.join(tempDir2, 'file2.txt'), 'Content2');

      const params = { paths: ['*.txt'] };
      const result = await tool.execute(params, new AbortController().signal);
      const content = result.llmContent as string[];
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
      createFile('file1.txt', 'Content1');
      // Create a file that will be "truncated" by making it long
      const longContent = Array.from({ length: 2500 }, (_, i) => `L${i}`).join(
        '\n',
      );
      createFile('large-file.txt', longContent);

      const params = { paths: ['*.txt'] };
      const result = await tool.execute(params, new AbortController().signal);
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
  });

  describe('limits functionality', () => {
    const createFile = (filePath: string, content = '') => {
      const fullPath = path.join(tempRootDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    };

    describe('file count limits', () => {
      it('should warn and stop when exceeding file count limit in warn mode', async () => {
        // Create 60 files (limit is 50 by default)
        for (let i = 1; i <= 60; i++) {
          createFile(`file${i}.txt`, `Content of file ${i}`);
        }

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-items': 50,
              'tool-output-truncate-mode': 'warn',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        expect(result.llmContent).toBe(
          'Found 60 files matching your pattern, but limiting to 50 files. Please use more specific patterns to narrow your search.',
        );
        expect(result.returnDisplay).toContain('## File Count Limit Exceeded');
        expect(result.returnDisplay).toContain('**Matched files:** 60');
        expect(result.returnDisplay).toContain('**Limit:** 50');
      });

      it('should truncate files when exceeding limit in truncate mode', async () => {
        // Create 10 files
        for (let i = 1; i <= 10; i++) {
          createFile(`file${i}.txt`, `Content of file ${i}`);
        }

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-items': 5,
              'tool-output-truncate-mode': 'truncate',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        const content = result.llmContent as string[];
        expect(content.length).toBe(5); // Only 5 files processed
        expect(result.returnDisplay).toContain(
          'Successfully read and concatenated content from **5 file(s)**',
        );
        expect(result.returnDisplay).toContain('**Skipped 1 item(s):**');
        expect(result.returnDisplay).toContain(
          '`5 file(s)` (Reason: truncated to stay within 5 file limit)',
        );
      });

      it('should sample files evenly when exceeding limit in sample mode', async () => {
        // Create 20 files
        for (let i = 1; i <= 20; i++) {
          createFile(
            `file${i.toString().padStart(2, '0')}.txt`,
            `Content of file ${i}`,
          );
        }

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-items': 5,
              'tool-output-truncate-mode': 'sample',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        const content = result.llmContent as string[];
        expect(content.length).toBe(5); // Only 5 files processed
        expect(result.returnDisplay).toContain(
          'Successfully read and concatenated content from **5 file(s)**',
        );
        expect(result.returnDisplay).toContain('**Skipped 1 item(s):**');
        expect(result.returnDisplay).toContain(
          '`15 file(s)` (Reason: sampling to stay within 5 file limit)',
        );

        // Check that we sampled evenly (should get files 1, 5, 9, 13, 17 approximately)
        const processedFiles =
          (result.returnDisplay as string).match(/file\d+\.txt/g) || [];
        expect(processedFiles.length).toBe(5);
      });
    });

    describe('token limits', () => {
      it('should warn and stop when exceeding token limit in warn mode', async () => {
        // Create files with enough content to exceed token limit
        createFile('file1.txt', 'a'.repeat(1000)); // ~250 tokens
        createFile('file2.txt', 'b'.repeat(1000)); // ~250 tokens
        createFile('file3.txt', 'c'.repeat(1000)); // ~250 tokens
        createFile('file4.txt', 'd'.repeat(1000)); // ~250 tokens

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-tokens': 500, // Very low token limit
              'tool-output-truncate-mode': 'warn',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        const content = result.llmContent as string[];
        expect(content.length).toBeLessThan(4); // Should stop before processing all files
        expect(result.returnDisplay).toContain(
          'Successfully read and concatenated content from',
        );
        expect(result.returnDisplay).toContain('**Skipped');
        expect(result.returnDisplay).toContain(
          'would exceed token limit of 500',
        );
      });

      it('should truncate content when exceeding token limit in truncate mode', async () => {
        // Create a file with long content
        const longContent = 'This is a very long content. '.repeat(200); // ~1600 tokens
        createFile('file1.txt', longContent);
        createFile('file2.txt', 'Short content');

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-tokens': 500,
              'tool-output-truncate-mode': 'truncate',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        const content = result.llmContent as string[];
        expect(
          content.some((c) =>
            c.includes('[CONTENT TRUNCATED DUE TO TOKEN LIMIT]'),
          ),
        ).toBe(true);
        expect(result.returnDisplay).toContain(
          'content truncated to fit token limit',
        );
      });

      it('should skip files when exceeding token limit in sample mode', async () => {
        // Create multiple files
        for (let i = 1; i <= 5; i++) {
          createFile(`file${i}.txt`, 'Content '.repeat(200)); // ~400 tokens each
        }

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-tokens': 1000,
              'tool-output-truncate-mode': 'sample',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        expect(result.returnDisplay).toContain(
          'skipped to stay within token limit',
        );
        const content = result.llmContent as string[];
        // Should have processed some files but not all
        expect(content.length).toBeGreaterThan(0);
        expect(content.length).toBeLessThan(5);
      });
    });

    describe('file size limits', () => {
      it('should skip files exceeding size limit', async () => {
        // Create a small file and a large file
        createFile('small.txt', 'Small content');
        const largeContent = 'x'.repeat(600 * 1024); // 600KB
        createFile('large.txt', largeContent);

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-item-size-limit': 524288, // 512KB
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        const content = result.llmContent as string[];
        expect(content.length).toBe(1); // Only small file processed
        expect(content[0]).toContain('Small content');
        expect(result.returnDisplay).toContain(
          'file size (600KB) exceeds limit (512KB)',
        );
      });

      it('should respect custom file size limit from ephemeral settings', async () => {
        // Create files of various sizes
        createFile('tiny.txt', 'x'.repeat(10));
        createFile('medium.txt', 'x'.repeat(200 * 1024)); // 200KB
        createFile('large.txt', 'x'.repeat(300 * 1024)); // 300KB

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-item-size-limit': 256 * 1024, // 256KB
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        expect(result.returnDisplay).toContain(
          'Successfully read and concatenated content from **2 file(s)**',
        );
        expect(result.returnDisplay).toContain(
          'file size (300KB) exceeds limit (256KB)',
        );
      });
    });

    describe('combined limits', () => {
      it('should handle multiple limits simultaneously', async () => {
        // Create many files with varying sizes
        for (let i = 1; i <= 10; i++) {
          const content = 'x'.repeat(i * 100); // Increasing sizes
          createFile(`file${i}.txt`, content);
        }

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () =>
            ({
              'tool-output-max-items': 5,
              'tool-output-max-tokens': 500,
              'tool-output-item-size-limit': 512,
              'tool-output-truncate-mode': 'sample',
            }) as Record<string, unknown>,
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        // Should be limited by multiple factors
        const content = result.llmContent as string[];
        expect(content.length).toBeLessThanOrEqual(5); // File count limit
        expect(result.returnDisplay).toMatch(
          /Successfully read and concatenated content from \*\*\d+ file\(s\)\*\*/,
        );
      });
    });

    describe('default values', () => {
      it('should use default limits when ephemeral settings are not provided', async () => {
        // Create 55 files (default limit is 50)
        for (let i = 1; i <= 55; i++) {
          createFile(`file${i}.txt`, `Content ${i}`);
        }

        const mockConfig = {
          getFileService: () => new FileDiscoveryService(tempRootDir),
          getFileFilteringOptions: () => ({
            respectGitIgnore: true,
            respectLlxprtIgnore: true,
          }),
          getTargetDir: () => tempRootDir,
          getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
          getEphemeralSettings: () => ({}) as Record<string, unknown>, // Empty settings
        } as Partial<Config> as Config;
        tool = new ReadManyFilesTool(mockConfig);

        const params = { paths: ['*.txt'] };
        const result = await tool.execute(params, new AbortController().signal);

        // Should use default warn mode and stop at 50 files
        expect(result.llmContent).toContain(
          'Found 55 files matching your pattern, but limiting to 50 files',
        );
      });
    });
  });
});
