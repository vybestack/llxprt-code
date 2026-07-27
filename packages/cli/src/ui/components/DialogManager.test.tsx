/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import type { HydratedModel } from '@vybestack/llxprt-code-core';

// Mock the providers runtime barrel to avoid the broken dist dependency chain.
vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  parseEphemeralSettingValue: vi.fn(),
  applyCliSetArguments: vi.fn(() => ({ modelParams: {} })),
}));

vi.mock('@vybestack/llxprt-code-providers', () => ({
  registerAgentRuntimeFactories: vi.fn(),
}));

import { useModelDialogHandler } from './modelDialogHandler.js';

// --- Stateful runtime fake ---
interface FakeRuntimeState {
  activeModelResult: {
    nextModel: string;
    providerName: string;
    previousModel: string | null;
  };
  setProviderResult: {
    nextProvider: string;
    infoMessages: string[];
  };
  providerStatus: { providerName: string | null };
  setActiveModelShouldFail: boolean;
  setProviderShouldFail: boolean;
}

function createFakeRuntime(overrides: Partial<FakeRuntimeState> = {}) {
  const state: FakeRuntimeState = {
    activeModelResult: {
      nextModel: 'new-model',
      providerName: 'openai',
      previousModel: 'old-model',
    },
    setProviderResult: {
      nextProvider: 'anthropic',
      infoMessages: [],
    },
    providerStatus: { providerName: 'openai' },
    setActiveModelShouldFail: false,
    setProviderShouldFail: false,
    ...overrides,
  };

  return {
    state,
    setActiveModel: vi.fn(async () => {
      if (state.setActiveModelShouldFail) {
        throw new Error('setActiveModel failed');
      }
      return state.activeModelResult;
    }),
    setProvider: vi.fn(async () => {
      if (state.setProviderShouldFail) {
        throw new Error('setProvider failed');
      }
      return state.setProviderResult;
    }),
    getActiveProviderStatus: vi.fn(() => state.providerStatus),
  };
}

let fakeRuntime: ReturnType<typeof createFakeRuntime>;
let mockUiActions: {
  closeModelsDialog: ReturnType<typeof vi.fn>;
  openModelConfigDialog: ReturnType<typeof vi.fn>;
};
let mockAddItem: ReturnType<typeof vi.fn>;

vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => fakeRuntime,
}));

vi.mock('../contexts/UIActionsContext.js', () => ({
  useUIActions: () => mockUiActions,
}));

vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: () => ({
    constrainHeight: false,
    terminalHeight: 40,
    mainAreaWidth: 100,
    commandContext: {},
  }),
}));

function makeModel(provider: string, id: string): HydratedModel {
  return {
    id,
    name: id,
    provider,
  } as HydratedModel;
}

describe('useModelDialogHandler', () => {
  beforeEach(() => {
    mockAddItem = vi.fn();
    mockUiActions = {
      closeModelsDialog: vi.fn(),
      openModelConfigDialog: vi.fn(),
    };
    fakeRuntime = createFakeRuntime();
  });

  it('opens config dialog after successful same-provider model switch', async () => {
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        mockUiActions as never,
        'openai',
        {},
      ),
    );

    result.current(makeModel('openai', 'gpt-5'));

    await waitFor(() => {
      expect(mockUiActions.openModelConfigDialog).toHaveBeenCalledTimes(1);
    });
    expect(mockUiActions.closeModelsDialog).toHaveBeenCalledTimes(1);
  });

  it('opens config dialog after successful cross-provider model switch', async () => {
    const recordProviderSwitch = vi.fn();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        mockUiActions as never,
        'openai',
        { recordingIntegration: { recordProviderSwitch } },
      ),
    );

    result.current(makeModel('anthropic', 'claude-sonnet'));

    await waitFor(() => {
      expect(mockUiActions.openModelConfigDialog).toHaveBeenCalledTimes(1);
    });
    expect(mockUiActions.closeModelsDialog).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.setProvider).toHaveBeenCalledWith('anthropic');
    expect(recordProviderSwitch).toHaveBeenCalledWith(
      'anthropic',
      'claude-sonnet',
    );
  });

  it('does NOT open config dialog when setActiveModel fails', async () => {
    fakeRuntime = createFakeRuntime({ setActiveModelShouldFail: true });

    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        mockUiActions as never,
        'openai',
        {},
      ),
    );

    result.current(makeModel('openai', 'gpt-5'));

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
        expect.any(Number),
      );
    });
    expect(mockUiActions.openModelConfigDialog).not.toHaveBeenCalled();
  });

  it('STILL opens config dialog when addItem fails after successful switch', async () => {
    const recordProviderSwitch = vi.fn(() => {
      throw new Error('recording infrastructure down');
    });

    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        mockUiActions as never,
        'openai',
        { recordingIntegration: { recordProviderSwitch } },
      ),
    );

    // Same-provider switch succeeds, but addItem throws.
    // The dialog must still open because the switch itself succeeded.
    mockAddItem.mockImplementation(() => {
      throw new Error('addItem failed');
    });

    result.current(makeModel('openai', 'gpt-5'));

    await waitFor(() => {
      expect(mockUiActions.openModelConfigDialog).toHaveBeenCalledTimes(1);
    });
  });
});
