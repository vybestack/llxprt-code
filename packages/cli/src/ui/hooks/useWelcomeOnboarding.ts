/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { INITIAL_WELCOME_STATE } from './welcomeState.js';
import { useState, useCallback, useEffect } from 'react';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { type LoadedSettings } from '../../config/settings.js';
import {
  isWelcomeCompleted,
  markWelcomeCompleted,
} from '../../config/welcomeConfig.js';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';

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
  selectModel: (modelId: string) => void | Promise<void>;
  selectAuthMethod: (method: 'oauth' | 'api_key') => void;
  onAuthComplete: () => void | Promise<void>;
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
  listProviders: () => string[];
  listAvailableModels: (provider?: string) => Promise<readonly ModelInfo[]>;
  setActiveModel: (model: string) => Promise<unknown>;
  readProviderStatus: () => { providerName: string | null };
  listSavedProfiles: () => Promise<string[]>;
  saveProfileSnapshot: (name: string) => Promise<unknown>;
  setDefaultProfileName: (name: string) => void;
  loadProfileByName: (name: string) => Promise<unknown>;
  switchProviderAfterAuth: (provider: string) => Promise<{ changed: boolean }>;
  updateActiveProviderApiKey: (
    key: string,
  ) => Promise<{ message: string; providerName: string }>;
  authenticate: OAuthControl['authenticate'];
  suppressStartup?: boolean;
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

function useProviderLoader(
  listProviders: UseWelcomeOnboardingOptions['listProviders'],
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  useEffect(() => {
    const providers = listProviders();
    setAvailableProviders(providers);
    debug.log(`Loaded ${providers.length} providers: ${providers.join(', ')}`);
  }, [listProviders]);

  return [availableProviders, setAvailableProviders];
}

function useModelLoader(
  listAvailableModels: UseWelcomeOnboardingOptions['listAvailableModels'],
  selectedProvider: string | undefined,
  setState: React.Dispatch<React.SetStateAction<WelcomeState>>,
): [ModelInfo[], React.Dispatch<React.SetStateAction<ModelInfo[]>>] {
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    const loadModels = async () => {
      if (!selectedProvider) {
        setAvailableModels([]);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'idle' }));
        return;
      }

      setState((prev) => ({ ...prev, modelsLoadStatus: 'loading' }));

      try {
        const models = await listAvailableModels(selectedProvider);
        const modelInfos: ModelInfo[] = models.map((m) => ({
          id: m.id,
          name: m.name,
        }));
        setAvailableModels(modelInfos);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'success' }));
        debug.log(`Loaded ${modelInfos.length} models for ${selectedProvider}`);
      } catch (error) {
        debug.log(`Failed to load models: ${error}`);
        setAvailableModels([]);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'error' }));
      }
    };

    void loadModels();
  }, [listAvailableModels, selectedProvider, setState]);

  return [availableModels, setAvailableModels];
}

function useSelectModelAction(
  setActiveModel: UseWelcomeOnboardingOptions['setActiveModel'],
  setState: React.Dispatch<React.SetStateAction<WelcomeState>>,
) {
  return useCallback(
    async (modelId: string) => {
      debug.log(`[selectModel] Setting model: ${modelId}`);
      try {
        await setActiveModel(modelId);
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
        step: 'completion',
      }));
    },
    [setActiveModel, setState],
  );
}

function useOnAuthCompleteAction(
  listAvailableModels: UseWelcomeOnboardingOptions['listAvailableModels'],
  selectedProvider: string | undefined,
  setState: React.Dispatch<React.SetStateAction<WelcomeState>>,
  setAvailableModels: React.Dispatch<React.SetStateAction<ModelInfo[]>>,
) {
  return useCallback(async () => {
    debug.log(
      `[onAuthComplete] Auth complete for provider: ${selectedProvider}`,
    );

    try {
      if (selectedProvider) {
        setState((prev) => ({ ...prev, modelsLoadStatus: 'loading' }));
        const models = await listAvailableModels(selectedProvider);
        const modelInfos: ModelInfo[] = models.map((m) => ({
          id: m.id,
          name: m.name,
        }));
        setAvailableModels(modelInfos);
        setState((prev) => ({ ...prev, modelsLoadStatus: 'success' }));
        debug.log(
          `[onAuthComplete] Loaded ${modelInfos.length} models for ${selectedProvider}`,
        );
      }
    } catch (error) {
      debug.log(`[onAuthComplete] Failed to reload models: ${error}`);
      setAvailableModels([]);
      setState((prev) => ({ ...prev, modelsLoadStatus: 'error' }));
    }

    setState((prev) => ({
      ...prev,
      step: 'model',
      authInProgress: false,
      error: undefined,
    }));
  }, [listAvailableModels, selectedProvider, setState, setAvailableModels]);
}

function useGoBackAction(
  setState: React.Dispatch<React.SetStateAction<WelcomeState>>,
) {
  return useCallback(() => {
    setState((prev) => {
      switch (prev.step) {
        case 'auth_method':
          return { ...prev, step: 'provider', selectedProvider: undefined };
        case 'authenticating':
          return {
            ...prev,
            step: 'auth_method',
            selectedAuthMethod: undefined,
            authInProgress: false,
          };
        case 'model':
          return { ...prev, step: 'auth_method', selectedModel: undefined };
        case 'provider':
          return { ...prev, step: 'welcome' };
        default:
          return prev;
      }
    });
  }, [setState]);
}

function useWelcomeStepActions(
  setActiveModel: UseWelcomeOnboardingOptions['setActiveModel'],
  listAvailableModels: UseWelcomeOnboardingOptions['listAvailableModels'],
  setState: React.Dispatch<React.SetStateAction<WelcomeState>>,
  selectedProvider: string | undefined,
  setAvailableModels: React.Dispatch<React.SetStateAction<ModelInfo[]>>,
) {
  const startSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'provider' }));
  }, [setState]);

  const selectProvider = useCallback(
    (providerId: string) => {
      setState((prev) => ({
        ...prev,
        selectedProvider: providerId,
        step: 'auth_method',
      }));
    },
    [setState],
  );

  const selectModel = useSelectModelAction(setActiveModel, setState);
  const onAuthComplete = useOnAuthCompleteAction(
    listAvailableModels,
    selectedProvider,
    setState,
    setAvailableModels,
  );

  const selectAuthMethod = useCallback(
    (method: 'oauth' | 'api_key') => {
      setState((prev) => ({
        ...prev,
        selectedAuthMethod: method,
        step: 'authenticating',
        authInProgress: true,
      }));
    },
    [setState],
  );

  const onAuthError = useCallback(
    (error: string) => {
      setState((prev) => ({
        ...prev,
        authInProgress: false,
        error,
        step: 'auth_method',
      }));
    },
    [setState],
  );

  const skipSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'skipped' }));
  }, [setState]);

  const goBack = useGoBackAction(setState);

  return {
    startSetup,
    selectProvider,
    selectModel,
    selectAuthMethod,
    onAuthComplete,
    onAuthError,
    skipSetup,
    goBack,
  };
}

function useProfileSave(
  readProviderStatus: UseWelcomeOnboardingOptions['readProviderStatus'],
  listSavedProfiles: UseWelcomeOnboardingOptions['listSavedProfiles'],
  saveProfileSnapshot: UseWelcomeOnboardingOptions['saveProfileSnapshot'],
  setDefaultProfileName: UseWelcomeOnboardingOptions['setDefaultProfileName'],
  loadProfileByName: UseWelcomeOnboardingOptions['loadProfileByName'],
) {
  return useCallback(
    async (name: string) => {
      try {
        debug.log(
          `[saveProfile] START name=${name}, active provider: ${readProviderStatus().providerName}`,
        );

        // Check if profile already exists
        const existingProfiles = await listSavedProfiles();
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
        await saveProfileSnapshot(name);
        debug.log(`[saveProfile] Saved profile: ${name}`);

        // Set as default profile so it loads on startup
        debug.log(`[saveProfile] Setting as default profile...`);
        setDefaultProfileName(name);
        debug.log(`[saveProfile] Set default profile: ${name}`);

        // Load the profile immediately in current session
        debug.log(`[saveProfile] Loading profile...`);
        const loadResult = await loadProfileByName(name);
        debug.log(
          `[saveProfile] Load result: ${JSON.stringify(loadResult, null, 2)}`,
        );
        debug.log(
          `[saveProfile] After load - active provider: ${readProviderStatus().providerName}`,
        );
      } catch (error) {
        debug.log(`[saveProfile] Failed: ${error}`);
        throw error;
      }
    },
    [
      readProviderStatus,
      listSavedProfiles,
      saveProfileSnapshot,
      setDefaultProfileName,
      loadProfileByName,
    ],
  );
}

function useTriggerAuth(
  readProviderStatus: UseWelcomeOnboardingOptions['readProviderStatus'],
  switchProviderAfterAuth: UseWelcomeOnboardingOptions['switchProviderAfterAuth'],
  updateActiveProviderApiKey: UseWelcomeOnboardingOptions['updateActiveProviderApiKey'],
  authenticate: UseWelcomeOnboardingOptions['authenticate'],
) {
  return useCallback(
    async (
      provider: string,
      method: 'oauth' | 'api_key',
      apiKey?: string,
    ): Promise<void> => {
      debug.log(`[triggerAuth] START provider=${provider} method=${method}`);

      debug.log(
        `[triggerAuth] Before auth - current active: ${readProviderStatus().providerName}`,
      );

      // Authenticate FIRST before switching provider (prevents double OAuth)
      if (method === 'oauth') {
        debug.log(`[triggerAuth] Starting OAuth for ${provider}`);
        await authenticate(provider, undefined, {
          signalAuthCompletion: true,
        });
        debug.log(`[triggerAuth] OAuth complete for ${provider}`);
      }

      // Now switch to the provider AFTER auth is complete
      // IMPORTANT: Pass autoOAuth: false to prevent the agent provider switch
      // from triggering a second OAuth flow - we already authenticated above
      const switchResult = await switchProviderAfterAuth(provider);
      debug.log(
        `[triggerAuth] After provider switch - changed: ${switchResult.changed}, now active: ${readProviderStatus().providerName}`,
      );

      // For API key method, set the key after switching provider
      if (method === 'api_key') {
        if (!apiKey) {
          throw new Error('API key is required for API key authentication');
        }
        debug.log(
          `[triggerAuth] Calling updateActiveProviderApiKey for ${provider}`,
        );
        const result = await updateActiveProviderApiKey(apiKey);
        debug.log(
          `[triggerAuth] API key result: ${result.message}, providerName=${result.providerName}`,
        );
      }

      debug.log(
        `[triggerAuth] END - active provider: ${readProviderStatus().providerName}`,
      );
    },
    [
      readProviderStatus,
      switchProviderAfterAuth,
      updateActiveProviderApiKey,
      authenticate,
    ],
  );
}

export const useWelcomeOnboarding = (
  options: UseWelcomeOnboardingOptions,
): UseWelcomeOnboardingReturn => {
  const {
    settings: _settings,
    isFolderTrustComplete,
    listProviders,
    listAvailableModels,
    setActiveModel,
    readProviderStatus,
    listSavedProfiles,
    saveProfileSnapshot,
    setDefaultProfileName,
    loadProfileByName,
    switchProviderAfterAuth,
    updateActiveProviderApiKey,
    authenticate,
  } = options;
  const suppressStartup = options.suppressStartup === true;
  const [welcomeCompleted, setWelcomeCompleted] = useState(() =>
    suppressStartup ? true : isWelcomeCompleted(),
  );

  // Only show welcome after folder trust is complete
  const showWelcome = !welcomeCompleted && isFolderTrustComplete;

  const [state, setState] = useState<WelcomeState>(INITIAL_WELCOME_STATE);

  const [availableProviders] = useProviderLoader(listProviders);
  const [availableModels, setAvailableModels] = useModelLoader(
    listAvailableModels,
    state.selectedProvider,
    setState,
  );

  const stepActions = useWelcomeStepActions(
    setActiveModel,
    listAvailableModels,
    setState,
    state.selectedProvider,
    setAvailableModels,
  );

  const saveProfile = useProfileSave(
    readProviderStatus,
    listSavedProfiles,
    saveProfileSnapshot,
    setDefaultProfileName,
    loadProfileByName,
  );
  const triggerAuth = useTriggerAuth(
    readProviderStatus,
    switchProviderAfterAuth,
    updateActiveProviderApiKey,
    authenticate,
  );

  const dismiss = useCallback(() => {
    const skipped = state.step === 'skipped';
    markWelcomeCompleted(skipped);
    setWelcomeCompleted(true);
    debug.log(`Welcome flow completed (skipped: ${skipped})`);
  }, [state.step]);

  const resetAndReopen = useCallback(() => {
    debug.log('[resetAndReopen] Re-triggering welcome onboarding');
    setWelcomeCompleted(false);
    setState({
      step: 'welcome',
      authInProgress: false,
      modelsLoadStatus: 'idle',
    });
    setAvailableModels([]);
  }, [setState, setAvailableModels]);

  return {
    showWelcome,
    state,
    actions: {
      ...stepActions,
      saveProfile,
      dismiss,
      resetAndReopen,
    },
    availableProviders,
    availableModels,
    triggerAuth,
  };
};
