/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { initialDialogActions } from './dialogActions.js';
import { ApprovalMode, type IdeContext } from '@vybestack/llxprt-code-core';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { ConsoleMessageItem } from '../../types.js';
import { CommandKind, type SlashCommand } from '../../commands/types.js';
import type {
  ModelInfo,
  WelcomeState,
} from '../../hooks/useWelcomeOnboarding.js';
import {
  createSettingsProfileStore,
  type ProfileListItem,
  type SettingsProfileState,
  type TokenMetricsSnapshot,
} from './settingsStore.js';

function standardProfile(): Profile {
  return {
    version: 1,
    provider: 'zai',
    model: 'glm-5.3',
    modelParams: { temperature: 0.4 },
    ephemeralSettings: {},
  };
}

describe('createSettingsProfileStore', () => {
  it('starts with the documented defaults', () => {
    const { store } = createSettingsProfileStore();
    expect(store.getState()).toStrictEqual({
      dialogActions: initialDialogActions(),
      startupGuardsInitialized: false,
      currentModel: '',
      currentModelLabel: undefined,
      contextLimit: undefined,
      providerOptions: [],
      createProfileProviders: [],
      selectedProvider: '',
      profiles: [],
      profileListItems: [],
      selectedProfileName: null,
      selectedProfileData: null,
      defaultProfileName: null,
      activeProfileName: null,
      profileDialogError: null,
      profileDialogLoading: false,
      toolsDialogAction: 'enable',
      toolsDialogTools: [],
      toolsDialogDisabledTools: [],
      slashCommands: undefined,
      welcomeState: {
        step: 'welcome',
        authInProgress: false,
        modelsLoadStatus: 'idle',
      },
      welcomeAvailableProviders: [],
      welcomeAvailableModels: [],
      ideContextState: undefined,
      llxprtMdFileCount: 0,
      coreMemoryFileCount: 0,
      consoleMessages: [],
      rawConsoleMessages: [],
      errorCount: 0,
      branchName: undefined,
      branchIsDirty: false,
      debugMessage: '',
      authError: null,
      initError: null,
      showAutoAcceptIndicator: 'default' as ApprovalMode,
      tokenMetrics: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        sessionTokenTotal: 0,
      },
      historyTokenCount: 0,
      settingsNonce: 0,
    } satisfies SettingsProfileState);
  });

  it('applies a partial initial override on top of the defaults', () => {
    const { store } = createSettingsProfileStore({
      currentModel: 'glm-5.3',
      profiles: ['work', 'personal'],
    });
    const state = store.getState();
    expect(state.currentModel).toBe('glm-5.3');
    expect(state.profiles).toStrictEqual(['work', 'personal']);
    // Untouched fields keep their defaults.
    expect(state.selectedProvider).toBe('');
    expect(state.selectedProfileData).toBeNull();
    expect(state.settingsNonce).toBe(0);
  });

  describe('model/provider commands', () => {
    it('setCurrentModel writes the model identity', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setCurrentModel('glm-5.3');
      expect(store.getState().currentModel).toBe('glm-5.3');
    });

    it('setCurrentModelLabel writes and clears the label', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setCurrentModelLabel('GLM 5.3 (fast)');
      expect(store.getState().currentModelLabel).toBe('GLM 5.3 (fast)');
      commands.setCurrentModelLabel(undefined);
      expect(store.getState().currentModelLabel).toBeUndefined();
    });

    it('setContextLimit writes and clears the limit', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setContextLimit(128_000);
      expect(store.getState().contextLimit).toBe(128_000);
      commands.setContextLimit(undefined);
      expect(store.getState().contextLimit).toBeUndefined();
    });

    it('setProviderOptions stores the given provider list', () => {
      const { store, commands } = createSettingsProfileStore();
      const providers = ['zai', 'openai'];
      commands.setProviderOptions(providers);
      expect(store.getState().providerOptions).toBe(providers);
    });

    it('setCreateProfileProviders stores the dialog provider list', () => {
      const { store, commands } = createSettingsProfileStore();
      const providers = ['zai', 'anthropic'];
      commands.setCreateProfileProviders(providers);
      expect(store.getState().createProfileProviders).toBe(providers);
    });

    it('setSelectedProvider writes the provider selection', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setSelectedProvider('zai');
      expect(store.getState().selectedProvider).toBe('zai');
    });
  });

  describe('profile dialog data commands', () => {
    it('setProfiles stores the profile name list', () => {
      const { store, commands } = createSettingsProfileStore();
      const profiles = ['work', 'personal'];
      commands.setProfiles(profiles);
      expect(store.getState().profiles).toBe(profiles);
    });

    it('setProfileListItems stores the dialog rows', () => {
      const { store, commands } = createSettingsProfileStore();
      const items: ProfileListItem[] = [
        {
          name: 'work',
          type: 'standard',
          provider: 'zai',
          model: 'glm-5.3',
          isActive: true,
        },
        { name: 'pool', type: 'loadbalancer', isDefault: true },
      ];
      commands.setProfileListItems(items);
      expect(store.getState().profileListItems).toBe(items);
      expect(store.getState().profileListItems).toHaveLength(2);
    });

    it('setSelectedProfileName writes and clears the selection', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setSelectedProfileName('work');
      expect(store.getState().selectedProfileName).toBe('work');
      commands.setSelectedProfileName(null);
      expect(store.getState().selectedProfileName).toBeNull();
    });

    it('setSelectedProfileData stores the loaded profile object and clears it', () => {
      const { store, commands } = createSettingsProfileStore();
      const profile = standardProfile();
      commands.setSelectedProfileData(profile);
      expect(store.getState().selectedProfileData).toBe(profile);
      commands.setSelectedProfileData(null);
      expect(store.getState().selectedProfileData).toBeNull();
    });

    it('setDefaultProfileName writes and clears the default', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setDefaultProfileName('work');
      expect(store.getState().defaultProfileName).toBe('work');
      commands.setDefaultProfileName(null);
      expect(store.getState().defaultProfileName).toBeNull();
    });

    it('setActiveProfileName writes and clears the active profile', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setActiveProfileName('work');
      expect(store.getState().activeProfileName).toBe('work');
      commands.setActiveProfileName(null);
      expect(store.getState().activeProfileName).toBeNull();
    });

    it('setProfileDialogError writes and clears the dialog error', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setProfileDialogError('profile not found');
      expect(store.getState().profileDialogError).toBe('profile not found');
      commands.setProfileDialogError(null);
      expect(store.getState().profileDialogError).toBeNull();
    });

    it('setProfileDialogLoading toggles the loading flag', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setProfileDialogLoading(true);
      expect(store.getState().profileDialogLoading).toBe(true);
      commands.setProfileDialogLoading(false);
      expect(store.getState().profileDialogLoading).toBe(false);
    });
  });

  describe('tools dialog commands', () => {
    it('setToolsDialogAction flips the pending action', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setToolsDialogAction('disable');
      expect(store.getState().toolsDialogAction).toBe('disable');
      commands.setToolsDialogAction('enable');
      expect(store.getState().toolsDialogAction).toBe('enable');
    });

    it('setToolsDialogTools stores the tool rows', () => {
      const { store, commands } = createSettingsProfileStore();
      const tools: ToolInfo[] = [
        {
          name: 'read_file',
          description: 'Reads a file',
          source: 'builtin',
          enabled: true,
        },
        { name: 'docs_search', source: 'mcp', server: 'docs', enabled: false },
      ];
      commands.setToolsDialogTools(tools);
      expect(store.getState().toolsDialogTools).toBe(tools);
    });

    it('setToolsDialogDisabledTools stores the disabled names', () => {
      const { store, commands } = createSettingsProfileStore();
      const disabled = ['web_search', 'run_shell_command'];
      commands.setToolsDialogDisabledTools(disabled);
      expect(store.getState().toolsDialogDisabledTools).toBe(disabled);
    });
  });

  describe('slash command registry', () => {
    it('setSlashCommands stores the registry and clears back to undefined', () => {
      const { store, commands } = createSettingsProfileStore();
      const registry: readonly SlashCommand[] = [
        { name: 'help', description: 'Show help', kind: CommandKind.BUILT_IN },
        {
          name: 'deploy',
          description: 'Deploy the app',
          kind: CommandKind.EXTENSION,
          extensionName: 'ops',
        },
      ];
      commands.setSlashCommands(registry);
      expect(store.getState().slashCommands).toBe(registry);
      commands.setSlashCommands(undefined);
      expect(store.getState().slashCommands).toBeUndefined();
    });
  });

  describe('welcome onboarding commands', () => {
    it('setWelcomeState advances the wizard state', () => {
      const { store, commands } = createSettingsProfileStore();
      const advanced: WelcomeState = {
        step: 'authenticating',
        selectedProvider: 'zai',
        selectedModel: 'glm-5.3',
        selectedAuthMethod: 'oauth',
        authInProgress: true,
        modelsLoadStatus: 'success',
      };
      commands.setWelcomeState(advanced);
      expect(store.getState().welcomeState).toBe(advanced);
    });

    it('setWelcomeAvailableProviders stores the wizard provider options', () => {
      const { store, commands } = createSettingsProfileStore();
      const providers = ['zai', 'anthropic'];
      commands.setWelcomeAvailableProviders(providers);
      expect(store.getState().welcomeAvailableProviders).toBe(providers);
    });

    it('setWelcomeAvailableModels stores the wizard model options', () => {
      const { store, commands } = createSettingsProfileStore();
      const models: ModelInfo[] = [
        { id: 'glm-5.3', name: 'GLM 5.3' },
        { id: 'glm-5-air', name: 'GLM 5 Air' },
      ];
      commands.setWelcomeAvailableModels(models);
      expect(store.getState().welcomeAvailableModels).toBe(models);
    });
  });

  describe('IDE + memory context commands', () => {
    it('setIdeContextState stores and clears the IDE context', () => {
      const { store, commands } = createSettingsProfileStore();
      const context: IdeContext = {
        workspaceState: {
          openFiles: [
            { path: '/src/app.ts', timestamp: 1_000, isActive: true },
          ],
          isTrusted: true,
        },
      };
      commands.setIdeContextState(context);
      expect(store.getState().ideContextState).toBe(context);
      commands.setIdeContextState(undefined);
      expect(store.getState().ideContextState).toBeUndefined();
    });

    it('setLlxprtMdFileCount and setCoreMemoryFileCount write the memory counts', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setLlxprtMdFileCount(4);
      commands.setCoreMemoryFileCount(2);
      expect(store.getState().llxprtMdFileCount).toBe(4);
      expect(store.getState().coreMemoryFileCount).toBe(2);
    });
  });

  describe('status readout commands', () => {
    it('setConsoleMessages stores the message list', () => {
      const { store, commands } = createSettingsProfileStore();
      const messages: ConsoleMessageItem[] = [
        { type: 'error', content: 'boom', count: 1 },
        { type: 'info', content: 'ready', count: 3 },
      ];
      commands.setConsoleMessages(messages);
      expect(store.getState().consoleMessages).toBe(messages);
    });

    it('setErrorCount and setHistoryTokenCount write the counters', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setErrorCount(2);
      commands.setHistoryTokenCount(1_500);
      expect(store.getState().errorCount).toBe(2);
      expect(store.getState().historyTokenCount).toBe(1_500);
    });

    it('setDebugMessage writes the debug line', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setDebugMessage('api latency 210ms');
      expect(store.getState().debugMessage).toBe('api latency 210ms');
    });

    it('setAuthError and setInitError write and clear the error strings', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setAuthError('oauth token expired');
      commands.setInitError('config file unreadable');
      expect(store.getState().authError).toBe('oauth token expired');
      expect(store.getState().initError).toBe('config file unreadable');
      commands.setAuthError(null);
      commands.setInitError(null);
      expect(store.getState().authError).toBeNull();
      expect(store.getState().initError).toBeNull();
    });

    it('setShowAutoAcceptIndicator cycles the approval mode', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setShowAutoAcceptIndicator(ApprovalMode.AUTO_EDIT);
      expect(store.getState().showAutoAcceptIndicator).toBe(
        ApprovalMode.AUTO_EDIT,
      );
      commands.setShowAutoAcceptIndicator(ApprovalMode.YOLO);
      expect(store.getState().showAutoAcceptIndicator).toBe(ApprovalMode.YOLO);
    });

    it('setTokenMetrics replaces the footer readout object', () => {
      const { store, commands } = createSettingsProfileStore();
      const metrics: TokenMetricsSnapshot = {
        tokensPerMinute: 812,
        throttleWaitTimeMs: 250,
        sessionTokenTotal: 45_600,
      };
      commands.setTokenMetrics(metrics);
      expect(store.getState().tokenMetrics).toBe(metrics);
    });
  });

  describe('setBranchInfo', () => {
    it('writes both branch fields in one state change', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setBranchInfo('feature/store', true);
      expect(store.getState().branchName).toBe('feature/store');
      expect(store.getState().branchIsDirty).toBe(true);
    });

    it('skips the write entirely when both fields already match', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setBranchInfo('main', false);
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });
      const before = store.getState();
      commands.setBranchInfo('main', false);
      expect(store.getState()).toBe(before);
      expect(notifications).toBe(0);
    });

    it('writes when only one of the two fields changes', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setBranchInfo('main', false);
      const before = store.getState();
      commands.setBranchInfo('main', true);
      expect(store.getState()).not.toBe(before);
      expect(store.getState().branchName).toBe('main');
      expect(store.getState().branchIsDirty).toBe(true);
    });
  });

  describe('settings nonce', () => {
    it('bumpSettingsNonce increments by one per call', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.bumpSettingsNonce();
      commands.bumpSettingsNonce();
      expect(store.getState().settingsNonce).toBe(2);
    });

    it('bumpSettingsNonce always notifies with a fresh state reference', () => {
      const { store, commands } = createSettingsProfileStore();
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });
      const before = store.getState();
      commands.bumpSettingsNonce();
      expect(notifications).toBe(1);
      expect(store.getState()).not.toBe(before);
    });
  });

  describe('list replacement identity', () => {
    it('re-passing the same array reference is a no-op (no notification, state preserved)', () => {
      const { store, commands } = createSettingsProfileStore();
      const providers = ['zai'];
      commands.setProviderOptions(providers);
      const before = store.getState();
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });

      commands.setProviderOptions(providers);

      expect(store.getState()).toBe(before);
      expect(notifications).toBe(0);
    });

    it('an equal-content fresh array replaces the reference and notifies', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setProfiles(['work']);
      const first = store.getState().profiles;
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });

      commands.setProfiles(['work']);

      expect(notifications).toBe(1);
      expect(store.getState().profiles).toStrictEqual(first);
      expect(store.getState().profiles).not.toBe(first);
    });
  });

  describe('subscription semantics', () => {
    it('notifies a subscriber once per state-changing command', () => {
      const { store, commands } = createSettingsProfileStore();
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      commands.setCurrentModel('glm-5.3');
      commands.setSelectedProvider('zai');
      expect(calls).toBe(2);
    });

    it('re-setting an Object.is-equal value does not notify', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setSelectedProvider('zai');
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      commands.setSelectedProvider('zai');
      commands.setCurrentModelLabel(undefined);
      commands.setProfileDialogLoading(false);
      commands.setContextLimit(undefined);
      expect(calls).toBe(0);
    });

    it('a no-op write preserves the state reference', () => {
      const { store, commands } = createSettingsProfileStore();
      commands.setSelectedProvider('zai');
      const before = store.getState();
      commands.setSelectedProvider('zai');
      expect(store.getState()).toBe(before);
    });

    it('unsubscribe stops notifications', () => {
      const { store, commands } = createSettingsProfileStore();
      let calls = 0;
      const unsubscribe = store.subscribe(() => {
        calls += 1;
      });
      commands.setCurrentModel('glm-5.3');
      unsubscribe();
      commands.setCurrentModel('glm-5-air');
      expect(calls).toBe(1);
    });

    it('a write produces a fresh state reference so selectors re-run', () => {
      const { store, commands } = createSettingsProfileStore();
      const before = store.getState();
      commands.setCurrentModel('glm-5.3');
      expect(store.getState()).not.toBe(before);
      // Unrelated fields survive the write.
      expect(store.getState().selectedProvider).toBe(before.selectedProvider);
      expect(store.getState().settingsNonce).toBe(before.settingsNonce);
    });

    it('an unrelated write keeps the stored array reference stable', () => {
      const { store, commands } = createSettingsProfileStore();
      const profiles = ['work'];
      commands.setProfiles(profiles);
      commands.setCurrentModel('glm-5.3');
      expect(store.getState().profiles).toBe(profiles);
    });
  });
});
