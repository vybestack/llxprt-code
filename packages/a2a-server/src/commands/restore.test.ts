/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RestoreCommand, ListCheckpointsCommand } from './restore.js';
import type { Config, GitService } from '@vybestack/llxprt-code-core';
import type { CommandContext } from './types.js';
import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import * as path from 'node:path';

const mockFormatCheckpointDisplayList = vi.hoisted(() => vi.fn());
const mockGetToolCallDataSchema = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();

  return {
    ...original,
    formatCheckpointDisplayList: mockFormatCheckpointDisplayList,
    getToolCallDataSchema: mockGetToolCallDataSchema,
  };
});

vi.mock('node:fs/promises');
vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return {
    ...original,
  };
});

describe('ListCheckpointsCommand', () => {
  let mockConfig: Config;
  let context: CommandContext;
  const checkpointDir = '/mock/checkpoint/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      getCheckpointingEnabled: vi.fn(),
      storage: {
        getProjectTempCheckpointsDir: vi.fn().mockReturnValue(checkpointDir),
      },
    } as unknown as Config;

    context = { config: mockConfig };
  });

  it('should have the correct name', () => {
    const command = new ListCheckpointsCommand();
    expect(command.name).toEqual('restore list');
  });

  it('should return error when checkpointing is disabled', async () => {
    const command = new ListCheckpointsCommand();
    vi.mocked(mockConfig.getCheckpointingEnabled).mockReturnValue(false);

    const result = await command.execute(context, []);

    expect(result).toEqual({
      name: 'restore list',
      data: { error: 'Checkpointing is not enabled' },
    });
  });

  it('should return "No checkpoints found." for empty directory', async () => {
    const command = new ListCheckpointsCommand();
    vi.mocked(mockConfig.getCheckpointingEnabled).mockReturnValue(true);
    vi.mocked(fs.readdir).mockResolvedValue([]);
    mockFormatCheckpointDisplayList.mockReturnValue('');

    const result = await command.execute(context, []);

    expect(result).toEqual({
      name: 'restore list',
      data: 'No checkpoints found.',
    });
  });

  it('should return formatted list for directory with .json files', async () => {
    const command = new ListCheckpointsCommand();
    vi.mocked(mockConfig.getCheckpointingEnabled).mockReturnValue(true);
    // readdir returns string[] when called without options
    vi.mocked(fs.readdir).mockResolvedValue([
      'checkpoint1.json',
      'checkpoint2.json',
      'other.txt',
    ] as never);
    mockFormatCheckpointDisplayList.mockReturnValue('checkpoint1\ncheckpoint2');

    const result = await command.execute(context, []);

    expect(mockFormatCheckpointDisplayList).toHaveBeenCalledWith([
      'checkpoint1.json',
      'checkpoint2.json',
    ]);
    expect(result).toEqual({
      name: 'restore list',
      data: 'checkpoint1\ncheckpoint2',
    });
  });
});

describe('RestoreCommand', () => {
  let mockConfig: Config;
  let mockGit: GitService;
  let context: CommandContext;
  const checkpointDir = '/mock/checkpoint/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      getCheckpointingEnabled: vi.fn().mockReturnValue(true),
      storage: {
        getProjectTempCheckpointsDir: vi.fn().mockReturnValue(checkpointDir),
      },
    } as unknown as Config;

    mockGit = {
      restoreProjectFromSnapshot: vi.fn(),
    } as unknown as GitService;

    context = { config: mockConfig, git: mockGit };
  });

  it('should have the correct name', () => {
    const command = new RestoreCommand();
    expect(command.name).toEqual('restore');
  });

  it('should require workspace', () => {
    const command = new RestoreCommand();
    expect(command.requiresWorkspace).toBe(true);
  });

  it('should be a top-level command', () => {
    const command = new RestoreCommand();
    expect(command.topLevel).toBe(true);
  });

  it('should have ListCheckpointsCommand as a subcommand', () => {
    const command = new RestoreCommand();
    expect(command.subCommands.map((c) => c.name)).toContain('restore list');
  });

  it('should return error when no args provided', async () => {
    const command = new RestoreCommand();

    const result = await command.execute(context, []);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
  });

  it('should reject path traversal attempts', async () => {
    const command = new RestoreCommand();

    const result = await command.execute(context, ['../../../etc/passwd']);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('traversal');
  });

  it('should reject paths with subdirectories', async () => {
    const command = new RestoreCommand();

    const result = await command.execute(context, ['subdir/name.json']);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('traversal');
  });

  it('should return error for nonexistent file', async () => {
    const command = new RestoreCommand();
    vi.mocked(fs.lstat).mockRejectedValue({ code: 'ENOENT' });

    const result = await command.execute(context, ['nonexistent.json']);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
  });

  it('should return error for symlink file', async () => {
    const command = new RestoreCommand();
    vi.mocked(fs.lstat).mockResolvedValue({
      isSymbolicLink: () => true,
    } as Stats);

    const result = await command.execute(context, ['symlink.json']);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('symlink');
  });

  it('should return error for schema-invalid JSON', async () => {
    const command = new RestoreCommand();
    vi.mocked(fs.lstat).mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    vi.mocked(fs.readFile).mockResolvedValue('{"invalid": "data"}');

    const mockSchema = {
      parse: vi.fn().mockImplementation(() => {
        throw new Error('Validation failed');
      }),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(context, ['invalid.json']);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
  });

  it('should call restoreProjectFromSnapshot for valid checkpoint with commitHash and git', async () => {
    const command = new RestoreCommand();
    const validData = {
      commitHash: 'abc123',
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    vi.mocked(fs.lstat).mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(context, ['valid.json']);

    expect(mockGit.restoreProjectFromSnapshot).toHaveBeenCalledWith('abc123');
    expect(result).toEqual({
      name: 'restore',
      data: {
        toolCall: validData.toolCall,
        restored: true,
      },
    });
  });

  it('should return error when commitHash present but no git service', async () => {
    const command = new RestoreCommand();
    const contextNoGit = { config: mockConfig };
    const validData = {
      commitHash: 'abc123',
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    vi.mocked(fs.lstat).mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(contextNoGit, ['valid.json']);

    expect(result.name).toEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('Git');
  });

  it('should succeed for valid checkpoint without commitHash (no git needed)', async () => {
    const command = new RestoreCommand();
    const contextNoGit = { config: mockConfig };
    const validData = {
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    vi.mocked(fs.lstat).mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(contextNoGit, ['valid.json']);

    expect(result).toEqual({
      name: 'restore',
      data: {
        toolCall: validData.toolCall,
        restored: true,
      },
    });
  });

  it('should add .json extension if not present', async () => {
    const command = new RestoreCommand();
    const validData = {
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    vi.mocked(fs.lstat).mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const pathJoinSpy = vi.spyOn(path, 'join');

    await command.execute(context, ['checkpoint-name']);

    // Verify that the joined path includes .json extension
    expect(pathJoinSpy).toHaveBeenCalledWith(
      checkpointDir,
      'checkpoint-name.json',
    );
  });
});
