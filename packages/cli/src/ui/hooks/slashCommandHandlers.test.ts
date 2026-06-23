/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { Logger } from '@vybestack/llxprt-code-core';
import { CommandKind } from '../commands/types.js';
import { MessageType } from '../types.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';

function createDeps(
  addItem: ReturnType<typeof vi.fn>,
): SlashCommandHandlerDeps {
  return {
    commands: [
      {
        name: 'help',
        description: 'Show help',
        kind: CommandKind.BUILT_IN,
        action: vi.fn(() => ({
          type: 'message' as const,
          messageType: 'info' as const,
          content: 'ok',
        })),
      },
    ],
    config: null,
    commandContext: {
      services: {
        config: null,
        settings:
          {} as SlashCommandHandlerDeps['commandContext']['services']['settings'],
        git: undefined,
        logger: new DebugLogger('test') as unknown as Logger,
      },
      ui: {
        addItem,
        clear: vi.fn(),
        setDebugMessage: vi.fn(),
        pendingItem: null,
        setPendingItem: vi.fn(),
        loadHistory: vi.fn(),
        toggleCorgiMode: vi.fn(),
        toggleDebugProfiler: vi.fn(),
        toggleVimEnabled: vi.fn(),
        setGeminiMdFileCount: vi.fn(),
        setLlxprtMdFileCount: vi.fn(),
        updateHistoryTokenCount: vi.fn(),
        reloadCommands: vi.fn(),
        extensionsUpdateState: new Map(),
        dispatchExtensionStateUpdate: vi.fn(),
        addConfirmUpdateExtensionRequest: vi.fn(),
      },
      session: {
        stats:
          {} as SlashCommandHandlerDeps['commandContext']['session']['stats'],
        sessionShellAllowlist: new Set(),
      },
    },
    actions: {} as SlashCommandHandlerDeps['actions'],
    addItem,
    addMessage: vi.fn(),
    setIsProcessing: vi.fn(),
    setLocalIsProcessing: vi.fn(),
    setPendingItem: vi.fn(),
    setSessionShellAllowlist: vi.fn(),
    setConfirmationRequest: vi.fn(),
    confirmationLogger: new DebugLogger('test-confirmation'),
    slashCommandLogger: new DebugLogger('test-slash'),
  };
}

describe('processSlashCommand', () => {
  it('sanitizes whitespace-separated secure commands before adding history', async () => {
    const addItem = vi.fn();

    await processSlashCommand(createDeps(addItem), '/key\tsk-abc123456');

    expect(addItem).toHaveBeenCalled();
    const [historyItem] = addItem.mock.calls[0] as [
      { type: MessageType; text: string },
      number,
    ];
    expect(historyItem.type).toBe(MessageType.USER);
    expect(historyItem.text).toContain('/key');
    expect(historyItem.text).not.toContain('sk-abc123456');
  });
});
