/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DebugCommandOperations } from '../commands/debugCommands.js';
import { describe, expect, it } from 'bun:test';
import { act, type ReactNode } from 'react';
import { setTimeout as idle } from 'node:timers/promises';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import {
  createCommandRegistrationFixture,
  createCommandRegistryFixture,
} from '../../__tests__/command-registry-fixture.js';
import {
  createUnconfiguredCredentialRegistry,
  createUnconfiguredHistoryReaders,
  createUnconfiguredSlashCommandPorts,
} from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createMockSettings,
  renderHook,
  waitFor,
} from '../../__tests__/render.js';
import { createMockRuntimeApi } from '../components/__tests__/StatsDisplay.testHelpers.js';
import * as Runtime from '../contexts/RuntimeContext.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { SessionStatsProvider } from '../contexts/SessionContext.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createIdeCommand } from '../commands/ideCommand.js';
import { bindIdeCommand } from '../commands/ideCommandHost.js';
import {
  useSlashCommandProcessorCore,
  type UseSlashCommandProcessorCoreArgs,
} from './useSlashCommandProcessorCore.js';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const api = createMockRuntimeApi();
  const oauth = createMockCommandContext().oauthControl;
  const metrics = new UiTelemetryService();
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <Runtime.GetActiveProviderDetailsProvider
        value={api.getActiveProviderDetails}
      >
        <Runtime.GetActiveProviderNameProvider
          value={api.getActiveProviderName}
        >
          <Runtime.GetEphemeralSettingProvider value={api.getEphemeralSetting}>
            <Runtime.GetRuntimeDiagnosticsSnapshotProvider
              value={api.getRuntimeDiagnosticsSnapshot}
            >
              <Runtime.ProviderStatusProvider value={api.providerStatus}>
                <Runtime.GetLoadBalancerStatsProvider
                  value={api.getLoadBalancerStats}
                >
                  <Runtime.GetLoadBalancerTokenAccountingProvider
                    value={api.getLoadBalancerTokenAccounting}
                  >
                    <Runtime.GetProviderDumpMetadataProvider
                      value={api.getProviderDumpMetadata}
                    >
                      <Runtime.GetSessionSettingProvider
                        value={api.getSessionSetting}
                      >
                        <Runtime.GetSessionTokenUsageProvider
                          value={api.getSessionTokenUsage}
                        >
                          <Runtime.SetSessionSettingProvider
                            value={api.setSessionSetting}
                          >
                            <Runtime.SetEphemeralSettingProvider
                              value={api.setEphemeralSetting}
                            >
                              <Runtime.GetEphemeralSettingsProvider
                                value={api.getEphemeralSettings}
                              >
                                <Runtime.GetActiveModelParamsProvider
                                  value={api.getActiveModelParams}
                                >
                                  <Runtime.SetActiveModelParamProvider
                                    value={api.setActiveModelParam}
                                  >
                                    <Runtime.ClearActiveModelParamProvider
                                      value={api.clearActiveModelParam}
                                    >
                                      <Runtime.DetectProviderQuotaProvider
                                        value={api.detectProviderQuota}
                                      >
                                        <Runtime.FetchProvider
                                          value={api.fetch}
                                        >
                                          <OAuthControlProvider control={oauth}>
                                            <SessionStatsProvider
                                              metrics={metrics}
                                            >
                                              {children}
                                            </SessionStatsProvider>
                                          </OAuthControlProvider>
                                        </Runtime.FetchProvider>
                                      </Runtime.DetectProviderQuotaProvider>
                                    </Runtime.ClearActiveModelParamProvider>
                                  </Runtime.SetActiveModelParamProvider>
                                </Runtime.GetActiveModelParamsProvider>
                              </Runtime.GetEphemeralSettingsProvider>
                            </Runtime.SetEphemeralSettingProvider>
                          </Runtime.SetSessionSettingProvider>
                        </Runtime.GetSessionTokenUsageProvider>
                      </Runtime.GetSessionSettingProvider>
                    </Runtime.GetProviderDumpMetadataProvider>
                  </Runtime.GetLoadBalancerTokenAccountingProvider>
                </Runtime.GetLoadBalancerStatsProvider>
              </Runtime.ProviderStatusProvider>
            </Runtime.GetRuntimeDiagnosticsSnapshotProvider>
          </Runtime.GetEphemeralSettingProvider>
        </Runtime.GetActiveProviderNameProvider>
      </Runtime.GetActiveProviderDetailsProvider>
    );
  };
}

function inputs(): UseSlashCommandProcessorCoreArgs {
  const settings = createMockSettings({});
  return {
    ...createCommandRegistryFixture(null),
    ...createCommandRegistrationFixture(),
    ...createUnconfiguredHistoryReaders(),
    writeOutput: async () => {},
    registerIdeCommand: (addItem) =>
      createIdeCommand(
        bindIdeCommand(
          () => ({ available: false, connected: false, diffingEnabled: false }),
          () => undefined,
          () => {},
          async () => {},
          async () => {},
          settings,
          addItem,
        ),
      ),
    registerCredentials: () => createUnconfiguredCredentialRegistry(),
    ports: createUnconfiguredSlashCommandPorts(),
    settings,
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
  };
}
function debugOwner(): DebugCommandOperations {
  let config: ReturnType<DebugCommandOperations['readConfig']> = {
    enabled: false,
    namespaces: [],
    level: 'info',
    output: { target: 'stderr' },
    lazyEvaluation: true,
    redactPatterns: [],
  };
  return {
    readConfig: () => config,
    writeConfig: (value) => {
      config = { ...config, ...value };
    },
    readOutput: () => 'stderr',
    hasChanges: () => false,
    persist: () => {},
  };
}

describe('production command registration lifecycle', () => {
  it('runs debug commands against the supplied root rather than a process singleton', async () => {
    const first = debugOwner();
    const second = debugOwner();
    const base = inputs();
    const args = { ...base, ports: { ...base.ports, debug: first } };
    const hook = renderHook(() => useSlashCommandProcessorCore(args), {
      wrapper: createWrapper(),
    });
    try {
      await waitFor(() =>
        expect(hook.result.current.slashCommands?.length).toBeGreaterThan(0),
      );
      await act(async () => {
        await hook.result.current.handleSlashCommand(
          '/debug enable llxprt:root-only',
        );
      });
      expect(first.readConfig().namespaces).toContain('llxprt:root-only');
      expect(second.readConfig().namespaces).not.toContain('llxprt:root-only');
    } finally {
      hook.unmount();
    }
  });

  it('settles after publication and unrelated renders, but reloads on host changes', async () => {
    const args = inputs();
    const listeners = new Set<() => void>();
    let loads = 0;
    let renders = 0;
    const load = args.loadRegisteredCommands;
    args.loadRegisteredCommands = async (owners, signal) => {
      loads++;
      // Yield so a broken registry cannot monopolize the microtask queue.
      await idle(0);
      return load(owners, signal);
    };
    args.subscribeCommandChanges = (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const hook = renderHook(
      () => {
        renders++;
        return useSlashCommandProcessorCore(args);
      },
      { wrapper: createWrapper() },
    );
    try {
      await waitFor(() =>
        expect(hook.result.current.slashCommands?.length).toBeGreaterThan(0),
      );
      const settledLoads = loads;
      const settledRenders = renders;
      await act(async () => {
        await idle(50);
      });
      expect(loads).toBe(settledLoads);
      expect(renders).toBe(settledRenders);
      expect(loads).toBeLessThanOrEqual(2);
      hook.rerender();
      await act(async () => {
        await idle(50);
      });
      expect(loads).toBe(settledLoads);
      await act(async () => {
        for (const listener of listeners) listener();
      });
      await waitFor(() => expect(loads).toBe(settledLoads + 1));
      await act(async () => {
        await idle(50);
      });
      expect(loads).toBe(settledLoads + 1);
    } finally {
      hook.unmount();
    }
    expect(listeners.size).toBe(0);
  });
});
