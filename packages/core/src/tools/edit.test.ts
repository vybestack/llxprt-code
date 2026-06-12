/* eslint-disable no-console */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines -- Phase 5: large behavioral coverage file retained together to avoid fragmenting related scenarios. */

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockGenerateJson = vi.hoisted(() => vi.fn());
const mockOpenDiff = vi.hoisted(() => vi.fn());

import { IDEConnectionStatus } from '../ide/ide-client.js';

vi.mock('../utils/editor.js', () => ({
  openDiff: mockOpenDiff,
}));

interface EditFileParameterSchema {
  properties: {
    file_path: {
      description: string;
    };
    replaceBeginLineNumber?: {
      description: string;
    };
  };
}

import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EditToolParams } from './edit.js';
import { applyReplacement, EditTool } from './edit.js';
import {
  countLineGuardedOccurrences,
  applyLineGuardedReplacement,
} from './edit-utils.js';
import type { FileDiff } from './tools.js';
import { ToolConfirmationOutcome } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import type { Content, Part } from '@google/genai';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';

describe('EditTool', () => {
  let tool: EditTool;
  let tempDir: string;
  let rootDir: string;
  let mockConfig: Config;
  let agentClient: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-tool-test-'));
    rootDir = path.join(tempDir, 'root');
    fs.mkdirSync(rootDir);

    agentClient = {
      generateJson: mockGenerateJson, // mockGenerateJson is already defined and hoisted
    };

    mockConfig = {
      getAgentClient: vi.fn().mockReturnValue(agentClient),
      getTargetDir: () => rootDir,
      getApprovalMode: vi.fn(),
      setApprovalMode: vi.fn(),
      getWorkspaceContext: () => createMockWorkspaceContext(rootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getIdeClient: () => undefined,
      getIdeMode: () => false,
      // getGeminiConfig: () => ({ apiKey: 'test-api-key' }), // This was not a real Config method
      // Add other properties/methods of Config if EditTool uses them
      // Minimal other methods to satisfy Config type if needed by EditTool constructor or other direct uses:
      getApiKey: () => 'test-api-key',
      getModel: () => 'test-model',
      getSandbox: () => false,
      getDebugMode: () => false,
      getQuestion: () => undefined,

      getToolDiscoveryCommand: () => undefined,
      getToolCallCommand: () => undefined,
      getMcpServerCommand: () => undefined,
      getMcpServers: () => undefined,
      getUserAgent: () => 'test-agent',
      getUserMemory: () => '',
      setUserMemory: vi.fn(),
      getLlxprtMdFileCount: () => 0,
      setLlxprtMdFileCount: vi.fn(),
      getConversationLoggingEnabled: () => false,
      getEphemeralSetting: vi.fn(() => 'auto'), // Default to 'auto' for emoji filter
      getToolRegistry: () => ({}) as any, // Minimal mock for ToolRegistry
    } as unknown as Config;

    // Reset mocks before each test
    (mockConfig.getApprovalMode as Mock).mockClear();
    // Default to not skipping confirmation
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.DEFAULT);

    // Default mock for generateJson to return the snippet unchanged
    mockGenerateJson.mockReset();
    mockGenerateJson.mockImplementation(
      async (contents: Content[], schema: Record<string, unknown>) => {
        // The problematic_snippet is the last part of the user's content
        const userContent = contents.find((c: Content) => c.role === 'user');
        let promptText = '';
        if (userContent?.parts) {
          promptText = userContent.parts
            .filter((p: Part) => typeof (p as any).text === 'string')
            .map((p: Part) => (p as any).text)
            .join('\n');
        }
        const snippetMatch = promptText.match(
          /Problematic target snippet:\n```\n([\s\S]*?)\n```/,
        );
        const problematicSnippet = snippetMatch?.[1] ?? '';

        const schemaProps = (schema as { properties?: Record<string, unknown> })
          .properties;
        if (schemaProps != null && 'corrected_target_snippet' in schemaProps) {
          return Promise.resolve({
            corrected_target_snippet: problematicSnippet,
          });
        }
        if (schemaProps != null && 'corrected_new_string' in schemaProps) {
          // For new_string correction, we might need more sophisticated logic,
          // but for now, returning original is a safe default if not specified by a test.
          const originalNewStringMatch = promptText.match(
            /original_new_string \(what was intended to replace original_old_string\):\n```\n([\s\S]*?)\n```/,
          );
          const originalNewString = originalNewStringMatch?.[1] ?? '';
          return Promise.resolve({ corrected_new_string: originalNewString });
        }
        return Promise.resolve({}); // Default empty object if schema doesn't match
      },
    );

    tool = new EditTool(mockConfig);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('applyReplacement', () => {
    // Test the exported applyReplacement function
    it('should return newString if isNewFile is true', () => {
      expect(applyReplacement(null, 'old', 'new', true)).toBe('new');
      expect(applyReplacement('existing', 'old', 'new', true)).toBe('new');
    });

    it('should return newString if currentContent is null and oldString is empty (defensive)', () => {
      expect(applyReplacement(null, '', 'new', false)).toBe('new');
    });

    it('should return empty string if currentContent is null and oldString is not empty (defensive)', () => {
      expect(applyReplacement(null, 'old', 'new', false)).toBe('');
    });

    it('should replace oldString with newString in currentContent', () => {
      // With default expected_replacements=1, should only replace first occurrence
      expect(applyReplacement('hello old world old', 'old', 'new', false)).toBe(
        'hello new world old',
      );
    });

    it('should replace multiple occurrences when expectedReplacements is specified', () => {
      expect(
        applyReplacement('hello old world old', 'old', 'new', false, 2),
      ).toBe('hello new world new');
    });

    it('should return currentContent if oldString is empty and not a new file', () => {
      expect(applyReplacement('hello world', '', 'new', false)).toBe(
        'hello world',
      );
    });

    it('should preserve trailing newline when currentContent ends with one', () => {
      expect(
        applyReplacement('line\n', 'line\n', 'line # updated', false),
      ).toBe('line # updated\n');
    });
  });

  describe('validateToolParams', () => {
    it('should return null for valid params', () => {
      const params: EditToolParams = {
        file_path: path.join(rootDir, 'test.txt'),
        old_string: 'old',
        new_string: 'new',
      };
      // No error should be thrown when building with valid params
      expect(() => tool.build(params)).not.toThrow();
    });

    it('should return error for relative path', () => {
      const params: EditToolParams = {
        file_path: 'test.txt',
        old_string: 'old',
        new_string: 'new',
      };
      expect(() => tool.build(params)).toThrow(/File path must be absolute/);
    });

    it('should return error for path outside root', () => {
      const params: EditToolParams = {
        file_path: path.join(tempDir, 'outside-root.txt'),
        old_string: 'old',
        new_string: 'new',
      };
      expect(() => tool.build(params)).toThrow(
        /File path must be within one of the workspace directories/,
      );
    });
  });

  describe('shouldConfirmExecute', () => {
    const testFile = 'edit_me.txt';
    let filePath: string;

    beforeEach(() => {
      filePath = path.join(rootDir, testFile);
    });

    it('should return false if params are invalid', async () => {
      const params: EditToolParams = {
        file_path: 'relative.txt',
        old_string: 'old',
        new_string: 'new',
      };
      // Invalid params should throw during build
      expect(() => tool.build(params)).toThrow(/File path must be absolute/);
    });

    it('should request confirmation for valid edit', async () => {
      fs.writeFileSync(filePath, 'some old content here');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmation).toStrictEqual(
        expect.objectContaining({
          title: `Confirm Edit: ${testFile}`,
          fileName: testFile,
          fileDiff: expect.any(String),
        }),
      );
    });

    it('should return false if old_string is not found', async () => {
      fs.writeFileSync(filePath, 'some content here');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'not_found',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      expect(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
    });

    it('should return false if multiple occurrences of old_string are found', async () => {
      fs.writeFileSync(filePath, 'old old content here');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      expect(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
    });

    it('should request confirmation for creating a new file (empty old_string)', async () => {
      const newFileName = 'new_file.txt';
      const newFilePath = path.join(rootDir, newFileName);
      const params: EditToolParams = {
        file_path: newFilePath,
        old_string: '',
        new_string: 'new file content',
      };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmation).toStrictEqual(
        expect.objectContaining({
          title: `Confirm Edit: ${newFileName}`,
          fileName: newFileName,
          fileDiff: expect.any(String),
        }),
      );
    });

    it('should rethrow calculateEdit errors when the abort signal is triggered', async () => {
      const params: EditToolParams = {
        file_path: path.join(rootDir, 'abort-confirmation.txt'),
        old_string: 'old',
        new_string: 'new',
      };

      const invocation = tool.build(params);
      const abortController = new AbortController();
      const abortError = new Error('Abort requested during confirmation');

      const calculateSpy = vi
        .spyOn(invocation as any, 'calculateEdit')
        .mockImplementation(async () => {
          if (!abortController.signal.aborted) {
            abortController.abort();
          }
          throw abortError;
        });

      await expect(
        invocation.shouldConfirmExecute(abortController.signal),
      ).rejects.toBe(abortError);

      calculateSpy.mockRestore();
    });

    it('should rethrow calculateEdit errors when the abort signal is triggered during confirmation', async () => {
      const filePath = path.join(rootDir, 'abort-confirmation.txt');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };

      const invocation = tool.build(params);
      const abortController = new AbortController();
      const abortError = new Error('Abort requested');

      const calculateSpy = vi
        .spyOn(invocation as any, 'calculateEdit')
        .mockImplementation(async () => {
          if (!abortController.signal.aborted) {
            abortController.abort();
          }
          throw abortError;
        });

      await expect(
        invocation.shouldConfirmExecute(abortController.signal),
      ).rejects.toBe(abortError);

      calculateSpy.mockRestore();
    });
  });

  describe('execute', () => {
    const testFile = 'execute_me.txt';
    let filePath: string;

    beforeEach(() => {
      filePath = path.join(rootDir, testFile);
    });

    it('should throw error if file path is not absolute', async () => {
      const params: EditToolParams = {
        file_path: 'relative.txt',
        old_string: 'old',
        new_string: 'new',
      };
      // Invalid params should throw during build
      expect(() => tool.build(params)).toThrow(/File path must be absolute/);
    });

    it('should throw error if file path is empty', async () => {
      const params: EditToolParams = {
        file_path: '',
        old_string: 'old',
        new_string: 'new',
      };
      expect(() => tool.build(params)).toThrow(
        /Either 'absolute_path' or 'file_path' parameter must be provided and non-empty./,
      );
    });

    it('should reject when calculateEdit fails after an abort signal', async () => {
      const params: EditToolParams = {
        file_path: path.join(rootDir, 'abort-execute.txt'),
        old_string: 'old',
        new_string: 'new',
      };

      const invocation = tool.build(params);
      const abortController = new AbortController();
      const abortError = new Error('Abort requested during execute');

      const calculateSpy = vi
        .spyOn(invocation as any, 'calculateEdit')
        .mockImplementation(async () => {
          if (!abortController.signal.aborted) {
            abortController.abort();
          }
          throw abortError;
        });

      await expect(invocation.execute(abortController.signal)).rejects.toBe(
        abortError,
      );

      calculateSpy.mockRestore();
    });

    it('should edit an existing file and return diff with fileName', async () => {
      const initialContent = 'This is some old text.';
      const newContent = 'This is some new text.'; // old -> new
      fs.writeFileSync(filePath, initialContent, 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };

      // Simulate confirmation by setting shouldAlwaysEdit
      (tool as any).shouldAlwaysEdit = true;

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      (tool as any).shouldAlwaysEdit = false; // Reset for other tests

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(newContent);
      const display = result.returnDisplay as FileDiff;
      expect(display.fileDiff).toMatch(initialContent);
      expect(display.fileDiff).toMatch(newContent);
      expect(display.fileName).toBe(testFile);
    });

    it('should create a new file if old_string is empty and file does not exist, and return created message', async () => {
      const newFileName = 'brand_new_file.txt';
      const newFilePath = path.join(rootDir, newFileName);
      const fileContent = 'Content for the new file.';
      const params: EditToolParams = {
        file_path: newFilePath,
        old_string: '',
        new_string: fileContent,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Created new file/);
      expect(fs.existsSync(newFilePath)).toBe(true);
      expect(fs.readFileSync(newFilePath, 'utf8')).toBe(fileContent);

      const display = result.returnDisplay as FileDiff;
      expect(display.fileDiff).toMatch(/\+Content for the new file\./);
      expect(display.fileName).toBe(newFileName);
      expect((result.returnDisplay as FileDiff).diffStat).toStrictEqual({
        ai_added_lines: 1,
        ai_removed_lines: 0,
        user_added_lines: 0,
        user_removed_lines: 0,
      });
    });

    it('should return error if old_string is not found in file', async () => {
      fs.writeFileSync(filePath, 'Some content.', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'nonexistent',
        new_string: 'replacement',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toMatch(
        /0 occurrences found for old_string in/,
      );
      expect(result.returnDisplay).toMatch(
        /Failed to edit, could not find the string to replace./,
      );
    });

    it('should return error if multiple occurrences of old_string are found', async () => {
      fs.writeFileSync(filePath, 'multiple old old strings', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toMatch(
        /Expected 1 occurrence but found 2 for old_string in file/,
      );
      expect(result.returnDisplay).toMatch(
        /Failed to edit, expected 1 occurrence but found 2/,
      );
    });

    it('should successfully replace multiple occurrences when expected_replacements specified', async () => {
      fs.writeFileSync(filePath, 'old text\nold text\nold text', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        expected_replacements: 3,
      };

      // Simulate confirmation by setting shouldAlwaysEdit
      (tool as any).shouldAlwaysEdit = true;

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      (tool as any).shouldAlwaysEdit = false; // Reset for other tests

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(
        'new text\nnew text\nnew text',
      );
      const display = result.returnDisplay as FileDiff;

      expect(display.fileDiff).toMatch(/-old text\n-old text\n-old text/);
      // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
      expect(display.fileDiff).toMatch(/\+new text\n\+new text\n\+new text/);
      expect(display.fileName).toBe(testFile);
      expect((result.returnDisplay as FileDiff).diffStat).toStrictEqual({
        ai_added_lines: 3,
        ai_removed_lines: 3,
        user_added_lines: 0,
        user_removed_lines: 0,
      });
    });

    it('should only replace the occurrence starting on replaceBeginLineNumber with repeated single-line old_string', async () => {
      fs.writeFileSync(filePath, 'old\nold\nold\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        replaceBeginLineNumber: 2,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('old\nnew\nold\n');
    });

    it('should only replace the occurrence starting on replaceBeginLineNumber with repeated multi-line old_string', async () => {
      fs.writeFileSync(
        filePath,
        'alpha\nbeta\ngamma\nalpha\nbeta\ngamma\n',
        'utf8',
      );
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'alpha\nbeta',
        new_string: 'ALPHA\nBETA',
        replaceBeginLineNumber: 4,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(
        'alpha\nbeta\ngamma\nALPHA\nBETA\ngamma\n',
      );
    });

    it('should fail with zero-occurrence error when old_string only appears later than replaceBeginLineNumber', async () => {
      fs.writeFileSync(filePath, 'alpha\nno match\nbeta\nold\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        replaceBeginLineNumber: 2,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(
        /0 occurrences found for old_string starting at line 2/,
      );
    });

    it('should not mismatch when a later duplicate exists and expected_replacements=1 with one eligible occurrence on the specified line', async () => {
      fs.writeFileSync(filePath, 'target\nother\ntarget\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'target',
        new_string: 'replaced',
        replaceBeginLineNumber: 1,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(
        'replaced\nother\ntarget\n',
      );
    });

    it('should replace multiple eligible occurrences starting on the same specified line with expected_replacements=2', async () => {
      fs.writeFileSync(filePath, 'foo bar\nbaz bar bar\nqux\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'bar',
        new_string: 'BAR',
        expected_replacements: 2,
        replaceBeginLineNumber: 2,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(
        'foo bar\nbaz BAR BAR\nqux\n',
      );
    });

    it('should error when expected_replacements exceeds eligible occurrences on the specified line', async () => {
      fs.writeFileSync(filePath, 'foo bar\nbaz bar bar\nqux\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'bar',
        new_string: 'BAR',
        expected_replacements: 3,
        replaceBeginLineNumber: 2,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Expected 3 occurrences but found 2/);
    });

    it('should reject multi-line old_string starting before replaceBeginLineNumber', async () => {
      fs.writeFileSync(
        filePath,
        'alpha_first\nbeta_first\nmiddle\nalpha_second\nbeta_second\nend\n',
        'utf8',
      );
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'alpha_first\nbeta_first',
        new_string: 'ALPHA_FIRST\nBETA_FIRST',
        replaceBeginLineNumber: 4,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(
        /0 occurrences found for old_string starting at line 4/,
      );
    });

    it('should preserve trailing newline with multi-line replaceBeginLineNumber replacement', async () => {
      fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'line2\nline3',
        new_string: 'LINE2\nLINE3',
        replaceBeginLineNumber: 2,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(
        'line1\nLINE2\nLINE3\nline4\n',
      );
    });

    it('should handle multi-line replacement at the end of file with replaceBeginLineNumber', async () => {
      fs.writeFileSync(filePath, 'line1\nline2\nline3', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'line2\nline3',
        new_string: 'LINE2\nLINE3',
        replaceBeginLineNumber: 2,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('line1\nLINE2\nLINE3');
    });

    it('should return a helpful error context when replaceBeginLineNumber is provided and old_string is not starting at that line', async () => {
      fs.writeFileSync(filePath, 'alpha\nno match\nbeta\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'alpha\nbeta',
        new_string: 'ALPHA\nBETA',
        replaceBeginLineNumber: 2,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(
        /0 occurrences found for old_string starting at line 2/,
      );
      expect(result.llmContent).toMatch(/Context around requested line:/);
      // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
      expect(result.llmContent).toMatch(/->\s+2\s+\|/);
    });

    it('should return an explicit out-of-range error when replaceBeginLineNumber exceeds total lines', async () => {
      fs.writeFileSync(filePath, 'old here\nold here\nold here\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        replaceBeginLineNumber: 999,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/replaceBeginLineNumber=999/);
      expect(result.llmContent).toMatch(/total lines: 4/);
      expect(result.returnDisplay).toMatch(
        /replaceBeginLineNumber is out of range/,
      );
    });

    it('should reject non-integer replaceBeginLineNumber values', async () => {
      fs.writeFileSync(filePath, 'old here\nold here\nold here\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        replaceBeginLineNumber: 1.5,
      };

      expect(() => tool.build(params)).toThrow(
        /replaceBeginLineNumber must be a positive integer/,
      );
    });

    it('should return error if expected_replacements does not match actual occurrences', async () => {
      fs.writeFileSync(filePath, 'old text old text', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        expected_replacements: 3, // Expecting 3 but only 2 exist
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toMatch(
        /Expected 3 occurrences but found 2 for old_string in file/,
      );
      expect(result.returnDisplay).toMatch(
        /Failed to edit, expected 3 occurrences but found 2/,
      );
    });

    it('should return error if trying to create a file that already exists (empty old_string)', async () => {
      fs.writeFileSync(filePath, 'Existing content', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: '',
        new_string: 'new content',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toMatch(/File already exists, cannot create/);
      expect(result.returnDisplay).toMatch(
        /Attempted to create a file that already exists/,
      );
    });

    it('should include modification message when proposed content is modified', async () => {
      const initialContent = 'Line 1\nold line\nLine 3\nLine 4\nLine 5\n';
      fs.writeFileSync(filePath, initialContent, 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        modified_by_user: true,
        ai_proposed_content: 'Line 1\nAI line\nLine 3\nLine 4\nLine 5\n',
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(
        /User modified the `new_string` content/,
      );
      expect((result.returnDisplay as FileDiff).diffStat).toStrictEqual({
        ai_added_lines: 1,
        ai_removed_lines: 1,
        user_added_lines: 1,
        user_removed_lines: 1,
      });
    });

    it('should not include modification message when proposed content is not modified', async () => {
      const initialContent = 'This is some old text.';
      fs.writeFileSync(filePath, initialContent, 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        modified_by_user: false,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).not.toMatch(
        /User modified the `new_string` content/,
      );
    });

    it('should not include modification message when modified_by_user is not provided', async () => {
      const initialContent = 'This is some old text.';
      fs.writeFileSync(filePath, initialContent, 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).not.toMatch(
        /User modified the `new_string` content/,
      );
    });

    it('should return error if old_string and new_string are identical', async () => {
      const initialContent = 'This is some identical text.';
      fs.writeFileSync(filePath, initialContent, 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'identical',
        new_string: 'identical',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toMatch(/No changes to apply/);
      expect(result.returnDisplay).toMatch(/No changes to apply/);
    });

    it('should match with fuzzy matching even when old_string has whitespace differences', async () => {
      const initialContent = 'line 1\nline  2\nline 3'; // Note the double space
      fs.writeFileSync(filePath, initialContent, 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        // old_string has a single space, but fuzzy matching should find it
        old_string: 'line 1\nline 2\nline 3',
        new_string: 'line 1\nnew line 2\nline 3',
      };

      (mockConfig.getApprovalMode as any).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // With fuzzy matching, this should now succeed
      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('new line 2');
    });
  });

  describe('Error Scenarios', () => {
    const testFile = 'error_test.txt';
    let filePath: string;

    beforeEach(() => {
      filePath = path.join(rootDir, testFile);
    });

    it('should return FILE_NOT_FOUND error', async () => {
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'any',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(ToolErrorType.FILE_NOT_FOUND);
    });

    it('should return ATTEMPT_TO_CREATE_EXISTING_FILE error', async () => {
      fs.writeFileSync(filePath, 'existing content', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: '',
        new_string: 'new content',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(
        ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
      );
    });

    it('should return NO_OCCURRENCE_FOUND error', async () => {
      fs.writeFileSync(filePath, 'content', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'not-found',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_OCCURRENCE_FOUND);
    });

    it('should return EXPECTED_OCCURRENCE_MISMATCH error', async () => {
      fs.writeFileSync(filePath, 'one one two', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'one',
        new_string: 'new',
        expected_replacements: 3,
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(
        ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
      );
    });

    it('should return NO_CHANGE error', async () => {
      fs.writeFileSync(filePath, 'content', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'content',
        new_string: 'content',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_CHANGE);
    });

    it('should return INVALID_PARAMETERS error for relative path', async () => {
      const params: EditToolParams = {
        file_path: 'relative/path.txt',
        old_string: 'a',
        new_string: 'b',
      };
      // Invalid params should throw during build
      expect(() => tool.build(params)).toThrow(/File path must be absolute/);
    });

    it('should return FILE_WRITE_FAILURE on write error', async () => {
      fs.writeFileSync(filePath, 'content', 'utf8');
      // Make file readonly to trigger a write error
      fs.chmodSync(filePath, '444');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'content',
        new_string: 'new content',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error?.type).toBe(ToolErrorType.FILE_WRITE_FAILURE);
    });
  });

  describe('getDescription', () => {
    it('should return "No file changes to..." if old_string and new_string are the same', () => {
      const testFileName = 'test.txt';
      const params: EditToolParams = {
        file_path: path.join(rootDir, testFileName),
        old_string: 'identical_string',
        new_string: 'identical_string',
      };
      // shortenPath will be called internally, resulting in just the file name
      const invocation = tool.build(params);
      expect(invocation.getDescription()).toBe(
        `No file changes to ${testFileName}`,
      );
    });

    it('should return a snippet of old and new strings if they are different', () => {
      const testFileName = 'test.txt';
      const params: EditToolParams = {
        file_path: path.join(rootDir, testFileName),
        old_string: 'this is the old string value',
        new_string: 'this is the new string value',
      };
      // shortenPath will be called internally, resulting in just the file name
      // The snippets are truncated at 30 chars + '...'
      const invocation = tool.build(params);
      expect(invocation.getDescription()).toBe(
        `${testFileName}: this is the old string value => this is the new string value`,
      );
    });

    it('should handle very short strings correctly in the description', () => {
      const testFileName = 'short.txt';
      const params: EditToolParams = {
        file_path: path.join(rootDir, testFileName),
        old_string: 'old',
        new_string: 'new',
      };
      const invocation = tool.build(params);
      expect(invocation.getDescription()).toBe(`${testFileName}: old => new`);
    });

    it('should truncate long strings in the description', () => {
      const testFileName = 'long.txt';
      const params: EditToolParams = {
        file_path: path.join(rootDir, testFileName),
        old_string:
          'this is a very long old string that will definitely be truncated',
        new_string:
          'this is a very long new string that will also be truncated',
      };
      const invocation = tool.build(params);
      expect(invocation.getDescription()).toBe(
        `${testFileName}: this is a very long old string... => this is a very long new string...`,
      );
    });
  });

  describe('workspace boundary validation', () => {
    it('should validate paths are within workspace root', () => {
      const validPath = {
        file_path: path.join(rootDir, 'file.txt'),
        old_string: 'old',
        new_string: 'new',
      };
      // Valid params should not throw
      expect(() => tool.build(validPath)).not.toThrow();
    });

    it('should reject paths outside workspace root', () => {
      const invalidPath = {
        file_path: '/etc/passwd',
        old_string: 'root',
        new_string: 'hacked',
      };
      expect(() => tool.build(invalidPath)).toThrow(
        /File path must be within one of the workspace directories/,
      );
    });
  });

  describe('constructor', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should use windows-style path examples on windows', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

      const tool = new EditTool({} as unknown as Config);
      const schema = tool.schema;
      expect(
        (schema.parametersJsonSchema as EditFileParameterSchema).properties
          .absolute_path.description,
      ).toBe(
        "The absolute path to the file to modify (e.g., 'C:\\Users\\project\\file.txt'). Must be an absolute path.",
      );
    });

    it('should use unix-style path examples on non-windows platforms', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

      const tool = new EditTool({} as unknown as Config);
      const schema = tool.schema;
      expect(
        (schema.parametersJsonSchema as EditFileParameterSchema).properties
          .absolute_path.description,
      ).toBe(
        "The absolute path to the file to modify (e.g., '/home/user/project/file.txt'). Must start with '/'.",
      );
    });
  });

  describe('IDE mode', () => {
    const testFile = 'edit_me.txt';
    let filePath: string;
    let ideClient: any;

    beforeEach(() => {
      filePath = path.join(rootDir, testFile);
      ideClient = {
        openDiff: vi.fn(),
        getConnectionStatus: vi.fn().mockReturnValue({
          status: IDEConnectionStatus.Connected,
        }),
      };
      (mockConfig as any).getIdeMode = () => true;
      (mockConfig as any).getIdeClient = () => ideClient;
    });

    it('should call ideClient.openDiff and NOT corrupt params on confirmation', async () => {
      const initialContent = 'some old content here';
      const newContent = 'some new content here';
      const modifiedContent = 'some modified content here';
      fs.writeFileSync(filePath, initialContent);
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };
      ideClient.openDiff.mockResolvedValueOnce({
        status: 'accepted',
        content: modifiedContent, // IDE returns entire file content
      });

      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      expect(ideClient.openDiff).toHaveBeenCalledWith(filePath, newContent);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (confirmation !== false && 'onConfirm' in confirmation) {
        await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
      }

      // FIX: params should NOT be corrupted by IDE's full file content
      // old_string should remain the specific text to replace
      // new_string should remain the specific replacement text
      expect(params.old_string).toBe('old');
      expect(params.new_string).toBe('new');
    });
  });

  describe('multiple file edits', () => {
    it('should perform multiple removals and report correct diff stats', async () => {
      const numFiles = 10;
      const files: Array<{
        path: string;
        initialContent: string;
        toRemove: string;
      }> = [];
      const expectedLinesRemoved: number[] = [];
      const actualLinesRemoved: number[] = [];

      // 1. Create 10 files with 5-10 lines each
      for (let i = 0; i < numFiles; i++) {
        const fileName = `test-file-${i}.txt`;
        const filePath = path.join(rootDir, fileName);
        const numLines = Math.floor(Math.random() * 6) + 5; // 5 to 10 lines
        const lines = Array.from(
          { length: numLines },
          (_, j) => `File ${i}, Line ${j + 1}`,
        );
        const content = lines.join('\n') + '\n';

        // Determine which lines to remove (2 or 3 lines)
        const numLinesToRemove = Math.floor(Math.random() * 2) + 2; // 2 or 3
        expectedLinesRemoved.push(numLinesToRemove);
        const startLineToRemove = 1; // Start removing from the second line
        const linesToRemove = lines.slice(
          startLineToRemove,
          startLineToRemove + numLinesToRemove,
        );
        const toRemove = linesToRemove.join('\n') + '\n';

        fs.writeFileSync(filePath, content, 'utf8');
        files.push({
          path: filePath,
          initialContent: content,
          toRemove,
        });
      }

      // 2. Create and execute 10 tool calls for removal
      for (const file of files) {
        const params: EditToolParams = {
          file_path: file.path,
          old_string: file.toRemove,
          new_string: '', // Removing the content
        };
        const invocation = tool.build(params);
        const result = await invocation.execute(new AbortController().signal);

        const returnDisplay = result.returnDisplay;
        if (
          typeof returnDisplay === 'object' &&
          'diffStat' in returnDisplay &&
          returnDisplay.diffStat != null
        ) {
          actualLinesRemoved.push(returnDisplay.diffStat.ai_removed_lines);
        } else if (result.error != null) {
          console.error(`Edit failed for ${file.path}:`, result.error);
        }
      }

      // 3. Assert that the content was removed from each file
      for (const file of files) {
        const finalContent = fs.readFileSync(file.path, 'utf8');
        const expectedContent = file.initialContent.replace(file.toRemove, '');
        expect(finalContent).toBe(expectedContent);
        expect(finalContent).not.toContain(file.toRemove);
      }

      // 4. Assert that the total number of removed lines matches the diffStat total
      const totalExpectedRemoved = expectedLinesRemoved.reduce(
        (sum, current) => sum + current,
        0,
      );
      const totalActualRemoved = actualLinesRemoved.reduce(
        (sum, current) => sum + current,
        0,
      );
      expect(totalActualRemoved).toBe(totalExpectedRemoved);
    });
  });

  describe('getOffsetForLine', () => {
    it('should count single occurrence on the specified line', () => {
      const content = 'foo\nbar\nbaz\n';
      expect(countLineGuardedOccurrences(content, 'bar', 2)).toBe(1);
    });

    it('should count multiple occurrences on the same line', () => {
      const content = 'a bar b bar c\nnope\n';
      expect(countLineGuardedOccurrences(content, 'bar', 1)).toBe(2);
    });

    it('should return 0 when old_string only appears on a different line', () => {
      const content = 'target\nother\ntarget\n';
      expect(countLineGuardedOccurrences(content, 'target', 2)).toBe(0);
    });

    it('should return 1 when old_string appears on lines 1 and 3 but guard is line 1', () => {
      const content = 'target\nother\ntarget\n';
      expect(countLineGuardedOccurrences(content, 'target', 1)).toBe(1);
    });

    it('should return 0 when old_string only appears before the guarded line', () => {
      const content = 'target\nother\nnope\n';
      expect(countLineGuardedOccurrences(content, 'target', 2)).toBe(0);
    });

    it('should return 0 for empty old_string', () => {
      const content = 'foo\nbar\n';
      expect(countLineGuardedOccurrences(content, '', 1)).toBe(0);
    });

    it('should return 0 for out-of-range line number', () => {
      const content = 'foo\nbar\n';
      expect(countLineGuardedOccurrences(content, 'foo', 999)).toBe(0);
    });

    it('should count multi-line old_string starting on the guarded line', () => {
      const content = 'alpha\nbeta\ngamma\nalpha\nbeta\ngamma\n';
      expect(countLineGuardedOccurrences(content, 'alpha\nbeta', 1)).toBe(1);
    });

    it('should return 0 when multi-line old_string starts before the guarded line but spans it', () => {
      const content = 'alpha\nbeta\ngamma\n';
      expect(countLineGuardedOccurrences(content, 'alpha\nbeta', 2)).toBe(0);
    });
  });

  describe('applyLineGuardedReplacement', () => {
    it('should replace only the occurrence on the specified line', () => {
      const content = 'old\nold\nold\n';
      const result = applyLineGuardedReplacement(content, 'old', 'new', 1, 2);
      expect(result).toBe('old\nnew\nold\n');
    });

    it('should replace multiple occurrences on the same line when expected_replacements > 1', () => {
      const content = 'foo bar\nbaz bar bar\nqux\n';
      const result = applyLineGuardedReplacement(content, 'bar', 'BAR', 2, 2);
      expect(result).toBe('foo bar\nbaz BAR BAR\nqux\n');
    });

    it('should not replace occurrences on other lines', () => {
      const content = 'target\nother\ntarget\n';
      const result = applyLineGuardedReplacement(
        content,
        'target',
        'REPLACED',
        1,
        3,
      );
      expect(result).toBe('target\nother\nREPLACED\n');
    });

    it('should not replace when old_string only appears before the guarded line', () => {
      const content = 'target\nother\nnope\n';
      const result = applyLineGuardedReplacement(
        content,
        'target',
        'REPLACED',
        1,
        2,
      );
      expect(result).toBe('target\nother\nnope\n');
    });

    it('should return content unchanged for empty old_string', () => {
      const content = 'foo\nbar\n';
      const result = applyLineGuardedReplacement(content, '', 'new', 1, 1);
      expect(result).toBe('foo\nbar\n');
    });

    it('should return content unchanged when replaceLine is out of range', () => {
      const content = 'foo\nbar\n';
      const result = applyLineGuardedReplacement(content, 'foo', 'new', 1, 999);
      expect(result).toBe('foo\nbar\n');
    });

    it('should replace multi-line old_string starting on the guarded line', () => {
      const content = 'alpha\nbeta\ngamma\nalpha\nbeta\ngamma\n';
      const result = applyLineGuardedReplacement(
        content,
        'alpha\nbeta',
        'ALPHA\nBETA',
        1,
        4,
      );
      expect(result).toBe('alpha\nbeta\ngamma\nALPHA\nBETA\ngamma\n');
    });

    it('should not replace multi-line old_string when it starts before the guarded line', () => {
      const content = 'alpha\nbeta\ngamma\n';
      const result = applyLineGuardedReplacement(
        content,
        'alpha\nbeta',
        'ALPHA\nBETA',
        1,
        2,
      );
      expect(result).toBe('alpha\nbeta\ngamma\n');
    });
  });

  describe('getModifyContext().getProposedContent', () => {
    const testFile = 'modify_proposed.txt';
    let filePath: string;

    beforeEach(() => {
      filePath = path.join(rootDir, testFile);
    });

    it('should replace only the occurrence on replaceBeginLineNumber with duplicate single-line old_string', async () => {
      fs.writeFileSync(filePath, 'old\nold\nold\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        replaceBeginLineNumber: 2,
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('old\nnew\nold\n');
    });

    it('should replace only the occurrence on replaceBeginLineNumber with duplicate multi-line old_string', async () => {
      fs.writeFileSync(
        filePath,
        'alpha\nbeta\ngamma\nalpha\nbeta\ngamma\n',
        'utf8',
      );
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'alpha\nbeta',
        new_string: 'ALPHA\nBETA',
        replaceBeginLineNumber: 4,
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('alpha\nbeta\ngamma\nALPHA\nBETA\ngamma\n');
    });

    it('should not replace occurrences before replaceBeginLineNumber', async () => {
      fs.writeFileSync(filePath, 'target\nother\ntarget\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'target',
        new_string: 'replaced',
        replaceBeginLineNumber: 3,
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('target\nother\nreplaced\n');
    });

    it('should propose unchanged content when old_string only appears before replaceBeginLineNumber', async () => {
      fs.writeFileSync(filePath, 'alpha\nno match\nbeta\nold\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        replaceBeginLineNumber: 2,
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      // No occurrence of 'old' starts on line 2, so applyLineGuardedReplacement
      // returns unchanged content — identical to execute() path behavior.
      expect(proposed).toBe('alpha\nno match\nbeta\nold\n');
    });

    it('should replace multiple eligible occurrences on the same specified line', async () => {
      fs.writeFileSync(filePath, 'foo bar\nbaz bar bar\nqux\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'bar',
        new_string: 'BAR',
        expected_replacements: 2,
        replaceBeginLineNumber: 2,
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('foo bar\nbaz BAR BAR\nqux\n');
    });

    it('should not replace occurrences on other lines even when expected_replacements exceeds guarded occurrences', async () => {
      fs.writeFileSync(filePath, 'bar bar bar\nbar bar\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'bar',
        new_string: 'BAR',
        expected_replacements: 5,
        replaceBeginLineNumber: 2,
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      // Only 2 occurrences on line 2, but expected_replacements=5 → mismatch.
      // execute() would reject; proposedContent returns unchanged content.
      expect(proposed).toBe('bar bar bar\nbar bar\n');
    });

    it('should handle normal replacement without replaceBeginLineNumber', async () => {
      fs.writeFileSync(filePath, 'hello old world\n', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('hello new world\n');
    });

    it('should return empty string for nonexistent file without replaceBeginLineNumber', async () => {
      const newPath = path.join(rootDir, 'nonexistent.txt');
      const params: EditToolParams = {
        file_path: newPath,
        old_string: 'old',
        new_string: 'new',
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('');
    });

    it('should create new file content with empty old_string for nonexistent file', async () => {
      const newPath = path.join(rootDir, 'brand_new.txt');
      const params: EditToolParams = {
        file_path: newPath,
        old_string: '',
        new_string: 'new file content',
      };
      const modifyContext = tool.getModifyContext(new AbortController().signal);
      const proposed = await modifyContext.getProposedContent(params);
      expect(proposed).toBe('new file content');
    });
  });

  describe('replaceBeginLineNumber fuzzy behavior', () => {
    const testFile = 'fuzzy_guard_test.txt';
    let filePath: string;

    beforeEach(() => {
      filePath = path.join(rootDir, testFile);
    });

    it('should not fuzzy-replace when replaceBeginLineNumber is set and old_string has whitespace differences', async () => {
      // old_string has single space but content has double space on the guarded line.
      // With replaceBeginLineNumber active, only exact matches on the guarded line count.
      // Fuzzy matching is NOT applied for line-guarded edits.
      fs.writeFileSync(filePath, 'line 1\nline  2\nline 3', 'utf8');
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'line 1\nline 2\nline 3',
        new_string: 'line 1\nnew line 2\nline 3',
        replaceBeginLineNumber: 1,
      };

      (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
        ApprovalMode.AUTO_EDIT,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // With replaceBeginLineNumber set, exact match is required on the guarded line.
      // The multi-line old_string starts on line 1 but "line 2" (single space) does not
      // match "line  2" (double space) on line 2. Since indexOf searches for the entire
      // multi-line string, it won't be found. This should fail with 0 occurrences
      // rather than fuzzy-matching a different line.
      expect(result.llmContent).toMatch(
        /0 occurrences found for old_string starting at line 1/,
      );
    });

    it('should only exact-match on the guarded line and not fall back to fuzzy matching elsewhere', async () => {
      // old_string appears on a later line but not on the guarded line.
      // With replaceBeginLineNumber, the guarded search should find 0 occurrences.
      fs.writeFileSync(
        filePath,
        'no match here\ntarget line\ntarget line\n',
        'utf8',
      );
      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'target',
        new_string: 'REPLACED',
        replaceBeginLineNumber: 1,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // No occurrence starts on line 1
      expect(result.llmContent).toMatch(
        /0 occurrences found for old_string starting at line 1/,
      );
    });

    describe('applyLineGuardedReplacement length-difference correctness', () => {
      it('should replace all 3 "a" with "AAAA" on the guarded line (review scenario)', () => {
        const content = 'a a a\nnext\n';
        const result = applyLineGuardedReplacement(content, 'a', 'AAAA', 3, 1);
        expect(result).toBe('AAAA AAAA AAAA\nnext\n');
      });

      it('should replace multiple short matches with longer replacements on the same line', () => {
        const content = 'ab ab ab\nother\n';
        const result = applyLineGuardedReplacement(content, 'ab', 'XYZ', 3, 1);
        expect(result).toBe('XYZ XYZ XYZ\nother\n');
      });

      it('should replace multiple long matches with shorter replacements on the same line', () => {
        const content = 'ABCDEF ABCDEF\nrest\n';
        const result = applyLineGuardedReplacement(
          content,
          'ABCDEF',
          'X',
          2,
          1,
        );
        expect(result).toBe('X X\nrest\n');
      });

      it('should handle overlapping-free adjacent matches with length change', () => {
        const content = 'xy xy xy\nother\n';
        const result = applyLineGuardedReplacement(
          content,
          'xy',
          'ZZZZZ',
          3,
          1,
        );
        expect(result).toBe('ZZZZZ ZZZZZ ZZZZZ\nother\n');
      });

      it('should preserve content after the guarded line when replacement grows', () => {
        const content = 'a a\nline2\nline3\n';
        const result = applyLineGuardedReplacement(content, 'a', 'LONG', 2, 1);
        expect(result).toBe('LONG LONG\nline2\nline3\n');
      });

      it('should preserve content before the guarded line when replacement shrinks', () => {
        const content = 'prefix\nABCDEF ABCDEF\nsuffix\n';
        const result = applyLineGuardedReplacement(
          content,
          'ABCDEF',
          'X',
          2,
          2,
        );
        expect(result).toBe('prefix\nX X\nsuffix\n');
      });
    });

    describe('execute with multiple matches on guarded line and length-changing replacement', () => {
      const testFile = 'multi_len_replace.txt';
      let filePath: string;

      beforeEach(() => {
        filePath = path.join(rootDir, testFile);
      });

      it('should replace all 3 "a" with "AAAA" on the guarded line through EditTool.execute', async () => {
        fs.writeFileSync(filePath, 'a a a\nnext\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'a',
          new_string: 'AAAA',
          expected_replacements: 3,
          replaceBeginLineNumber: 1,
        };

        (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
          ApprovalMode.AUTO_EDIT,
        );

        const invocation = tool.build(params);
        const result = await invocation.execute(new AbortController().signal);

        expect(result.llmContent).toMatch(/Successfully modified file/);
        expect(fs.readFileSync(filePath, 'utf8')).toBe(
          'AAAA AAAA AAAA\nnext\n',
        );
      });

      it('should replace short old_string with longer new_string for multiple occurrences on the same line', async () => {
        fs.writeFileSync(filePath, 'ab ab ab\nother\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'ab',
          new_string: 'XYZ',
          expected_replacements: 3,
          replaceBeginLineNumber: 1,
        };

        (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
          ApprovalMode.AUTO_EDIT,
        );

        const invocation = tool.build(params);
        const result = await invocation.execute(new AbortController().signal);

        expect(result.llmContent).toMatch(/Successfully modified file/);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('XYZ XYZ XYZ\nother\n');
      });

      it('should replace long old_string with shorter new_string for multiple occurrences on same line', async () => {
        fs.writeFileSync(filePath, 'prefix\nABCDEF ABCDEF\nsuffix\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'ABCDEF',
          new_string: 'X',
          expected_replacements: 2,
          replaceBeginLineNumber: 2,
        };

        (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
          ApprovalMode.AUTO_EDIT,
        );

        const invocation = tool.build(params);
        const result = await invocation.execute(new AbortController().signal);

        expect(result.llmContent).toMatch(/Successfully modified file/);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('prefix\nX X\nsuffix\n');
      });

      it('should report success count matching expected_replacements when new_string is longer', async () => {
        fs.writeFileSync(filePath, 'a a a\nnext\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'a',
          new_string: 'AAAA',
          expected_replacements: 3,
          replaceBeginLineNumber: 1,
        };

        (mockConfig.getApprovalMode as Mock).mockReturnValueOnce(
          ApprovalMode.AUTO_EDIT,
        );

        const invocation = tool.build(params);
        const result = await invocation.execute(new AbortController().signal);

        expect(result.llmContent).toMatch(/3 replacements/);
      });
    });

    describe('getProposedContent expected_replacements mismatch alignment', () => {
      const testFile = 'proposed_mismatch.txt';
      let filePath: string;

      beforeEach(() => {
        filePath = path.join(rootDir, testFile);
      });

      it('should return unchanged content when eligible occurrences differ from expected_replacements (too few)', async () => {
        // 2 eligible occurrences on line 2, but expected_replacements=3 → mismatch
        fs.writeFileSync(filePath, 'foo bar\nbaz bar bar\nqux\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'bar',
          new_string: 'BAR',
          expected_replacements: 3,
          replaceBeginLineNumber: 2,
        };
        const modifyContext = tool.getModifyContext(
          new AbortController().signal,
        );
        const proposed = await modifyContext.getProposedContent(params);
        // execute() would reject this; proposedContent should not show partial replacement
        expect(proposed).toBe('foo bar\nbaz bar bar\nqux\n');
      });

      it('should return unchanged content when eligible occurrences differ from expected_replacements (too many)', async () => {
        // 3 eligible occurrences on line 1, but expected_replacements=2 → mismatch
        fs.writeFileSync(filePath, 'bar bar bar\nother\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'bar',
          new_string: 'BAR',
          expected_replacements: 2,
          replaceBeginLineNumber: 1,
        };
        const modifyContext = tool.getModifyContext(
          new AbortController().signal,
        );
        const proposed = await modifyContext.getProposedContent(params);
        expect(proposed).toBe('bar bar bar\nother\n');
      });

      it('should return proposed content when eligible occurrences match expected_replacements', async () => {
        // 3 eligible occurrences on line 1, expected_replacements=3 → match
        fs.writeFileSync(filePath, 'a a a\nnext\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'a',
          new_string: 'AAAA',
          expected_replacements: 3,
          replaceBeginLineNumber: 1,
        };
        const modifyContext = tool.getModifyContext(
          new AbortController().signal,
        );
        const proposed = await modifyContext.getProposedContent(params);
        expect(proposed).toBe('AAAA AAAA AAAA\nnext\n');
      });

      it('should return unchanged content when no eligible occurrences exist on guarded line', async () => {
        // old_string not on line 2 at all
        fs.writeFileSync(filePath, 'target\nother\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'target',
          new_string: 'REPLACED',
          expected_replacements: 1,
          replaceBeginLineNumber: 2,
        };
        const modifyContext = tool.getModifyContext(
          new AbortController().signal,
        );
        const proposed = await modifyContext.getProposedContent(params);
        expect(proposed).toBe('target\nother\n');
      });

      it('should not affect non-replaceBeginLineNumber path for mismatch', async () => {
        // Without replaceBeginLineNumber, getProposedContent does not guard against mismatch
        // (that path relies on execute() validation, consistent with current behavior)
        fs.writeFileSync(filePath, 'hello old world old\n', 'utf8');
        const params: EditToolParams = {
          file_path: filePath,
          old_string: 'old',
          new_string: 'new',
          expected_replacements: 1,
        };
        const modifyContext = tool.getModifyContext(
          new AbortController().signal,
        );
        const proposed = await modifyContext.getProposedContent(params);
        expect(proposed).toBe('hello new world old\n');
      });
    });
  });
});
