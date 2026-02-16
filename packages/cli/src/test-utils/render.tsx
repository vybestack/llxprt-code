/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render as inkRender } from 'ink-testing-library';
import React, { act, createContext, useContext } from 'react';

import { LoadedSettings, type Settings } from '../config/settings.js';
import { KeypressProvider } from '../ui/contexts/KeypressContext.js';
import { SettingsContext } from '../ui/contexts/SettingsContext.js';
import { UIStateContext, type UIState } from '../ui/contexts/UIStateContext.js';
import { StreamingState } from '../ui/types.js';

// Wrapper around ink-testing-library's render that ensures act() is called
// This fixes React 18+ warnings about state updates not being wrapped in act()
export const render = (
  tree: React.ReactElement,
): ReturnType<typeof inkRender> => {
  let renderResult: ReturnType<typeof inkRender> =
    undefined as unknown as ReturnType<typeof inkRender>;
  act(() => {
    renderResult = inkRender(tree);
  });

  const originalUnmount = renderResult.unmount;
  const originalRerender = renderResult.rerender;

  return {
    ...renderResult,
    unmount: () => {
      act(() => {
        originalUnmount();
      });
    },
    rerender: (newTree: React.ReactElement) => {
      act(() => {
        originalRerender(newTree);
      });
    },
  };
};

const mockSettings = new LoadedSettings(
  { path: '', settings: {} },
  { path: '', settings: {} },
  { path: '', settings: { ui: { useAlternateBuffer: true } } },
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
    settings = mockSettings,
    uiState = baseMockUiState,
  }: {
    settings?: LoadedSettings;
    uiState?: Partial<UIState>;
  } = {},
): ReturnType<typeof render> =>
  render(
    <SettingsContext.Provider value={settings}>
      <UIStateContext.Provider value={uiState as UIState}>
        <MockRuntimeContextProvider>
          <KeypressProvider>{component}</KeypressProvider>
        </MockRuntimeContextProvider>
      </UIStateContext.Provider>
    </SettingsContext.Provider>,
  );

interface RenderHookResult<T> {
  result: { current: T };
  rerender: (props?: unknown) => void;
  unmount: () => void;
}

interface RenderHookOptions<P> {
  initialProps?: P;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

export function renderHook<T, P = undefined>(
  hook: (props: P) => T,
  options?: RenderHookOptions<P>,
): RenderHookResult<T> {
  const result = { current: undefined as T };

  function TestComponent({ hookProps }: { hookProps: P }) {
    result.current = hook(hookProps);
    return null;
  }

  const Wrapper = options?.wrapper ?? React.Fragment;

  let root: ReturnType<typeof render>;
  act(() => {
    root = render(
      React.createElement(
        Wrapper,
        null,
        React.createElement(TestComponent, {
          hookProps: options?.initialProps as P,
        }),
      ),
    );
  });

  return {
    result,
    rerender: (props?: unknown) => {
      act(() => {
        root.rerender(
          React.createElement(
            Wrapper,
            null,
            React.createElement(TestComponent, { hookProps: props as P }),
          ),
        );
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

export function cleanup(): void {
  // ink-testing-library manages its own cleanup
  // This is a no-op for compatibility
}

// Simple waitFor implementation - polls until callback succeeds or timeout
export const waitFor = async (
  callback: () => void | Promise<void>,
  options?: { timeout?: number; interval?: number },
): Promise<void> => {
  const timeout = options?.timeout ?? 1000;
  const interval = options?.interval ?? 50;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      await callback();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  // Final attempt - let it throw if it fails
  await callback();
};
