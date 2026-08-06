/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { renderHook, waitFor } from '../../test-utils/render.js';
import type { HydratedModel } from '@vybestack/llxprt-code-core';

// Mock the providers runtime barrel to avoid the broken dist dependency chain.
void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  parseEphemeralSettingValue: vi.fn(),
  applyCliSetArguments: vi.fn(() => ({ modelParams: {} })),
}));

void vi.mock('@vybestack/llxprt-code-providers', () => ({
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
      callSequence.push('setActiveModel');
      if (state.setActiveModelShouldFail) {
        throw new Error('setActiveModel failed');
      }
      return state.activeModelResult;
    }),
    setProvider: vi.fn(async () => {
      callSequence.push('setProvider');
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
let callSequence: string[];

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => fakeRuntime,
}));

void vi.mock('../contexts/UIActionsContext.js', () => ({
  useUIActions: () => mockUiActions,
}));

void vi.mock('../contexts/UIStateContext.js', () => ({
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
    callSequence = [];
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
    expect(fakeRuntime.setActiveModel).toHaveBeenCalledWith('gpt-5');
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
    expect(fakeRuntime.setActiveModel).toHaveBeenCalledWith('claude-sonnet');
    expect(callSequence).toStrictEqual(['setProvider', 'setActiveModel']);
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
      );
    });
    expect(mockUiActions.openModelConfigDialog).not.toHaveBeenCalled();
    expect(mockUiActions.closeModelsDialog).toHaveBeenCalledTimes(1);
  });

  it('does NOT open config dialog when cross-provider setProvider fails', async () => {
    fakeRuntime = createFakeRuntime({ setProviderShouldFail: true });

    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        mockUiActions as never,
        'openai',
        {},
      ),
    );

    result.current(makeModel('anthropic', 'claude-sonnet'));

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
    expect(mockUiActions.openModelConfigDialog).not.toHaveBeenCalled();
    expect(mockUiActions.closeModelsDialog).toHaveBeenCalledTimes(1);
  });

  it('does NOT open config dialog when cross-provider setProvider succeeds but setActiveModel fails', async () => {
    // Partial failure: the provider switch has already committed, but the
    // model switch fails. The error must be reported and the config dialog
    // must NOT open (switchSucceeded stays false).
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

    result.current(makeModel('anthropic', 'claude-sonnet'));

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
    expect(fakeRuntime.setProvider).toHaveBeenCalledTimes(1);
    expect(mockUiActions.openModelConfigDialog).not.toHaveBeenCalled();
    expect(mockUiActions.closeModelsDialog).toHaveBeenCalledTimes(1);
  });

  it('STILL opens config dialog when addItem fails after successful switch', async () => {
    const recordProviderSwitch = vi.fn(() => {
      throw new Error('recording infrastructure down');
    });

    // Same-provider switch succeeds, but addItem throws.
    // The dialog must still open because the switch itself succeeded.
    mockAddItem.mockImplementation(() => {
      throw new Error('addItem failed');
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

    result.current(makeModel('openai', 'gpt-5'));

    await waitFor(() => {
      expect(mockUiActions.openModelConfigDialog).toHaveBeenCalledTimes(1);
    });

    // Verify the error path was genuinely exercised: addItem WAS invoked
    // (and threw), and the dialog opened anyway.
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info' }),
    );
  });
});
