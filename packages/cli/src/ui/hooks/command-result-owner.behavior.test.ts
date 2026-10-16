import { bindCommandErrorRecorder } from './commandErrorRecorderHost.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createMcpCommand } from '../commands/mcpCommand.js';
import { createMcpAuthCommand } from '../commands/mcpAuth.js';
import { bindMcpAuthCommandOperations } from '../commands/credentialCommandHost.js';
import { bindMcpCommand } from '../commands/mcpCommandHost.js';
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
async function recordingPath(agent: Agent): Promise<string> {
  await agent.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'initial' }] },
  ]);
  await agent.session.setRecording({ enabled: true });
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Missing session recording');
  return path;
}
async function dispatchFailure(
  owner: Agent,
  decoy: Agent,
  server: string,
): Promise<void> {
  const context = createMockCommandContext({
    recordingOwner: 'agent',
    services: { agent: decoy },
  });
  const auth = createMcpAuthCommand(
    bindMcpAuthCommandOperations(owner, context.services.config),
    () => true,
    context.ui.addItem,
    context.ui.reloadCommands,
  );
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        {
          ...createUnconfiguredBuiltinOwners(),
          mcpCommand: createMcpCommand(
            auth,
            bindMcpCommand(
              context.services.config !== null,
              {
                listServers: () => owner.mcp.listServers(),
                listBlockedServers: () => owner.mcp.listBlockedServers(),
                discoveryState: () => owner.mcp.discoveryState(),
                readDetails: () =>
                  owner.mcp.details({
                    includeTools: true,
                    includePrompts: true,
                    includeResources: true,
                  }),
              },
              context.ui.addItem,
              context.ui.reloadCommands,
              async () => {
                await owner.mcp.reload();
              },
              async () => {
                await owner.mcp.refresh();
              },
            ),
          ),
        },
        null,
      ),
    ],
    context.signal,
  );
  const deps = {
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
    confirmationLogger: new DebugLogger('owner-confirm'),
    slashCommandLogger: new DebugLogger('owner-slash'),
    beginSlashCommandAction: () => new AbortController(),
    endSlashCommandAction: () => {},
    resumeOwnedSession: null,
    isMcpDiscoveryPending: () => false,
    resumeRawSession: null,
    replayResumedHistory: () => {},
    recordCommandError: bindCommandErrorRecorder(
      owner.session.recordRecordingEvent.bind(owner.session),
      'agent',
      undefined,
    ),
    loadCommandHistory: async () => {},
  };
  await processSlashCommand(deps, `/mcp auth ${server}`);
}
describe('command result recording owner', () => {
  const makeOwner = useCommandOwners();
  it('records registered command failures in its owner instead of the invocation session', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const ownerPath = await recordingPath(owner);
    const siblingPath = await recordingPath(sibling);
    await dispatchFailure(owner, sibling, 'owner-missing');
    expect(await readFile(ownerPath, 'utf8')).toContain(
      "MCP server 'owner-missing' not found.",
    );
    expect(await readFile(siblingPath, 'utf8')).not.toContain('owner-missing');
    await owner.dispose();
    await dispatchFailure(sibling, owner, 'sibling-missing');
    expect(await readFile(siblingPath, 'utf8')).toContain(
      "MCP server 'sibling-missing' not found.",
    );
  });
});
