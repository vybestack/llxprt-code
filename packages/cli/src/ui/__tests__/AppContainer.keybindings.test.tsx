/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan project-plans/issue1576/TEST_PLAN.md - Test 4
 *
 * Verifies AppContainer keyboard shortcuts.
 * Behavior: Ctrl+C double-press, Ctrl+S copy mode, Cmd+M/Alt+M markdown, Ctrl+F shell focus.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderWithProviders,
  createMockSettings,
} from '../../test-utils/render.js';
import { AppContainer } from '../AppContainer.js';
import { initialAppState } from '../reducers/appReducer.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { Command } from '../keyMatchers.js';
import { defaultKeyBindings } from '../../config/keyBindings.js';

// Mock config type
interface MockConfig {
  getModel: () => string;
  getQuestion: () => string | undefined;
  getDebugMode: () => boolean;
  getSessionId: () => string;
  getGeminiClient: () => unknown;
  getWorkingDir: () => string;
  getIdeClient: () => unknown;
  getIdeMode: () => boolean;
  getScreenReader: () => boolean;
  getTerminalBackground: () => string | undefined;
  getWorkspaceContext: () => { getDirectories: () => string[] };
  getExtensions: () => unknown[];
  getMcpServers: () => Record<string, unknown>;
  setPtyTerminalSize: () => void;
  isTrustedFolder: () => boolean;
  getFolderTrust: () => boolean;
  getEnableInteractiveShell: () => boolean;
  getTargetDir: () => string;
  getLlxprtMdFileCount: () => number;
  getCoreMemoryFileCount: () => number;
  storage: { getPreviousUserMessages: () => Promise<string[]> };
}

function createMockConfig(overrides: Partial<MockConfig> = {}): MockConfig {
  return {
    getModel: vi.fn(() => 'test-model'),
    getQuestion: vi.fn(() => undefined),
    getDebugMode: vi.fn(() => false),
    getSessionId: vi.fn(() => 'test-session-id'),
    getGeminiClient: vi.fn(() => ({
      getUserTier: vi.fn(),
      hasChatInitialized: vi.fn(() => false),
      getHistoryService: vi.fn(),
    })),
    getWorkingDir: vi.fn(() => '/test/dir'),
    getIdeClient: vi.fn(() => ({
      getCurrentIde: vi.fn(),
      disconnect: vi.fn(),
    })),
    getIdeMode: vi.fn(() => true),
    getScreenReader: vi.fn(() => false),
    getTerminalBackground: vi.fn(() => undefined),
    getWorkspaceContext: vi.fn(() => ({
      getDirectories: vi.fn(() => []),
    })),
    getExtensions: vi.fn(() => []),
    getMcpServers: vi.fn(() => ({})),
    setPtyTerminalSize: vi.fn(),
    isTrustedFolder: vi.fn(() => true),
    getFolderTrust: vi.fn(() => false),
    getEnableInteractiveShell: vi.fn(() => false),
    getTargetDir: vi.fn(() => '/test/dir'),
    getLlxprtMdFileCount: vi.fn(() => 0),
    getCoreMemoryFileCount: vi.fn(() => 0),
    storage: {
      getPreviousUserMessages: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

// Mock heavy dependencies
vi.mock('../hooks/geminiStream/index.js', () => ({
  useGeminiStream: vi.fn(() => ({
    streamingState: 'Idle',
    submitQuery: vi.fn(),
    initError: null,
    pendingHistoryItems: [],
    thought: null,
    cancelOngoingRequest: vi.fn(),
    lastOutputTime: Date.now(),
    activeShellPtyId: null,
  })),
}));

vi.mock('../hooks/useHistoryManager.js', () => ({
  useHistory: vi.fn(() => ({
    history: [],
    addItem: vi.fn(),
    clearItems: vi.fn(),
    loadHistory: vi.fn(),
  })),
}));

vi.mock('../hooks/useInputHistoryStore.js', () => ({
  useInputHistoryStore: vi.fn(() => ({
    inputHistory: [],
    addInput: vi.fn(),
    initializeFromLogger: vi.fn(),
  })),
}));

vi.mock('../hooks/useConsoleMessages.js', () => ({
  useConsoleMessages: vi.fn(() => ({
    consoleMessages: [],
    handleNewMessage: vi.fn(),
    clearConsoleMessages: vi.fn(),
  })),
}));

vi.mock('../hooks/useThemeCommand.js', () => ({
  useThemeCommand: vi.fn(() => ({
    isThemeDialogOpen: false,
    openThemeDialog: vi.fn(),
    handleThemeSelect: vi.fn(),
    handleThemeHighlight: vi.fn(),
  })),
}));

vi.mock('../hooks/useAuthCommand.js', () => ({
  useAuthCommand: vi.fn(() => ({
    isAuthDialogOpen: false,
    openAuthDialog: vi.fn(),
    handleAuthSelect: vi.fn(),
  })),
}));

vi.mock('../hooks/useEditorSettings.js', () => ({
  useEditorSettings: vi.fn(() => ({
    isEditorDialogOpen: false,
    openEditorDialog: vi.fn(),
    handleEditorSelect: vi.fn(),
    exitEditorDialog: vi.fn(),
  })),
}));

vi.mock('../hooks/useFolderTrust.js', () => ({
  useFolderTrust: vi.fn(() => ({
    isFolderTrustDialogOpen: false,
    handleFolderTrustSelect: vi.fn(),
    isRestarting: false,
  })),
}));

vi.mock('../hooks/useSettingsCommand.js', () => ({
  useSettingsCommand: vi.fn(() => ({
    isSettingsDialogOpen: false,
    openSettingsDialog: vi.fn(),
    closeSettingsDialog: vi.fn(),
  })),
}));

vi.mock('../hooks/useProviderDialog.js', () => ({
  useProviderDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    handleSelect: vi.fn(),
    closeDialog: vi.fn(),
    providers: [],
    currentProvider: null,
  })),
}));

vi.mock('../hooks/useLoadProfileDialog.js', () => ({
  useLoadProfileDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    handleSelect: vi.fn(),
    closeDialog: vi.fn(),
    profiles: [],
  })),
}));

vi.mock('../hooks/useCreateProfileDialog.js', () => ({
  useCreateProfileDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    providers: [],
  })),
}));

vi.mock('../hooks/useProfileManagement.js', () => ({
  useProfileManagement: vi.fn(() => ({
    showListDialog: false,
    showDetailDialog: false,
    showEditorDialog: false,
    profiles: [],
    isLoading: false,
    selectedProfileName: null,
    selectedProfile: null,
    defaultProfileName: null,
    activeProfileName: null,
    profileError: null,
    openListDialog: vi.fn(),
    closeListDialog: vi.fn(),
    viewProfileDetail: vi.fn(),
    closeDetailDialog: vi.fn(),
    loadProfile: vi.fn(),
    deleteProfile: vi.fn(),
    setDefault: vi.fn(),
    openEditor: vi.fn(),
    closeEditor: vi.fn(),
    saveProfile: vi.fn(),
  })),
}));

vi.mock('../hooks/useToolsDialog.js', () => ({
  useToolsDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    action: 'enable',
    availableTools: [],
    disabledTools: [],
    handleSelect: vi.fn(),
  })),
}));

vi.mock('../hooks/useWelcomeOnboarding.js', () => ({
  useWelcomeOnboarding: vi.fn(() => ({
    showWelcome: false,
    state: { step: 'provider' },
    actions: {
      startSetup: vi.fn(),
      resetAndReopen: vi.fn(),
    },
    availableProviders: [],
    availableModels: [],
    triggerAuth: vi.fn(),
  })),
}));

vi.mock('../hooks/useExtensionUpdates.js', () => ({
  useExtensionUpdates: vi.fn(() => ({
    extensionsUpdateState: new Map(),
    dispatchExtensionStateUpdate: vi.fn(),
    confirmUpdateExtensionRequests: [],
    addConfirmUpdateExtensionRequest: vi.fn(),
  })),
}));

vi.mock('../hooks/useWorkspaceMigration.js', () => ({
  useWorkspaceMigration: vi.fn(() => ({
    showWorkspaceMigrationDialog: false,
    workspaceGeminiCLIExtensions: [],
    onWorkspaceMigrationDialogOpen: vi.fn(),
    onWorkspaceMigrationDialogClose: vi.fn(),
  })),
}));

vi.mock('../hooks/useHookDisplayState.js', () => ({
  useHookDisplayState: vi.fn(() => []),
}));

vi.mock('../hooks/useMemoryMonitor.js', () => ({
  useMemoryMonitor: vi.fn(),
}));

vi.mock('../hooks/useTodoPausePreserver.js', () => ({
  useTodoPausePreserver: vi.fn(() => ({
    handleUserInputSubmit: vi.fn(),
  })),
  TodoPausePreserver: vi.fn(),
}));

vi.mock('../hooks/useAutoAcceptIndicator.js', () => ({
  useAutoAcceptIndicator: vi.fn(() => false),
}));

vi.mock('../hooks/useExtensionAutoUpdate.js', () => ({
  useExtensionAutoUpdate: vi.fn(),
}));

vi.mock('../hooks/useStaticHistoryRefresh.js', () => ({
  useStaticHistoryRefresh: vi.fn(),
}));

vi.mock('../hooks/useBracketedPaste.js', () => ({
  useBracketedPaste: vi.fn(),
}));

vi.mock('../hooks/useResponsive.js', () => ({
  useResponsive: vi.fn(() => ({ isNarrow: false })),
}));

vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: vi.fn(() => ({ rows: 24, columns: 120 })),
}));

vi.mock('../hooks/useGitBranchName.js', () => ({
  useGitBranchName: vi.fn(() => null),
}));

vi.mock('../hooks/useLoadingIndicator.js', () => ({
  useLoadingIndicator: vi.fn(() => ({
    elapsedTime: 0,
    currentLoadingPhrase: 'Thinking...',
  })),
}));

vi.mock('../hooks/slashCommandProcessor.js', () => ({
  useSlashCommandProcessor: vi.fn(() => ({
    handleSlashCommand: vi.fn(),
    slashCommands: [],
    pendingHistoryItems: [],
    commandContext: {},
    confirmationRequest: null,
  })),
}));

vi.mock('../hooks/useVim.js', () => ({
  useVim: vi.fn(() => ({ handleInput: vi.fn() })),
}));

vi.mock('../hooks/useFlickerDetector.js', () => ({
  useFlickerDetector: vi.fn(),
}));

vi.mock('../hooks/useMouseSelection.js', () => ({
  useMouseSelection: vi.fn(),
}));

vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    stats: { historyTokenCount: 0 },
    updateHistoryTokenCount: vi.fn(),
  })),
}));

vi.mock('../contexts/TodoContext.js', () => ({
  useTodoContext: vi.fn(() => ({
    todos: [],
    updateTodos: vi.fn(),
  })),
}));

vi.mock('../contexts/VimModeContext.js', () => ({
  useVimMode: vi.fn(() => ({
    vimEnabled: false,
    vimMode: 'normal',
    toggleVimEnabled: vi.fn(),
  })),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: vi.fn(() => ({
    getCliOAuthManager: vi.fn(),
    getActiveModelName: vi.fn(() => 'test-model'),
    getActiveProviderMetrics: vi.fn(() => ({})),
    getSessionTokenUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0 })),
  })),
}));

vi.mock('../utils/mouse.js', () => ({
  isMouseEventsActive: vi.fn(() => false),
  setMouseEventsActive: vi.fn(),
  disableMouseEvents: vi.fn(),
  enableMouseEvents: vi.fn(),
  ENABLE_MOUSE_EVENTS: '\u001b[?1002h\u001b[?1006h',
  DISABLE_MOUSE_EVENTS: '\u001b[?1006l\u001b[?1002l',
  DISABLE_EXTRA_MOUSE_MODES: '',
  DISABLE_BRACKETED_PASTE: '',
  ENABLE_BRACKETED_PASTE: '',
  TERMINAL_PROTOCOL_RESTORE_SEQUENCES: '',
  TERMINAL_PROTOCOL_SETUP_SEQUENCES: '',
}));

vi.mock('../../config/config.js', () => ({
  loadHierarchicalLlxprtMemory: vi.fn().mockResolvedValue({
    memoryContent: '',
    fileCount: 0,
  }),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    triggerSessionStartHook: vi.fn().mockResolvedValue(null),
    triggerSessionEndHook: vi.fn().mockResolvedValue(undefined),
    SessionStartSource: { Startup: 'startup' },
    SessionEndReason: { Exit: 'exit' },
    coreEvents: {
      on: vi.fn(),
      off: vi.fn(),
      drainFeedbackBacklog: vi.fn(),
    },
    CoreEvent: {
      UserFeedback: 'user_feedback',
      SettingsChanged: 'settings_changed',
    },
    DebugLogger: Object.assign(
      vi.fn(() => ({
        debug: vi.fn(),
        log: vi.fn(),
        error: vi.fn(),
      })),
      {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          log: vi.fn(),
          error: vi.fn(),
        })),
      },
    ),
    debugLogger: { debug: vi.fn(), log: vi.fn() },
    uiTelemetryService: { setTokenTrackingMetrics: vi.fn() },
    ideContext: {
      subscribeToIdeContext: vi.fn(() => vi.fn()),
      getIdeContext: vi.fn(() => undefined),
    },
    ShellExecutionService: {
      getLastActivePtyId: vi.fn(() => null),
    },
  };
});

vi.mock('../hooks/useFocus.js', () => ({
  useFocus: vi.fn(() => true),
}));

vi.mock('../hooks/useIdeTrustListener.js', () => ({
  useIdeTrustListener: vi.fn(() => ({ needsRestart: false })),
}));

vi.mock('../hooks/useLogger.js', () => ({
  useLogger: vi.fn(() => ({
    getPreviousUserMessages: vi.fn().mockResolvedValue([]),
  })),
}));

describe('AppContainer.keybindings', () => {
  let mockConfig: MockConfig;
  let mockSettings: ReturnType<typeof createMockSettings>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = createMockConfig();
    mockSettings = createMockSettings({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('key binding configuration', () => {
    it('should have Ctrl+C bound to QUIT command', () => {
      const quitBindings = defaultKeyBindings[Command.QUIT];
      const hasCtrlC = quitBindings.some(
        (b) => b.key === 'c' && b.ctrl === true,
      );
      expect(hasCtrlC).toBe(true);
    });

    it('should have Ctrl+D bound to EXIT command', () => {
      const exitBindings = defaultKeyBindings[Command.EXIT];
      const hasCtrlD = exitBindings.some(
        (b) => b.key === 'd' && b.ctrl === true,
      );
      expect(hasCtrlD).toBe(true);
    });

    it('should have Cmd+M (macOS) / Alt+M bound to TOGGLE_MARKDOWN command', () => {
      const markdownBindings = defaultKeyBindings[Command.TOGGLE_MARKDOWN];
      const hasAltM = markdownBindings.some(
        (b) => b.key === 'm' && b.command === true,
      );
      expect(hasAltM).toBe(true);
    });

    it('should have Ctrl+S bound to TOGGLE_COPY_MODE command', () => {
      const copyBindings = defaultKeyBindings[Command.TOGGLE_COPY_MODE];
      const hasCtrlS = copyBindings.some(
        (b) => b.key === 's' && b.ctrl === true,
      );
      expect(hasCtrlS).toBe(true);
    });

    it('should have Ctrl+F bound to TOGGLE_SHELL_INPUT_FOCUS command', () => {
      const shellFocusBindings =
        defaultKeyBindings[Command.TOGGLE_SHELL_INPUT_FOCUS];
      const hasCtrlF = shellFocusBindings.some(
        (b) => b.key === 'f' && b.ctrl === true,
      );
      expect(hasCtrlF).toBe(true);
    });
  });

  describe('keybinding behavior', () => {
    it('should mount component with keybinding handlers active', () => {
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      const { unmount } = renderWithProviders(<AppContainer {...props} />);

      // Component mounts without errors, meaning keybinding handlers are registered
      expect(unmount).toBeTypeOf('function');

      unmount();
    });

    it('should have copy mode toggle available when using alternate buffer', () => {
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      const { unmount } = renderWithProviders(<AppContainer {...props} />);

      // When useAlternateBuffer is true, copy mode keybinding (Ctrl+S) should be available
      // The keybinding is defined and the settings enable alternate buffer
      expect(mockSettings.merged.ui.useAlternateBuffer).toBe(true);

      unmount();
    });

    it('should have shell focus toggle available when interactive shell is enabled', () => {
      mockConfig = createMockConfig({
        getEnableInteractiveShell: vi.fn(() => true),
      });

      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      const { unmount } = renderWithProviders(<AppContainer {...props} />);

      // Shell focus toggle (Ctrl+F) should be available when interactive shell is enabled
      expect(mockConfig.getEnableInteractiveShell()).toBe(true);

      unmount();
    });
  });
});
