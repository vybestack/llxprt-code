import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import {
  createCommandRegistrationFixture,
  createCommandRegistryFixture,
} from '../../__tests__/command-registry-fixture.js';
import {
  createUnconfiguredCredentialRegistry,
  createUnconfiguredHistoryReaders,
  createUnconfiguredSlashCommandPorts,
} from '../../__tests__/unconfigured-model-command.js';
const commandRegistry = createCommandRegistryFixture(null);
import { openRouteAAgent } from '../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { describe, expect, it, vi } from 'bun:test';
import { createMockRuntimeApi } from '../components/__tests__/StatsDisplay.testHelpers.js';
import { appendJournalUiItem } from './command-journal-output.js';
import { act } from 'react';
import { Agent } from '@vybestack/llxprt-code-agents';
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
import {
  useSlashCommandProcessorCore,
  type UseSlashCommandProcessorCoreArgs,
} from './useSlashCommandProcessorCore.js';

const metrics = new UiTelemetryService();
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const selectedRuntimeMock1 = (() =>
  (() => {
    const useSelectedTestRuntime = () => createMockRuntimeApi();
    return {
      useGetActiveProviderDetails: () =>
        useSelectedTestRuntime().getActiveProviderDetails,
      useGetProviderDumpMetadata: () =>
        useSelectedTestRuntime().getProviderDumpMetadata,
      useGetActiveProviderAliasConfig: () =>
        useSelectedTestRuntime().getActiveProviderAliasConfig,
      useDetectProviderQuota: () =>
        useSelectedTestRuntime().detectProviderQuota,
      useGetLoadBalancerStats: () =>
        useSelectedTestRuntime().getLoadBalancerStats,
      useGetLoadBalancerTokenAccounting: () =>
        useSelectedTestRuntime().getLoadBalancerTokenAccounting,
      useListSavedProfiles: () => useSelectedTestRuntime().listSavedProfiles,
      useGetProfileByName: () => useSelectedTestRuntime().getProfileByName,
      useSaveProfileDefinition: () =>
        useSelectedTestRuntime().saveProfileDefinition,
      useSaveLoadBalancerProfile: () =>
        useSelectedTestRuntime().saveLoadBalancerProfile,
      useListProviders: () => useSelectedTestRuntime().listProviders,
      useGetActiveProviderName: () =>
        useSelectedTestRuntime().getActiveProviderName,
      useListAvailableModels: () =>
        useSelectedTestRuntime().listAvailableModels,
      useGetActiveModelName: () => useSelectedTestRuntime().getActiveModelName,
      useProviderStatus: () => useSelectedTestRuntime().providerStatus,
      useGetUnallowedParametersForActiveModel: () =>
        useSelectedTestRuntime().getUnallowedParametersForActiveModel,
      useGetActiveProviderMetrics: () =>
        useSelectedTestRuntime().getActiveProviderMetrics,
      useGetSessionTokenUsage: () =>
        useSelectedTestRuntime().getSessionTokenUsage,
      useGetEphemeralSettings: () =>
        useSelectedTestRuntime().getEphemeralSettings,
      useSetEphemeralSetting: () =>
        useSelectedTestRuntime().setEphemeralSetting,
      useGetActiveToolFormatState: () =>
        useSelectedTestRuntime().getActiveToolFormatState,
      useSetActiveToolFormatOverride: () =>
        useSelectedTestRuntime().setActiveToolFormatOverride,
      useGetEphemeralSetting: () =>
        useSelectedTestRuntime().getEphemeralSetting,
      useGetSessionSetting: () => useSelectedTestRuntime().getSessionSetting,
      useSetSessionSetting: () => useSelectedTestRuntime().setSessionSetting,
      useClearSessionSetting: () =>
        useSelectedTestRuntime().clearSessionSetting,
      useSetActiveModel: () => useSelectedTestRuntime().setActiveModel,
      useGetActiveModelParams: () =>
        useSelectedTestRuntime().getActiveModelParams,
      useSetActiveModelParam: () =>
        useSelectedTestRuntime().setActiveModelParam,
      useClearActiveModelParam: () =>
        useSelectedTestRuntime().clearActiveModelParam,
      useUpdateActiveProviderApiKey: () =>
        useSelectedTestRuntime().updateActiveProviderApiKey,
      useGetWorkspaceDirectories: () =>
        useSelectedTestRuntime().getWorkspaceDirectories,
      useGetDefaultProfileName: () =>
        useSelectedTestRuntime().getDefaultProfileName,
      useGetOpenAIProviderInfo: () =>
        useSelectedTestRuntime().getOpenAIProviderInfo,
      useGetActiveProfileName: () =>
        useSelectedTestRuntime().getActiveProfileName,
      useSetDefaultProfileName: () =>
        useSelectedTestRuntime().setDefaultProfileName,
      useGetRuntimeDiagnosticsSnapshot: () =>
        useSelectedTestRuntime().getRuntimeDiagnosticsSnapshot,
      useSaveProfileSnapshot: () =>
        useSelectedTestRuntime().saveProfileSnapshot,
      useDeleteProfileByName: () =>
        useSelectedTestRuntime().deleteProfileByName,
      useFetch: () => useSelectedTestRuntime().fetch,
      useSetProvider: () => useSelectedTestRuntime().setProvider,
      useLoadProfileByName: () => useSelectedTestRuntime().loadProfileByName,
      useUpdateActiveProviderBaseUrl: () =>
        useSelectedTestRuntime().updateActiveProviderBaseUrl,
      useRuntimeApi: useSelectedTestRuntime,
    };
  })())();
void vi.mock('../contexts/RuntimeContext.js', () => selectedRuntimeMock1);
void vi.mock(
  '../../__tests__/runtime-context-fixture.js',
  () => selectedRuntimeMock1,
);

function wrapper({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <ProviderAliasRefreshProvider refresh={async () => {}}>
      <OAuthControlProvider control={createMockCommandContext().oauthControl}>
        <SessionStatsProvider metrics={metrics}>
          {children}
        </SessionStatsProvider>
      </OAuthControlProvider>
    </ProviderAliasRefreshProvider>
  );
}

function slashInputs(
  _agent: Agent,
  recordingOwner?: 'agent' | 'raw',
): UseSlashCommandProcessorCoreArgs {
  return {
    registerCredentials: () => createUnconfiguredCredentialRegistry(),
    ...commandRegistry,
    ...createCommandRegistrationFixture(_agent),
    ...createUnconfiguredHistoryReaders(),
    writeOutput: async (item) => {
      if (recordingOwner !== 'agent') return;
      await appendJournalUiItem(
        { appendDisplay: _agent.session.appendDisplay.bind(_agent.session) },
        undefined,
        item,
      );
    },
    ports: createUnconfiguredSlashCommandPorts(),
    settings: createMockSettings({}),
    addItem: () => 0,
    clearItems: () => {},

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
  it('commits command output to the journal before resolving without a ledger write', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const inputs = slashInputs(agent, 'agent');
      const { result, unmount } = renderHook(
        () =>
          useSlashCommandProcessorCore({
            ...inputs,
            addItem: () => {
              throw new Error('Unexpected ledger write');
            },
          }),
        { wrapper },
      );
      try {
        await waitFor(() => {
          expect(
            result.current.slashCommands?.some((cmd) => cmd.name === 'chat'),
          ).toBe(true);
        });
        await act(async () => {
          await result.current.handleSlashCommand('/unknown-journal-command');
        });
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('Missing output journal');
        const { NativeJournalCursor } = await import(
          '../stores/turn/native-journal-cursor.js'
        );
        const cursor = await NativeJournalCursor.open(path, {}, 16);
        try {
          const entries = (await cursor.pageBack(16)).entries;
          expect(
            entries.flatMap((entry) =>
              entry.kind === 'projected' ? [entry.item.text] : [],
            ),
          ).toStrictEqual([
            'Unknown command: /unknown-journal-command',
            '/unknown-journal-command',
          ]);
          expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual(
            [],
          );
        } finally {
          await cursor.close();
        }
      } finally {
        unmount();
      }
    });
  }, 30000);

  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('selects the owner handler through the real processor and command context', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent } = route;
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      const inputs = slashInputs(agent, 'agent');
      const { result, unmount } = renderHook(
        () => useSlashCommandProcessorCore(inputs),
        { wrapper },
      );
      expect(Reflect.has(result.current.commandContext, 'recordingOwner')).toBe(
        false,
      );
      await waitFor(() => {
        expect(
          result.current.slashCommands?.some((cmd) => cmd.name === 'chat'),
        ).toBe(true);
      });
      await act(async () => {
        await result.current.handleSlashCommand('/chat save owner-route');
      });
      expect(
        (await agent.session.listCheckpoints()).map(
          (checkpoint) => checkpoint.name,
        ),
      ).toContain('owner-route');
      unmount();
    } finally {
      await route.close();
    }
  }, 30000);

  it('keeps the raw command registry and context when no owner mode is supplied', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent } = route;
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing recording path');
      const inputs = slashInputs(agent);
      const { result, unmount } = renderHook(
        () => useSlashCommandProcessorCore(inputs),
        { wrapper },
      );
      await waitFor(() => {
        expect(
          result.current.slashCommands?.some((cmd) => cmd.name === 'chat'),
        ).toBe(true);
      });
      expect(Reflect.has(result.current.commandContext, 'recordingOwner')).toBe(
        false,
      );
      await act(async () => {
        await result.current.handleSlashCommand('/chat save raw-default');
      });
      expect(
        (await agent.session.listCheckpoints()).map(
          (checkpoint) => checkpoint.name,
        ),
      ).not.toContain('raw-default');
      unmount();
    } finally {
      await route.close();
    }
  }, 30000);
});
