/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext } from '../commands/types.js';

/**
 * Creates a UI context object with no-op functions.
 * Useful for non-interactive environments where UI operations
 * are not applicable.
 */
export function createNonInteractiveUI(): CommandContext['ui'] {
  return {
    addItem: (_item: Parameters<CommandContext['ui']['addItem']>[0], _timestamp: number) => 0,
    clear: () => {},
    setDebugMessage: (_message: string) => {},
    loadHistory: (_newHistory: Parameters<CommandContext['ui']['loadHistory']>[0]) => {},
    pendingItem: null,
    setPendingItem: (_item: Parameters<CommandContext['ui']['setPendingItem']>[0]) => {},
    toggleCorgiMode: () => {},
    toggleVimEnabled: async () => false,
    setLlxprtMdFileCount: (_count: number) => {},
    updateHistoryTokenCount: (_count: number) => {},
    reloadCommands: () => {},
  };
}
