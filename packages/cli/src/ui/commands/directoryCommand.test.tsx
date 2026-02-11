/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { directoryCommand, expandHomeDir } from './directoryCommand.js';
import {
  loadServerHierarchicalMemory,
  type Config,
  type WorkspaceContext,
} from '@vybestack/llxprt-code-core';
import { CommandContext } from './types.js';
import { MessageType } from '../types.js';
import * as os from 'os';
import * as path from 'path';
import * as trustedFoldersModule from '../../config/trustedFolders.js';
import type { LoadedTrustedFolders } from '../../config/trustedFolders.js';

// Mock the trustedFolders module
vi.mock('../../config/trustedFolders.js', () => ({
  loadTrustedFolders: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    loadServerHierarchicalMemory: vi.fn(),
  };
});

const mockLoadServerHierarchicalMemory = vi.mocked(
  loadServerHierarchicalMemory,
);

describe('directoryCommand', () => {
  let mockContext: CommandContext;
  let mockConfig: Config;
  let mockWorkspaceContext: WorkspaceContext;
  const addCommand = directoryCommand.subCommands?.find(
    (c) => c.name === 'add',
  );
  const showCommand = directoryCommand.subCommands?.find(
    (c) => c.name === 'show',
  );

  beforeEach(() => {
    mockLoadServerHierarchicalMemory.mockReset();
    mockLoadServerHierarchicalMemory.mockResolvedValue({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    });

    mockWorkspaceContext = {
      addDirectory: vi.fn(),
      getDirectories: vi
        .fn()
        .mockReturnValue([
          path.normalize('/home/user/project1'),
          path.normalize('/home/user/project2'),
        ]),
    } as unknown as WorkspaceContext;

    mockConfig = {
      getWorkspaceContext: () => mockWorkspaceContext,
      isRestrictiveSandbox: vi.fn().mockReturnValue(false),
      getGeminiClient: vi.fn().mockReturnValue({
        addDirectoryContext: vi.fn(),
      }),
      getWorkingDir: () => '/test/dir',
      shouldLoadMemoryFromIncludeDirectories: () => false,
      getDebugMode: () => false,
      getFileService: () => ({}),
      getExtensions: () => [],
      getExtensionContextFilePaths: () => [],
      getFileFilteringOptions: () => ({ ignore: [], include: [] }),
      setUserMemory: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      getFolderTrust: vi.fn().mockReturnValue(false), // Default: folder trust disabled
    } as unknown as Config;

    mockContext = {
      services: {
        config: mockConfig,
        settings: {
          merged: {
            memoryDiscoveryMaxDirs: 1000,
          },
        },
      },
      ui: {
        addItem: vi.fn(),
      },
    } as unknown as CommandContext;
  });

  describe('show', () => {
    it('should display the list of directories', () => {
      if (!showCommand?.action) throw new Error('No action');
      showCommand.action(mockContext, '');
      expect(mockWorkspaceContext.getDirectories).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: `Current workspace directories:\n- ${path.normalize(
            '/home/user/project1',
          )}\n- ${path.normalize('/home/user/project2')}`,
        }),
        expect.any(Number),
      );
    });
  });

  describe('add', () => {
    it('should show an error if no path is provided', () => {
      if (!addCommand?.action) throw new Error('No action');
      addCommand.action(mockContext, '');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Please provide at least one path to add.',
        }),
        expect.any(Number),
      );
    });

    it('should call addDirectory and show a success message for a single path', async () => {
      const newPath = path.normalize('/home/user/new-project');
      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, newPath);
      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledWith(newPath);
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: `Successfully added directories:\n- ${newPath}`,
        }),
        expect.any(Number),
      );
    });

    it('should call addDirectory for each path and show a success message for multiple paths', async () => {
      const newPath1 = path.normalize('/home/user/new-project1');
      const newPath2 = path.normalize('/home/user/new-project2');
      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, `${newPath1},${newPath2}`);
      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledWith(newPath1);
      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledWith(newPath2);
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: `Successfully added directories:\n- ${newPath1}\n- ${newPath2}`,
        }),
        expect.any(Number),
      );
    });

    it('should show an error if addDirectory throws an exception', async () => {
      const error = new Error('Directory does not exist');
      vi.mocked(mockWorkspaceContext.addDirectory).mockImplementation(() => {
        throw error;
      });
      const newPath = path.normalize('/home/user/invalid-project');
      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, newPath);
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: `Error adding '${newPath}': ${error.message}`,
        }),
        expect.any(Number),
      );
    });

    it('should handle a mix of successful and failed additions', async () => {
      const validPath = path.normalize('/home/user/valid-project');
      const invalidPath = path.normalize('/home/user/invalid-project');
      const error = new Error('Directory does not exist');
      vi.mocked(mockWorkspaceContext.addDirectory).mockImplementation(
        (p: string) => {
          if (p === invalidPath) {
            throw error;
          }
        },
      );

      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, `${validPath},${invalidPath}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: `Successfully added directories:\n- ${validPath}`,
        }),
        expect.any(Number),
      );

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: `Error adding '${invalidPath}': ${error.message}`,
        }),
        expect.any(Number),
      );
    });
  });
  it('should correctly expand a Windows-style home directory path', () => {
    const windowsPath = '%userprofile%\\Documents';
    const expectedPath = path.win32.join(os.homedir(), 'Documents');
    const result = expandHomeDir(windowsPath);
    expect(path.win32.normalize(result)).toBe(
      path.win32.normalize(expectedPath),
    );
  });

  describe('trust gating', () => {
    it('should reject untrusted target directory before addDirectory call', async () => {
      const untrustedPath = path.normalize('/home/user/untrusted-project');
      const mockLoadedTrustedFolders: Partial<LoadedTrustedFolders> = {
        isPathTrusted: vi.fn().mockReturnValue(false),
      };
      vi.mocked(trustedFoldersModule.loadTrustedFolders).mockReturnValue(
        mockLoadedTrustedFolders as LoadedTrustedFolders,
      );
      mockConfig = {
        ...mockConfig,
        getFolderTrust: vi.fn().mockReturnValue(true), // Folder trust enabled
        isTrustedFolder: vi.fn().mockReturnValue(false),
      } as unknown as Config;
      mockContext = {
        ...mockContext,
        services: {
          ...mockContext.services,
          config: mockConfig,
        },
      };

      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, untrustedPath);

      // Should NOT have called addDirectory
      expect(mockWorkspaceContext.addDirectory).not.toHaveBeenCalled();

      // Should show error with guidance to /permissions command
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('not trusted'),
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('/permissions'),
        }),
        expect.any(Number),
      );
    });

    it('should allow trusted directory and keep existing success flow', async () => {
      const trustedPath = path.normalize('/home/user/trusted-project');
      const mockLoadedTrustedFolders: Partial<LoadedTrustedFolders> = {
        isPathTrusted: vi.fn().mockReturnValue(true),
      };
      vi.mocked(trustedFoldersModule.loadTrustedFolders).mockReturnValue(
        mockLoadedTrustedFolders as LoadedTrustedFolders,
      );
      mockConfig = {
        ...mockConfig,
        getFolderTrust: vi.fn().mockReturnValue(true), // Folder trust enabled
      } as unknown as Config;
      mockContext = {
        ...mockContext,
        services: {
          ...mockContext.services,
          config: mockConfig,
        },
      };

      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, trustedPath);

      // Should have called addDirectory
      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledWith(
        trustedPath,
      );

      // Should show success message
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: `Successfully added directories:\n- ${trustedPath}`,
        }),
        expect.any(Number),
      );
    });

    it('should handle mixed trusted/untrusted list with both info and error outputs', async () => {
      const trustedPath = path.normalize('/home/user/trusted-project');
      const untrustedPath = path.normalize('/home/user/untrusted-project');
      const mockLoadedTrustedFolders: Partial<LoadedTrustedFolders> = {
        isPathTrusted: vi.fn((p: string) => p === trustedPath),
      };
      vi.mocked(trustedFoldersModule.loadTrustedFolders).mockReturnValue(
        mockLoadedTrustedFolders as LoadedTrustedFolders,
      );
      mockConfig = {
        ...mockConfig,
        getFolderTrust: vi.fn().mockReturnValue(true), // Folder trust enabled
      } as unknown as Config;
      mockContext = {
        ...mockContext,
        services: {
          ...mockContext.services,
          config: mockConfig,
        },
      };

      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, `${trustedPath},${untrustedPath}`);

      // Should have called addDirectory only for trusted path
      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledWith(
        trustedPath,
      );
      expect(mockWorkspaceContext.addDirectory).not.toHaveBeenCalledWith(
        untrustedPath,
      );

      // Should show success message for trusted path
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: `Successfully added directories:\n- ${trustedPath}`,
        }),
        expect.any(Number),
      );

      // Should show error for untrusted path
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining(untrustedPath),
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('not trusted'),
        }),
        expect.any(Number),
      );
    });

    it('should preserve restrictive sandbox early-return behavior', async () => {
      const trustedPath = path.normalize('/home/user/trusted-project');
      const mockLoadedTrustedFolders: Partial<LoadedTrustedFolders> = {
        isPathTrusted: vi.fn().mockReturnValue(true),
      };
      vi.mocked(trustedFoldersModule.loadTrustedFolders).mockReturnValue(
        mockLoadedTrustedFolders as LoadedTrustedFolders,
      );
      mockConfig = {
        ...mockConfig,
        getFolderTrust: vi.fn().mockReturnValue(true), // Folder trust enabled
        isRestrictiveSandbox: vi.fn().mockReturnValue(true),
      } as unknown as Config;
      mockContext = {
        ...mockContext,
        services: {
          ...mockContext.services,
          config: mockConfig,
        },
      };

      if (!addCommand?.action) throw new Error('No action');
      const result = await addCommand.action(mockContext, trustedPath);

      // Should return early with restrictive sandbox message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'The /directory add command is not supported in restrictive sandbox profiles. Please use --include-directories when starting the session instead.',
      });

      // Should NOT have called addDirectory even for trusted path
      expect(mockWorkspaceContext.addDirectory).not.toHaveBeenCalled();
    });

    it('should refresh memory using only successfully added expanded paths', async () => {
      const trustedPath = path.normalize('/home/user/trusted-project');
      const rejectedRawPath = '~/untrusted-project';
      const rejectedExpandedPath = expandHomeDir(rejectedRawPath);

      const mockLoadedTrustedFolders: Partial<LoadedTrustedFolders> = {
        isPathTrusted: vi
          .fn()
          .mockImplementation((p: string) => p === trustedPath),
      };
      vi.mocked(trustedFoldersModule.loadTrustedFolders).mockReturnValue(
        mockLoadedTrustedFolders as LoadedTrustedFolders,
      );

      mockConfig = {
        ...mockConfig,
        getFolderTrust: vi.fn().mockReturnValue(true),
        shouldLoadMemoryFromIncludeDirectories: () => true,
      } as unknown as Config;
      mockContext = {
        ...mockContext,
        services: {
          ...mockContext.services,
          config: mockConfig,
        },
      };

      if (!addCommand?.action) throw new Error('No action');
      await addCommand.action(mockContext, `${trustedPath},${rejectedRawPath}`);

      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledTimes(1);
      expect(mockWorkspaceContext.addDirectory).toHaveBeenCalledWith(
        trustedPath,
      );

      expect(mockLoadServerHierarchicalMemory).toHaveBeenCalledTimes(1);
      const includeDirectoriesArg =
        mockLoadServerHierarchicalMemory.mock.calls[0][1];
      expect(includeDirectoriesArg).toContain(trustedPath);
      expect(includeDirectoriesArg).not.toContain(rejectedRawPath);
      expect(includeDirectoriesArg).not.toContain(rejectedExpandedPath);
    });
  });
});
