/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeleteLineRangeTool } from './delete_line_range.js';
import { ToolEditConfirmationDetails } from './tools.js';
import { ApprovalMode, Config } from '../config/config.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { ToolErrorType } from './tool-error.js';

const rootDir = path.resolve(os.tmpdir(), 'delete-line-range-test-root');

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

describe('DeleteLineRangeTool', () => {
  let tool: DeleteLineRangeTool;
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'delete-line-range-test-external-'),
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

    tool = new DeleteLineRangeTool(mockConfig);

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
        start_line: 1,
        end_line: 5,
      };
      expect(tool.validateToolParams(params)).toBeNull();
    });

    it('should return error for relative path', () => {
      const params = { absolute_path: 'test.txt', start_line: 1, end_line: 5 };
      expect(tool.validateToolParams(params)).toMatch(
        /File path must be absolute/,
      );
    });

    it('should return error for path outside workspace', () => {
      const outsidePath = path.resolve(tempDir, 'outside-root.txt');
      const params = {
        absolute_path: outsidePath,
        start_line: 1,
        end_line: 5,
      };
      const error = tool.validateToolParams(params);
      expect(error).toContain(
        'File path must be within one of the workspace directories',
      );
    });

    it('should return error for invalid start_line', () => {
      const params = {
        absolute_path: path.join(rootDir, 'test.txt'),
        start_line: 0,
        end_line: 5,
      };
      expect(tool.validateToolParams(params)).toMatch(/start_line must be/);
    });

    it('should return error when end_line is less than start_line', () => {
      const params = {
        absolute_path: path.join(rootDir, 'test.txt'),
        start_line: 5,
        end_line: 3,
      };
      expect(tool.validateToolParams(params)).toMatch(
        /end_line must be greater than or equal to start_line/,
      );
    });
  });

  describe('shouldConfirmExecute', () => {
    const abortSignal = new AbortController().signal;

    it('should request confirmation with diff in DEFAULT mode', async () => {
      const filePath = path.join(rootDir, 'confirm_delete.txt');
      const originalContent = 'line1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = { absolute_path: filePath, start_line: 2, end_line: 3 };
      const invocation = tool.build(params);
      const confirmation = (await invocation.shouldConfirmExecute(
        abortSignal,
      )) as ToolEditConfirmationDetails;

      expect(confirmation).not.toBe(false);
      expect(confirmation.type).toBe('edit');
      expect(confirmation.title).toContain('Delete');
      expect(confirmation.fileDiff).toContain('line2');
      expect(confirmation.fileDiff).toContain('line3');
    });

    it('should return false (auto-approve) in AUTO_EDIT mode', async () => {
      mockConfigInternal.getApprovalMode.mockReturnValue(
        ApprovalMode.AUTO_EDIT,
      );

      const filePath = path.join(rootDir, 'auto_edit_delete.txt');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = { absolute_path: filePath, start_line: 2, end_line: 2 };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmation).toBe(false);
    });

    it('should return false (auto-approve) in YOLO mode', async () => {
      mockConfigInternal.getApprovalMode.mockReturnValue(ApprovalMode.YOLO);

      const filePath = path.join(rootDir, 'yolo_delete.txt');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = { absolute_path: filePath, start_line: 1, end_line: 1 };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmation).toBe(false);
    });

    it('should return false when file cannot be read', async () => {
      const filePath = path.join(rootDir, 'nonexistent.txt');

      const params = { absolute_path: filePath, start_line: 1, end_line: 1 };
      const invocation = tool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(abortSignal);

      expect(confirmation).toBe(false);
    });
  });

  describe('execute', () => {
    const abortSignal = new AbortController().signal;

    it('should delete the specified lines', async () => {
      const filePath = path.join(rootDir, 'execute_delete.txt');
      const originalContent = 'line1\nline2\nline3\nline4\nline5';
      fs.writeFileSync(filePath, originalContent, 'utf8');

      const params = { absolute_path: filePath, start_line: 2, end_line: 3 };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Successfully deleted lines');
      const writtenContent = fs.readFileSync(filePath, 'utf8');
      expect(writtenContent).toBe('line1\nline4\nline5');
    });

    it('should return error if file does not exist', async () => {
      const filePath = path.join(rootDir, 'nonexistent.txt');
      const params = { absolute_path: filePath, start_line: 1, end_line: 1 };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.FILE_NOT_FOUND);
    });

    it('should return error if start_line exceeds file length', async () => {
      const filePath = path.join(rootDir, 'short_file.txt');
      fs.writeFileSync(filePath, 'line1\nline2', 'utf8');

      const params = { absolute_path: filePath, start_line: 10, end_line: 12 };
      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('start_line');
    });
  });
});
