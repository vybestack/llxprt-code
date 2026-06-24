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
  AgentClient,
} from '@vybestack/llxprt-code-core';
import {
  Config as ServerConfig,
  ApprovalMode,
  ideContext,
} from '@vybestack/llxprt-code-core';
import type { SettingsFile, Settings } from '../config/settings.js';
import { LoadedSettings } from '../config/settings.js';
import type { HistoryItem } from './types.js';
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

vi.mock('../config/config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-expect-error - this is fine
    ...actual,
    loadHierarchicalGeminiMemory: vi
      .fn()
      .mockResolvedValue({ memoryContent: '', fileCount: 0 }),
  };
});

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

  it('should display default "GEMINI.md" in footer when contextFileName is not set and count is 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(1);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue(['GEMINI.md']);
    mockedGetAllLlxprtMdFilenames.mockReturnValue(['GEMINI.md']);
    // For this test, ensure showMemoryUsage is false or debugMode is false if it relies on that
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve(); // Wait for any async updates
    expect(lastFrame()).toContain('Using: 1 GEMINI.md file');
  });

  it('should display default "GEMINI.md" with plural when contextFileName is not set and count is > 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(2);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue([
      'GEMINI.md',
      'GEMINI.md',
    ]);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using: 2 GEMINI.md files');
  });

  it('should display custom contextFileName in footer when set and count is 1', async () => {
    mockSettings = createMockSettings({
      workspace: { contextFileName: 'AGENTS.md', theme: 'Default' },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(1);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue(['AGENTS.md']);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using: 1 AGENTS.md file');
  });

  it('should display a generic message when multiple context files with different names are provided', async () => {
    mockSettings = createMockSettings({
      workspace: {
        contextFileName: ['AGENTS.md', 'CONTEXT.md'],
        theme: 'Default',
      },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(2);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue([
      'AGENTS.md',
      'CONTEXT.md',
    ]);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using: 2 context files');
  });

  it('should display custom contextFileName with plural when set and count is > 1', async () => {
    mockSettings = createMockSettings({
      workspace: { contextFileName: 'MY_NOTES.TXT', theme: 'Default' },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(3);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(3);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue([
      'MY_NOTES.TXT',
      'MY_NOTES.TXT',
      'MY_NOTES.TXT',
    ]);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using: 3 MY_NOTES.TXT files');
  });

  it('should not display context file message if count is 0, even if contextFileName is set', async () => {
    mockSettings = createMockSettings({
      workspace: { contextFileName: 'ANY_FILE.MD', theme: 'Default' },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue([]);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).not.toContain('ANY_FILE.MD');
  });

  it('should display core memory files separately from custom context files', async () => {
    mockSettings = createMockSettings({
      workspace: { contextFileName: 'CONTEXT.md', theme: 'Default' },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(0);
    mockConfig.getCoreMemoryFileCount.mockReturnValue(1);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue(['CONTEXT.md']);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using: 1 .LLXPRT_SYSTEM file');
    expect(lastFrame()).not.toContain('Using: 1 CONTEXT.md file');
  });

  it('should display GEMINI.md and MCP server count when both are present', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(2);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue([
      'GEMINI.md',
      'GEMINI.md',
    ]);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('1 MCP server');
  });

  it('should display only MCP server count when GEMINI.md count is 0', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue([]);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
      server2: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using: 2 MCP servers (ctrl+t to view)');
  });

  it('should display Tips component by default', async () => {
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

  it('should not display Tips component when hideTips is true', async () => {
    mockSettings = createMockSettings({
      workspace: {
        hideTips: true,
      },
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
    expect(vi.mocked(Tips)).not.toHaveBeenCalled();
  });

  it('should display Header component by default', async () => {
    const { Header } = await import('./components/Header.js');
    const { unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(vi.mocked(Header)).toHaveBeenCalled();
  });

  it('should not display Header component when hideBanner is true', async () => {
    const { Header } = await import('./components/Header.js');
    mockSettings = createMockSettings({
      user: { hideBanner: true },
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
    expect(vi.mocked(Header)).not.toHaveBeenCalled();
  });

  it('should render TodoPanel when showTodoPanel is true', async () => {
    const { unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(mockTodoPanel).toHaveBeenCalled();
  });

  it('should not render TodoPanel when showTodoPanel is false', async () => {
    mockSettings = createMockSettings({
      user: { showTodoPanel: false },
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
    expect(mockTodoPanel).not.toHaveBeenCalled();
  });

  it('should display Footer component by default', async () => {
    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    // Footer should render - look for target directory which is always shown
    expect(lastFrame()).toContain('/test/dir');
  });
});
