/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadFileTool, ReadFileToolParams } from './read-file.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import fsp from 'fs/promises';
import { Config } from '../config/config.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { ToolInvocation, ToolResult } from './tools.js';
import { ToolErrorType } from './tool-error.js';

describe('ReadFileTool', () => {
  let tempRootDir: string;
  let tool: ReadFileTool;
  const abortSignal = new AbortController().signal;

  beforeEach(async () => {
    // Create a unique temporary root directory for each test run
    tempRootDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'read-file-tool-root-'),
    );
    const mockConfigInstance = {
      getFileService: () => new FileDiscoveryService(tempRootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getTargetDir: () => tempRootDir,
      getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
      getConversationLoggingEnabled: () => false,
    } as unknown as Config;
    tool = new ReadFileTool(mockConfigInstance);
  });

  afterEach(async () => {
    // Clean up the temporary root directory
    if (fs.existsSync(tempRootDir)) {
      await fsp.rm(tempRootDir, { recursive: true, force: true });
    }
  });

  describe('build', () => {
    it('should return an invocation for valid params (absolute path within root)', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
      };
      const result = tool.build(params);
      expect(result).not.toBeTypeOf('string');
      expect(typeof result).toBe('object');
      expect(
        (result as ToolInvocation<ReadFileToolParams, ToolResult>).params,
      ).toEqual(params);
    });

    it('should return an invocation for valid params with offset and limit', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: 0,
        limit: 10,
      };
      const result = tool.build(params);
      expect(result).not.toBeTypeOf('string');
    });

    it('should throw error for relative path', () => {
      const params: ReadFileToolParams = { absolute_path: 'test.txt' };
      expect(() => tool.build(params)).toThrow(
        `File path must be absolute, but was relative: test.txt. You must provide an absolute path.`,
      );
    });

    it('should throw error for path outside root', () => {
      const outsidePath = path.resolve(os.tmpdir(), 'outside-root.txt');
      const params: ReadFileToolParams = { absolute_path: outsidePath };
      expect(() => tool.build(params)).toThrow(
        'File path must be within one of the workspace directories',
      );
    });

    it('should throw error if path is empty', () => {
      const params: ReadFileToolParams = {
        absolute_path: '',
      };
      expect(() => tool.build(params)).toThrow(
        /Either 'absolute_path' or 'file_path' parameter must be provided and non-empty./,
      );
    });

    it('should throw error if offset is negative', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: -1,
        limit: 10,
      };
      expect(() => tool.build(params)).toThrow(
        'Offset must be a non-negative number',
      );
    });

    it('should throw error for non-positive limit', () => {
      const paramsZero: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: 0,
        limit: 0,
      };
      expect(() => tool.build(paramsZero)).toThrow(
        'Limit must be a positive number',
      );
      const paramsNegative: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'test.txt'),
        offset: 0,
        limit: -5,
      };
      expect(() => tool.build(paramsNegative)).toThrow(
        'Limit must be a positive number',
      );
    });

    it('should throw error for schema validation failure (e.g. missing path)', () => {
      const params = { offset: 0 } as unknown as ReadFileToolParams;
      expect(() => tool.build(params)).toThrow(
        `Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.`,
      );
    });
  });

  describe('ToolInvocation', () => {
    describe('getDescription', () => {
      it('should return a shortened, relative path', () => {
        const filePath = path.join(tempRootDir, 'sub', 'dir', 'file.txt');
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params);
        expect(typeof invocation).not.toBe('string');
        expect(
          (
            invocation as ToolInvocation<ReadFileToolParams, ToolResult>
          ).getDescription(),
        ).toBe(path.join('sub', 'dir', 'file.txt'));
      });

      it('should return . if path is the root directory', () => {
        const params: ReadFileToolParams = { absolute_path: tempRootDir };
        const invocation = tool.build(params);
        expect(typeof invocation).not.toBe('string');
        expect(
          (
            invocation as ToolInvocation<ReadFileToolParams, ToolResult>
          ).getDescription(),
        ).toBe('.');
      });
    });

    describe('execute', () => {
      it('should return error if file does not exist', async () => {
        const filePath = path.join(tempRootDir, 'nonexistent.txt');
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;
        const result = await invocation.execute(abortSignal);
        expect(result).toEqual({
          error: {
            message: `File not found: ${filePath}`,
            type: 'file_not_found',
          },
          llmContent:
            'Could not read file because no file was found at the specified path.',
          returnDisplay: 'File not found.',
        });
      });

      it('should return success result for a text file', async () => {
        const filePath = path.join(tempRootDir, 'textfile.txt');
        const fileContent = 'This is a test file.';
        await fsp.writeFile(filePath, fileContent, 'utf-8');
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        expect(await invocation.execute(abortSignal)).toEqual({
          llmContent: fileContent,
          returnDisplay: '',
        });
      });

      it('should return success result for an image file', async () => {
        // A minimal 1x1 transparent PNG file.
        const pngContent = Buffer.from([
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
          1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68,
          65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0,
          0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]);
        const filePath = path.join(tempRootDir, 'image.png');
        await fsp.writeFile(filePath, pngContent);
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        expect(await invocation.execute(abortSignal)).toEqual({
          llmContent: {
            inlineData: {
              mimeType: 'image/png',
              data: pngContent.toString('base64'),
            },
          },
          returnDisplay: `Read image file: image.png`,
        });
      });

      it('should treat a non-image file with image extension as an image', async () => {
        const filePath = path.join(tempRootDir, 'fake-image.png');
        const fileContent = 'This is not a real png.';
        await fsp.writeFile(filePath, fileContent, 'utf-8');
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        expect(await invocation.execute(abortSignal)).toEqual({
          llmContent: {
            inlineData: {
              mimeType: 'image/png',
              data: Buffer.from(fileContent).toString('base64'),
            },
          },
          returnDisplay: `Read image file: fake-image.png`,
        });
      });

      it('should return a structured message when a slice of a text file is read', async () => {
        const filePath = path.join(tempRootDir, 'paginated.txt');
        const fileContent = Array.from(
          { length: 20 },
          (_, i) => `Line ${i + 1}`,
        ).join('\n');
        await fsp.writeFile(filePath, fileContent, 'utf-8');

        const params: ReadFileToolParams = {
          absolute_path: filePath,
          offset: 5, // Start from line 6
          limit: 3,
        };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);

        const expectedLlmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines 6-8 of 20 total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: 8.

--- FILE CONTENT (truncated) ---
Line 6
Line 7
Line 8`;

        expect(result.llmContent).toEqual(expectedLlmContent);
        expect(result.returnDisplay).toBe(
          'Read lines 6-8 of 20 from paginated.txt',
        );
      });

      it('should prefix returned lines with virtual line numbers when showLineNumbers is true (paginated)', async () => {
        const filePath = path.join(tempRootDir, 'paginated-numbered.txt');
        const fileContent = Array.from(
          { length: 20 },
          (_, i) => `Line ${i + 1}`,
        ).join('\n');
        await fsp.writeFile(filePath, fileContent, 'utf-8');

        const params: ReadFileToolParams = {
          absolute_path: filePath,
          offset: 5, // Start from line 6
          limit: 3,
          showLineNumbers: true,
        };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);

        const expectedLlmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines 6-8 of 20 total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: 8.

--- FILE CONTENT (truncated) ---
   6| Line 6
   7| Line 7
   8| Line 8`;

        expect(result.llmContent).toEqual(expectedLlmContent);
      });

      it('should prefix returned lines with virtual line numbers when showLineNumbers is true (non-truncated)', async () => {
        const filePath = path.join(tempRootDir, 'numbered.txt');
        const fileContent = ['Line 1', 'Line 2', 'Line 3'].join('\n');
        await fsp.writeFile(filePath, fileContent, 'utf-8');

        const params: ReadFileToolParams = {
          absolute_path: filePath,
          showLineNumbers: true,
        };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);

        const expectedLlmContent = [
          '   1| Line 1',
          '   2| Line 2',
          '   3| Line 3',
        ].join('\n');

        expect(result.llmContent).toEqual(expectedLlmContent);
      });

      describe('with .llxprtignore', () => {
        beforeEach(async () => {
          await fsp.writeFile(
            path.join(tempRootDir, '.llxprtignore'),
            ['foo.*', 'ignored/'].join('\n'),
          );
        });

        it('should throw error if path is ignored by a .llxprtignore pattern', async () => {
          const ignoredFilePath = path.join(tempRootDir, 'foo.bar');
          await fsp.writeFile(ignoredFilePath, 'content', 'utf-8');
          const params: ReadFileToolParams = {
            absolute_path: ignoredFilePath,
          };
          const expectedError = `File path '${ignoredFilePath}' is ignored by .llxprtignore pattern(s).`;
          expect(() => tool.build(params)).toThrow(expectedError);
        });
      });

      it('should return success result for a text file in validate mode', async () => {
        const filePath = path.join(tempRootDir, 'textfile.txt');
        const fileContent = 'This is a test file.';
        await fsp.writeFile(filePath, fileContent, 'utf-8');
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        expect(await invocation.execute(abortSignal)).toEqual({
          llmContent: fileContent,
          returnDisplay: '',
        });
      });

      it('should return success result for an image file in validate mode', async () => {
        // A minimal 1x1 transparent PNG file.
        const pngContent = Buffer.from([
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
          1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68,
          65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0,
          0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]);
        const filePath = path.join(tempRootDir, 'image.png');
        await fsp.writeFile(filePath, pngContent);
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        expect(await invocation.execute(abortSignal)).toEqual({
          llmContent: {
            inlineData: {
              mimeType: 'image/png',
              data: pngContent.toString('base64'),
            },
          },
          returnDisplay: `Read image file: image.png`,
        });
      });

      it('should treat a non-image file with image extension as an image in validate mode', async () => {
        const filePath = path.join(tempRootDir, 'fake-image.png');
        const fileContent = 'This is not a real png.';
        await fsp.writeFile(filePath, fileContent, 'utf-8');
        const params: ReadFileToolParams = { absolute_path: filePath };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        expect(await invocation.execute(abortSignal)).toEqual({
          llmContent: {
            inlineData: {
              mimeType: 'image/png',
              data: Buffer.from(fileContent).toString('base64'),
            },
          },
          returnDisplay: `Read image file: fake-image.png`,
        });
      });

      it('should pass offset and limit to read a slice of a text file', async () => {
        const filePath = path.join(tempRootDir, 'paginated.txt');
        const fileContent = Array.from(
          { length: 20 },
          (_, i) => `Line ${i + 1}`,
        ).join('\n');
        await fsp.writeFile(filePath, fileContent, 'utf-8');

        const params: ReadFileToolParams = {
          absolute_path: filePath,
          offset: 5, // Start from line 6
          limit: 3,
        };
        const invocation = tool.build(params) as ToolInvocation<
          ReadFileToolParams,
          ToolResult
        >;

        const result = await invocation.execute(abortSignal);

        const expectedLlmContent = `
IMPORTANT: The file content has been truncated.
Status: Showing lines 6-8 of 20 total lines.
Action: To read more of the file, you can use the 'offset' and 'limit' parameters in a subsequent 'read_file' call. For example, to read the next section of the file, use offset: 8.

--- FILE CONTENT (truncated) ---
Line 6
Line 7
Line 8`;

        expect(result.llmContent).toEqual(expectedLlmContent);
        expect(result.returnDisplay).toBe(
          'Read lines 6-8 of 20 from paginated.txt',
        );
      });
    });

    it('should return error if path is a directory', async () => {
      const dirPath = path.join(tempRootDir, 'directory');
      await fsp.mkdir(dirPath);
      const params: ReadFileToolParams = { absolute_path: dirPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result).toEqual({
        llmContent:
          'Could not read file because the provided path is a directory, not a file.',
        returnDisplay: 'Path is a directory.',
        error: {
          message: `Path is a directory, not a file: ${dirPath}`,
          type: ToolErrorType.TARGET_IS_DIRECTORY,
        },
      });
    });

    it('should return error for a file that is too large', async () => {
      const filePath = path.join(tempRootDir, 'largefile.txt');
      // 21MB of content exceeds 20MB limit
      const largeContent = 'x'.repeat(21 * 1024 * 1024);
      await fsp.writeFile(filePath, largeContent, 'utf-8');
      const params: ReadFileToolParams = { absolute_path: filePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result).toHaveProperty('error');
      expect(result.error?.type).toBe(ToolErrorType.FILE_TOO_LARGE);
      expect(result.error?.message).toContain(
        'File size exceeds the 20MB limit',
      );
    });

    it('should handle text file with lines exceeding maximum length', async () => {
      const filePath = path.join(tempRootDir, 'longlines.txt');
      const longLine = 'a'.repeat(2500); // Exceeds MAX_LINE_LENGTH_TEXT_FILE (2000)
      const fileContent = `Short line\n${longLine}\nAnother short line`;
      await fsp.writeFile(filePath, fileContent, 'utf-8');
      const params: ReadFileToolParams = { absolute_path: filePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'IMPORTANT: The file content has been truncated',
      );
      expect(result.llmContent).toContain('--- FILE CONTENT (truncated) ---');
      expect(result.returnDisplay).toContain('some lines were shortened');
    });

    it('should handle image file and return appropriate content', async () => {
      const imagePath = path.join(tempRootDir, 'image.png');
      // Minimal PNG header
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      await fsp.writeFile(imagePath, pngHeader);
      const params: ReadFileToolParams = { absolute_path: imagePath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toEqual({
        inlineData: {
          data: pngHeader.toString('base64'),
          mimeType: 'image/png',
        },
      });
      expect(result.returnDisplay).toBe('Read image file: image.png');
    });

    it('should handle PDF file and return appropriate content', async () => {
      const pdfPath = path.join(tempRootDir, 'document.pdf');
      // Minimal PDF header
      const pdfHeader = Buffer.from('%PDF-1.4');
      await fsp.writeFile(pdfPath, pdfHeader);
      const params: ReadFileToolParams = { absolute_path: pdfPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toEqual({
        inlineData: {
          data: pdfHeader.toString('base64'),
          mimeType: 'application/pdf',
        },
      });
      expect(result.returnDisplay).toBe('Read pdf file: document.pdf');
    });

    it('should handle binary file and skip content', async () => {
      const binPath = path.join(tempRootDir, 'binary.bin');
      // Binary data with null bytes
      const binaryData = Buffer.from([0x00, 0xff, 0x00, 0xff]);
      await fsp.writeFile(binPath, binaryData);
      const params: ReadFileToolParams = { absolute_path: binPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe(
        'Cannot display content of binary file: binary.bin',
      );
      expect(result.returnDisplay).toBe('Skipped binary file: binary.bin');
    });

    it('should handle SVG file as text', async () => {
      const svgPath = path.join(tempRootDir, 'image.svg');
      const svgContent = '<svg><circle cx="50" cy="50" r="40"/></svg>';
      await fsp.writeFile(svgPath, svgContent, 'utf-8');
      const params: ReadFileToolParams = { absolute_path: svgPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe(svgContent);
      expect(result.returnDisplay).toBe('Read SVG as text: image.svg');
    });

    it('should handle large SVG file', async () => {
      const svgPath = path.join(tempRootDir, 'large.svg');
      // Create SVG content larger than 1MB
      const largeContent = '<svg>' + 'x'.repeat(1024 * 1024 + 1) + '</svg>';
      await fsp.writeFile(svgPath, largeContent, 'utf-8');
      const params: ReadFileToolParams = { absolute_path: svgPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe(
        'Cannot display content of SVG file larger than 1MB: large.svg',
      );
      expect(result.returnDisplay).toBe(
        'Skipped large SVG file (>1MB): large.svg',
      );
    });

    it('should handle empty file', async () => {
      const emptyPath = path.join(tempRootDir, 'empty.txt');
      await fsp.writeFile(emptyPath, '', 'utf-8');
      const params: ReadFileToolParams = { absolute_path: emptyPath };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toBe('');
      expect(result.returnDisplay).toBe('');
    });

    it('should support offset and limit for text files', async () => {
      const filePath = path.join(tempRootDir, 'paginated.txt');
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
      const fileContent = lines.join('\n');
      await fsp.writeFile(filePath, fileContent, 'utf-8');

      const params: ReadFileToolParams = {
        absolute_path: filePath,
        offset: 5, // Start from line 6
        limit: 3,
      };
      const invocation = tool.build(params) as ToolInvocation<
        ReadFileToolParams,
        ToolResult
      >;

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'IMPORTANT: The file content has been truncated',
      );
      expect(result.llmContent).toContain(
        'Status: Showing lines 6-8 of 20 total lines',
      );
      expect(result.llmContent).toContain('Line 6');
      expect(result.llmContent).toContain('Line 7');
      expect(result.llmContent).toContain('Line 8');
      expect(result.returnDisplay).toBe(
        'Read lines 6-8 of 20 from paginated.txt',
      );
    });

    describe('with .llxprtignore for ignored directory', () => {
      beforeEach(async () => {
        await fsp.writeFile(
          path.join(tempRootDir, '.llxprtignore'),
          ['foo.*', 'ignored/'].join('\n'),
        );
      });

      it('should throw error if path is in an ignored directory', async () => {
        const ignoredDirPath = path.join(tempRootDir, 'ignored');
        await fsp.mkdir(ignoredDirPath);
        const filePath = path.join(ignoredDirPath, 'somefile.txt');
        await fsp.writeFile(filePath, 'content', 'utf-8');

        const params: ReadFileToolParams = {
          absolute_path: filePath,
        };
        const expectedError = `File path '${filePath}' is ignored by .llxprtignore pattern(s).`;
        expect(() => tool.build(params)).toThrow(expectedError);
      });
    });
  });

  describe('workspace boundary validation', () => {
    it('should validate paths are within workspace root', () => {
      const params: ReadFileToolParams = {
        absolute_path: path.join(tempRootDir, 'file.txt'),
      };
      expect(() => tool.build(params)).not.toThrow();
    });

    it('should reject paths outside workspace root', () => {
      const params: ReadFileToolParams = {
        absolute_path: '/etc/passwd',
      };
      expect(() => tool.build(params)).toThrow(
        'File path must be within one of the workspace directories',
      );
    });

    it('should provide clear error message with workspace directories', () => {
      const outsidePath = path.join(os.tmpdir(), 'outside-workspace.txt');
      const params: ReadFileToolParams = {
        absolute_path: outsidePath,
      };
      expect(() => tool.build(params)).toThrow(
        'File path must be within one of the workspace directories',
      );
    });
  });
});
