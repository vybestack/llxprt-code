/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { RestoreCommand, ListCheckpointsCommand } from './restore.js';
import type { Config, GitService } from '@vybestack/llxprt-code-core';
import type { CommandContext } from './types.js';
import type { Stats } from 'node:fs';
import * as path from 'node:path';

const mockFormatCheckpointDisplayList = vi.fn();
const mockGetToolCallDataSchema = vi.fn();
const mockReaddir = vi.fn();
const mockLstat = vi.fn();
const mockReadFile = vi.fn();
const dependencies = {
  formatCheckpointDisplayList: mockFormatCheckpointDisplayList,
  getToolCallDataSchema: mockGetToolCallDataSchema,
  readdir: mockReaddir,
  lstat: mockLstat,
  readFile: mockReadFile,
};

describe('ListCheckpointsCommand', () => {
  let mockConfig: Config;
  let context: CommandContext;
  let getCheckpointingEnabled: ReturnType<typeof vi.fn<() => boolean>>;
  const checkpointDir = '/mock/checkpoint/dir';

  beforeEach(() => {
    vi.clearAllMocks();

    getCheckpointingEnabled = vi.fn();
    mockConfig = {
      getCheckpointingEnabled,
      storage: {
        getProjectTempCheckpointsDir: vi.fn().mockReturnValue(checkpointDir),
      },
    } as unknown as Config;

    context = { config: mockConfig };
  });

  it('should have the correct name', () => {
    const command = new ListCheckpointsCommand(dependencies);
    expect(command.name).toStrictEqual('restore list');
  });

  it('should return error when checkpointing is disabled', async () => {
    const command = new ListCheckpointsCommand(dependencies);
    getCheckpointingEnabled.mockReturnValue(false);

    const result = await command.execute(context, []);

    expect(result).toStrictEqual({
      name: 'restore list',
      data: { error: 'Checkpointing is not enabled' },
    });
  });

  it('should return "No checkpoints found." for empty directory', async () => {
    const command = new ListCheckpointsCommand(dependencies);
    getCheckpointingEnabled.mockReturnValue(true);
    mockReaddir.mockResolvedValue([]);
    mockFormatCheckpointDisplayList.mockReturnValue('');

    const result = await command.execute(context, []);

    expect(result).toStrictEqual({
      name: 'restore list',
      data: 'No checkpoints found.',
    });
  });

  it('should return formatted list for directory with .json files', async () => {
    const command = new ListCheckpointsCommand(dependencies);
    getCheckpointingEnabled.mockReturnValue(true);
    // readdir returns string[] when called without options
    mockReaddir.mockResolvedValue([
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
    expect(result).toStrictEqual({
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
    const command = new RestoreCommand(dependencies);
    expect(command.name).toStrictEqual('restore');
  });

  it('should require workspace', () => {
    const command = new RestoreCommand(dependencies);
    expect(command.requiresWorkspace).toBe(true);
  });

  it('should be a top-level command', () => {
    const command = new RestoreCommand(dependencies);
    expect(command.topLevel).toBe(true);
  });

  it('should have ListCheckpointsCommand as a subcommand', () => {
    const command = new RestoreCommand(dependencies);
    expect(command.subCommands.map((c) => c.name)).toContain('restore list');
  });

  it('should return error when no args provided', async () => {
    const command = new RestoreCommand(dependencies);

    const result = await command.execute(context, []);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
  });

  it('should reject path traversal attempts', async () => {
    const command = new RestoreCommand(dependencies);

    const result = await command.execute(context, ['../../../etc/passwd']);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('traversal');
  });

  it('should reject paths with subdirectories', async () => {
    const command = new RestoreCommand(dependencies);

    const result = await command.execute(context, ['subdir/name.json']);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('traversal');
  });

  it('should return error for nonexistent file', async () => {
    const command = new RestoreCommand(dependencies);
    mockLstat.mockRejectedValue({ code: 'ENOENT' });

    const result = await command.execute(context, ['nonexistent.json']);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
  });

  it('should return error for symlink file', async () => {
    const command = new RestoreCommand(dependencies);
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => true,
    } as Stats);

    const result = await command.execute(context, ['symlink.json']);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('symlink');
  });

  it('should return error for schema-invalid JSON', async () => {
    const command = new RestoreCommand(dependencies);
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    mockReadFile.mockResolvedValue('{"invalid": "data"}');

    const mockSchema = {
      parse: vi.fn().mockImplementation(() => {
        throw new Error('Validation failed');
      }),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(context, ['invalid.json']);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
  });

  it('should call restoreProjectFromSnapshot for valid checkpoint with commitHash and git', async () => {
    const command = new RestoreCommand(dependencies);
    const validData = {
      commitHash: 'abc123',
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    mockReadFile.mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(context, ['valid.json']);

    expect(mockGit.restoreProjectFromSnapshot).toHaveBeenCalledWith('abc123');
    expect(result).toStrictEqual({
      name: 'restore',
      data: {
        toolCall: validData.toolCall,
        restored: true,
      },
    });
  });

  it('should return error when commitHash present but no git service', async () => {
    const command = new RestoreCommand(dependencies);
    const contextNoGit = { config: mockConfig };
    const validData = {
      commitHash: 'abc123',
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    mockReadFile.mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(contextNoGit, ['valid.json']);

    expect(result.name).toStrictEqual('restore');
    expect(result.data).toHaveProperty('error');
    expect((result.data as { error?: string }).error).toContain('Git');
  });

  it('should succeed for valid checkpoint without commitHash (no git needed)', async () => {
    const command = new RestoreCommand(dependencies);
    const contextNoGit = { config: mockConfig };
    const validData = {
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    mockReadFile.mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    const result = await command.execute(contextNoGit, ['valid.json']);

    expect(result).toStrictEqual({
      name: 'restore',
      data: {
        toolCall: validData.toolCall,
        restored: true,
      },
    });
  });

  it('should add .json extension if not present', async () => {
    const command = new RestoreCommand(dependencies);
    const validData = {
      toolCall: {
        name: 'test_tool',
        args: { file_path: '/test/file.txt' },
      },
    };

    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
    } as Stats);
    mockReadFile.mockResolvedValue(JSON.stringify(validData));

    const mockSchema = {
      parse: vi.fn().mockReturnValue(validData),
    };
    mockGetToolCallDataSchema.mockReturnValue(mockSchema);

    await command.execute(context, ['checkpoint-name']);

    expect(mockLstat).toHaveBeenCalledWith(
      path.join(checkpointDir, 'checkpoint-name.json'),
    );
  });
});
