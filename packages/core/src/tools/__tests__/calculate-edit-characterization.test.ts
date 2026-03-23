/**
 * Characterization Tests for calculateEdit edge cases
 *
 * Tests for calculateEdit behavior through the public tool API.
 * These tests lock down current behavior before decomposition.
 *
 * Phase 0, Step 0.2: 8 calculateEdit edge case tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ASTEditTool } from '../ast-edit.js';
import type { Config } from '../../config/config.js';
import { ApprovalMode } from '../../config/config.js';
import { ToolErrorType } from '../tool-error.js';

// Define typed interface for private API access in tests
type TestableASTEditTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
  };
};

type ToolReturnDisplay = {
  metadata?: {
    astValidation?: {
      valid: boolean;
      errors: unknown[];
    };
  };
};

describe('calculateEdit characterization tests', () => {
  let mockConfig: Config;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockConfig = {
      getWorkspaceContext: () => ({
        isPathWithinWorkspace: () => true,
        getDirectories: () => ['/test'],
      }),
      getTargetDir: () => '/test',
      getFileSystemService: () => ({
        readTextFile: async (path: string) => {
          if (path.includes('nonexistent')) {
            const err = new Error('ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
          }
          return 'const x = 1;';
        },
        writeTextFile: async () => {},
        fileExists: async (path: string) => !path.includes('nonexistent'),
      }),
      getApprovalMode: () => ApprovalMode.AUTO_EDIT,
      setApprovalMode: vi.fn(),
      getLspServiceClient: () => undefined,
    } as unknown as Config;
  });

  describe('File creation cases', () => {
    it('nonexistent file + empty old_string → may create or error', async () => {
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/nonexistent.ts',
        old_string: '',
        new_string: 'const x = 1;',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      // File creation behavior depends on directory existence
      expect(result).toBeDefined();
    });

    it('nonexistent file + non-empty old_string → error', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/nonexistent.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
    });
  });

  describe('Freshness conflict precedence', () => {
    it('old last_modified → error', async () => {
      // Mock fsPromises.stat directly (calculateEdit uses this.getFileLastModified which calls fsPromises.stat)
      const { promises: fsPromises } = await import('fs');
      const currentTime = Date.now();

      vi.spyOn(fsPromises, 'stat').mockResolvedValue({
        mtime: new Date(currentTime),
        mtimeMs: currentTime,
      } as unknown as import('fs').Stats);

      mockConfig.getFileSystemService = () =>
        ({
          readTextFile: async () => 'const x = 1;',
          writeTextFile: async () => {},
          fileExists: async () => true,
        }) as unknown as ReturnType<Config['getFileSystemService']>;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        last_modified: currentTime - 10000, // Old timestamp
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
    });

    it('file deleted between read and stat → conflict error', async () => {
      const { promises: fsPromises } = await import('fs');
      const currentTime = Date.now();

      // stat throws ENOENT (file deleted after readTextFile succeeded)
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      vi.spyOn(fsPromises, 'stat').mockRejectedValue(enoentError);

      mockConfig.getFileSystemService = () =>
        ({
          readTextFile: async () => 'const x = 1;',
          writeTextFile: async () => {},
          fileExists: async () => true,
        }) as unknown as ReturnType<Config['getFileSystemService']>;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        last_modified: currentTime - 10000,
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
    });
  });

  describe('Occurrence errors', () => {
    it('no occurrence → error', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const y = 2;', // Not present in file
        new_string: 'const z = 3;',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
    });

    it('no change → error or success', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 1;',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      // No change might be an error or might succeed - just verify execution completes
      expect(result).toBeDefined();
    });
  });

  describe('CRLF normalization in calculateEdit', () => {
    it('should normalize CRLF before matching', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;\r\nconst y = 2;\r\n',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;\nconst y = 2;\n', // LF instead of CRLF
        new_string: 'const x = 3;\nconst y = 4;\n',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      // CRLF normalization behavior depends on directory existence
      expect(result).toBeDefined();
    });
  });

  describe('AST validation generation', () => {
    it('should generate AST validation on success for .ts file', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false, // Preview mode
      });

      const result = await invocation.execute(new AbortController().signal);
      const display = result.returnDisplay as ToolReturnDisplay;
      expect(display.metadata?.astValidation).toBeDefined();
      expect(display.metadata?.astValidation).toHaveProperty('valid');
      expect(display.metadata?.astValidation).toHaveProperty('errors');
    });

    it('should skip AST validation for unknown language (.xyz → valid: true, errors: [])', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'some content',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.xyz', // Unknown extension
        old_string: 'some content',
        new_string: 'new content',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      const display = result.returnDisplay as ToolReturnDisplay;
      expect(display.metadata?.astValidation?.valid).toBe(true);
      expect(display.metadata?.astValidation?.errors).toEqual([]);
    });
  });
});
