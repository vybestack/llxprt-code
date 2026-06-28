/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Text } from 'ink';
import { renderWithProviders } from '../test-utils/render.js';
import { AppWrapper as App } from './App.js';
import type {
  MCPServerConfig,
  ToolRegistry,
  AccessibilitySettings,
  SandboxConfig,
  LLxprtClient,
  AgentClient,
} from '@vybestack/llxprt-code-core';
import {
  Config as ServerConfig,
  ApprovalMode,
  ideContext,
} from '@vybestack/llxprt-code-core';
import type { SettingsFile, Settings } from '../config/settings.js';
import { LoadedSettings } from '../config/settings.js';
import process from 'node:process';
import { useGeminiStream } from './hooks/geminiStream/index.js';
import { useConsoleMessages } from './hooks/useConsoleMessages.js';
import type { ConsoleMessageItem, HistoryItem } from './types.js';
import { StreamingState } from './types.js';
import { Tips } from './components/Tips.js';
import * as useTerminalSize from './hooks/useTerminalSize.js';

// Define a more complete mock server config based on actual Config
interface MockServerConfig {
  apiKey: string;
  model: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  question?: string;
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>; // Use imported MCPServerConfig
  userAgent: string;
  userMemory: string;
  geminiMdFileCount: number;
  coreMemoryFileCount: number;
  approvalMode: ApprovalMode;
  vertexai?: boolean;
  showMemoryUsage?: boolean;
  accessibility?: AccessibilitySettings;
  embeddingModel: string;

  getApiKey: Mock<() => string>;
  getModel: Mock<() => string>;
  getSandbox: Mock<() => SandboxConfig | undefined>;
  getTargetDir: Mock<() => string>;
  getToolRegistry: Mock<() => ToolRegistry>; // Use imported ToolRegistry type
  getDebugMode: Mock<() => boolean>;
  getQuestion: Mock<() => string | undefined>;
  getCoreTools: Mock<() => string[] | undefined>;
  getToolDiscoveryCommand: Mock<() => string | undefined>;
  getToolCallCommand: Mock<() => string | undefined>;
  getMcpServerCommand: Mock<() => string | undefined>;
  getMcpServers: Mock<() => Record<string, MCPServerConfig> | undefined>;
  getExtensions: Mock<
    () => Array<{ name: string; version: string; isActive: boolean }>
  >;
  getBlockedMcpServers: Mock<
    () => Array<{ name: string; extensionName: string }>
  >;
  getUserAgent: Mock<() => string>;
  getUserMemory: Mock<() => string>;
  setUserMemory: Mock<(newUserMemory: string) => void>;
  getGeminiMdFileCount: Mock<() => number>;
  getLlxprtMdFileCount: Mock<() => number>;
  getCoreMemoryFileCount: Mock<() => number>;
  setGeminiMdFileCount: Mock<(count: number) => void>;
  getApprovalMode: Mock<() => ApprovalMode>;
  setApprovalMode: Mock<(skip: ApprovalMode) => void>;
  getVertexAI: Mock<() => boolean | undefined>;
  getShowMemoryUsage: Mock<() => boolean>;
  getAccessibility: Mock<() => AccessibilitySettings>;
  getProjectRoot: Mock<() => string | undefined>;
  getAllGeminiMdFilenames: Mock<() => string[]>;
  getAgentClient: Mock<() => AgentClient | undefined>;
  getUserTier: Mock<() => Promise<string | undefined>>;
  getIdeClient: Mock<() => { getCurrentIde: Mock<() => string | undefined> }>;
  getScreenReader: Mock<() => boolean>;
}

// Mock @vybestack/llxprt-code-core and its Config class
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCore =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  const ConfigClassMock = vi
    .fn()
    .mockImplementation((optionsPassedToConstructor) => {
      const opts = { ...optionsPassedToConstructor }; // Clone
      // Basic mock structure, will be extended by the instance in tests
      return {
        apiKey:
          opts.apiKey != null && opts.apiKey !== '' ? opts.apiKey : 'test-key',
        model:
          opts.model != null && opts.model !== ''
            ? opts.model
            : 'test-model-in-mock-factory',
        sandbox: opts.sandbox,
        targetDir:
          opts.targetDir != null && opts.targetDir !== ''
            ? opts.targetDir
            : '/test/dir',
        debugMode: opts.debugMode ?? false,
        question: opts.question,
        coreTools: opts.coreTools,
        toolDiscoveryCommand: opts.toolDiscoveryCommand,
        toolCallCommand: opts.toolCallCommand,
        mcpServerCommand: opts.mcpServerCommand,
        mcpServers: opts.mcpServers,
        userAgent:
          opts.userAgent != null && opts.userAgent !== ''
            ? opts.userAgent
            : 'test-agent',
        userMemory:
          opts.userMemory != null && opts.userMemory !== ''
            ? opts.userMemory
            : '',
        geminiMdFileCount: opts.geminiMdFileCount ?? 0,
        coreMemoryFileCount: opts.coreMemoryFileCount ?? 0,
        approvalMode: opts.approvalMode ?? ApprovalMode.DEFAULT,
        vertexai: opts.vertexai,
        showMemoryUsage: opts.showMemoryUsage ?? false,
        accessibility: opts.accessibility ?? {},
        embeddingModel:
          opts.embeddingModel != null && opts.embeddingModel !== ''
            ? opts.embeddingModel
            : 'test-embedding-model',

        getApiKey: vi.fn(() =>
          opts.apiKey != null && opts.apiKey !== '' ? opts.apiKey : 'test-key',
        ),
        getModel: vi.fn(() =>
          opts.model != null && opts.model !== ''
            ? opts.model
            : 'test-model-in-mock-factory',
        ),
        getSandbox: vi.fn(() => opts.sandbox),
        getTargetDir: vi.fn(() =>
          opts.targetDir != null && opts.targetDir !== ''
            ? opts.targetDir
            : '/test/dir',
        ),
        getToolRegistry: vi.fn(() => ({}) as ToolRegistry), // Simple mock
        getDebugMode: vi.fn(() => opts.debugMode ?? false),
        getQuestion: vi.fn(() => opts.question),
        getCoreTools: vi.fn(() => opts.coreTools),
        getToolDiscoveryCommand: vi.fn(() => opts.toolDiscoveryCommand),
        getToolCallCommand: vi.fn(() => opts.toolCallCommand),
        getMcpServerCommand: vi.fn(() => opts.mcpServerCommand),
        getMcpServers: vi.fn(() => opts.mcpServers),
        getPromptRegistry: vi.fn(),
        getExtensions: vi.fn(() => []),
        getBlockedMcpServers: vi.fn(() => []),
        getUserAgent: vi.fn(() =>
          opts.userAgent != null && opts.userAgent !== ''
            ? opts.userAgent
            : 'test-agent',
        ),
        getUserMemory: vi.fn(() =>
          opts.userMemory != null && opts.userMemory !== ''
            ? opts.userMemory
            : '',
        ),
        setUserMemory: vi.fn(),
        getGeminiMdFileCount: vi.fn(() => opts.geminiMdFileCount ?? 0),
        getLlxprtMdFileCount: vi.fn(() => opts.geminiMdFileCount ?? 0),
        getCoreMemoryFileCount: vi.fn(() => opts.coreMemoryFileCount ?? 0),
        setGeminiMdFileCount: vi.fn(),
        getApprovalMode: vi.fn(() => opts.approvalMode ?? ApprovalMode.DEFAULT),
        setApprovalMode: vi.fn(),
        getVertexAI: vi.fn(() => opts.vertexai),
        getShowMemoryUsage: vi.fn(() => opts.showMemoryUsage ?? false),
        getAccessibility: vi.fn(() => opts.accessibility ?? {}),
        getProjectRoot: vi.fn(() => opts.targetDir),
        getEnablePromptCompletion: vi.fn(() => false),
        getAgentClient: vi.fn(() => ({
          getUserTier: vi.fn(),
        })),
        getCheckpointingEnabled: vi.fn(() => opts.checkpointing ?? true),
        getAllGeminiMdFilenames: vi.fn(() => ['GEMINI.md']),
        getSessionId: vi.fn(() => 'test-session-id'),
        getUserTier: vi.fn().mockResolvedValue(undefined),
        getIdeMode: vi.fn(() => true),
        getWorkspaceContext: vi.fn(() => ({
          getDirectories: vi.fn(() => []),
        })),
        getIdeClient: vi.fn(() => ({
          getCurrentIde: vi.fn(() => 'vscode'),
          getDetectedIdeDisplayName: vi.fn(() => 'VSCode'),
          addStatusChangeListener: vi.fn(),
          removeStatusChangeListener: vi.fn(),
          getConnectionStatus: vi.fn(() => 'connected'),
        })),
        isTrustedFolder: vi.fn(() => true),
        getScreenReader: vi.fn(() => false),
        getEphemeralSetting: vi.fn(() => undefined),
        getEphemeralSettings: vi.fn(() => ({})),
        setEphemeralSetting: vi.fn(),
        clearEphemeralSetting: vi.fn(),
        getFolderTrustFeature: vi.fn(() => false),
        getFolderTrust: vi.fn(() => false),
      };
    });

  const ideContextMock = {
    getIdeContext: vi.fn(),
    subscribeToIdeContext: vi.fn(() => vi.fn()), // subscribe returns an unsubscribe function
  };

  return {
    ...actualCore,
    Config: ConfigClassMock,
    MCPServerConfig: actualCore.MCPServerConfig,
    getAllGeminiMdFilenames: vi.fn(() => ['GEMINI.md']),
    getAllLlxprtMdFilenames: vi.fn(() => ['GEMINI.md']),
    ideContext: ideContextMock,
    isGitRepository: vi.fn(),
  };
});

// Mock heavy dependencies or those with side effects
vi.mock('./hooks/geminiStream/index', () => ({
  useGeminiStream: vi.fn(() => ({
    streamingState: 'Idle',
    submitQuery: vi.fn(),
    initError: null,
    pendingHistoryItems: [],
    thought: null,
  })),
}));

vi.mock('./hooks/useAuthCommand', () => ({
  useAuthCommand: vi.fn(() => ({
    isAuthDialogOpen: false,
    openAuthDialog: vi.fn(),
    handleAuthSelect: vi.fn(),
    handleAuthHighlight: vi.fn(),
  })),
}));

vi.mock('./hooks/useFolderTrust', () => ({
  useFolderTrust: vi.fn(() => ({
    isFolderTrustDialogOpen: false,
    handleFolderTrustSelect: vi.fn(),
    isRestarting: false,
  })),
}));

vi.mock('./hooks/useFocus', () => ({
  useFocus: vi.fn(() => true),
}));

vi.mock('./hooks/useIdeTrustListener', () => ({
  useIdeTrustListener: vi.fn(() => ({
    needsRestart: false,
  })),
}));

vi.mock('./hooks/useLogger', () => ({
  useLogger: vi.fn(() => ({
    getPreviousUserMessages: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('./hooks/useInputHistoryStore.js', () => ({
  useInputHistoryStore: vi.fn(() => ({
    inputHistory: [],
    addInput: vi.fn(),
    initializeFromLogger: vi.fn(),
  })),
}));

vi.mock('./hooks/useConsoleMessages.js', () => ({
  useConsoleMessages: vi.fn(() => ({
    consoleMessages: [],
    handleNewMessage: vi.fn(),
    clearConsoleMessages: vi.fn(),
  })),
}));

// Create a mock history state that can be updated by tests
let mockHistoryState: HistoryItem[] = [];
const mockAddItem = vi.fn((item: Omit<HistoryItem, 'id'>) => {
  mockHistoryState.push({ ...item, id: Date.now() });
});

vi.mock('./hooks/useHistoryManager.js', () => ({
  useHistory: vi.fn(() => ({
    history: mockHistoryState,
    addItem: mockAddItem,
    clearItems: vi.fn(() => {
      mockHistoryState = [];
    }),
    loadHistory: vi.fn(),
  })),
}));

vi.mock('./components/Tips.js', () => ({
  Tips: vi.fn(() => null),
}));

const mockTodoPanel = vi.fn(() => (
  <Text color={Colors.Foreground}>Mock Todo Panel</Text>
));
vi.mock('./components/TodoPanel.js', () => ({
  TodoPanel: mockTodoPanel,
}));

vi.mock('./components/Header.js', () => ({
  Header: vi.fn(() => null),
}));

vi.mock('./utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(),
}));

vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: vi.fn(),
}));

const { getAllLlxprtMdFilenames: mockedGetAllLlxprtMdFilenames } = vi.mocked(
  await import('@vybestack/llxprt-code-core'),
);

vi.mock('node:child_process');

vi.mock('../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(() => ({
    getActiveProvider: vi.fn(() => ({
      getCurrentModel: vi.fn(() => 'gemini-pro'),
    })),
  })),
}));

describe('App UI', () => {
  let mockConfig: MockServerConfig;
  let mockSettings: LoadedSettings;
  let mockVersion: string;
  let currentUnmount: (() => void) | undefined;

  // Helper to detect if we're in a PowerShell environment
  const isPowerShell = () =>
    process.env.PSModulePath !== undefined ||
    process.env.PSVERSION !== undefined;

  const createMockSettings = (
    settings: {
      system?: Partial<Settings>;
      user?: Partial<Settings>;
      workspace?: Partial<Settings>;
    } = {},
  ): LoadedSettings => {
    const systemSettingsFile: SettingsFile = {
      path: '/system/settings.json',
      settings: settings.system ?? {},
    };
    const systemDefaultsFile: SettingsFile = {
      path: '/system/system-defaults.json',
      settings: {},
    };
    const userSettingsFile: SettingsFile = {
      path: '/user/settings.json',
      settings: settings.user ?? {},
    };
    const workspaceSettingsFile: SettingsFile = {
      path: '/workspace/.gemini/settings.json',
      settings: settings.workspace ?? {},
    };
    return new LoadedSettings(
      systemSettingsFile,
      systemDefaultsFile,
      userSettingsFile,
      workspaceSettingsFile,
      true,
    );
  };

  beforeEach(() => {
    // Reset mock history state
    mockHistoryState = [];
    mockAddItem.mockClear();
    mockTodoPanel.mockClear();

    // Reset core function mocks to default values
    mockedGetAllLlxprtMdFilenames.mockReturnValue(['GEMINI.md']);

    vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
      columns: 120,
      rows: 24,
    });

    const ServerConfigMocked = vi.mocked(ServerConfig, true);
    mockConfig = new ServerConfigMocked({
      embeddingModel: 'test-embedding-model',
      sandbox: undefined,
      targetDir: '/test/dir',
      debugMode: false,
      userMemory: '',
      geminiMdFileCount: 0,
      showMemoryUsage: false,
      sessionId: 'test-session-id',
      cwd: '/tmp',
      model: 'model',
    }) as unknown as MockServerConfig;
    mockVersion = '0.0.0-test';

    // Set up mock for getShowMemoryUsage
    mockConfig.getShowMemoryUsage.mockReturnValue(false); // Default for most tests

    // Ensure a theme is set so the theme dialog does not appear.
    mockSettings = createMockSettings({ workspace: { theme: 'Default' } });

    // Ensure getWorkspaceContext is available if not added by the constructor
    mockConfig.getWorkspaceContext ??= vi.fn(() => ({
      getDirectories: vi.fn(() => ['/test/dir']),
    }));

    // Ensure getEphemeralSetting is available if not added by the constructor
    mockConfig.getEphemeralSetting ??= vi.fn(() => undefined);
    vi.mocked(ideContext.getIdeContext).mockReturnValue(undefined);
  });

  afterEach(() => {
    if (currentUnmount) {
      currentUnmount();
      currentUnmount = undefined;
    }
    vi.clearAllMocks(); // Clear mocks after each test
  });

  it('should not display Footer component when hideFooter is true', async () => {
    mockSettings = createMockSettings({
      user: { hideFooter: true },
    });

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    // Footer should not render - target directory should not appear
    expect(lastFrame()).not.toContain('/test/dir');
  });

  it('should show footer if system says show, but workspace and user settings say hide', async () => {
    mockSettings = createMockSettings({
      system: { hideFooter: false },
      user: { hideFooter: true },
      workspace: { hideFooter: true },
    });

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    // Footer should render because system overrides - look for target directory
    expect(lastFrame()).toContain('/test/dir');
  });

  it('should show tips if system says show, but workspace and user settings say hide', async () => {
    mockSettings = createMockSettings({
      system: { hideTips: false },
      user: { hideTips: true },
      workspace: { hideTips: true },
    });

    const { unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(vi.mocked(Tips)).toHaveBeenCalled();
  });

  describe('when no theme is set', () => {
    let originalNoColor: string | undefined;

    beforeEach(() => {
      originalNoColor = process.env.NO_COLOR;
      // Ensure no theme is set for these tests
      mockSettings = createMockSettings({});
      mockConfig.getDebugMode.mockReturnValue(false);
      mockConfig.getShowMemoryUsage.mockReturnValue(false);
    });

    afterEach(() => {
      process.env.NO_COLOR = originalNoColor;
    });

    it('should display theme dialog if NO_COLOR is not set', async () => {
      delete process.env.NO_COLOR;

      const { lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      expect(lastFrame()).toContain('Select Theme');
    });

    it('should display a message if NO_COLOR is set', async () => {
      process.env.NO_COLOR = 'true';

      const { lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      expect(lastFrame()).toContain(
        'INFO: Theme configuration unavailable due to NO_COLOR env variable.',
      );
      expect(lastFrame()).not.toContain('Select Theme');
    });
  });

  it('should render the initial UI correctly', () => {
    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    expect(lastFrame()).toMatchSnapshot();
  });

  it('should render correctly with the prompt input box - common checks', () => {
    vi.mocked(useGeminiStream).mockReturnValue({
      streamingState: StreamingState.Idle,
      submitQuery: vi.fn(),
      initError: null,
      pendingHistoryItems: [],
      thought: null,
    });

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;

    // Check for the correct placeholder based on environment
    const frame = lastFrame();
    expect(frame).toContain('Context: 0.0k/1049k');
    expect(frame).toContain('/test/dir');
    expect(frame).toContain('gemini-pro');
  });

  it.runIf(isPowerShell())(
    'should render PowerShell-specific placeholder',
    () => {
      vi.mocked(useGeminiStream).mockReturnValue({
        streamingState: StreamingState.Idle,
        submitQuery: vi.fn(),
        initError: null,
        pendingHistoryItems: [],
        thought: null,
      });

      const { lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      const frame = lastFrame();
      expect(frame).toContain(
        'Type your message, @path/to/file or +path/to/file',
      );
    },
  );

  it.skipIf(isPowerShell())(
    'should render standard placeholder on non-PowerShell',
    () => {
      vi.mocked(useGeminiStream).mockReturnValue({
        streamingState: StreamingState.Idle,
        submitQuery: vi.fn(),
        initError: null,
        pendingHistoryItems: [],
        thought: null,
      });

      const { lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      const frame = lastFrame();
      expect(frame).toContain('Type your message or @path/to/file');
    },
  );

  describe('with initial prompt from --prompt-interactive', () => {
    it('should submit the initial prompt automatically', async () => {
      const mockSubmitQuery = vi.fn();

      mockConfig.getQuestion = vi.fn(() => 'hello from prompt-interactive');

      vi.mocked(useGeminiStream).mockReturnValue({
        streamingState: StreamingState.Idle,
        submitQuery: mockSubmitQuery,
        initError: null,
        pendingHistoryItems: [],
        thought: null,
      });

      mockConfig.getAgentClient.mockReturnValue({
        isInitialized: vi.fn(() => false),
        getUserTier: vi.fn(),
      } as unknown as LLxprtClient);

      const { unmount, rerender } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      // Force a re-render to trigger useEffect
      rerender(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSubmitQuery).toHaveBeenCalledWith(
        'hello from prompt-interactive',
      );
    });
  });

  describe('errorCount', () => {
    it('should correctly sum the counts of error messages', async () => {
      const mockConsoleMessages: ConsoleMessageItem[] = [
        { type: 'error', content: 'First error', count: 1 },
        { type: 'log', content: 'some log', count: 1 },
        { type: 'error', content: 'Second error', count: 3 },
        { type: 'warn', content: 'a warning', count: 1 },
        { type: 'error', content: 'Third error', count: 1 },
      ];

      vi.mocked(useConsoleMessages).mockReturnValue({
        consoleMessages: mockConsoleMessages,
        handleNewMessage: vi.fn(),
        clearConsoleMessages: vi.fn(),
      });

      const { lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;
      await Promise.resolve();

      // Total error count should be 1 + 3 + 1 = 5
      expect(lastFrame()).toContain('5 errors');
    });
  });

  describe('when in a narrow terminal', () => {
    it('should render with a column layout - common checks', () => {
      vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
        columns: 60,
        rows: 24,
      });

      const { lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      // Check for the correct layout and placeholder based on environment
      const frame = lastFrame();
      expect(frame).toContain('Ctx: 0.0k/1049k'); // Narrow terminal shows abbreviated context
      expect(frame).toContain('/test/dir');
    });

    it.runIf(isPowerShell())(
      'should render PowerShell-specific placeholder in narrow terminal',
      () => {
        vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
          columns: 60,
          rows: 24,
        });

        const { lastFrame, unmount } = renderWithProviders(
          <App
            config={mockConfig as unknown as ServerConfig}
            settings={mockSettings}
            version={mockVersion}
          />,
        );
        currentUnmount = unmount;

        const frame = lastFrame();
        expect(frame).toContain(
          'Type your message, @path/to/file or +path/to/file',
        );
      },
    );

    it.skipIf(isPowerShell())(
      'should render standard placeholder in narrow terminal on non-PowerShell',
      () => {
        vi.spyOn(useTerminalSize, 'useTerminalSize').mockReturnValue({
          columns: 60,
          rows: 24,
        });

        const { lastFrame, unmount } = renderWithProviders(
          <App
            config={mockConfig as unknown as ServerConfig}
            settings={mockSettings}
            version={mockVersion}
          />,
        );
        currentUnmount = unmount;

        const frame = lastFrame();
        expect(frame).toContain('Type your message or @path/to/file');
      },
    );
  });
});
