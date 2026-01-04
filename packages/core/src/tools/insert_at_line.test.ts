/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InsertAtLineTool } from './insert_at_line.js';
import { ToolEditConfirmationDetails } from './tools.js';
import { ApprovalMode, Config } from '../config/config.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { ToolErrorType } from './tool-error.js';

const rootDir = path.resolve(os.tmpdir(), 'insert-at-line-test-root');

const fsService = new StandardFileSystemService();
const mockConfigInternal = {
  getTargetDir: () => rootDir,
  getApprovalMode: vi.fn(() => ApprovalMode.DEFAULT),
  setApprovalMode: vi.fn(),
  getFileSystemService: () => fsService,
  getFileService: () => ({
    shouldLlxprtIgnoreFile: () => false,
    shouldGitIgnoreFile: () => false,
  }),
  getIdeClient: vi.fn(),
  getIdeMode: vi.fn(() => false),
  getWorkspaceContext: () => createMockWorkspaceContext(rootDir),
  getDebugMode: () => false,
};
const mockConfig = mockConfigInternal as unknown as Config;

describe('InsertAtLineTool', () => {
  let tool: InsertAtLineTool;
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'insert-at-line-test-external-'),
    );
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true });
    }

    mockConfigInternal.getIdeClient.mockReturnValue({
      openDiff: vi.fn(),
      closeDiff: vi.fn(),
      getIdeContext: vi.fn(),
      subscribeToIdeContext: vi.fn(),
      isCodeTrackerEnabled: vi.fn(),
      getTrackedCode: vi.fn(),
    });

    tool = new InsertAtLineTool(mockConfig);

    mockConfigInternal.getApprovalMode.mockReturnValue(ApprovalMode.DEFAULT);
    mockConfigInternal.setApprovalMode.mockClear();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('validateToolParams', () => {
    it('should return null for valid parameters within workspace', () => {
      const params = {
        absolute_path: path.join(rootDir, 'test.txt'),
        line_number: 1,
        content: 'new content',
      };
      expect(tool.validateToolParams(params)).toBeNull();
    });

    it('should return error for relative path', () => {
      const params = {
        absolute_path: 'test.txt',
        line_number: 1,
        content: 'new content',
      };
      expect(tool.validateToolParams(params)).toMatch(
        /File path must be absolute/,
      );
    });

    it('should return error for path outside workspace', () => {
      const outsidePath = path.resolve(tempDir, 'outside-root.txt');
      const params = {
        absolute_path: outsidePath,
        line_number: 1,
        content: 'new content',
      };
      const error = tool.validateToolParams(params);
      expect(error).toContain(
        'File path must be within one of the workspace directories',
      );
    });

    it('should return error for invalid line_number', () => {
      const params = {
        absolute_path: path.join(rootDir, 'test.txt'),
        line_number: 0,
        content: 'new content',
      };
      expect(tool.validateToolParams(params)).toMatch(/line_number must be/);
    });

    it('should return error when content is empty', () => {
      const params = {
        absolute_path: path.join(rootDir, 'test.txt'),
        line_number: 1,
        content: '',
      };
      expect(tool.validateToolParams(params)).toMatch(
        /content parameter must be/,
      );
    });
  });

  describe('shouldConfirmExecute', () => {
    const abortSignal = new AbortController().signal;

    it('should request confirmation with diff in DEFAULT mode', async () => {
      const filePath = path.join(rootDir, 'confirm_insert.txt');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = {
        absolute_path: filePath,
        line_number: 2,
        content: 'inserted line',
      };
      const invocation = tool.build(params);
      const confirmation = (await invocation.shouldConfirmExecute(
        abortSignal,
      )) as ToolEditConfirmationDetails;

      expect(confirmation).not.toBe(false);
      expect(confirmation.type).toBe('edit');
      expect(confirmation.title).toContain('Insert');
      expect(confirmation.fileDiff).toContain('inserted line');
    });

    it('should return false (auto-approve) in AUTO_EDIT mode', async () => {
      mockConfigInternal.getApprovalMode.mockReturnValue(
        ApprovalMode.AUTO_EDIT,
      );

      const filePath = path.join(rootDir, 'auto_edit_insert.txt');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = {
        absolute_path: filePath,
        line_number: 2,
        content: 'inserted line',
      };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmation).toBe(false);
    });

    it('should return false (auto-approve) in YOLO mode', async () => {
      mockConfigInternal.getApprovalMode.mockReturnValue(ApprovalMode.YOLO);

      const filePath = path.join(rootDir, 'yolo_insert.txt');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = {
        absolute_path: filePath,
        line_number: 1,
        content: 'inserted line',
      };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmation).toBe(false);
    });

    it('should request confirmation for new file creation in DEFAULT mode', async () => {
      const filePath = path.join(rootDir, 'new_file.txt');

      const params = {
        absolute_path: filePath,
        line_number: 1,
        content: 'new file content',
      };
      const invocation = tool.build(params);
      const confirmation = (await invocation.shouldConfirmExecute(
        abortSignal,
      )) as ToolEditConfirmationDetails;

      expect(confirmation).not.toBe(false);
      expect(confirmation.type).toBe('edit');
      expect(confirmation.fileDiff).toContain('new file content');
    });
  });

  describe('execute', () => {
    const abortSignal = new AbortController().signal;

    it('should insert content at the specified line', async () => {
      const filePath = path.join(rootDir, 'execute_insert.txt');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = {
        absolute_path: filePath,
        line_number: 2,
        content: 'inserted line',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Successfully');
      const writtenContent = fs.readFileSync(filePath, 'utf8');
      expect(writtenContent).toBe('line1\ninserted line\nline2\nline3');
    });

    it('should create a new file when inserting at line 1 in non-existent file', async () => {
      const filePath = path.join(rootDir, 'new_file_create.txt');

      const params = {
        absolute_path: filePath,
        line_number: 1,
        content: 'first line',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Successfully');
      expect(fs.existsSync(filePath)).toBe(true);
      const writtenContent = fs.readFileSync(filePath, 'utf8');
      expect(writtenContent).toBe('first line\n');
    });

    it('should return error when inserting at line > 1 in non-existent file', async () => {
      const filePath = path.join(rootDir, 'nonexistent.txt');

      const params = {
        absolute_path: filePath,
        line_number: 5,
        content: 'content',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('file does not exist');
    });

    it('should return error when line_number exceeds file length + 1', async () => {
      const filePath = path.join(rootDir, 'short_file.txt');
      fs.writeFileSync(filePath, 'line1\nline2', 'utf8');

      const params = {
        absolute_path: filePath,
        line_number: 10,
        content: 'content',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('exceeds file length');
    });

    it('should append content at end of file when line_number equals total lines + 1', async () => {
      const filePath = path.join(rootDir, 'append_file.txt');
      fs.writeFileSync(filePath, 'line1\nline2', 'utf8');

      const params = {
        absolute_path: filePath,
        line_number: 3,
        content: 'appended line',
      };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Successfully');
      const writtenContent = fs.readFileSync(filePath, 'utf8');
      expect(writtenContent).toBe('line1\nline2\nappended line');
    });
  });
});
