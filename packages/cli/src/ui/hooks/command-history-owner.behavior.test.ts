import { bindCommandHistoryLoader } from './commandHistoryLoaderHost.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  SessionRecordingService,
  getProjectHash,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createChatCommand } from '../commands/chatCommand.js';
import { bindChatRecordingOperations } from '../commands/chatCommandHost.js';
import { processSlashCommand } from './slashCommandHandlers.js';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';
function unused(): never {
  throw new Error('Unexpected dialog action');
}
function actions(): SlashCommandProcessorActions {
  return {
    openAuthDialog: unused,
    openThemeDialog: unused,
    openEditorDialog: unused,
    openPrivacyNotice: unused,
    openSettingsDialog: unused,
    openLoggingDialog: unused,
    openSubagentDialog: unused,
    openModelsDialog: unused,
    openPermissionsDialog: unused,
    openPoliciesDialog: unused,
    openProviderDialog: unused,
    openLoadProfileDialog: unused,
    openCreateProfileDialog: unused,
    openProfileListDialog: unused,
    viewProfileDetail: unused,
    openProfileEditor: unused,
    quit: unused,
    setDebugMessage: unused,
    toggleCorgiMode: unused,
    toggleDebugProfiler: unused,
    dispatchExtensionStateUpdate: unused,
    addConfirmUpdateExtensionRequest: unused,
    openWelcomeDialog: unused,
    openSessionBrowserDialog: unused,
  };
}
async function restore(owner: Agent, decoy: Agent): Promise<void> {
  const root = owner.workspace.getWorkingDirectory();
  const recording = await SessionRecordingService.createLocked({
    sessionId: crypto.randomUUID(),
    projectHash: getProjectHash(root),
    chatsDir: join(root, 'raw-chats'),
    workspaceDirs: [root],
    cwd: root,
    provider: 'fake',
    model: 'fake-model',
  });
  try {
    for (const content of await owner.session.getHistory())
      recording.recordContent(content);
    await recording.flush();
    const context = createMockCommandContext({ services: { agent: decoy } });
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...createUnconfiguredBuiltinOwners(),
            chatCommand: createChatCommand(
              bindChatRecordingOperations({
                agent: owner,
                config: context.services.config,
                recordingIntegration: undefined,
                recordingSwapCallbacks: {
                  getCurrentRecording: () => recording,
                  getCurrentIntegration: () => null,
                  getCurrentLockHandle: () => null,
                  setRecording: unused,
                },
              }),
              () => true,
            ),
          },
          null,
        ),
      ],
      context.signal,
    );
    await processSlashCommand(
      {
        commands: registry.getCommands(),
        config: null,
        commandContext: context,
        actions: actions(),
        addItem: context.ui.addItem,
        addMessage: () => {},
        setIsProcessing: () => {},
        setLocalIsProcessing: () => {},
        setPendingItem: () => {},
        setSessionShellAllowlist: () => {},
        setConfirmationRequest: () => {},
        confirmationLogger: new DebugLogger('history-confirm'),
        slashCommandLogger: new DebugLogger('history-slash'),
        beginSlashCommandAction: () => new AbortController(),
        endSlashCommandAction: () => {},
        resumeOwnedSession: null,
        isMcpDiscoveryPending: () => false,
        recordCommandError: async () => {},
        loadCommandHistory: bindCommandHistoryLoader(
          (history) => owner.setHistory(history),
          () => 'allowed',
          context.ui.clear,
          context.ui.addItem,
        ),
      },
      '/chat restore 1',
    );
  } finally {
    await recording.dispose();
  }
}
describe('registered command history result owner', () => {
  const makeOwner = useCommandOwners();
  it('applies durable history restore to its owner and leaves sibling history unchanged', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    await owner.chat('first', { mcpDiscovery: 'skip' });
    await owner.chat('second', { mcpDiscovery: 'skip' });
    await sibling.chat('sibling first', { mcpDiscovery: 'skip' });
    const original = await owner.session.getHistory();
    await restore(owner, sibling);
    expect((await owner.session.getHistory()).length).toBeLessThan(
      original.length,
    );
    expect(await sibling.session.getHistory()).toMatchObject([
      { speaker: 'human', blocks: [{ type: 'text', text: 'sibling first' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'turn one reply' }] },
    ]);
    await owner.dispose();
    await sibling.chat('sibling second', { mcpDiscovery: 'skip' });
    const before = await sibling.session.getHistory();
    await restore(sibling, owner);
    expect((await sibling.session.getHistory()).length).toBeLessThan(
      before.length,
    );
  }, 30000);
});
