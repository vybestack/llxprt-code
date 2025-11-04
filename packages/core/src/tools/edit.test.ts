/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockGenerateJson = vi.hoisted(() => vi.fn());
const mockOpenDiff = vi.hoisted(() => vi.fn());

import { IDEConnectionStatus } from '../ide/ide-client.js';

vi.mock('../core/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    generateJson: mockGenerateJson,
  })),
}));

vi.mock('../utils/editor.js', () => ({
  openDiff: mockOpenDiff,
}));

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { applyReplacement, EditTool, EditToolParams } from './edit.js';
import { FileDiff, ToolConfirmationOutcome } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ApprovalMode, Config } from '../config/config.js';
import { Content, Part } from '@google/genai';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';

describe('EditTool', () => {
  let tool: EditTool;
  let tempDir: string;
  let rootDir: string;
  let mockConfig: Config;
  let geminiClient: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-tool-test-'));
    rootDir = path.join(tempDir, 'root');
    fs.mkdirSync(rootDir);

    geminiClient = {
      generateJson: mockGenerateJson, // mockGenerateJson is already defined and hoisted
    };

    mockConfig = {
      getGeminiClient: vi.fn().mockReturnValue(geminiClient),
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
      getFullContext: () => false,
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
        if (userContent && userContent.parts) {
          promptText = userContent.parts
            .filter((p: Part) => typeof (p as any).text === 'string')
            .map((p: Part) => (p as any).text)
            .join('\n');
        }
        const snippetMatch = promptText.match(
          /Problematic target snippet:\n```\n([\s\S]*?)\n```/,
        );
        const problematicSnippet =
          snippetMatch && snippetMatch[1] ? snippetMatch[1] : '';

        if (((schema as any).properties as any)?.corrected_target_snippet) {
          return Promise.resolve({
            corrected_target_snippet: problematicSnippet,
          });
        }
        if (((schema as any).properties as any)?.corrected_new_string) {
          // For new_string correction, we might need more sophisticated logic,
          // but for now, returning original is a safe default if not specified by a test.
          const originalNewStringMatch = promptText.match(
            /original_new_string \(what was intended to replace original_old_string\):\n```\n([\s\S]*?)\n```/,
          );
          const originalNewString =
            originalNewStringMatch && originalNewStringMatch[1]
              ? originalNewStringMatch[1]
              : '';
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
      expect(confirmation).toEqual(
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
      expect(confirmation).toEqual(
        expect.objectContaining({
          title: `Confirm Edit: ${newFileName}`,
          fileName: newFileName,
          fileDiff: expect.any(String),
        }),
      );
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
        /The 'file_path' parameter must be non-empty./,
      );
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
      expect(display.fileDiff).toMatch(/\+new text\n\+new text\n\+new text/);
      expect(display.fileName).toBe(testFile);
      expect((result.returnDisplay as FileDiff).diffStat).toStrictEqual({
        ai_added_lines: 3,
        ai_removed_lines: 3,
        user_added_lines: 0,
        user_removed_lines: 0,
      });
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

      if (confirmation && 'onConfirm' in confirmation) {
        await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
      }

      // FIX: params should NOT be corrupted by IDE's full file content
      // old_string should remain the specific text to replace
      // new_string should remain the specific replacement text
      expect(params.old_string).toBe('old');
      expect(params.new_string).toBe('new');
    });
  });
});
