/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { DialogManager } from './DialogManager.js';
import { DialogProvider } from '../stores/dialog/DialogContext.js';
import { AppCommandsProvider } from '../contexts/AppCommandsContext.js';
import { createAppCommandBindings } from '../../test-utils/appCommandBindings.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { useTextBuffer } from './shared/text-buffer.js';

import { hasDialogRequest } from '../../test-utils/dialogStore.js';

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import {
  renderHook,
  waitFor,
  renderWithProviders,
  createMockSettings,
} from '../../test-utils/render.js';
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
import {
  createDialogStore,
  type DialogStore,
  type DialogRequest,
} from '../stores/dialog/dialogStore.js';

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
    getActiveProviderName: () => state.providerStatus.providerName,
  };
}

let fakeRuntime: ReturnType<typeof createFakeRuntime>;
let mockAddItem: ReturnType<typeof vi.fn>;
let callSequence: string[];

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => fakeRuntime,
}));

function makeModel(provider: string, id: string): HydratedModel {
  return {
    id,
    name: id,
    provider,
  } as HydratedModel;
}

/** Store seeded the way the /models flow leaves it: models dialog open. */
function createSeededStore(): DialogStore {
  const store = createDialogStore();
  store.commands.openDialog({ kind: 'models', payload: {} });
  return store;
}

describe('useModelDialogHandler', () => {
  beforeEach(() => {
    mockAddItem = vi.fn();
    callSequence = [];
    fakeRuntime = createFakeRuntime();
  });

  it('opens config dialog after successful same-provider model switch', async () => {
    const store = createSeededStore();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        store,
        'openai',
        {},
      ),
    );

    result.current(makeModel('openai', 'gpt-5'));

    await waitFor(() => {
      expect(hasDialogRequest(store, 'modelConfig')).toBe(true);
    });
    expect(fakeRuntime.setActiveModel).toHaveBeenCalledWith('gpt-5');
    expect(hasDialogRequest(store, 'models')).toBe(false);
  });

  it('opens config dialog after successful cross-provider model switch', async () => {
    const recordProviderSwitch = vi.fn();
    const store = createSeededStore();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        store,
        'openai',
        { recordingIntegration: { recordProviderSwitch } },
      ),
    );

    result.current(makeModel('anthropic', 'claude-sonnet'));

    await waitFor(() => {
      expect(hasDialogRequest(store, 'modelConfig')).toBe(true);
    });
    expect(hasDialogRequest(store, 'models')).toBe(false);
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
    const store = createSeededStore();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        store,
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
    expect(hasDialogRequest(store, 'modelConfig')).toBe(false);
    expect(hasDialogRequest(store, 'models')).toBe(false);
  });

  it('does NOT open config dialog when cross-provider setProvider fails', async () => {
    fakeRuntime = createFakeRuntime({ setProviderShouldFail: true });
    const store = createSeededStore();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        store,
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
    expect(hasDialogRequest(store, 'modelConfig')).toBe(false);
    expect(hasDialogRequest(store, 'models')).toBe(false);
  });

  it('does NOT open config dialog when cross-provider setProvider succeeds but setActiveModel fails', async () => {
    // Partial failure: the provider switch has already committed, but the
    // model switch fails. The error must be reported and the config dialog
    // must NOT open (switchSucceeded stays false).
    fakeRuntime = createFakeRuntime({ setActiveModelShouldFail: true });
    const store = createSeededStore();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        store,
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
    expect(hasDialogRequest(store, 'modelConfig')).toBe(false);
    expect(hasDialogRequest(store, 'models')).toBe(false);
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

    const store = createSeededStore();
    const { result } = renderHook(() =>
      useModelDialogHandler(
        fakeRuntime as never,
        mockAddItem,
        store,
        'openai',
        { recordingIntegration: { recordProviderSwitch } },
      ),
    );

    result.current(makeModel('openai', 'gpt-5'));

    await waitFor(() => {
      expect(hasDialogRequest(store, 'modelConfig')).toBe(true);
    });

    // Verify the error path was genuinely exercised: addItem WAS invoked
    // (and threw), and the dialog opened anyway.
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info' }),
    );
  });
});

const FOLDER_TRUST_MARKER = 'Do you trust this folder?';
const PROVIDER_MARKER = 'Select Provider (';
const LOAD_PROFILE_MARKER = 'Select Profile (';
const CREATE_PROFILE_MARKER = 'Create New Profile - Step 1 of 6';
const TOOLS_MARKER = 'Select a tool to disable:';

function DialogManagerHarness({ store }: { store: DialogStore }) {
  const buffer = useTextBuffer({
    viewport: { width: 100, height: 40 },
    isValidPath: () => false,
  });
  const bindings = createAppCommandBindings('DialogManager', {
    buffer,
    commandContext: createMockCommandContext(),
    inputHistory: [],
  });
  const standIns = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  const commands = new Proxy(bindings, {
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      let standIn = standIns.get(property);
      if (!standIn) {
        standIn = vi.fn(() => {
          throw new Error('Unexpected dispatch: ' + String(property));
        });
        standIns.set(property, standIn);
      }
      return standIn;
    },
  });
  const config = buildSlashCommandRuntime(
    new Config({
      sessionId: 'dialog-dispatch',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
    }),
  );
  return (
    <AppCommandsProvider value={commands}>
      <DialogProvider store={store}>
        <DialogManager config={config} settings={createMockSettings({})} />
      </DialogProvider>
    </AppCommandsProvider>
  );
}

function renderDialogManager(requests: DialogRequest[]): string {
  const store = createDialogStore();
  for (const request of requests) store.commands.openDialog(request);
  const view = renderWithProviders(<DialogManagerHarness store={store} />, {
    terminal: {
      terminalWidth: 100,
      terminalHeight: 40,
      mainAreaWidth: 100,
      constrainHeight: false,
    },
    settingsProfile: {
      providerOptions: ['ollama'],
      profiles: ['alpha', 'beta'],
      toolsDialogTools: [
        {
          name: 'shell',
          displayName: 'Shell',
          source: 'builtin',
          enabled: true,
        },
      ],
      toolsDialogDisabledTools: [],
    },
  });
  const frame = view.lastFrame() ?? '';
  view.unmount();
  return frame;
}

describe('DialogManager render dispatch', () => {
  it('renders the folder-trust dialog when only its request is open', () => {
    const frame = renderDialogManager([{ kind: 'folderTrust', payload: {} }]);
    expect(frame).toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the provider dialog when only its request is open', () => {
    const frame = renderDialogManager([{ kind: 'provider', payload: {} }]);
    expect(frame).toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the load-profile dialog when only its request is open', () => {
    const frame = renderDialogManager([{ kind: 'loadProfile', payload: {} }]);
    expect(frame).toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the profile-create wizard when only its request is open', () => {
    const frame = renderDialogManager([{ kind: 'createProfile', payload: {} }]);
    expect(frame).toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the tools dialog when only its request is open', () => {
    const frame = renderDialogManager([
      { kind: 'tools', payload: { action: 'disable' } },
    ]);
    expect(frame).toContain(TOOLS_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
  });

  it('renders exactly the folder-trust dialog when early, first-half, and second-half requests are all open', () => {
    // Early dialogs win: folder trust beats provider (first half) and tools
    // (second half).
    const frame = renderDialogManager([
      { kind: 'folderTrust', payload: {} },
      { kind: 'provider', payload: {} },
      { kind: 'tools', payload: { action: 'disable' } },
    ]);
    expect(frame).toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders exactly the provider dialog when first-half and second-half requests are both open', () => {
    // First half beats second half: provider beats tools.
    const frame = renderDialogManager([
      { kind: 'provider', payload: {} },
      { kind: 'tools', payload: { action: 'disable' } },
    ]);
    expect(frame).toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders exactly the load-profile dialog when both profile requests are open', () => {
    // The store priority gives load precedence over create.
    const frame = renderDialogManager([
      { kind: 'loadProfile', payload: {} },
      { kind: 'createProfile', payload: {} },
    ]);
    expect(frame).toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
  });
});
