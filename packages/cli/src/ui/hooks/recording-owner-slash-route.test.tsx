/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { createMockRuntimeApi } from '../components/__tests__/StatsDisplay.testHelpers.js';

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => createMockRuntimeApi(),
}));
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { SessionStatsProvider } from '../contexts/SessionContext.js';
import { ProviderAliasRefreshProvider } from '../contexts/ProviderAliasRefreshContext.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import {
  renderHook,
  createMockSettings,
  waitFor,
} from '../../__tests__/render.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import {
  useSlashCommandProcessorCore,
  type UseSlashCommandProcessorCoreArgs,
} from './useSlashCommandProcessorCore.js';

function wrapper({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <ProviderAliasRefreshProvider refresh={async () => {}}>
      <OAuthControlProvider control={createMockCommandContext().oauthControl}>
        <SessionStatsProvider>{children}</SessionStatsProvider>
      </OAuthControlProvider>
    </ProviderAliasRefreshProvider>
  );
}

function slashInputs(
  agent: Agent,
  recordingOwner?: 'agent' | 'raw',
): UseSlashCommandProcessorCoreArgs {
  return {
    config: null,
    agent,
    settings: createMockSettings({}),
    addItem: () => 0,
    clearItems: () => {},
    loadHistory: () => {},
    refreshStatic: () => {},
    toggleVimEnabled: async () => true,
    setIsProcessing: () => {},
    setLlxprtMdFileCount: () => {},
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
    store: createDialogStore(),
    extensionsUpdateState: new Map(),
    isConfigInitialized: true,
    recordingOwner,
  };
}

describe('interactive slash command recording route', () => {
  it('selects the owner handler through the real processor and command context', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      const { result, unmount } = renderHook(
        () => useSlashCommandProcessorCore(slashInputs(agent, 'agent')),
        { wrapper },
      );
      expect(result.current.commandContext.recordingOwner).toBe('agent');
      await waitFor(() => {
        expect(
          result.current.slashCommands?.some((cmd) => cmd.name === 'chat'),
        ).toBe(true);
      });
      await act(async () => {
        await result.current.handleSlashCommand('/chat save owner-route');
      });
      expect(await readFile(path, 'utf8')).toContain('owner-route');
      unmount();
    });
  }, 30000);

  it('keeps the raw command registry and context when no owner mode is supplied', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      const { result, unmount } = renderHook(
        () => useSlashCommandProcessorCore(slashInputs(agent)),
        { wrapper },
      );
      await waitFor(() => {
        expect(
          result.current.slashCommands?.some((cmd) => cmd.name === 'chat'),
        ).toBe(true);
      });
      expect(result.current.commandContext.recordingOwner).toBeUndefined();
      await act(async () => {
        await result.current.handleSlashCommand('/chat save raw-default');
      });
      expect(await readFile(path, 'utf8')).not.toContain('raw-default');
      unmount();
    });
  }, 30000);
});
