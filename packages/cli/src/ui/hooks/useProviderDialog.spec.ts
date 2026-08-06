/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so hook state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { MessageType } from '../types.js';
import { NO_ACTIVE_PROVIDER_ERROR_MESSAGE } from '@vybestack/llxprt-code-providers/runtime.js';
import type { AppAction } from '../reducers/appReducer.js';
import type { AgentProviderSwitchResult } from '@vybestack/llxprt-code-agents';

const useRuntimeApiMock = vi.fn();
const useAppDispatchMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: useRuntimeApiMock,
}));

vi.mock('../contexts/AppDispatchContext.js', () => ({
  useAppDispatch: useAppDispatchMock,
}));

// Import after mocks are set up
import { useProviderDialog } from './useProviderDialog.js';

type AddMessageCall = {
  type: MessageType;
  content: string;
  timestamp: Date;
};

interface RuntimeApiStub {
  listProviders: ReturnType<typeof vi.fn>;
  getActiveProviderName: ReturnType<typeof vi.fn>;
  setProvider: ReturnType<typeof vi.fn>;
  getActiveModelName: ReturnType<typeof vi.fn>;
}

function createRuntimeApiStub(overrides?: Partial<RuntimeApiStub>): {
  api: RuntimeApiStub;
  dispatch: React.Dispatch<AppAction>;
  addMessage: ReturnType<typeof vi.fn>;
} {
  const api: RuntimeApiStub = {
    listProviders: vi.fn(() => ['anthropic', 'openai', 'gemini']),
    getActiveProviderName: vi.fn(() => 'openai'),
    setProvider: vi.fn(),
    getActiveModelName: vi.fn(() => 'gpt-4'),
    ...overrides,
  };
  const dispatch = vi.fn();
  return { api, dispatch, addMessage: vi.fn() };
}

function renderProviderDialog(
  api: RuntimeApiStub,
  dispatch: React.Dispatch<AppAction>,
  addMessage: ReturnType<typeof vi.fn>,
) {
  useRuntimeApiMock.mockReturnValue(api);
  useAppDispatchMock.mockReturnValue(dispatch);

  return renderHook(() =>
    useProviderDialog({
      addMessage,
      appState: {
        openDialogs: {
          theme: false,
          auth: false,
          editor: false,
          provider: false,
          privacy: false,
          loadProfile: false,
          createProfile: false,
          profileList: false,
          profileDetail: false,
          profileEditor: false,
          tools: false,
          oauthCode: false,
        },
        warnings: new Map(),
        errors: { theme: null, auth: null, editor: null },
        needsRelogin: false,
        lastAddItemAction: null,
      },
    }),
  );
}

describe('useProviderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('openDialog with an active provider', () => {
    it('loads providers, records the active provider, and opens the dialog', () => {
      const { api, dispatch, addMessage } = createRuntimeApiStub();
      const { result } = renderProviderDialog(api, dispatch, addMessage);

      act(() => {
        result.current.openDialog();
      });

      expect(api.listProviders).toHaveBeenCalledTimes(1);
      expect(api.getActiveProviderName).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({
        type: 'OPEN_DIALOG',
        payload: 'provider',
      });
      expect(addMessage).not.toHaveBeenCalled();
    });
  });

  describe('openDialog with NO active provider (issue #2776)', () => {
    it('opens the selector and surfaces an empty current-provider selection', () => {
      const { api, dispatch, addMessage } = createRuntimeApiStub({
        // getActiveProviderName intentionally throws its documented
        // empty-state signal in this scenario.
        getActiveProviderName: vi.fn(() => {
          throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
        }),
      });
      const { result } = renderProviderDialog(api, dispatch, addMessage);

      act(() => {
        result.current.openDialog();
      });

      expect(api.listProviders).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({
        type: 'OPEN_DIALOG',
        payload: 'provider',
      });
      expect(result.current.providers).toStrictEqual([
        'anthropic',
        'openai',
        'gemini',
      ]);
      expect(result.current.currentProvider).toBe('');
      // The documented empty-state signal is not a failure.
      expect(addMessage).not.toHaveBeenCalled();
    });

    it('still reports an error when listing providers genuinely fails', () => {
      const { api, dispatch, addMessage } = createRuntimeApiStub({
        listProviders: vi.fn(() => {
          throw new Error('runtime not registered');
        }),
      });
      const { result } = renderProviderDialog(api, dispatch, addMessage);

      act(() => {
        result.current.openDialog();
      });

      expect(dispatch).not.toHaveBeenCalled();
      const calls = addMessage.mock.calls as unknown as AddMessageCall[][];
      expect(calls).toHaveLength(1);
      const message = calls[0][0];
      expect(message.type).toBe(MessageType.ERROR);
      expect(message.content).toContain('Failed to load providers');
      expect(message.content).toContain('runtime not registered');
    });
  });

  describe('handleSelect from the no-active-provider state (issue #2776)', () => {
    it('activates the selected provider normally', async () => {
      const switchResult: AgentProviderSwitchResult = {
        changed: true,
        previousProvider: '',
        nextProvider: 'anthropic',
        defaultModel: 'claude-opus',
        infoMessages: [],
      };
      const { api, dispatch, addMessage } = createRuntimeApiStub({
        // Before the switch there is no active provider.
        getActiveProviderName: vi.fn(() => {
          throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
        }),
        setProvider: vi.fn().mockResolvedValue(switchResult),
      });
      const { result } = renderProviderDialog(api, dispatch, addMessage);

      await act(async () => {
        await result.current.handleSelect('anthropic');
      });

      expect(api.setProvider).toHaveBeenCalledWith('anthropic');
      expect(result.current.currentProvider).toBe('anthropic');
      expect(dispatch).toHaveBeenCalledWith({
        type: 'CLOSE_DIALOG',
        payload: 'provider',
      });
      // The notification message should fire, not a switch error. With no
      // prior provider the message reports the "none" origin explicitly.
      const calls = addMessage.mock.calls as unknown as AddMessageCall[][];
      const switchMessages = calls
        .map((args) => args[0])
        .filter((m) => m.type === MessageType.INFO);
      expect(switchMessages).toContainEqual(
        expect.objectContaining({
          type: MessageType.INFO,
          content: 'Switched from none to anthropic',
        }),
      );
      const errors = calls
        .map((args) => args[0])
        .filter((m) => m.type === MessageType.ERROR);
      expect(errors).toStrictEqual([]);
    });

    it('reports an error when switching genuinely fails', async () => {
      const { api, dispatch, addMessage } = createRuntimeApiStub({
        setProvider: vi.fn().mockRejectedValue(new Error('network down')),
      });
      const { result } = renderProviderDialog(api, dispatch, addMessage);

      await act(async () => {
        await result.current.handleSelect('anthropic');
      });

      const calls = addMessage.mock.calls as unknown as AddMessageCall[][];
      const errors = calls
        .map((args) => args[0])
        .filter((m) => m.type === MessageType.ERROR);
      expect(errors).toHaveLength(1);
      expect(errors[0].content).toContain('Failed to switch provider');
      expect(errors[0].content).toContain('network down');
      expect(dispatch).toHaveBeenCalledWith({
        type: 'CLOSE_DIALOG',
        payload: 'provider',
      });
    });
  });

  describe('unexpected runtime failures during openDialog (issue #2776)', () => {
    it('reports the error when getActiveProviderName throws a non-empty-state error', () => {
      const { api, dispatch, addMessage } = createRuntimeApiStub({
        // A genuine runtime failure that is NOT the documented empty-state
        // signal must still surface the existing error message rather than
        // being silently treated as "no selection".
        getActiveProviderName: vi.fn(() => {
          throw new Error('runtime registry corrupted');
        }),
      });
      const { result } = renderProviderDialog(api, dispatch, addMessage);

      act(() => {
        result.current.openDialog();
      });

      expect(dispatch).not.toHaveBeenCalled();
      const calls = addMessage.mock.calls as unknown as AddMessageCall[][];
      expect(calls).toHaveLength(1);
      const message = calls[0][0];
      expect(message.type).toBe(MessageType.ERROR);
      expect(message.content).toContain('Failed to load providers');
      expect(message.content).toContain('runtime registry corrupted');
    });
  });
});
