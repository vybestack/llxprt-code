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
import process from 'node:process';
import type { HistoryItem } from './types.js';
import { MessageType } from './types.js';
import type { UpdateObject } from './utils/updateCheck.js';
import { checkForUpdates } from './utils/updateCheck.js';
import { EventEmitter } from 'events';
import { updateEventEmitter } from '../utils/updateEventEmitter.js';
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

const mockedCheckForUpdates = vi.mocked(checkForUpdates);
const {
  isGitRepository: mockedIsGitRepository,
  getAllLlxprtMdFilenames: mockedGetAllLlxprtMdFilenames,
} = vi.mocked(await import('@vybestack/llxprt-code-core'));

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

  describe('handleAutoUpdate', () => {
    let spawnEmitter: EventEmitter;

    beforeEach(async () => {
      const { spawn } = await import('node:child_process');
      spawnEmitter = new EventEmitter();
      spawnEmitter.stdout = new EventEmitter();
      spawnEmitter.stderr = new EventEmitter();
      (spawn as vi.Mock).mockReturnValue(spawnEmitter);
    });

    afterEach(() => {
      delete process.env.LLXPRT_CODE_DISABLE_AUTOUPDATER;
    });

    it('should not start the update process when running from git', async () => {
      mockedIsGitRepository.mockResolvedValue(true);
      const info: UpdateObject = {
        update: {
          name: '@vybestack/llxprt-code',
          latest: '1.1.0',
          current: '1.0.0',
        },
        message: 'Gemini CLI update available!',
      };
      mockedCheckForUpdates.mockResolvedValue(info);
      const { spawn } = await import('node:child_process');

      const { unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      // Wait for any potential async operations to complete
      await Promise.resolve();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should show a success message when update succeeds', async () => {
      mockedIsGitRepository.mockResolvedValue(false);
      const info: UpdateObject = {
        update: {
          name: '@vybestack/llxprt-code',
          latest: '1.1.0',
          current: '1.0.0',
        },
        message: 'Update available',
      };
      mockedCheckForUpdates.mockResolvedValue(info);

      const { lastFrame: _lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      updateEventEmitter.emit('update-success', info);

      // Wait for the success message to be added to history
      await Promise.resolve();
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Update successful! The new version will be used on your next run.',
        },
        expect.any(Number),
      );
    });

    it('should show an error message when update fails', async () => {
      mockedIsGitRepository.mockResolvedValue(false);
      const info: UpdateObject = {
        update: {
          name: '@vybestack/llxprt-code',
          latest: '1.1.0',
          current: '1.0.0',
        },
        message: 'Update available',
      };
      mockedCheckForUpdates.mockResolvedValue(info);

      const { lastFrame: _lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      updateEventEmitter.emit('update-failed', info);

      // Wait for the error message to be added to history
      await Promise.resolve();
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Automatic update failed. Please try updating manually',
        },
        expect.any(Number),
      );
    });

    it('should show an error message when spawn fails', async () => {
      mockedIsGitRepository.mockResolvedValue(false);
      const info: UpdateObject = {
        update: {
          name: '@vybestack/llxprt-code',
          latest: '1.1.0',
          current: '1.0.0',
        },
        message: 'Update available',
      };
      mockedCheckForUpdates.mockResolvedValue(info);

      const { lastFrame: _lastFrame, unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      // We are testing the App's reaction to an `update-failed` event,
      // which is what should be emitted when a spawn error occurs elsewhere.
      updateEventEmitter.emit('update-failed', info);

      // Wait for the error message to be added to history
      await Promise.resolve();
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Automatic update failed. Please try updating manually',
        },
        expect.any(Number),
      );
    });

    it('should not auto-update if LLXPRT_CODE_DISABLE_AUTOUPDATER is true', async () => {
      mockedIsGitRepository.mockResolvedValue(false);
      process.env.LLXPRT_CODE_DISABLE_AUTOUPDATER = 'true';
      const info: UpdateObject = {
        update: {
          name: '@vybestack/llxprt-code',
          latest: '1.1.0',
          current: '1.0.0',
        },
        message: 'Update available',
      };
      mockedCheckForUpdates.mockResolvedValue(info);
      const { spawn } = await import('node:child_process');

      const { unmount } = renderWithProviders(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
          version={mockVersion}
        />,
      );
      currentUnmount = unmount;

      // Wait for any potential async operations to complete
      await Promise.resolve();
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  it('should display active file when available', async () => {
    vi.mocked(ideContext.getIdeContext).mockReturnValue({
      workspaceState: {
        openFiles: [
          {
            path: '/path/to/my-file.ts',
            isActive: true,
            selectedText: 'hello',
            timestamp: 0,
          },
        ],
      },
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
    expect(lastFrame()).toContain('1 open file (ctrl+g to view)');
  });

  it('should not display any files when not available', async () => {
    vi.mocked(ideContext.getIdeContext).mockReturnValue({
      workspaceState: {
        openFiles: [],
      },
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
    expect(lastFrame()).not.toContain('Open File');
  });

  it('should display active file and other open files', async () => {
    vi.mocked(ideContext.getIdeContext).mockReturnValue({
      workspaceState: {
        openFiles: [
          {
            path: '/path/to/my-file.ts',
            isActive: true,
            selectedText: 'hello',
            timestamp: 0,
          },
          {
            path: '/path/to/another-file.ts',
            isActive: false,
            timestamp: 1,
          },
          {
            path: '/path/to/third-file.ts',
            isActive: false,
            timestamp: 2,
          },
        ],
      },
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
    expect(lastFrame()).toContain('3 open files (ctrl+g to view)');
  });

  it('should display active file and other context', async () => {
    vi.mocked(ideContext.getIdeContext).mockReturnValue({
      workspaceState: {
        openFiles: [
          {
            path: '/path/to/my-file.ts',
            isActive: true,
            selectedText: 'hello',
            timestamp: 0,
          },
        ],
      },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getLlxprtMdFileCount.mockReturnValue(1);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue(['GEMINI.md']);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain(
      'Using: 1 open file (ctrl+g to view) | 1 GEMINI.md file',
    );
  });

  it('should not display context summary when hideContextSummary is true', async () => {
    mockSettings = createMockSettings({
      workspace: {
        ui: { hideContextSummary: true },
      },
    });
    vi.mocked(ideContext.getIdeContext).mockReturnValue({
      workspaceState: {
        openFiles: [
          {
            path: '/path/to/my-file.ts',
            isActive: true,
            selectedText: 'hello',
            timestamp: 0,
          },
        ],
      },
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getAllGeminiMdFilenames.mockReturnValue(['GEMINI.md']);

    const { lastFrame, unmount } = renderWithProviders(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
        version={mockVersion}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    const output = lastFrame();
    expect(output).not.toContain('Using:');
    expect(output).not.toContain('open file');
    expect(output).not.toContain('GEMINI.md file');
  });
});
