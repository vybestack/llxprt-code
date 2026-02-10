/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { permissionsCommand } from './permissionsCommand.js';
import { CommandKind } from './types.js';
import * as path from 'node:path';

// Mock the trustedFolders module
const mockSetValue = vi.fn();
const mockIsPathTrusted = vi.fn();
const mockRules: Array<{ path: string; trustLevel: string }> = [];

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

describe('permissionsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRules.length = 0;
  });

  const createMockContext = () => ({
    services: {
      config: null,
      settings: {} as never,
      git: undefined,
      logger: {} as never,
    },
    ui: {
      addItem: () => 0,
      clear: () => {},
      setDebugMessage: () => {},
      pendingItem: null,
      setPendingItem: () => {},
      loadHistory: () => {},
      toggleCorgiMode: () => {},
      toggleDebugProfiler: () => {},
      toggleVimEnabled: async () => false,
      setGeminiMdFileCount: () => {},
      setLlxprtMdFileCount: () => {},
      updateHistoryTokenCount: () => {},
      reloadCommands: () => {},
      extensionsUpdateState: new Map(),
      dispatchExtensionStateUpdate: () => {},
      addConfirmUpdateExtensionRequest: () => {},
    },
    session: {
      stats: {} as never,
      sessionShellAllowlist: new Set<string>(),
    },
  });

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

      expect(result).toEqual({
        type: 'dialog',
        dialog: 'permissions',
      });
    });

    it('should return a dialog action when only whitespace provided', () => {
      const mockContext = createMockContext();
      const result = permissionsCommand.action?.(mockContext, '   ');

      expect(result).toEqual({
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
      expect(result).toEqual({
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
      expect(result).toEqual({
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
      expect(result).toEqual({
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
      expect(result).toEqual({
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
      expect(result).toEqual({
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
      expect(result).toEqual({
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
      expect(result).toEqual({
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

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Failed to save trust settings'),
      });
    });
  });
});
