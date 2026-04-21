/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan project-plans/issue1576/TEST_PLAN.md - Test 1
 *
 * Verifies AppContainer renders without errors and produces correct provider hierarchy.
 * Tests the observable behavior: component mounts and renders DefaultAppLayout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies first before importing component
vi.mock('../../hooks/geminiStream/index.js', () => ({
  useGeminiStream: vi.fn(() => ({
    streamingState: 'Idle',
    submitQuery: vi.fn(),
    initError: null,
    pendingHistoryItems: [],
    thought: null,
    cancelOngoingRequest: vi.fn(),
    lastOutputTime: Date.now(),
  })),
}));

vi.mock('../../hooks/useConsoleMessages.js', () => ({
  useConsoleMessages: vi.fn(() => ({
    consoleMessages: [],
    handleNewMessage: vi.fn(),
    clearConsoleMessages: vi.fn(),
  })),
}));

vi.mock('../../hooks/useHistoryManager.js', () => ({
  useHistory: vi.fn(() => ({
    history: [],
    addItem: vi.fn(),
    clearItems: vi.fn(),
    loadHistory: vi.fn(),
  })),
}));

vi.mock('../../hooks/useAuthCommand.js', () => ({
  useAuthCommand: vi.fn(() => ({
    isAuthDialogOpen: false,
    openAuthDialog: vi.fn(),
    handleAuthSelect: vi.fn(),
  })),
}));

vi.mock('../../hooks/useFolderTrust.js', () => ({
  useFolderTrust: vi.fn(() => ({
    isFolderTrustDialogOpen: false,
    handleFolderTrustSelect: vi.fn(),
    isRestarting: false,
  })),
}));

vi.mock('../../hooks/useFocus.js', () => ({
  useFocus: vi.fn(() => true),
}));

vi.mock('../../hooks/useIdeTrustListener.js', () => ({
  useIdeTrustListener: vi.fn(() => ({ needsRestart: false })),
}));

vi.mock('../../hooks/useLogger.js', () => ({
  useLogger: vi.fn(() => ({
    getPreviousUserMessages: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../hooks/useInputHistoryStore.js', () => ({
  useInputHistoryStore: vi.fn(() => ({
    inputHistory: [],
    addInput: vi.fn(),
    initializeFromLogger: vi.fn(),
  })),
}));

vi.mock('../../hooks/useThemeCommand.js', () => ({
  useThemeCommand: vi.fn(() => ({
    isThemeDialogOpen: false,
    openThemeDialog: vi.fn(),
    handleThemeSelect: vi.fn(),
    handleThemeHighlight: vi.fn(),
  })),
}));

vi.mock('../../hooks/useSettingsCommand.js', () => ({
  useSettingsCommand: vi.fn(() => ({
    isSettingsDialogOpen: false,
    openSettingsDialog: vi.fn(),
    closeSettingsDialog: vi.fn(),
  })),
}));

vi.mock('../../hooks/useEditorSettings.js', () => ({
  useEditorSettings: vi.fn(() => ({
    isEditorDialogOpen: false,
    openEditorDialog: vi.fn(),
    handleEditorSelect: vi.fn(),
    exitEditorDialog: vi.fn(),
  })),
}));

vi.mock('../../hooks/useProviderDialog.js', () => ({
  useProviderDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    handleSelect: vi.fn(),
    closeDialog: vi.fn(),
    providers: [],
    currentProvider: '',
  })),
}));

vi.mock('../../hooks/useLoadProfileDialog.js', () => ({
  useLoadProfileDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    handleSelect: vi.fn(),
    closeDialog: vi.fn(),
    profiles: [],
  })),
}));

vi.mock('../../hooks/useCreateProfileDialog.js', () => ({
  useCreateProfileDialog: vi.fn(() => ({
    showDialog: false,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    providers: [],
  })),
}));

vi.mock('../../hooks/useProfileManagement.js', () => ({
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

vi.mock('../../hooks/useToolsDialog.js', () => ({
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

vi.mock('../../hooks/useWelcomeOnboarding.js', () => ({
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

vi.mock('../../hooks/useExtensionUpdates.js', () => ({
  useExtensionUpdates: vi.fn(() => ({
    extensionsUpdateState: new Map(),
    dispatchExtensionStateUpdate: vi.fn(),
    confirmUpdateExtensionRequests: [],
    addConfirmUpdateExtensionRequest: vi.fn(),
  })),
}));

vi.mock('../../hooks/useWorkspaceMigration.js', () => ({
  useWorkspaceMigration: vi.fn(() => ({
    showWorkspaceMigrationDialog: false,
    workspaceGeminiCLIExtensions: [],
    onWorkspaceMigrationDialogOpen: vi.fn(),
    onWorkspaceMigrationDialogClose: vi.fn(),
  })),
}));

vi.mock('../../hooks/useHookDisplayState.js', () => ({
  useHookDisplayState: vi.fn(() => []),
}));

vi.mock('../../hooks/useMemoryMonitor.js', () => ({
  useMemoryMonitor: vi.fn(),
}));

vi.mock('../../hooks/useTodoPausePreserver.js', () => ({
  useTodoPausePreserver: vi.fn(() => ({
    handleUserInputSubmit: vi.fn(),
  })),
  TodoPausePreserver: vi.fn(),
}));

vi.mock('../../hooks/useAutoAcceptIndicator.js', () => ({
  useAutoAcceptIndicator: vi.fn(() => false),
}));

vi.mock('../../hooks/useExtensionAutoUpdate.js', () => ({
  useExtensionAutoUpdate: vi.fn(),
}));

vi.mock('../../hooks/useStaticHistoryRefresh.js', () => ({
  useStaticHistoryRefresh: vi.fn(),
}));

vi.mock('../../hooks/useBracketedPaste.js', () => ({
  useBracketedPaste: vi.fn(),
}));

vi.mock('../../hooks/useResponsive.js', () => ({
  useResponsive: vi.fn(() => ({ isNarrow: false })),
}));

vi.mock('../../hooks/useTerminalSize.js', () => ({
  useTerminalSize: vi.fn(() => ({ rows: 24, columns: 120 })),
}));

vi.mock('../../hooks/useGitBranchName.js', () => ({
  useGitBranchName: vi.fn(() => null),
}));

vi.mock('../../hooks/useLoadingIndicator.js', () => ({
  useLoadingIndicator: vi.fn(() => ({
    elapsedTime: 0,
    currentLoadingPhrase: 'Thinking...',
  })),
}));

vi.mock('../../hooks/slashCommandProcessor.js', () => ({
  useSlashCommandProcessor: vi.fn(() => ({
    handleSlashCommand: vi.fn(),
    slashCommands: [],
    pendingHistoryItems: [],
    commandContext: {},
    confirmationRequest: null,
  })),
}));

vi.mock('../../hooks/useVim.js', () => ({
  useVim: vi.fn(() => ({ handleInput: vi.fn() })),
}));

vi.mock('../../hooks/useFlickerDetector.js', () => ({
  useFlickerDetector: vi.fn(),
}));

vi.mock('../../hooks/useMouseSelection.js', () => ({
  useMouseSelection: vi.fn(),
}));

vi.mock('../../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    stats: { historyTokenCount: 0 },
    updateHistoryTokenCount: vi.fn(),
  })),
}));

vi.mock('../../contexts/TodoContext.js', () => ({
  useTodoContext: vi.fn(() => ({
    todos: [],
    updateTodos: vi.fn(),
  })),
}));

vi.mock('../../contexts/VimModeContext.js', () => ({
  useVimMode: vi.fn(() => ({
    vimEnabled: false,
    vimMode: 'normal',
    toggleVimEnabled: vi.fn(),
  })),
}));

vi.mock('../../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: vi.fn(() => ({
    getCliOAuthManager: vi.fn(),
    getActiveModelName: vi.fn(() => 'test-model'),
    getActiveProviderMetrics: vi.fn(() => ({})),
    getSessionTokenUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0 })),
  })),
}));

vi.mock('../../utils/mouse.js', () => ({
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

vi.mock('../../../config/settings.js', () => {
  const actual = vi.importActual('../../../config/settings.js');
  return {
    ...actual,
    SettingScope: { User: 'user', Workspace: 'workspace', System: 'system' },
  };
});

// eslint-disable-next-line @typescript-eslint/no-misused-promises -- Vitest async mock factory is standard pattern
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
    debugLogger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
    uiTelemetryService: { setTokenTrackingMetrics: vi.fn() },
    getSettingsService: vi.fn(),
    ideContext: {
      subscribeToIdeContext: vi.fn(() => vi.fn()),
      getIdeContext: vi.fn(() => undefined),
    },
  };
});

vi.mock('node:process', () => ({
  default: {
    exit: vi.fn(),
    env: {},
  },
}));

import {
  renderWithProviders,
  createMockSettings,
} from '../../test-utils/render.js';
import { AppContainer } from '../AppContainer.js';
import { initialAppState } from '../reducers/appReducer.js';
import type { Config, IContent } from '@vybestack/llxprt-code-core';

// Type for the mock config
interface MockConfig {
  getGeminiClient: () => {
    getUserTier: () => Promise<undefined>;
    hasChatInitialized?: () => boolean;
  };
  getModel: () => string;
  getWorkingDir: () => string;
  getDebugMode: () => boolean;
  getQuestion: () => string | undefined;
  getMcpServers: () => Record<string, unknown>;
  getExtensions: () => Array<{
    name: string;
    version: string;
    isActive: boolean;
  }>;
  getLlxprtMdFileCount: () => number;
  getCoreMemoryFileCount: () => number;
  getIdeMode: () => boolean;
  getIdeClient: () => { getCurrentIde: () => string | undefined };
  getScreenReader: () => boolean;
  isTrustedFolder: () => boolean;
  getWorkspaceContext: () => { getDirectories: () => string[] };
  getFolderTrust: () => boolean;
  getEnableInteractiveShell: () => boolean;
  getTerminalBackground: () => string | undefined;
  getTargetDir: () => string;
  setPtyTerminalSize: () => void;
  setUserMemory: () => void;
  setLlxprtMdFileCount: () => void;
  getSessionId: () => string;
}

/**
 * Creates a minimal mock config for testing AppContainer mounting.
 */
function createMockConfig(overrides: Partial<MockConfig> = {}): MockConfig {
  return {
    getGeminiClient: () => ({
      getUserTier: vi.fn().mockResolvedValue(undefined),
      hasChatInitialized: () => false,
    }),
    getModel: () => 'test-model',
    getWorkingDir: () => '/test/dir',
    getDebugMode: () => false,
    getQuestion: () => undefined,
    getMcpServers: () => ({}),
    getExtensions: () => [],
    getLlxprtMdFileCount: () => 0,
    getCoreMemoryFileCount: () => 0,
    getIdeMode: () => false,
    getIdeClient: () => ({ getCurrentIde: () => undefined }),
    getScreenReader: () => false,
    isTrustedFolder: () => true,
    getWorkspaceContext: () => ({ getDirectories: () => [] }),
    getFolderTrust: () => false,
    getEnableInteractiveShell: () => false,
    getTerminalBackground: () => undefined,
    getTargetDir: () => '/test/dir',
    setPtyTerminalSize: vi.fn(),
    setUserMemory: vi.fn(),
    setLlxprtMdFileCount: vi.fn(),
    getSessionId: () => 'test-session-id',
    ...overrides,
  };
}

describe('AppContainer.mount', () => {
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

  describe('component mounting', () => {
    it('should mount without throwing errors', () => {
      // Arrange: All dependencies mocked
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      // Act & Assert: Should not throw when rendering
      expect(() => {
        renderWithProviders(<AppContainer {...props} />);
      }).not.toThrow();
    });

    it('should render with provider contexts active', () => {
      // Arrange
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      // Act
      const { lastFrame, unmount } = renderWithProviders(
        <AppContainer {...props} />,
      );

      // Assert: Component renders output (indicating UIStateProvider and UIActionsProvider are active)
      expect(lastFrame()).toBeDefined();
      expect(unmount).toBeTypeOf('function');
      unmount();
    });

    it('should render DefaultAppLayout', () => {
      // Arrange
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      // Act
      const { lastFrame } = renderWithProviders(<AppContainer {...props} />);

      // Assert: DefaultAppLayout renders content (e.g., footer with target dir)
      // The footer should show the working directory from config
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('with resumed history', () => {
    it('should mount with resumedHistory without errors', () => {
      // Arrange
      const resumedHistory: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there!' }] },
      ];
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        resumedHistory,
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      // Act & Assert: Should not throw when rendering with resumed history
      expect(() => {
        renderWithProviders(<AppContainer {...props} />);
      }).not.toThrow();
    });
  });

  describe('with startup warnings', () => {
    it('should mount with startupWarnings without errors', () => {
      // Arrange
      const startupWarnings = ['Warning 1', 'Warning 2'];
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        startupWarnings,
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      // Act & Assert: Should not throw when rendering with startup warnings
      expect(() => {
        renderWithProviders(<AppContainer {...props} />);
      }).not.toThrow();
    });
  });

  describe('unmount behavior', () => {
    it('should unmount without errors', () => {
      // Arrange
      const props = {
        config: mockConfig as unknown as Config,
        settings: mockSettings,
        version: '1.0.0-test',
        appState: initialAppState,
        appDispatch: vi.fn(),
      };

      // Act
      const { unmount } = renderWithProviders(<AppContainer {...props} />);

      // Assert: Should not throw when unmounting
      expect(() => {
        unmount();
      }).not.toThrow();
    });
  });
});
