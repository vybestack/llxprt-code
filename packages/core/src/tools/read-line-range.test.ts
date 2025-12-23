/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import fsp from 'fs/promises';

const abortSignal = new AbortController().signal;

import { Config } from '../config/config.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import {
  ReadLineRangeTool,
  ReadLineRangeToolParams,
} from './read_line_range.js';
import { ToolInvocation, ToolResult } from './tools.js';

describe('ReadLineRangeTool', () => {
  let tempRootDir: string;
  let tool: ReadLineRangeTool;

  beforeEach(async () => {
    tempRootDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'read-line-range-tool-root-'),
    );

    const mockConfigInstance = {
      getFileService: () => new FileDiscoveryService(tempRootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getTargetDir: () => tempRootDir,
      getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
      getConversationLoggingEnabled: () => false,
    } as unknown as Config;

    tool = new ReadLineRangeTool(mockConfigInstance);
  });

  afterEach(async () => {
    if (fs.existsSync(tempRootDir)) {
      await fsp.rm(tempRootDir, { recursive: true, force: true });
    }
  });

  it('should return an invocation for valid params', () => {
    const params: ReadLineRangeToolParams = {
      absolute_path: path.join(tempRootDir, 'file.txt'),
      start_line: 1,
      end_line: 1,
    };

    const result = tool.build(params);
    expect(result).not.toBeTypeOf('string');
  });

  it('should prefix returned lines with virtual line numbers when showLineNumbers is true', async () => {
    const filePath = path.join(tempRootDir, 'paginated.txt');
    const fileContent = Array.from(
      { length: 6 },
      (_, i) => `Line ${i + 1}`,
    ).join('\n');
    await fsp.writeFile(filePath, fileContent, 'utf-8');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 3,
      end_line: 5,
      showLineNumbers: true,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;

    const result = await invocation.execute(abortSignal);

    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('--- FILE CONTENT (truncated) ---');
    expect(result.llmContent).toContain('   3| Line 3');
    expect(result.llmContent).toContain('   4| Line 4');
    expect(result.llmContent).toContain('   5| Line 5');
  });

  it('should not prefix returned lines when showLineNumbers is false/omitted', async () => {
    const filePath = path.join(tempRootDir, 'paginated.txt');
    const fileContent = Array.from(
      { length: 6 },
      (_, i) => `Line ${i + 1}`,
    ).join('\n');
    await fsp.writeFile(filePath, fileContent, 'utf-8');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 3,
      end_line: 5,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;

    const result = await invocation.execute(abortSignal);

    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('--- FILE CONTENT (truncated) ---');
    expect(result.llmContent).toContain('Line 3');
    expect(result.llmContent).toContain('Line 4');
    expect(result.llmContent).toContain('Line 5');

    expect(result.llmContent).not.toContain('   3| Line 3');
  });
});
