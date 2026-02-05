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
  /** Re-trigger the welcome onboarding flow (for /setup command) */
  resetAndReopen: () => void;
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
          id: m.id,
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
      step: 'auth_method', // Auth before model selection to ensure models load properly
    }));
  }, []);

  const selectModel = useCallback(
    async (modelId: string) => {
      // Actually set the model on the runtime so it's captured in the profile
      debug.log(`[selectModel] Setting model: ${modelId}`);
      try {
        await runtime.setActiveModel(modelId);
        debug.log(`[selectModel] Model set successfully: ${modelId}`);
      } catch (error) {
        debug.log(`[selectModel] Failed to set model: ${error}`);
        setState((prev) => ({
          ...prev,
          error: `Failed to set model: ${error instanceof Error ? error.message : String(error)}`,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        selectedModel: modelId,
        step: 'completion', // After model selection, go to completion (auth already done)
      }));
    },
    [runtime],
  );

  const selectAuthMethod = useCallback((method: 'oauth' | 'api_key') => {
    setState((prev) => ({
      ...prev,
      selectedAuthMethod: method,
      step: 'authenticating',
      authInProgress: true,
    }));
  }, []);

  const onAuthComplete = useCallback(async () => {
    // Provider switch already happened in triggerAuth
    debug.log(
      `[onAuthComplete] Auth complete for provider: ${state.selectedProvider}`,
    );

    // Refresh models now that auth is established
    try {
      if (state.selectedProvider) {
        setState((prev) => ({ ...prev, modelsLoadStatus: 'loading' }));
        const models = await runtime.listAvailableModels(
          state.selectedProvider,
        );
        const modelInfos: ModelInfo[] = models.map((m) => ({
          id: m.id,
          name: m.name,
        }));
        setAvailableModels(modelInfos);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'success' }));
        debug.log(
          `[onAuthComplete] Loaded ${modelInfos.length} models for ${state.selectedProvider}`,
        );
      }
    } catch (error) {
      debug.log(`[onAuthComplete] Failed to reload models: ${error}`);
      setAvailableModels([]);
      setState((prev) => ({ ...prev, modelsLoadStatus: 'error' }));
    }

    // Go to model selection step (since we reordered: provider → auth → model)
    setState((prev) => ({
      ...prev,
      step: 'model',
      authInProgress: false,
      error: undefined,
    }));
  }, [runtime, state.selectedProvider]);

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
        case 'auth_method':
          // Going back from auth method goes to provider selection
          return { ...prev, step: 'provider', selectedProvider: undefined };
        case 'authenticating':
          return {
            ...prev,
            step: 'auth_method',
            selectedAuthMethod: undefined,
            authInProgress: false,
          };
        case 'model':
          // Going back from model selection goes to auth method
          return { ...prev, step: 'auth_method', selectedModel: undefined };
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

  const resetAndReopen = useCallback(() => {
    debug.log('[resetAndReopen] Re-triggering welcome onboarding');
    // Reset local state
    setWelcomeCompleted(false);
    setState({
      step: 'welcome',
      authInProgress: false,
      modelsLoadStatus: 'idle',
    });
    setAvailableModels([]);
  }, []);

  // Trigger authentication for the selected provider
  // Flow is now: provider → auth → model, so we authenticate FIRST before setting provider/model
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
        `[triggerAuth] Before auth - current active: ${providerManager?.getActiveProviderName()}`,
      );

      // Authenticate FIRST before switching provider (prevents double OAuth)
      if (method === 'oauth') {
        if (!oauthManager) {
          throw new Error('OAuth manager not available');
        }
        debug.log(`[triggerAuth] Starting OAuth for ${provider}`);
        await oauthManager.authenticate(provider);
        debug.log(`[triggerAuth] OAuth complete for ${provider}`);
      }

      // Now switch to the provider AFTER auth is complete
      // IMPORTANT: Pass autoOAuth: false to prevent switchActiveProvider from triggering
      // a second OAuth flow - we already authenticated above
      const switchResult = await runtime.switchActiveProvider(provider, {
        autoOAuth: false,
      });
      debug.log(
        `[triggerAuth] After switchActiveProvider - changed: ${switchResult.changed}, now active: ${providerManager?.getActiveProviderName()}`,
      );

      // For API key method, set the key after switching provider
      if (method === 'api_key') {
        if (!apiKey) {
          throw new Error('API key is required for API key authentication');
        }
        debug.log(
          `[triggerAuth] Calling updateActiveProviderApiKey for ${provider}`,
        );
        const result = await runtime.updateActiveProviderApiKey(apiKey);
        debug.log(
          `[triggerAuth] API key result: ${result.message}, providerName=${result.providerName}`,
        );
      }

      debug.log(
        `[triggerAuth] END - active provider: ${providerManager?.getActiveProviderName()}`,
      );
    },
    [runtime],
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
      resetAndReopen,
    },
    availableProviders,
    availableModels,
    triggerAuth,
  };
};
