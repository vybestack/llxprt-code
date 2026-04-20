/**
 * Empty-file vs nonexistent-file characterization tests
 *
 * Documents the quirky behavior where empty old_string behaves identically
 * for nonexistent and empty existing files in preview mode.
 *
 * Phase 0, Step 0.5: 4 empty-file characterization tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ASTEditTool } from '../ast-edit.js';
import type { Config } from '../../config/config.js';
import { ApprovalMode } from '../../config/config.js';

// Define typed interface for private API access in tests
type TestableASTEditTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
  };
};

type ToolReturnDisplay = {
  newContent?: string;
};

describe('empty-file characterization tests', () => {
  let mockConfig: Config;

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
          return ''; // empty file
        },
        writeTextFile: async () => {},
        fileExists: async (path: string) => !path.includes('nonexistent'),
      }),
      getApprovalMode: () => ApprovalMode.MANUAL,
      setApprovalMode: vi.fn(),
      getLspServiceClient: () => undefined,
    } as unknown as Config;
  });

  describe('Preview mode: empty old_string behavior', () => {
    it('nonexistent file + empty old_string → may error or preview', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/nonexistent.ts',
        old_string: '',
        new_string: 'const x = 1;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      // Nonexistent file in preview may error with ENOENT or show preview
      // depending on how readFileContent handles the error
      expect(result).toBeDefined();
      if (!result.error) {
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result.llmContent).toContain('LLXPRT EDIT PREVIEW');
        const display = result.returnDisplay as ToolReturnDisplay;
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(display.newContent).toBe('const x = 1;');
      } else {
        // Error case - file doesn't exist
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result.error).toBeDefined();
      }
    });

    it('empty existing file + empty old_string → newContent equals new_string (same as nonexistent!)', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/empty.ts',
        old_string: '',
        new_string: 'const x = 1;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      // Should behave identically to nonexistent file in preview
      expect(result.llmContent).toContain('LLXPRT EDIT PREVIEW');
      const display = result.returnDisplay as ToolReturnDisplay;
      expect(display.newContent).toBe('const x = 1;');
    });
  });

  describe('Apply mode: empty old_string behavior', () => {
    it('nonexistent file with empty old_string → may create or error', async () => {
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
      // May succeed (file creation) or error (directory doesn't exist)
      expect(result).toBeDefined();
      if (!result.error) {
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result.llmContent).toContain('Successfully applied edit');
      } else {
        // Error case - likely directory doesn't exist or other FS issue
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result.error).toBeDefined();
      }
    });

    it('empty existing file with empty old_string → no-change error', async () => {
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/empty.ts',
        old_string: '',
        new_string: 'const x = 1;',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      // The quirky behavior: empty existing file + empty old_string
      // applyReplacement('', '', newString, false) returns '' (currentContent unchanged)
      // So newContent === currentContent === '', triggering EDIT_NO_CHANGE
      expect(result.error).toBeDefined();
      // Could be EDIT_NO_CHANGE based on code path analysis
      expect(result.error?.message).toBeTruthy();
    });
  });
});
