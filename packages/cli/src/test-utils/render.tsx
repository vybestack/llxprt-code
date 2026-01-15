/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { renderHook as testingLibraryRenderHook } from '@testing-library/react';
import React, { createContext, useContext } from 'react';
import { LoadedSettings, type Settings } from '../config/settings.js';
import { KeypressProvider } from '../ui/contexts/KeypressContext.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';
import { UIStateContext, type UIState } from '../ui/contexts/UIStateContext.js';
import { StreamingState } from '../ui/types.js';

const mockSettings = new LoadedSettings(
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: {} },
  true,
);

export const createMockSettings = (
  overrides: Partial<Settings>,
): LoadedSettings => {
  const settings = overrides as Settings;
  return new LoadedSettings(
    { path: '', settings: {} },
    { path: '', settings: {} },
    { path: '', settings },
    { path: '', settings: {} },
    true,
  );
};

// A minimal mock UIState to satisfy the context provider.
// Tests that need specific UIState values should provide their own.
const baseMockUiState: Partial<UIState> = {
  streamingState: StreamingState.Idle,
  mainAreaWidth: 100,
  terminalWidth: 120,
};

// Mock RuntimeApi for tests - provides stub implementations of runtime functions
interface MockRuntimeApi {
  getEphemeralSetting: (key: string) => unknown;
  // Add other methods as needed
  [key: string]: unknown;
}

const mockRuntimeApi: MockRuntimeApi = {
  getEphemeralSetting: () => true, // Default to showing thinking blocks
  switchActiveProvider: async () => {},
  listProviders: () => [],
  getActiveProviderName: () => 'mock-provider',
  setActiveModel: async () => {},
  listAvailableModels: () => [],
  getActiveModelName: () => 'mock-model',
  getActiveProviderStatus: () => ({ status: 'ready' }),
  getActiveModelParams: () => ({}),
  getEphemeralSettings: () => ({}),
  setEphemeralSetting: () => {},
  setActiveModelParam: () => {},
  clearActiveModelParam: () => {},
  saveProfileSnapshot: async () => {},
  saveLoadBalancerProfile: async () => {},
  loadProfileByName: async () => {},
  deleteProfileByName: async () => {},
  listSavedProfiles: () => [],
  setDefaultProfileName: () => {},
  updateActiveProviderApiKey: async () => {},
  updateActiveProviderBaseUrl: async () => {},
  setActiveToolFormatOverride: () => {},
  getActiveToolFormatState: () => ({ format: 'default', isOverridden: false }),
  getActiveProviderMetrics: () => ({}),
  getRuntimeDiagnosticsSnapshot: () => ({}),
  registerCliProviderInfrastructure: () => {},
  getCliProviderManager: () => null,
  getCliOAuthManager: () => null,
  getCliRuntimeServices: () => null,
  getSessionTokenUsage: () => ({ inputTokens: 0, outputTokens: 0 }),
  getLoadBalancerStats: () => null,
  getLoadBalancerLastSelected: () => null,
  getAllLoadBalancerStats: () => [],
};

interface MockRuntimeContextBridge {
  runtimeId: string;
  metadata: Record<string, unknown>;
  api: MockRuntimeApi;
  runWithScope: <T>(callback: () => T) => T;
  enterScope: () => void;
}

const mockRuntimeBridge: MockRuntimeContextBridge = {
  runtimeId: 'test-runtime',
  metadata: {},
  api: mockRuntimeApi,
  runWithScope: function runWithScope<T>(callback: () => T): T {
    return callback();
  },
  enterScope: () => {},
};

const MockRuntimeContext = createContext<MockRuntimeContextBridge | null>(
  mockRuntimeBridge,
);

// Mock RuntimeContextProvider for tests
const MockRuntimeContextProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => (
  <MockRuntimeContext.Provider value={mockRuntimeBridge}>
    {children}
  </MockRuntimeContext.Provider>
);

// Export mock hooks that tests can use
export const useMockRuntimeApi = (): MockRuntimeApi => {
  const context = useContext(MockRuntimeContext);
  if (!context) {
    throw new Error('MockRuntimeContext not found');
  }
  return context.api;
};

export const renderWithProviders = (
  component: React.ReactElement,
  {
    kittyProtocolEnabled = true,
    settings = mockSettings,
    uiState = baseMockUiState,
  }: {
    kittyProtocolEnabled?: boolean;
    settings?: LoadedSettings;
    uiState?: Partial<UIState>;
  } = {},
): ReturnType<typeof render> =>
  render(
    <SettingsContext.Provider value={settings}>
      <UIStateContext.Provider value={uiState as UIState}>
        <MockRuntimeContextProvider>
          <KeypressProvider kittyProtocolEnabled={kittyProtocolEnabled}>
            {component}
          </KeypressProvider>
        </MockRuntimeContextProvider>
      </UIStateContext.Provider>
    </SettingsContext.Provider>,
  );

// Re-export renderHook from testing-library for convenience
export { testingLibraryRenderHook as renderHook };
