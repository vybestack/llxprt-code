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
  | 'auth_method'
  | 'authenticating'
  | 'completion'
  | 'skipped';

export interface WelcomeState {
  step: WelcomeStep;
  selectedProvider?: string;
  selectedAuthMethod?: 'oauth' | 'api_key';
  authInProgress: boolean;
  error?: string;
}

export interface WelcomeActions {
  startSetup: () => void;
  selectProvider: (providerId: string) => void;
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

export interface UseWelcomeOnboardingReturn {
  showWelcome: boolean;
  state: WelcomeState;
  actions: WelcomeActions;
  availableProviders: string[];
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
  });

  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

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

  const startSetup = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'provider' }));
  }, []);

  const selectProvider = useCallback((providerId: string) => {
    setState((prev) => ({
      ...prev,
      selectedProvider: providerId,
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
    const providerManager = runtime.getCliProviderManager();
    if (providerManager && state.selectedProvider) {
      try {
        providerManager.setActiveProvider(state.selectedProvider);
        debug.log(`Set active provider to: ${state.selectedProvider}`);
      } catch (error) {
        debug.log(`Failed to set active provider: ${error}`);
      }
    }

    setState((prev) => ({
      ...prev,
      step: 'completion',
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
          return { ...prev, step: 'provider', selectedProvider: undefined };
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
        await runtime.saveProfileSnapshot(name);
        debug.log(`Saved profile: ${name}`);
      } catch (error) {
        debug.log(`Failed to save profile: ${error}`);
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
      _apiKey?: string,
    ): Promise<void> => {
      debug.log(`Triggering auth for ${provider} via ${method}`);
      const oauthManager = runtime.getCliOAuthManager();
      const providerManager = runtime.getCliProviderManager();

      if (method === 'oauth') {
        // Trigger OAuth flow
        if (!oauthManager) {
          throw new Error('OAuth manager not available');
        }
        await oauthManager.authenticate(provider);
      } else {
        // API key path: For now, just enable OAuth for this provider
        // In the future, this could use a dedicated API key setting mechanism
        // The API key can be set via environment variables or /key command
        debug.log(
          `API key auth not yet supported in welcome flow - please use /key command or environment variables`,
        );
        throw new Error(
          'API key authentication during onboarding not yet supported. Use /key command after setup.',
        );
      }

      // Set the active provider after successful auth
      if (providerManager) {
        providerManager.setActiveProvider(provider);
      }
    },
    [runtime],
  );

  return {
    showWelcome,
    state,
    actions: {
      startSetup,
      selectProvider,
      selectAuthMethod,
      onAuthComplete,
      onAuthError,
      skipSetup,
      goBack,
      saveProfile,
      dismiss,
    },
    availableProviders,
    triggerAuth,
  };
};
