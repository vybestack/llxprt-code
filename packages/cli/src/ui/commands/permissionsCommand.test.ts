/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { permissionsCommand } from './permissionsCommand.js';
import { CommandKind } from './types.js';
import * as path from 'node:path';
import * as trustedFolders from '../../config/trustedFolders.js';
import { createMockCommandContext as createBaseMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

const mockSetValue = vi.fn();
const mockIsPathTrusted = vi.fn();
const mockRules: Array<{
  path: string;
  trustLevel: trustedFolders.TrustLevel;
}> = [];

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>();
  return {
    ...actual,
    cwd: vi.fn(() => '/home/user/projects/myapp'),
  };
});

vi.mock('../../config/trustedFolders.js', async () => {
  const actual = await vi.importActual('../../config/trustedFolders.js');
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      rules: mockRules,
      setValue: mockSetValue,
      user: { path: '/mock/path', config: {} },
      errors: [],
      isPathTrusted: mockIsPathTrusted,
    })),
  };
});

import * as mockedProcess from 'node:process';

import { ideContext } from '@vybestack/llxprt-code-core';
describe('permissionsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ideContext.clearIdeContext();
    mockRules.length = 0;
    mockSetValue.mockImplementation(
      (rulePath: string, trustLevel: trustedFolders.TrustLevel) => {
        mockRules.push({ path: rulePath, trustLevel });
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
    vi.mocked(mockedProcess.cwd).mockReturnValue('/home/user/projects/myapp');
  });

  const createMockContext = (configOverrides?: {
    setTrustedFolderLive?: ReturnType<typeof vi.fn>;
    getWorkingDir?: () => string;
  }) => {
    const config = configOverrides
      ? ({
          setTrustedFolderLive: configOverrides.setTrustedFolderLive ?? vi.fn(),
          getWorkingDir:
            configOverrides.getWorkingDir ??
            (() => '/home/user/projects/myapp'),
          getFolderTrust: () => true,
        } satisfies Pick<
          CliUiRuntime,
          'setTrustedFolderLive' | 'getWorkingDir' | 'getFolderTrust'
        >)
      : null;
    return createBaseMockCommandContext({
      services: {
        config: config as CliUiRuntime | null,
        settings: { merged: { folderTrust: true } },
      },
    });
  };

  it('should have correct name and description', () => {
    expect(permissionsCommand.name).toBe('permissions');
    expect(permissionsCommand.description).toBe('manage folder trust settings');
  });

  it('should be a built-in command', () => {
    expect(permissionsCommand.kind).toBe(CommandKind.BUILT_IN);
  });

  describe('dialog mode (no arguments)', () => {
    it('should return a dialog action when no args provided', () => {
      const mockContext = createMockContext();
      const result = permissionsCommand.action?.(mockContext, '');

      expect(result).toStrictEqual({
        type: 'dialog',
        dialog: 'permissions',
      });
    });

    it('should return a dialog action when only whitespace provided', () => {
      const mockContext = createMockContext();
      const result = permissionsCommand.action?.(mockContext, '   ');

      expect(result).toStrictEqual({
        type: 'dialog',
        dialog: 'permissions',
      });
    });
  });

  describe('modify trust mode (with arguments)', () => {
    it('should modify trust for an explicit target directory', () => {
      const mockContext = createMockContext();
      const targetPath = '/home/user/projects/my-project';
      const args = `TRUST_FOLDER ${targetPath}`;

      const result = permissionsCommand.action?.(mockContext, args);

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

    it('should handle TRUST_PARENT trust level', () => {
      const mockContext = createMockContext();
      const targetPath = '/home/user/projects/my-project';
      const args = `TRUST_PARENT ${targetPath}`;

      const result = permissionsCommand.action?.(mockContext, args);

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

    it('should handle DO_NOT_TRUST trust level', () => {
      const mockContext = createMockContext();
      const targetPath = '/home/user/projects/my-project';
      const args = `DO_NOT_TRUST ${targetPath}`;

      const result = permissionsCommand.action?.(mockContext, args);

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

    it('should reject invalid trust levels', () => {
      const mockContext = createMockContext();
      const args = 'INVALID_TRUST /some/path';

      const result = permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Invalid trust level'),
      });
    });

    it('should report error when target path is omitted', () => {
      const mockContext = createMockContext();
      const args = 'TRUST_FOLDER';

      const result = permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('path is required'),
      });
    });

    it('should handle paths with spaces', () => {
      const mockContext = createMockContext();
      const targetPath = '/home/user/my projects/project with spaces';
      const args = `TRUST_FOLDER ${targetPath}`;

      const result = permissionsCommand.action?.(mockContext, args);

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

    it('should normalize relative paths', () => {
      const mockContext = createMockContext();
      const args = 'TRUST_FOLDER ./relative/path';

      const result = permissionsCommand.action?.(mockContext, args);

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

    it('should handle setValue throwing an error', () => {
      const mockContext = createMockContext();
      const targetPath = '/home/user/projects/my-project';
      const args = `TRUST_FOLDER ${targetPath}`;
      mockSetValue.mockImplementationOnce(() => {
        throw new Error('Failed to save');
      });

      const result = permissionsCommand.action?.(mockContext, args);

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Failed to save trust settings'),
      });
    });

    it('resolves a relative target against Config working directory', () => {
      const setTrustedFolderLive = vi.fn();
      const context = createMockContext({
        setTrustedFolderLive,
        getWorkingDir: () => '/config/workspace',
      });
      vi.mocked(mockedProcess.cwd).mockReturnValue('/process/workspace');

      void permissionsCommand.action?.(context, 'TRUST_FOLDER child');

      expect(mockSetValue).toHaveBeenCalledWith(
        path.resolve('/config/workspace', 'child'),
        trustedFolders.TrustLevel.TRUST_FOLDER,
      );
    });
  });

  describe('live Config update', () => {
    it('should call setTrustedFolderLive(true) when trusting the current workspace', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER /home/user/projects/myapp`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should call setTrustedFolderLive(false) when untrusting the current workspace', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `DO_NOT_TRUST /home/user/projects/myapp`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it.each([
      [trustedFolders.TrustLevel.TRUST_FOLDER, false, true],
      [trustedFolders.TrustLevel.DO_NOT_TRUST, true, false],
    ] as const)(
      'caches local %s resolution instead of the opposite IDE override',
      (trustLevel, ideTrust, expectedLocalTrust) => {
        ideContext.setIdeContext({ workspaceState: { isTrusted: ideTrust } });
        const setTrustedFolderLive = vi.fn();
        const mockContext = createMockContext({ setTrustedFolderLive });

        void permissionsCommand.action?.(
          mockContext,
          `${trustLevel} /home/user/projects/myapp`,
        );

        expect(setTrustedFolderLive).toHaveBeenCalledWith(expectedLocalTrust);
      },
    );

    it('should call setTrustedFolderLive(true) when TRUST_PARENT covers the cwd', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      // TRUST_PARENT on /home/user/projects/myapp means parent is trusted
      const args = `TRUST_PARENT /home/user/projects/myapp`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should call setTrustedFolderLive(true) when TRUST_FOLDER covers cwd as a descendant', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER /home/user/projects`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should call setTrustedFolderLive(true) when TRUST_PARENT on a sibling covers cwd via shared parent', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      // TRUST_PARENT on /home/user/projects/myapp-sub means /home/user/projects is trusted
      // which covers cwd /home/user/projects/myapp
      const args = `TRUST_PARENT /home/user/projects/myapp-sub`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(true);
    });

    it('should recompute live trust after changing an unrelated path', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_FOLDER /some/unrelated/path`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it('should NOT call setTrustedFolderLive for sibling path with shared string prefix (boundary safety)', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      // /home/user/projects/myap is a string-prefix of cwd
      // /home/user/projects/myapp but is NOT an ancestor directory.
      // startsWith would incorrectly match.
      const args = `TRUST_FOLDER /home/user/projects/myap`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it('should recompute false for TRUST_PARENT on an unrelated path', () => {
      const setTrustedFolderLive = vi.fn();
      const mockContext = createMockContext({ setTrustedFolderLive });
      const args = `TRUST_PARENT /opt/llxprt-other`;

      void permissionsCommand.action?.(mockContext, args);

      expect(setTrustedFolderLive).toHaveBeenCalledWith(false);
    });

    it('should not call setTrustedFolderLive when config is null', () => {
      const mockContext = createMockContext();
      const args = `TRUST_FOLDER /home/user/projects/myapp`;

      const result = permissionsCommand.action?.(mockContext, args);

      expect(mockSetValue).toHaveBeenCalled();
      expect(result).toMatchObject({ messageType: 'info' });
    });
  });
});
