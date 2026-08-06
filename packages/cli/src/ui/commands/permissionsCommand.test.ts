/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import { permissionsCommand } from './permissionsCommand.js';
import { CommandKind } from './types.js';
import * as trustedFolders from '../../config/trustedFolders.js';
import { createMockCommandContext as createBaseMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

const realTrustedFoldersModule = {
  ...(await import('../../config/trustedFolders.js')),
};

const mockedCwd = vi.fn();
const mockedHomedir = vi.fn(() => '/mock/home/user');
const mockSetValue = vi.fn();
const mockSnapshotValue = vi.fn();
const mockRestoreSnapshot = vi.fn();
const mockIsPathTrusted = vi.fn();
const mockRules: Array<{
  path: string;
  trustLevel: trustedFolders.TrustLevel;
}> = [];

const actual = { ...(await import('node:process')) };
vi.mock('node:process', () => {
  return {
    ...actual,
    cwd: mockedCwd,
  };
});

const actualActual = { ...(await import('node:os')) };
vi.mock('node:os', () => {
  return {
    ...actualActual,
    homedir: mockedHomedir,
  };
});

vi.mock('../../config/trustedFolders.js', () => {
  const actual = realTrustedFoldersModule;
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      rules: mockRules,
      setValue: mockSetValue,
      getValue: (location: string) =>
        mockRules.find((rule) => rule.path === location)?.trustLevel,
      snapshotValue: mockSnapshotValue,
      restoreSnapshot: mockRestoreSnapshot,
      user: { path: '/mock/path', config: {} },
      errors: [],
      isPathTrusted: mockIsPathTrusted,
    })),
  };
});

import * as mockedProcess from 'node:process';

import { ideContext } from '@vybestack/llxprt-code-core';
describe('permissionsCommand', () => {
  let testRoot: string;
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-permissions-'));
    workspacePath = path.join(testRoot, 'projects', 'myapp');
    for (const directory of [
      workspacePath,
      path.join(testRoot, 'projects', 'my-project'),
      path.join(testRoot, 'my projects', 'project with spaces'),
      path.join(workspacePath, 'relative', 'path'),
      path.join(testRoot, 'config', 'workspace', 'child'),
      path.join(testRoot, 'projects', 'myapp-sub'),
      path.join(testRoot, 'projects', 'myap'),
      path.join(testRoot, 'some', 'unrelated', 'path'),
      path.join(testRoot, 'opt', 'llxprt-other'),
    ]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    mockedCwd.mockReturnValue(workspacePath);
    ideContext.clearIdeContext();
    mockRules.length = 0;
    mockSetValue.mockImplementation(
      (rulePath: string, trustLevel: trustedFolders.TrustLevel) => {
        mockRules.push({ path: rulePath, trustLevel });
      },
    );
    mockSnapshotValue.mockImplementation((location: string) => ({
      canonicalPath: location,
      entries: mockRules.map(
        ({ path: rulePath, trustLevel }) => [rulePath, trustLevel] as const,
      ),
    }));
    mockRestoreSnapshot.mockImplementation(
      (snapshot: trustedFolders.TrustedFolderSnapshot) => {
        mockRules.length = 0;
        for (const [rulePath, trustLevel] of snapshot.entries) {
          mockRules.push({ path: rulePath, trustLevel });
        }
      },
    );
    mockIsPathTrusted.mockImplementation((location: string) => {
      const config = Object.fromEntries(
        mockRules.map((rule) => [rule.path, rule.trustLevel]),
      );
      return new trustedFolders.LoadedTrustedFolders(
        { path: '/mock/path', config },
        [],
      ).isPathTrusted(location);
    });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  const createMockContext = (configOverrides?: {
    setTrustedFolderLive?: ReturnType<typeof vi.fn>;
    getWorkingDir?: () => string;
  }) => {
    const config = configOverrides
      ? ({
          setTrustedFolderLive: configOverrides.setTrustedFolderLive ?? vi.fn(),
          getWorkingDir: configOverrides.getWorkingDir ?? (() => workspacePath),
          getFolderTrust: () => true,
          isTrustedFolder: () => false,
        } satisfies Pick<
          CliUiRuntime,
          | 'setTrustedFolderLive'
          | 'getWorkingDir'
          | 'getFolderTrust'
          | 'isTrustedFolder'
        >)
      : null;
    return createBaseMockCommandContext({
      services: {
        config: config as CliUiRuntime | null,
        settings: { merged: { folderTrust: true } },
      },
    });
  };

  it('should have correct name and description', async () => {
    expect(permissionsCommand.name).toBe('permissions');
    expect(permissionsCommand.description).toBe('manage folder trust settings');
  });

  it('should be a built-in command', async () => {
    expect(permissionsCommand.kind).toBe(CommandKind.BUILT_IN);
  });

  describe('dialog mode (no arguments)', () => {
    it('should return a dialog action when no args provided', async () => {
      const mockContext = createMockContext();
      const result = await permissionsCommand.action?.(mockContext, '');

      expect(result).toStrictEqual({
        type: 'dialog',
        dialog: 'permissions',
      });
    });

    it('should return a dialog action when only whitespace provided', async () => {
      const mockContext = createMockContext();
      const result = await permissionsCommand.action?.(mockContext, '   ');

      expect(result).toStrictEqual({
        type: 'dialog',
        dialog: 'permissions',
      });
    });
  });

  describe('modify trust mode (with arguments)', () => {
    it('should modify trust for an explicit target directory', async () => {
      const mockContext = createMockContext();
      const targetPath = path.join(testRoot, 'projects', 'my-project');
      const args = `TRUST_FOLDER ${targetPath}`;

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalledWith(
        path.normalize(targetPath),
        'TRUST_FOLDER',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Trust level set to TRUST_FOLDER'),
      });
    });

    it('should handle TRUST_PARENT trust level', async () => {
      const mockContext = createMockContext();
      const targetPath = path.join(testRoot, 'projects', 'my-project');
      const args = `TRUST_PARENT ${targetPath}`;

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalledWith(
        path.normalize(targetPath),
        'TRUST_PARENT',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Trust level set to TRUST_PARENT'),
      });
    });

    it('should handle DO_NOT_TRUST trust level', async () => {
      const mockContext = createMockContext();
      const targetPath = path.join(testRoot, 'projects', 'my-project');
      const args = `DO_NOT_TRUST ${targetPath}`;

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalledWith(
        path.normalize(targetPath),
        'DO_NOT_TRUST',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Trust level set to DO_NOT_TRUST'),
      });
    });

    it('should reject invalid trust levels', async () => {
      const mockContext = createMockContext();
      const args = 'INVALID_TRUST /some/path';

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Invalid trust level'),
      });
    });

    it('should report error when target path is omitted', async () => {
      const mockContext = createMockContext();
      const args = 'TRUST_FOLDER';

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('path is required'),
      });
    });

    it('should handle paths with spaces', async () => {
      const mockContext = createMockContext();
      const targetPath = path.join(
        testRoot,
        'my projects',
        'project with spaces',
      );
      const args = `TRUST_FOLDER ${targetPath}`;

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalledWith(
        path.normalize(targetPath),
        'TRUST_FOLDER',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Trust level set to TRUST_FOLDER'),
      });
    });

    it('should normalize relative paths', async () => {
      const mockContext = createMockContext();
      const args = 'TRUST_FOLDER ./relative/path';

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalledWith(
        expect.any(String),
        'TRUST_FOLDER',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Trust level set to TRUST_FOLDER'),
      });
    });

    it('A6: expands a tilde-prefixed target path through the shared helper', async () => {
      mockedHomedir.mockReturnValue('/mock/home/user');
      const mockContext = createMockContext();
      const args = 'TRUST_FOLDER ~/projects/x';

      const result = await permissionsCommand.action?.(mockContext, args);

      // path.resolve, not path.join: on Windows the production helper resolves
      // against the current drive, which path.join would not reproduce.
      expect(mockSetValue).toHaveBeenCalledWith(
        path.resolve('/mock/home/user', 'projects', 'x'),
        'TRUST_FOLDER',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Trust level set to TRUST_FOLDER'),
      });
    });

    it('should handle setValue throwing an error', async () => {
      const mockContext = createMockContext();
      const targetPath = path.join(testRoot, 'projects', 'my-project');
      const args = `TRUST_FOLDER ${targetPath}`;
      mockSetValue.mockImplementationOnce(() => {
        throw new Error('Failed to save');
      });

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Failed to save trust settings'),
      });
    });

    it('rolls back saved and live trust when transition settlement fails', async () => {
      const transitionFailure = new Error('transition failed');
      const setTrustedFolderLive = vi
        .fn()
        .mockRejectedValueOnce(transitionFailure)
        .mockResolvedValueOnce(undefined);
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER ${workspacePath}`;

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockRules).toStrictEqual([]);
      expect(setTrustedFolderLive).toHaveBeenNthCalledWith(1, true);
      expect(setTrustedFolderLive).toHaveBeenNthCalledWith(2, false);
      expect(result).toMatchObject({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('transition failed'),
      });
    });

    it('flattens nested transition and rollback failures in the command result', async () => {
      const setTrustedFolderLive = vi
        .fn()
        .mockRejectedValueOnce(
          new AggregateError(
            [new Error('disconnect failed'), new Error('refresh failed')],
            'transition failed',
          ),
        )
        .mockRejectedValueOnce(
          new AggregateError(
            [new Error('policy rollback failed')],
            'live rollback failed',
          ),
        );
      mockSetValue.mockImplementationOnce(() => {
        mockRules.push({
          path: workspacePath,
          trustLevel: trustedFolders.TrustLevel.TRUST_FOLDER,
        });
      });
      mockRestoreSnapshot.mockImplementationOnce(() => {
        throw new Error('saved rollback failed');
      });
      const mockContext = createMockContext({ setTrustedFolderLive });

      const result = await permissionsCommand.action?.(
        mockContext,
        `TRUST_FOLDER ${workspacePath}`,
      );

      // Bun's toMatchObject caches asymmetric matchers across calls on the
      // same property, so only the first stringContaining assertion works
      // reliably. Extract content once and use toContain for the rest.
      expect(result).toMatchObject({
        type: 'message',
        messageType: 'error',
      });
      const content = (result as { content?: string }).content;
      expect(content).toContain('disconnect failed');
      expect(content).toContain('refresh failed');
      expect(content).toContain('saved rollback failed');
      expect(content).toContain('policy rollback failed');
      expect(content).not.toMatch(/setting was restored/i);
    });

    it('resolves a relative target against Config working directory', async () => {
      const setTrustedFolderLive = vi.fn();
      const context = createMockContext({
        setTrustedFolderLive,
        getWorkingDir: () => path.join(testRoot, 'config', 'workspace'),
      });
      (mockedProcess.cwd as Mock<typeof mockedProcess.cwd>).mockReturnValue(
        path.join(testRoot, 'process', 'workspace'),
      );

      await permissionsCommand.action?.(context, 'TRUST_FOLDER child');

      expect(mockSetValue).toHaveBeenCalledWith(
        path.resolve(path.join(testRoot, 'config', 'workspace'), 'child'),
        trustedFolders.TrustLevel.TRUST_FOLDER,
      );
    });
  });

  describe('live Config update', () => {
    it('should call setTrustedFolderLive(true) when trusting the current workspace', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER ${workspacePath}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should call setTrustedFolderLive(false) when untrusting the current workspace', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `DO_NOT_TRUST ${workspacePath}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it.each([
      [trustedFolders.TrustLevel.TRUST_FOLDER, false, true],
      [trustedFolders.TrustLevel.DO_NOT_TRUST, true, false],
    ] as const)(
      'caches local %s resolution instead of the opposite IDE override',
      async (trustLevel, ideTrust, expectedLocalTrust) => {
        ideContext.setIdeContext({ workspaceState: { isTrusted: ideTrust } });
        const setTrustedFolderLive = vi.fn();
        const mockContext = createMockContext({ setTrustedFolderLive });

        await permissionsCommand.action?.(
          mockContext,
          `${trustLevel} ${workspacePath}`,
        );

        expect(setTrustedFolderLive).toHaveBeenCalledWith(expectedLocalTrust);
      },
    );

    it('should call setTrustedFolderLive(true) when TRUST_PARENT covers the cwd', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      // TRUST_PARENT on /home/user/projects/myapp means parent is trusted
      const args = `TRUST_PARENT ${workspacePath}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('returns a user-facing error when trusted-folder loading fails', async () => {
      (
        trustedFolders.loadTrustedFolders as Mock<
          typeof trustedFolders.loadTrustedFolders
        >
      ).mockImplementationOnce(() => {
        throw new Error('load failed');
      });
      const mockContext = createMockContext();

      const result = await permissionsCommand.action?.(
        mockContext,
        `TRUST_FOLDER ${workspacePath}`,
      );

      expect(result).toMatchObject({
        messageType: 'error',
        content: expect.stringContaining('load failed'),
      });
      expect(mockSetValue).not.toHaveBeenCalled();
    });

    it('should call setTrustedFolderLive(true) when TRUST_FOLDER covers cwd as a descendant', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER ${path.join(testRoot, 'projects')}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should call setTrustedFolderLive(true) when TRUST_PARENT on a sibling covers cwd via shared parent', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      // TRUST_PARENT on /home/user/projects/myapp-sub means /home/user/projects is trusted
      // which covers cwd /home/user/projects/myapp
      const args = `TRUST_PARENT ${path.join(testRoot, 'projects', 'myapp-sub')}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should recompute live trust after changing an unrelated path', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER ${path.join(testRoot, 'some', 'unrelated', 'path')}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it('should NOT call setTrustedFolderLive for sibling path with shared string prefix (boundary safety)', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      // /home/user/projects/myap is a string-prefix of cwd
      // /home/user/projects/myapp but is NOT an ancestor directory.
      // startsWith would incorrectly match.
      const args = `TRUST_FOLDER ${path.join(testRoot, 'projects', 'myap')}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it('should recompute false for TRUST_PARENT on an unrelated path', async () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_PARENT ${path.join(testRoot, 'opt', 'llxprt-other')}`;

      await permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it('should not call setTrustedFolderLive when config is null', async () => {
      const mockContext = createMockContext();
      const args = `TRUST_FOLDER ${workspacePath}`;

      const result = await permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalled();
      expect(result).toMatchObject({ messageType: 'info' });
    });
  });
});
