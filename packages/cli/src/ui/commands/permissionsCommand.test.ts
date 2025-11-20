/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { permissionsCommand } from './permissionsCommand.js';
import { CommandKind } from './types.js';

describe('permissionsCommand', () => {
  it('should have correct name and description', () => {
    expect(permissionsCommand.name).toBe('permissions');
    expect(permissionsCommand.description).toBe('manage folder trust settings');
  });

  it('should be a built-in command', () => {
    expect(permissionsCommand.kind).toBe(CommandKind.BUILT_IN);
  });

  it('should return a dialog action for permissions', () => {
    const mockContext = {
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
        toggleVimEnabled: async () => false,
        setLlxprtMdFileCount: () => {},
        updateHistoryTokenCount: () => {},
        reloadCommands: () => {},
      },
      session: {
        stats: {} as never,
        sessionShellAllowlist: new Set<string>(),
      },
    };

    const result = permissionsCommand.action?.(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'permissions',
    });
  });
});
