/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import {
  renderHook,
  waitFor,
  createMockSettings,
  renderWithProviders,
} from '../../test-utils/render.js';
import type { HydratedModel } from '@vybestack/llxprt-code-core';

// Enable React's act() environment so component state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
import { DialogManager } from './DialogManager.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

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
  activeProviderName: string | null;
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
    activeProviderName: 'openai',
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
    getActiveProviderName: vi.fn(() => state.activeProviderName),
  };
}

let fakeRuntime: ReturnType<typeof createFakeRuntime>;
let mockUiActions: {
  closeModelsDialog: ReturnType<typeof vi.fn>;
  openModelConfigDialog: ReturnType<typeof vi.fn>;
};
let mockAddItem: ReturnType<typeof vi.fn>;
let callSequence: string[];
// Per-test UIState for the render-dispatch tests. The vi.mock factory is
// hoisted above this declaration, so it must dereference the holder at CALL
// time, never at factory-definition time.
let mockUiState: Record<string, unknown>;

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => fakeRuntime,
}));

void vi.mock('../contexts/UIActionsContext.js', () => ({
  useUIActions: () => mockUiActions,
}));

void vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: () => mockUiState,
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
    mockUiState = {
      constrainHeight: false,
      terminalHeight: 40,
      mainAreaWidth: 100,
      commandContext: {},
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

// ---------------------------------------------------------------------------
// Render dispatch: which dialog frame the real DialogManager paints.
// ---------------------------------------------------------------------------

// Distinctive strings each dialog paints, verified against the components.
const FOLDER_TRUST_MARKER = 'Do you trust this folder?';
const PROVIDER_MARKER = 'Select Provider (';
const LOAD_PROFILE_MARKER = 'Select Profile (';
const CREATE_PROFILE_MARKER = 'Create New Profile - Step 1 of 6';
const TOOLS_MARKER = 'Select a tool to disable:';

/**
 * A UIActions stand-in for render tests. Every action property any dialog
 * branch may reference resolves to a fresh vi.fn(); nothing here drives
 * behavior, the dialogs under test never call them during a static render.
 */
function makeRenderUiActions(): Record<string, ReturnType<typeof vi.fn>> {
  const store: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = vi.fn();
      }
      return target[prop];
    },
  });
}

/**
 * Baseline UIState with every dialog flag closed plus the data fields the
 * rendered dialogs consume. Per-test flag overrides replace entries.
 */
function makeDialogManagerUiState(
  flagOverrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    constrainHeight: false,
    terminalHeight: 40,
    mainAreaWidth: 100,
    commandContext: {},
    // Early tier.
    showWorkspaceMigrationDialog: false,
    shouldShowIdePrompt: false,
    isFolderTrustDialogOpen: false,
    isWelcomeDialogOpen: false,
    confirmationRequest: null,
    confirmUpdateLlxprtExtensionRequests: [],
    // First half.
    isThemeDialogOpen: false,
    isSettingsDialogOpen: false,
    isAuthDialogOpen: false,
    isOAuthCodeDialogOpen: false,
    isEditorDialogOpen: false,
    isProviderDialogOpen: false,
    // Profile tier.
    isLoadProfileDialogOpen: false,
    isCreateProfileDialogOpen: false,
    isProfileListDialogOpen: false,
    isProfileDetailDialogOpen: false,
    isProfileEditorDialogOpen: false,
    // Second half.
    isToolsDialogOpen: false,
    showPrivacyNotice: false,
    isPermissionsDialogOpen: false,
    isLoggingDialogOpen: false,
    isSubagentDialogOpen: false,
    isModelsDialogOpen: false,
    isSessionBrowserDialogOpen: false,
    isModelConfigDialogOpen: false,
    isPoliciesDialogOpen: false,
    // Data consumed by the dialogs these tests render.
    providerOptions: ['ollama'],
    selectedProvider: undefined,
    profiles: ['alpha', 'beta'],
    toolsDialogTools: [{ name: 'shell', displayName: 'Shell' }],
    toolsDialogAction: 'disable',
    toolsDialogDisabledTools: [],
    ...flagOverrides,
  };
}

function renderDialogManager(flags: Record<string, unknown>): string {
  mockUiState = makeDialogManagerUiState(flags);
  mockUiActions = makeRenderUiActions() as typeof mockUiActions;
  const configStub = {
    getWorkingDir: () => '/workspace/project',
  } as CliUiRuntime;
  const { lastFrame } = renderWithProviders(
    <KeypressProvider>
      <DialogManager
        addItem={mockAddItem}
        terminalWidth={100}
        config={configStub}
        settings={createMockSettings({})}
      />
    </KeypressProvider>,
  );
  return lastFrame() ?? '';
}

describe('DialogManager render dispatch', () => {
  it('renders the folder-trust dialog when only its flag is set', () => {
    const frame = renderDialogManager({ isFolderTrustDialogOpen: true });
    expect(frame).toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the provider dialog when only its flag is set', () => {
    const frame = renderDialogManager({ isProviderDialogOpen: true });
    expect(frame).toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the load-profile dialog when only its flag is set', () => {
    const frame = renderDialogManager({ isLoadProfileDialogOpen: true });
    expect(frame).toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the profile-create wizard when only its flag is set', () => {
    const frame = renderDialogManager({ isCreateProfileDialogOpen: true });
    expect(frame).toContain(CREATE_PROFILE_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders the tools dialog when only its flag is set', () => {
    const frame = renderDialogManager({ isToolsDialogOpen: true });
    expect(frame).toContain(TOOLS_MARKER);
    expect(frame).not.toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
  });

  it('renders exactly the folder-trust dialog when early, first-half, and second-half flags are all set', () => {
    // Early dialogs win: folder trust beats provider (first half) and tools
    // (second half).
    const frame = renderDialogManager({
      isFolderTrustDialogOpen: true,
      isProviderDialogOpen: true,
      isToolsDialogOpen: true,
    });
    expect(frame).toContain(FOLDER_TRUST_MARKER);
    expect(frame).not.toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders exactly the provider dialog when first-half and second-half flags are both set', () => {
    // First half beats second half: provider beats tools.
    const frame = renderDialogManager({
      isProviderDialogOpen: true,
      isToolsDialogOpen: true,
    });
    expect(frame).toContain(PROVIDER_MARKER);
    expect(frame).not.toContain(TOOLS_MARKER);
  });

  it('renders exactly the load-profile dialog when both profile flags are set', () => {
    // Inside the profile tier, load beats create (declaration order in
    // renderProfileDialogs).
    const frame = renderDialogManager({
      isLoadProfileDialogOpen: true,
      isCreateProfileDialogOpen: true,
    });
    expect(frame).toContain(LOAD_PROFILE_MARKER);
    expect(frame).not.toContain(CREATE_PROFILE_MARKER);
  });
});
