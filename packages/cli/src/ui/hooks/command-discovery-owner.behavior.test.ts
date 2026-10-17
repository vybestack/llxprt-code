/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
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

async function waitUntil(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!ready()) {
    if (Date.now() > deadline)
      throw new Error('Discovery did not reach expected state');
    await setTimeout(10);
  }
}

describe('command discovery owner', () => {
  const makeOwner = useCommandOwners();

  it('uses live owner discovery instead of invocation discovery and preserves siblings', async () => {
    const sibling = await makeOwner('sibling');
    const gate = join(sibling.workspace.getWorkingDirectory(), 'discovery');
    const owner = await makeOwner('owner', {
      shared: {
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL(
              '../../__tests__/pending-discovery-stdio-fixture.ts',
              import.meta.url,
            ),
          ),
          gate,
        ],
      },
    });
    const context = createMockCommandContext({ services: { agent: sibling } });
    const registry = await CommandService.create(
      [new BuiltinCommandLoader(createUnconfiguredBuiltinOwners(), null)],
      context.signal,
    );
    const messages: string[] = [];
    const deps: SlashCommandHandlerDeps = {
      commands: registry.getCommands(),
      config: null,
      commandContext: context,
      actions: actions(),
      addItem: context.ui.addItem,
      addMessage: (message) => {
        if ('content' in message && message.content)
          messages.push(message.content);
      },
      setIsProcessing: () => {},
      setLocalIsProcessing: () => {},
      setPendingItem: () => {},
      setSessionShellAllowlist: () => {},
      setConfirmationRequest: unused,
      confirmationLogger: new DebugLogger('discovery-confirm'),
      slashCommandLogger: new DebugLogger('discovery-command'),
      beginSlashCommandAction: () => new AbortController(),
      endSlashCommandAction: () => {},
      resumeRawSession: null,
      replayResumedHistory: () => {},
      recordCommandError: async () => {},
      loadCommandHistory: async () => {},
      resumeOwnedSession: null,
      isMcpDiscoveryPending: () => owner.mcp.discoveryState() === 'pending',
    };
    await writeFile(`${gate}.block`, 'block');
    const refreshing = owner.mcp.refresh();
    try {
      await waitUntil(() => existsSync(`${gate}.entered`));
      await processSlashCommand(deps, '/not-a-command');
      expect(messages.join('\n')).toContain('MCP servers are not done loading');
    } finally {
      await writeFile(`${gate}.released`, 'released');
      await refreshing;
    }
    await waitUntil(() => {
      const state = owner.mcp.discoveryState();
      if (state === 'failed' || state === 'partial')
        throw new Error(JSON.stringify(owner.mcp.status()));
      return state === 'ready';
    });
    messages.length = 0;
    await processSlashCommand(deps, '/not-a-command');
    expect(messages.join('\n')).not.toContain(
      'MCP servers are not done loading',
    );
    await owner.dispose();
    messages.length = 0;
    await processSlashCommand(
      {
        ...deps,
        commandContext: createMockCommandContext({
          services: { agent: owner },
        }),
        isMcpDiscoveryPending: () => sibling.mcp.discoveryState() === 'pending',
      },
      '/not-a-command',
    );
    expect(messages.join('\n')).toContain('Unknown command');
  }, 30000);
});
