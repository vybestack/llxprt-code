/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { createCommands } from '../../__tests__/command-history-result-fixture.js';
import {
  createMockCommandContext,
  type CommandOwnerFixture,
} from '../../__tests__/mockCommandContext.js';
import type { SlashCommandHandlerDeps } from './slashCommandHandlers.js';

export type CommandHandlerFixture = Omit<
  SlashCommandHandlerDeps,
  'commandContext'
> & { commandContext: CommandOwnerFixture };

export function createDeps(
  addItem: ReturnType<typeof vi.fn>,
  overrides: Partial<CommandHandlerFixture> = {},
): CommandHandlerFixture {
  return {
    commands: createCommands(undefined),
    config: null,
    commandContext: createMockCommandContext({ ui: { addItem } }),
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
