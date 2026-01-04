/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { type LoadedSettings } from '../../config/settings.js';
import {
  isWelcomeCompleted,
  markWelcomeCompleted,
} from '../../config/welcomeConfig.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

const debug = new DebugLogger('llxprt:ui:useWelcomeOnboarding');

export type WelcomeStep =
  | 'welcome'
  | 'provider'
  | 'model'
  | 'auth_method'
  | 'authenticating'
  | 'completion'
  | 'skipped';

export type ModelsLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface WelcomeState {
  step: WelcomeStep;
  selectedProvider?: string;
  selectedModel?: string;
  selectedAuthMethod?: 'oauth' | 'api_key';
  authInProgress: boolean;
  modelsLoadStatus: ModelsLoadStatus;
  error?: string;
}

export interface WelcomeActions {
  startSetup: () => void;
  selectProvider: (providerId: string) => void;
  selectModel: (modelId: string) => void;
  selectAuthMethod: (method: 'oauth' | 'api_key') => void;
  onAuthComplete: () => void;
  onAuthError: (error: string) => void;
  skipSetup: () => void;
  goBack: () => void;
  saveProfile: (name: string) => Promise<void>;
  dismiss: () => void;
}

export interface UseWelcomeOnboardingOptions {
  settings: LoadedSettings;
  isFolderTrustComplete: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface UseWelcomeOnboardingReturn {
  showWelcome: boolean;
  state: WelcomeState;
  actions: WelcomeActions;
  availableProviders: string[];
  availableModels: ModelInfo[];
  triggerAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;
}

export const useWelcomeOnboarding = (
  options: UseWelcomeOnboardingOptions,
): UseWelcomeOnboardingReturn => {
  const { settings: _settings, isFolderTrustComplete } = options;
  const runtime = useRuntimeApi();
  const [welcomeCompleted, setWelcomeCompleted] = useState(() =>
    isWelcomeCompleted(),
  );

  // Only show welcome after folder trust is complete
  const showWelcome = !welcomeCompleted && isFolderTrustComplete;

  const [state, setState] = useState<WelcomeState>({
    step: 'welcome',
    authInProgress: false,
    modelsLoadStatus: 'idle',
  });

  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);

  // Load available providers on mount
  useEffect(() => {
    const providerManager = runtime.getCliProviderManager();
    if (providerManager) {
      const providers = providerManager.listProviders();
      setAvailableProviders(providers);
      debug.log(
        `Loaded ${providers.length} providers: ${providers.join(', ')}`,
      );
    }
  }, [runtime]);

  // Load available models when provider is selected
  useEffect(() => {
    const loadModels = async () => {
      if (!state.selectedProvider) {
        setAvailableModels([]);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'idle' }));
        return;
      }

      setState((prev) => ({ ...prev, modelsLoadStatus: 'loading' }));

      try {
        const models = await runtime.listAvailableModels(
          state.selectedProvider,
        );
        const modelInfos: ModelInfo[] = models.map((m) => ({
          id: m.name,
          name: m.name,
        }));
        setAvailableModels(modelInfos);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'success' }));
        debug.log(
          `Loaded ${modelInfos.length} models for ${state.selectedProvider}`,
        );
      } catch (error) {
        debug.log(`Failed to load models: ${error}`);
        setAvailableModels([]);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'error' }));
      }
    };

    loadModels();
  }, [runtime, state.selectedProvider]);

  const startSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'provider' }));
  }, []);

  const selectProvider = useCallback((providerId: string) => {
    setState((prev) => ({
      ...prev,
      selectedProvider: providerId,
      step: 'model',
    }));
  }, []);

  const selectModel = useCallback((modelId: string) => {
    setState((prev) => ({
      ...prev,
      selectedModel: modelId,
      step: 'auth_method',
    }));
  }, []);

  const selectAuthMethod = useCallback((method: 'oauth' | 'api_key') => {
    setState((prev) => ({
      ...prev,
      selectedAuthMethod: method,
      step: 'authenticating',
      authInProgress: true,
    }));
  }, []);

  const onAuthComplete = useCallback(() => {
    // Provider switch already happened in triggerAuth, just update UI state
    debug.log(
      `[onAuthComplete] Auth complete for provider: ${state.selectedProvider}`,
    );

    setState((prev) => ({
      ...prev,
      step: 'completion',
      authInProgress: false,
      error: undefined,
    }));
  }, [state.selectedProvider]);

  const onAuthError = useCallback((error: string) => {
    setState((prev) => ({
      ...prev,
      authInProgress: false,
      error,
      step: 'auth_method',
    }));
  }, []);

  const skipSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'skipped' }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      switch (prev.step) {
        case 'model':
          return { ...prev, step: 'provider', selectedProvider: undefined };
        case 'auth_method':
          return { ...prev, step: 'model', selectedModel: undefined };
        case 'authenticating':
          return {
            ...prev,
            step: 'auth_method',
            selectedAuthMethod: undefined,
            authInProgress: false,
          };
        case 'provider':
          return { ...prev, step: 'welcome' };
        default:
          return prev;
      }
    });
  }, []);

  const saveProfile = useCallback(
    async (name: string) => {
      try {
        const providerManager = runtime.getCliProviderManager();
        debug.log(
          `[saveProfile] START name=${name}, active provider: ${providerManager?.getActiveProviderName()}`,
        );

        // Check if profile already exists
        const existingProfiles = await runtime.listSavedProfiles();
        debug.log(
          `[saveProfile] Existing profiles: ${existingProfiles.join(', ')}`,
        );
        if (existingProfiles.includes(name)) {
          throw new Error(
            `Profile "${name}" already exists. Please choose a different name.`,
          );
        }

        // Save the profile snapshot
        debug.log(`[saveProfile] Calling saveProfileSnapshot...`);
        await runtime.saveProfileSnapshot(name);
        debug.log(`[saveProfile] Saved profile: ${name}`);

        // Set as default profile so it loads on startup
        debug.log(`[saveProfile] Setting as default profile...`);
        await runtime.setDefaultProfileName(name);
        debug.log(`[saveProfile] Set default profile: ${name}`);

        // Load the profile immediately in current session
        debug.log(`[saveProfile] Loading profile...`);
        const loadResult = await runtime.loadProfileByName(name);
        debug.log(
          `[saveProfile] Load result: ${JSON.stringify(loadResult, null, 2)}`,
        );
        debug.log(
          `[saveProfile] After load - active provider: ${providerManager?.getActiveProviderName()}`,
        );
      } catch (error) {
        debug.log(`[saveProfile] Failed: ${error}`);
        throw error;
      }
    },
    [runtime],
  );

  const dismiss = useCallback(() => {
    const skipped = state.step === 'skipped';
    markWelcomeCompleted(skipped);
    setWelcomeCompleted(true);
    debug.log(`Welcome flow completed (skipped: ${skipped})`);
  }, [state.step]);

  // Trigger authentication for the selected provider
  const triggerAuth = useCallback(
    async (
      provider: string,
      method: 'oauth' | 'api_key',
      apiKey?: string,
    ): Promise<void> => {
      debug.log(`[triggerAuth] START provider=${provider} method=${method}`);
      const oauthManager = runtime.getCliOAuthManager();
      const providerManager = runtime.getCliProviderManager();

      debug.log(
        `[triggerAuth] Before switch - current active: ${providerManager?.getActiveProviderName()}`,
      );

      // Use switchActiveProvider (not setActiveProvider) - it does full provider switch
      // including config updates, ephemeral settings, and settingsService updates
      const switchResult = await runtime.switchActiveProvider(provider);
      debug.log(
        `[triggerAuth] After switchActiveProvider - changed: ${switchResult.changed}, now active: ${providerManager?.getActiveProviderName()}`,
      );

      // Set the selected model
      if (state.selectedModel) {
        debug.log(`[triggerAuth] Setting model to: ${state.selectedModel}`);
        await runtime.setActiveModel(state.selectedModel);
        debug.log(`[triggerAuth] Model set to: ${state.selectedModel}`);
      }

      if (method === 'oauth') {
        // Trigger OAuth flow
        if (!oauthManager) {
          throw new Error('OAuth manager not available');
        }
        await oauthManager.authenticate(provider);
        debug.log(`[triggerAuth] OAuth complete for ${provider}`);
      } else if (apiKey) {
        // API key path: set the key for the now-active provider
        debug.log(
          `[triggerAuth] Calling updateActiveProviderApiKey for ${provider}`,
        );
        const result = await runtime.updateActiveProviderApiKey(apiKey);
        debug.log(
          `[triggerAuth] API key result: ${result.message}, providerName=${result.providerName}`,
        );
      } else {
        throw new Error('API key is required for API key authentication');
      }

      debug.log(
        `[triggerAuth] END - active provider: ${providerManager?.getActiveProviderName()}`,
      );
    },
    [runtime, state.selectedModel],
  );

  return {
    showWelcome,
    state,
    actions: {
      startSetup,
      selectProvider,
      selectModel,
      selectAuthMethod,
      onAuthComplete,
      onAuthError,
      skipSetup,
      goBack,
      saveProfile,
      dismiss,
    },
    availableProviders,
    availableModels,
    triggerAuth,
  };
};
