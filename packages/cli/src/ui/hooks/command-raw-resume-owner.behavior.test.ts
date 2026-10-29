/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { appendJournalUiItem } from './command-journal-output.js';
import { bindCommandRawResume } from './commandRawResumeHost.js';
import { performResume } from '../../services/performResume.js';

import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  createLockedSessionRecorder,
  type SessionRecordingPort,
  LocalMediaStore,
  getProjectHash,
  type RecordingIntegration,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { CliSessionPersistence } from '../../cliSessionPersistence.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createContinueCommand } from '../commands/continueCommand.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
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

async function resumeRaw(owner: Agent, decoy: Agent): Promise<void> {
  const root = owner.workspace.getWorkingDirectory();
  const chatsDir = join(root, 'chats');
  const sourceId = crypto.randomUUID();
  const locked = await createLockedSessionRecorder({
    sessionId: sourceId,
    projectHash: getProjectHash(root),
    chatsDir,
    workspaceDirs: [root],
    cwd: root,
    provider: 'fake',
    model: 'fake-model',
  });
  await recordRowsForTest(locked, [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'raw owner replay' }],
    },
  ]);
  await locked.dispose();
  const media = new LocalMediaStore({
    rootDirectory: join(root, 'resume-media'),
    quotaBytes: 1024,
  });
  const persistence = new CliSessionPersistence(
    { projectRoot: root, chatsDir },
    { mediaStore: media },
  );
  const active: {
    recording: SessionRecordingPort | null;
    integration: RecordingIntegration | null;
    lock: LockHandle | null;
  } = { recording: null, integration: null, lock: null };
  let sessionId = 'live-before-resume';
  const callbacks = {
    getCurrentRecording: () => active.recording,
    getCurrentIntegration: () => active.integration,
    getCurrentLockHandle: () => active.lock,
    getCurrentMetadata: () => null,
    setRecording: (
      recording: SessionRecordingPort | null,
      integration: RecordingIntegration | null,
      lock: LockHandle | null,
    ) => {
      active.recording = recording;
      active.integration = integration;
      active.lock = lock;
    },
  };
  const context = createMockCommandContext({
    services: {
      agent: decoy,
      config: {
        projectTempDir: root,
        getProjectRoot: () => root,
        getSessionId: () => sessionId,
        getProvider: () => 'fake',
        getModel: () => 'fake-model',
        directories: () => [root],
        getSessionRecordingQueueByteLimit: () => Number.MAX_SAFE_INTEGER,
        adoptSessionId: (next: string) => {
          sessionId = next;
        },
      },
    },
  });
  const config = context.services.config;
  if (!config) throw new Error('Missing fixture config');
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        {
          ...createUnconfiguredBuiltinOwners(),
          continueCommand: createContinueCommand({
            isInteractive: () => true,
            listContinueTargets: async () => [],
            exportSession: async () => undefined,
            validateSessionPackage: unused,
          }),
        },
        null,
      ),
    ],
    context.signal,
  );
  const deps: SlashCommandHandlerDeps = {
    commands: registry.getCommands(),
    config,
    commandContext: context,
    actions: actions(),
    addItem: context.ui.addItem,
    addMessage: (message) => {
      if (message.type === 'error' && 'content' in message)
        throw new Error(message.content);
    },
    setIsProcessing: () => {},
    setLocalIsProcessing: () => {},
    setPendingItem: () => {},
    setSessionShellAllowlist: () => {},
    setConfirmationRequest: unused,
    confirmationLogger: new DebugLogger('raw-resume-confirm'),
    slashCommandLogger: new DebugLogger('raw-resume-command'),
    beginSlashCommandAction: () => new AbortController(),
    endSlashCommandAction: () => {},
    recordCommandError: async (message) => {
      throw new Error(message);
    },
    writeOutput: async (item) => {
      await appendJournalUiItem(owner.session, owner.session, item);
    },
    resumeOwnedSession: null,
    isMcpDiscoveryPending: () => false,
    resumeRawSession: bindCommandRawResume(
      config,
      persistence,
      owner.session,
      callbacks,
      new DebugLogger('raw-owner'),
      performResume,
    ),
    refreshResumedHistory: () => {},
  };
  try {
    await processSlashCommand(deps, '/continue ' + sourceId);
  } finally {
    await active.integration?.dispose();
    await active.recording?.dispose();
    await active.lock?.release();
    persistence.close();
    await media.close();
  }
}

describe('raw command resume owner', () => {
  const makeOwner = useCommandOwners();
  it('restores the captured history owner with sibling invocation and independent disposal', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    await owner.chat('initialize owner', { mcpDiscovery: 'skip' });
    await sibling.chat('initialize sibling', { mcpDiscovery: 'skip' });
    await owner.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'owner live' }] },
    ]);
    await sibling.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'sibling live' }] },
    ]);
    await resumeRaw(owner, sibling);
    expect(await owner.session.getHistory()).toMatchObject([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'raw owner replay' }],
      },
    ]);
    expect(await sibling.session.getHistory()).toMatchObject([
      { speaker: 'human', blocks: [{ type: 'text', text: 'sibling live' }] },
    ]);
    await owner.dispose();
    await resumeRaw(sibling, owner);
    expect(await sibling.session.getHistory()).toMatchObject([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'raw owner replay' }],
      },
    ]);
  }, 30000);
});
