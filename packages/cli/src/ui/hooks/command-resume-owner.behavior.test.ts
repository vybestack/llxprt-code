/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { validateSessionMediaPackage } from '@vybestack/llxprt-code-core';
import { bindCommandOwnerResume } from './commandOwnerResumeHost.js';

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { buildSlashCommandRuntimeForTest } from '../../__tests__/slash-command-runtime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createContinueCommand } from '../commands/continueCommand.js';
import { bindContinueCommandOperations } from '../commands/continueCommandHost.js';
import { resumeOwnerSession } from '../utils/resumeOwnerSession.js';
import { processSlashCommand } from './slashCommandHandlers.js';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';
import type { HistoryItem } from '../types.js';

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

describe('registered command resume owner', () => {
  it('resumes and replays through its bound owner with a closed invocation decoy', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        config,
        _settingsOwner,
        _settingsService,
        _oauthManager,
        borrow,
      ) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'registered resume history' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const sourceId = (await agent.session.listSessions()).at(0)?.id;
        if (!sourceId) throw new Error('Missing recording');
        await agent.session.setRecording({ enabled: false });
        const owner = await borrow();
        await owner.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'live history' }],
          },
        ]);
        await owner.session.setRecording({ enabled: true });
        const decoy = await borrow();
        await decoy.dispose();
        const runtime = buildSlashCommandRuntimeForTest(config, owner);
        const context = createMockCommandContext({
          recordingOwner: 'agent',
          services: { agent: decoy },
        });
        const registry = await CommandService.create(
          [
            new BuiltinCommandLoader(
              {
                ...createUnconfiguredBuiltinOwners(),
                continueCommand: createContinueCommand(
                  bindContinueCommandOperations(
                    owner.session.exportSession.bind(owner.session),
                    () => runtime.isInteractive(),
                    async () => [...(await owner.session.listBrowserTargets())],
                    validateSessionMediaPackage,
                  ),
                ),
              },
              null,
            ),
          ],
          context.signal,
        );
        let loaded: readonly HistoryItem[] = [];
        await processSlashCommand(
          {
            commands: registry.getCommands(),
            config: context.services.config,
            commandContext: context,
            actions: actions(),
            addItem: context.ui.addItem,
            addMessage: () => {},
            setIsProcessing: () => {},
            setLocalIsProcessing: () => {},
            setPendingItem: () => {},
            setSessionShellAllowlist: () => {},
            setConfirmationRequest: unused,
            confirmationLogger: new DebugLogger('resume-confirm'),
            slashCommandLogger: new DebugLogger('resume-command'),
            beginSlashCommandAction: () => new AbortController(),
            endSlashCommandAction: () => {},
            isMcpDiscoveryPending: () => false,
            resumeRawSession: null,
            replayResumedHistory: () => {},
            recordCommandError: async () => {},
            loadCommandHistory: async () => {},
            resumeOwnedSession: bindCommandOwnerResume(
              (action) => {
                if (action.sessionRef === undefined)
                  throw new Error('Unexpected package import');
                return resumeOwnerSession(
                  owner.session.resume.bind(owner.session),
                  action.sessionRef,
                  'allowed',
                  owner.session.listBrowserTargetsDetailed.bind(owner.session),
                );
              },
              (history) => {
                loaded = history;
              },
            ),
          },
          `/continue ${sourceId}`,
        );
        expect(loaded).toContainEqual(
          expect.objectContaining({
            type: 'user',
            text: 'registered resume history',
          }),
        );
        expect(await owner.session.getHistory()).toMatchObject([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'registered resume history' }],
          },
        ]);
      },
    );
  }, 30000);
});
