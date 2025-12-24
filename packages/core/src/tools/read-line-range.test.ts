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

  it('should include a warning (but still return content) when showGitChanges is enabled and file is not in a git repo', async () => {
    const filePath = path.join(tempRootDir, 'file.txt');
    const fileContent = ['Line 1', 'Line 2', 'Line 3'].join('\n');
    await fsp.writeFile(filePath, fileContent, 'utf-8');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 1,
      end_line: 2,
      showGitChanges: true,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;

    const result = await invocation.execute(abortSignal);
    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain(
      'NOTE: Failed to read git change status',
    );
    expect(result.llmContent).toContain('Git changes legend');
    expect(result.llmContent).toContain('Line 1');
    expect(result.llmContent).toContain('Line 2');
  });

  it('should show N markers in the returned range when showGitChanges is enabled in a git repo', async () => {
    const repoDir = path.join(tempRootDir, 'repo-n');
    await fsp.mkdir(repoDir, { recursive: true });

    const filePath = path.join(repoDir, 'file.txt');
    await fsp.writeFile(
      filePath,
      ['one', 'two', 'three', ''].join('\n'),
      'utf-8',
    );

    const runGit = async (args: string[]) => {
      const { spawn } = await import('child_process');
      return await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, { cwd: repoDir, windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d.toString('utf8');
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(new Error(stderr.trim() || `git exited with code ${code}`));
        });
      });
    };

    await runGit(['init']);
    await runGit(['config', 'user.email', 'test@example.com']);
    await runGit(['config', 'user.name', 'Test User']);
    await runGit(['add', 'file.txt']);
    await runGit(['commit', '-m', 'init']);

    await fsp.appendFile(filePath, '\nnew');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 5,
      end_line: 5,
      showGitChanges: true,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;
    const result = await invocation.execute(abortSignal);

    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('Git changes legend');
    expect(result.llmContent).toContain('Nnew');
    expect(result.llmContent).not.toContain(
      'NOTE: Failed to read git change status',
    );
  });

  it('should show M markers in the returned range when showGitChanges is enabled in a git repo', async () => {
    const repoDir = path.join(tempRootDir, 'repo-m');
    await fsp.mkdir(repoDir, { recursive: true });

    const filePath = path.join(repoDir, 'file.txt');
    await fsp.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8');

    const runGit = async (args: string[]) => {
      const { spawn } = await import('child_process');
      return await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, { cwd: repoDir, windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d.toString('utf8');
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(new Error(stderr.trim() || `git exited with code ${code}`));
        });
      });
    };

    await runGit(['init']);
    await runGit(['config', 'user.email', 'test@example.com']);
    await runGit(['config', 'user.name', 'Test User']);
    await runGit(['add', 'file.txt']);
    await runGit(['commit', '-m', 'init']);

    await fsp.writeFile(filePath, ['one', 'TWO', 'three'].join('\n'), 'utf-8');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 2,
      end_line: 2,
      showGitChanges: true,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;
    const result = await invocation.execute(abortSignal);

    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('Git changes legend');
    expect(result.llmContent).toContain('MTWO');
    expect(result.llmContent).not.toContain(
      'NOTE: Failed to read git change status',
    );
  });

  it('should show D markers in the returned range when showGitChanges is enabled in a git repo', async () => {
    const repoDir = path.join(tempRootDir, 'repo-d');
    await fsp.mkdir(repoDir, { recursive: true });

    const filePath = path.join(repoDir, 'file.txt');
    await fsp.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8');

    const runGit = async (args: string[]) => {
      const { spawn } = await import('child_process');
      return await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, { cwd: repoDir, windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d.toString('utf8');
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(new Error(stderr.trim() || `git exited with code ${code}`));
        });
      });
    };

    await runGit(['init']);
    await runGit(['config', 'user.email', 'test@example.com']);
    await runGit(['config', 'user.name', 'Test User']);
    await runGit(['add', 'file.txt']);
    await runGit(['commit', '-m', 'init']);

    await fsp.writeFile(filePath, ['one', 'two'].join('\n'), 'utf-8');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 2,
      end_line: 2,
      showGitChanges: true,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;
    const result = await invocation.execute(abortSignal);

    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('Git changes legend');

    // Deletion happened between line 2 and the now-missing line 3, so the marker is attached to the last
    // visible line (line 2).
    expect(result.llmContent).toContain('Dtwo');

    expect(result.llmContent).not.toContain(
      'NOTE: Failed to read git change status',
    );
  });

  it('should show a leading D line when deletions happened immediately before the requested range', async () => {
    const repoDir = path.join(tempRootDir, 'repo-d-boundary');
    await fsp.mkdir(repoDir, { recursive: true });

    const filePath = path.join(repoDir, 'file.txt');
    await fsp.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8');

    const runGit = async (args: string[]) => {
      const { spawn } = await import('child_process');
      return await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, { cwd: repoDir, windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d.toString('utf8');
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(new Error(stderr.trim() || `git exited with code ${code}`));
        });
      });
    };

    await runGit(['init']);
    await runGit(['config', 'user.email', 'test@example.com']);
    await runGit(['config', 'user.name', 'Test User']);
    await runGit(['add', 'file.txt']);
    await runGit(['commit', '-m', 'init']);

    // Delete the first line in working tree. This creates a deletion block "before line 1".
    await fsp.writeFile(filePath, ['two', 'three'].join('\n'), 'utf-8');

    const params: ReadLineRangeToolParams = {
      absolute_path: filePath,
      start_line: 1,
      end_line: 1,
      showGitChanges: true,
    };

    const invocation = tool.build(params) as ToolInvocation<
      ReadLineRangeToolParams,
      ToolResult
    >;
    const result = await invocation.execute(abortSignal);

    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('Git changes legend');

    // The first rendered line should be the "virtual" deletion marker line.
    expect(result.llmContent).toContain('\nD\n');
    expect(result.llmContent).toContain('░two');
  });
});
