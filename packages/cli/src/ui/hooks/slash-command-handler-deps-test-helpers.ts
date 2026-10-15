/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { DebugLogger, type Logger } from '@vybestack/llxprt-code-core';
import { createMockRuntimeApi } from '../components/__tests__/StatsDisplay.testHelpers.js';
import { createCommands } from '../../__tests__/command-history-result-fixture.js';
import type { SlashCommandHandlerDeps } from './slashCommandHandlers.js';

export function createDeps(
  addItem: ReturnType<typeof vi.fn>,
  overrides: Partial<SlashCommandHandlerDeps> = {},
): SlashCommandHandlerDeps {
  return {
    commands: createCommands(undefined),
    config: null,
    commandContext: {
      runtimeApi: createMockRuntimeApi(),
      refreshProviderAliases: vi.fn(async () => {}),
      oauthControl:
        {} as SlashCommandHandlerDeps['commandContext']['oauthControl'],
      signal: new AbortController().signal,
      services: {
        config: null,
        agent: null,
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
    beginSlashCommandAction: () => new AbortController(),
    endSlashCommandAction: () => {},
    resumeOwnedSession: null,
    isMcpDiscoveryPending: () => false,
    resumeRawSession: null,
    replayResumedHistory: () => {},
    recordCommandError: async () => {},
    loadCommandHistory: async () => {},
    ...overrides,
  };
}
