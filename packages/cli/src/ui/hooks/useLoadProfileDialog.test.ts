/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so hook state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { createDeferred } from '../../test-utils/async.js';
import { MessageType } from '../types.js';
import type { AppAction, AppState } from '../reducers/appReducer.js';

const useRuntimeApiMock = vi.fn();
const useAppDispatchMock = vi.fn();

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: useRuntimeApiMock,
}));

void vi.mock('../contexts/AppDispatchContext.js', () => ({
  useAppDispatch: useAppDispatchMock,
}));

// Import after mocks are set up
import { useLoadProfileDialog } from './useLoadProfileDialog.js';

interface LoadProfileResult {
  infoMessages: string[];
  warnings: string[];
}

interface StoredProfile {
  result?: LoadProfileResult;
  failure?: Error | string;
}

/**
 * A stateful infrastructure double for the profile store backing the runtime
 * API. It behaves like a real store: listings come from the store's names,
 * and load outcomes depend on what is actually stored, so the hook's
 * classification and message routing are exercised against store semantics
 * rather than a literal the test asserts back.
 */
function createProfileRuntimeDouble(initialNames: string[] = []) {
  const savedNames = [...initialNames];
  const stored = new Map<string, StoredProfile>();
  return {
    /** The backing store, mutated by the test to change runtime behavior. */
    savedNames,
    stored,
    listSavedProfiles: vi.fn(async (): Promise<string[]> => [...savedNames]),
    loadProfileByName: vi.fn(
      async (name: string): Promise<LoadProfileResult> => {
        const entry = stored.get(name);
        if (entry?.failure !== undefined) {
          throw entry.failure;
        }
        if (!savedNames.includes(name)) {
          // Real store semantics: unknown names surface a lookup failure whose
          // text carries the 'not found' classification substring.
          throw new Error(`Profile record for ${name} not found in store`);
        }
        return { infoMessages: [], warnings: [], ...entry?.result };
      },
    ),
  };
}

type RuntimeDouble = ReturnType<typeof createProfileRuntimeDouble>;

interface AddMessageCall {
  type: MessageType;
  content: string;
  timestamp: Date;
}

function makeAppState(loadProfileOpen: boolean): AppState {
  return {
    openDialogs: {
      theme: false,
      auth: false,
      editor: false,
      provider: false,
      privacy: false,
      loadProfile: loadProfileOpen,
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
  };
}

function renderLoadProfileDialog(
  runtime: RuntimeDouble,
  appState: AppState,
): {
  result: { current: ReturnType<typeof useLoadProfileDialog> };
  dispatchCalls: AppAction[];
  addMessage: ReturnType<typeof vi.fn>;
} {
  const dispatchCalls: AppAction[] = [];
  const dispatch = (action: AppAction): void => {
    dispatchCalls.push(action);
  };
  const addMessage = vi.fn();
  useRuntimeApiMock.mockReturnValue(runtime);
  useAppDispatchMock.mockReturnValue(dispatch);
  const { result } = renderHook(() =>
    useLoadProfileDialog({ addMessage, appState }),
  );
  return { result, dispatchCalls, addMessage };
}

function errorMessages(addMessage: ReturnType<typeof vi.fn>): AddMessageCall[] {
  const calls = addMessage.mock.calls as unknown as AddMessageCall[][];
  return calls
    .map((args) => args[0])
    .filter((m) => m.type === MessageType.ERROR);
}

describe('useLoadProfileDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the dialog, loads profiles, and clears the loading flag', async () => {
    const runtime = createProfileRuntimeDouble(['zai', 'stepfun']);
    const { result, dispatchCalls } = renderLoadProfileDialog(
      runtime,
      makeAppState(false),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profiles).toStrictEqual([]);

    await act(async () => {
      await result.current.openDialog();
    });

    expect(dispatchCalls).toContainEqual({
      type: 'OPEN_DIALOG',
      payload: 'loadProfile',
    });
    // Assert the loaded outcome; the loading flag's true→false transition is
    // covered by the in-flight test below.
    expect(result.current.profiles).toStrictEqual(['zai', 'stepfun']);
  });

  it('keeps isLoading true while the listing is in flight', async () => {
    const runtime = createProfileRuntimeDouble(['zai']);
    const deferred = createDeferred<string[]>();
    runtime.listSavedProfiles.mockImplementation(() => deferred.promise);
    const { result } = renderLoadProfileDialog(runtime, makeAppState(false));

    let opened: Promise<void> = Promise.resolve();
    act(() => {
      opened = result.current.openDialog();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });
    expect(result.current.profiles).toStrictEqual([]);

    await act(async () => {
      deferred.resolve(['zai']);
      await opened;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profiles).toStrictEqual(['zai']);
  });

  it('reports the listing failure and auto-closes the dialog', async () => {
    const runtime = createProfileRuntimeDouble();
    runtime.listSavedProfiles.mockImplementation(() => {
      throw new Error('profile registry unreadable');
    });
    const { result, dispatchCalls, addMessage } = renderLoadProfileDialog(
      runtime,
      makeAppState(false),
    );

    await act(async () => {
      await result.current.openDialog();
    });

    const errors = errorMessages(addMessage);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.content).toContain('Failed to load profiles');
    expect(errors[0]?.content).toContain('profile registry unreadable');
    expect(dispatchCalls).toContainEqual({
      type: 'OPEN_DIALOG',
      payload: 'loadProfile',
    });
    expect(dispatchCalls).toContainEqual({
      type: 'CLOSE_DIALOG',
      payload: 'loadProfile',
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.profiles).toStrictEqual([]);
  });

  it('emits the loaded INFO message with info bullets and warnings, then closes', async () => {
    const runtime = createProfileRuntimeDouble(['zai']);
    runtime.stored.set('zai', {
      result: {
        infoMessages: ['restored 2 settings', 'rebound auth'],
        warnings: ['model pinned to old value', 'context limit lowered'],
      },
    });
    const { result, dispatchCalls, addMessage } = renderLoadProfileDialog(
      runtime,
      makeAppState(true),
    );

    await act(async () => {
      await result.current.handleSelect('zai');
    });

    const calls = addMessage.mock.calls as unknown as AddMessageCall[][];
    const contents = calls.map((args) => args[0]);
    expect(
      contents.find(
        (m) =>
          m.type === MessageType.INFO &&
          m.content.includes("Profile 'zai' loaded"),
      ),
    ).toBeDefined();
    // Info bullets are appended onto the loaded message, one per line.
    const loadedMessage = contents.find((m) =>
      m.content.includes("Profile 'zai' loaded"),
    );
    expect(loadedMessage?.content).toContain('- restored 2 settings');
    expect(loadedMessage?.content).toContain('- rebound auth');
    // Each warning becomes its own INFO message with the warning marker.
    const warningMessages = contents.filter((m) => m.content.startsWith('⚠ '));
    expect(warningMessages).toHaveLength(2);
    expect(warningMessages[0]?.content).toBe('⚠ model pinned to old value');
    expect(warningMessages[1]?.content).toBe('⚠ context limit lowered');
    expect(errorMessages(addMessage)).toStrictEqual([]);
    expect(dispatchCalls).toStrictEqual([
      { type: 'CLOSE_DIALOG', payload: 'loadProfile' },
    ]);
  });

  describe('handleSelect error classification', () => {
    type ClassificationCase = {
      description: string;
      failure: Error | string;
      expectedFragment: string;
    };

    const storedFailure = (
      runtime: RuntimeDouble,
      failure: Error | string,
    ): void => {
      runtime.savedNames.push('zai');
      runtime.stored.set('zai', { failure });
    };

    const cases: ClassificationCase[] = [
      {
        description: "'not found' maps to the not-found message",
        failure: new Error('no entry: profile record not found'),
        expectedFragment: "Profile 'zai' not found",
      },
      {
        description: "'corrupted' maps to the corrupted message",
        failure: new Error('profile file corrupted at offset 3'),
        expectedFragment: "Profile 'zai' is corrupted",
      },
      {
        description:
          "'missing required fields' maps to the invalid-profile message",
        failure: new Error('missing required fields: provider, model'),
        expectedFragment: "Profile 'zai' is invalid: missing required fields",
      },
      {
        description: 'an unrelated Error maps to the generic failure message',
        failure: new Error('disk exploded'),
        expectedFragment: 'Failed to load profile: disk exploded',
      },
      {
        description: 'a non-Error rejection maps to the generic message',
        failure: 'store returned garbage',
        expectedFragment: 'Failed to load profile: store returned garbage',
      },
    ];

    for (const testCase of cases) {
      it(`${testCase.description} and closes the dialog`, async () => {
        const runtime = createProfileRuntimeDouble();
        storedFailure(runtime, testCase.failure);
        const { result, dispatchCalls, addMessage } = renderLoadProfileDialog(
          runtime,
          makeAppState(true),
        );

        await act(async () => {
          await result.current.handleSelect('zai');
        });

        const errors = errorMessages(addMessage);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.content).toContain(testCase.expectedFragment);
        // The dialog always closes after a selection attempt, even on error.
        expect(dispatchCalls).toStrictEqual([
          { type: 'CLOSE_DIALOG', payload: 'loadProfile' },
        ]);
      });
    }
  });
});
