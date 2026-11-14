/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { appendJournalUiItem } from './command-journal-output.js';
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
  const context =
    overrides.commandContext ?? createMockCommandContext({ ui: { addItem } });
  return {
    commands: createCommands(undefined),
    config: null,
    commandContext: context,
    writeOutput: async (item) => {
      if (context.recordingOwner === 'agent') {
        const agent = context.services.agent;
        if (agent === null) throw new Error('Missing output owner');
        await appendJournalUiItem(agent.session, undefined, item);
      } else addItem(item, Date.now());
    },
    actions: {
      openAuthDialog: () => {},
      openThemeDialog: () => {},
      openEditorDialog: () => {},
      openPrivacyNotice: () => {},
      openSettingsDialog: () => {},
      openLoggingDialog: () => {},
      openSubagentDialog: () => {},
      openModelsDialog: () => {},
      openPermissionsDialog: () => {},
      openPoliciesDialog: () => {},
      openProviderDialog: () => {},
      openLoadProfileDialog: () => {},
      openCreateProfileDialog: () => {},
      openProfileListDialog: () => {},
      viewProfileDetail: () => {},
      openProfileEditor: () => {},
      quit: () => {},
      setDebugMessage: () => {},
      toggleCorgiMode: () => {},
      toggleDebugProfiler: () => {},
      dispatchExtensionStateUpdate: () => {},
      addConfirmUpdateExtensionRequest: () => {},
      openWelcomeDialog: () => {},
      openSessionBrowserDialog: () => {},
    },
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
    refreshResumedHistory: () => {},
    recordCommandError: async () => {},
    ...overrides,
  };
}

export function errorTexts(addItem: ReturnType<typeof vi.fn>): string[] {
  return addItem.mock.calls.flatMap(([item]) => {
    if (typeof item !== 'object' || item === null) return [];
    if (!('type' in item) || item.type !== 'error') return [];
    if (!('text' in item) || typeof item.text !== 'string') return [];
    return [item.text];
  });
}
