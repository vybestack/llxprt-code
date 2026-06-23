/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Content } from '@google/genai';
import type { ConfigParameters, SandboxConfig } from './config.js';
import { Config, DEFAULT_FILE_FILTERING_OPTIONS } from './config.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { setLlxprtMdFilename as mockSetLlxprtMdFilename } from '@vybestack/llxprt-code-tools';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import { createContentGeneratorConfig } from '../core/contentGenerator.js';
import type { ToolSchedulerFactoryOptions } from '../core/toolSchedulerContract.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestConfig } from '../test-utils/config.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({
      isDirectory: vi.fn().mockReturnValue(true),
    }),
    realpathSync: vi.fn((path) => path),
  };
});

// Mock dependencies that might be called during Config construction or createServerConfig.
vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>();
  const registerToolMock = vi.fn();
  const ToolRegistryMock = vi.fn().mockImplementation(() => ({
    registerTool: registerToolMock,
    unregisterTool: vi.fn(),
    discoverAllTools: vi.fn(),
    sortTools: vi.fn(),
    getAllTools: vi.fn(() => []),
    getTool: vi.fn(),
    getFunctionDeclarations: vi.fn(() => []),
  }));
  ToolRegistryMock.prototype.registerTool = registerToolMock;
  ToolRegistryMock.prototype.unregisterTool = vi.fn();
  ToolRegistryMock.prototype.discoverAllTools = vi.fn();
  ToolRegistryMock.prototype.sortTools = vi.fn();
  ToolRegistryMock.prototype.getAllTools = vi.fn(() => []);
  ToolRegistryMock.prototype.getTool = vi.fn();
  ToolRegistryMock.prototype.getFunctionDeclarations = vi.fn(() => []);
  return {
    ...actual,
    ToolRegistry: ToolRegistryMock,
    MemoryTool: vi.fn(),
    setLlxprtMdFilename: vi.fn(),
    getCurrentLlxprtMdFilename: vi.fn(() => 'LLXPRT.md'),
    DEFAULT_CONTEXT_FILENAME: 'LLXPRT.md',
    LLXPRT_CONFIG_DIR: '.llxprt',
  };
});

// Mock individual tools if their constructors are complex or have side effects

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createContentGeneratorConfig: vi.fn(),
  };
});

const AgentClient = vi.fn().mockImplementation(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
  hasChatInitialized: vi.fn().mockReturnValue(false),
  getHistory: vi.fn().mockReturnValue([]),
  getHistoryService: vi.fn().mockReturnValue(null),
  setHistory: vi.fn(),
  storeHistoryServiceForReuse: vi.fn(),
  storeHistoryForLaterUse: vi.fn(),
  dispose: vi.fn(),
  clearTools: vi.fn(),
  stripThoughtsFromHistory: vi.fn(),
}));

class CoreToolScheduler {
  constructor(_options: ToolSchedulerFactoryOptions) {}
  schedule = vi.fn().mockResolvedValue(undefined);
  cancelAll = vi.fn();
  dispose = vi.fn();
  setCallbacks = vi.fn();
  handleConfirmationResponse = vi.fn().mockResolvedValue(undefined);
}

vi.mock('../telemetry/index.js', () => {
  // Create a mock StartSessionEvent class to avoid circular dependency issues
  // when importOriginal tries to load types.ts which imports config.ts
  class MockStartSessionEvent {
    'event.name' = 'cli_config';
    'event.timestamp': string;
    model = '';
    embedding_model: string | undefined;
    sandbox_enabled = false;
    core_tools_enabled = '';
    approval_mode = '';
    api_key_enabled = false;
    vertex_ai_enabled = false;
    debug_enabled = false;
    mcp_servers = '';
    telemetry_enabled = false;
    telemetry_log_user_prompts_enabled = false;
    file_filtering_respect_git_ignore = false;

    constructor() {
      this['event.timestamp'] = new Date().toISOString();
    }
  }

  return {
    initializeTelemetry: vi.fn(),
    logCliConfiguration: vi.fn(),
    StartSessionEvent: MockStartSessionEvent,
    DEFAULT_TELEMETRY_TARGET: 'local',
    DEFAULT_OTLP_ENDPOINT: 'http://localhost:4317',
    TelemetryTarget: { GCP: 'gcp', LOCAL: 'local' },
  };
});

vi.mock('../services/gitService.js', () => {
  const GitServiceMock = vi.fn();
  GitServiceMock.prototype.initialize = vi.fn();
  return { GitService: GitServiceMock };
});

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-settings')
  >('@vybestack/llxprt-code-settings');
  const mockSettingsService = {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    getProviderSettings: vi.fn(() => ({})),
    getAllGlobalSettings: vi.fn(() => ({})),
  };
  return {
    ...actual,
    getSettingsService: vi.fn(() => mockSettingsService),
    resetSettingsService: vi.fn(),
    registerSettingsService: vi.fn(),
  };
});

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
  };
});

const mockLoadJitSubdirectoryMemory = vi.hoisted(() => vi.fn());

vi.mock('../utils/memoryDiscovery.js', () => ({
  loadGlobalMemory: vi.fn().mockResolvedValue({ files: [] }),
  loadEnvironmentMemory: vi.fn().mockResolvedValue({ files: [] }),
  loadJitSubdirectoryMemory: mockLoadJitSubdirectoryMemory,
  loadCoreMemory: vi.fn().mockResolvedValue({ files: [] }),
  concatenateInstructions: vi.fn().mockReturnValue(''),
  getAllLlxprtMdFilenames: vi.fn().mockReturnValue([]),
  loadServerHierarchicalMemory: vi.fn().mockResolvedValue({
    memoryContent: '',
    fileCount: 0,
    filePaths: [],
  }),
}));

const mockCoreEvents = vi.hoisted(() => ({
  emitFeedback: vi.fn(),
  emitModelChanged: vi.fn(),
  emitConsoleLog: vi.fn(),
}));

const mockSetGlobalProxy = vi.hoisted(() => vi.fn());

vi.mock('../utils/events.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    coreEvents: {
      ...mockCoreEvents,
      emit: vi.fn(),
    },
  };
});

vi.mock('../utils/fetch.js', () => ({
  setGlobalProxy: mockSetGlobalProxy,
}));

describe('Server Config (config.ts)', () => {
  const MODEL = 'gemini-pro';
  const SANDBOX: SandboxConfig = {
    command: 'docker',
    image: 'llxprt-code-sandbox',
  };
  const TARGET_DIR = '/path/to/target';
  const DEBUG_MODE = false;
  const QUESTION = 'test question';

  const USER_MEMORY = 'Test User Memory';
  const TELEMETRY_SETTINGS = { enabled: false };
  const EMBEDDING_MODEL = 'gemini-embedding';
  const SESSION_ID = 'test-session-id';
  const sharedSettingsService =
    getSettingsService() as unknown as SettingsService;
  const baseParams: ConfigParameters = {
    cwd: '/tmp',
    embeddingModel: EMBEDDING_MODEL,
    sandbox: SANDBOX,
    targetDir: TARGET_DIR,
    debugMode: DEBUG_MODE,
    question: QUESTION,

    userMemory: USER_MEMORY,
    telemetry: TELEMETRY_SETTINGS,
    sessionId: SESSION_ID,
    model: MODEL,
    settingsService: sharedSettingsService,
    agentClientFactory: (config, runtimeState) =>
      new AgentClient(config, runtimeState),
    toolSchedulerFactory: (options) => new CoreToolScheduler(options),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    AgentClient.mockReset();
    AgentClient.mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      isInitialized: vi.fn().mockReturnValue(false),
      hasChatInitialized: vi.fn().mockReturnValue(false),
      getHistory: vi.fn().mockReturnValue([]),
      getHistoryService: vi.fn().mockReturnValue(null),
      setHistory: vi.fn(),
      storeHistoryServiceForReuse: vi.fn(),
      storeHistoryForLaterUse: vi.fn(),
      dispose: vi.fn(),
      clearTools: vi.fn(),
      stripThoughtsFromHistory: vi.fn(),
    }));
  });
  describe('refreshAuth', () => {
    it('should refresh auth and update config', async () => {
      const config = new Config(baseParams);
      // Initialize config to create AgentClient instance
      await initializeTestConfig(config);

      const newModel = 'gemini-flash';
      const mockContentConfig = {
        model: newModel,
        apiKey: 'test-key',
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      // Set fallback mode to true to ensure it gets reset
      config.setFallbackMode(true);
      expect(config.isInFallbackMode()).toBe(true);

      await config.refreshAuth();

      expect(createContentGeneratorConfig).toHaveBeenCalledWith(config);
      // Verify that contentGeneratorConfig is updated with the new model
      expect(config.getContentGeneratorConfig()).toStrictEqual(
        mockContentConfig,
      );
      expect(config.getContentGeneratorConfig()?.model).toBe(newModel);
      expect(config.getModel()).toBe(newModel); // getModel() should return the updated model
      expect(AgentClient).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          provider: expect.any(String),
          model: newModel,
        }),
      );
      // Verify that fallback mode is reset
      expect(config.isInFallbackMode()).toBe(false);
    });

    it('should preserve conversation history when refreshing auth', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      // Mock the existing client with some history
      const mockExistingHistory = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ];

      const mockExistingClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue(mockExistingHistory),
        getHistoryService: vi.fn().mockReturnValue(null),
      };

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        setHistory: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
      };

      // Set the existing client
      (
        config as unknown as { agentClient: typeof mockExistingClient }
      ).agentClient = mockExistingClient;
      AgentClient.mockImplementation(() => mockNewClient);

      await config.refreshAuth();

      // Verify that existing history was retrieved
      expect(mockExistingClient.getHistory).toHaveBeenCalled();

      // Verify that new client was created and initialized
      expect(AgentClient).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          provider: expect.any(String),
        }),
      );

      // Verify that history was stored BEFORE initialize was called
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalledWith(
        mockExistingHistory,
      );

      // Verify that initialize was called after storing history
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);
    });

    it('preserves committed chat history without waiting for an active turn to become idle', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
      };
      const committedHistory: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'Remember we are fixing issue 2049' }],
        },
        { role: 'model', parts: [{ text: 'We are preserving history.' }] },
      ];
      const partialInFlightHistory: Content[] = [
        ...committedHistory,
        { role: 'user', parts: [{ text: 'This turn is still retrying' }] },
      ];

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      const chatGetHistory = vi.fn().mockReturnValue(committedHistory);
      const mockHistoryService = { setTokenizerFactory: vi.fn() };
      const mockExistingClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        hasChatInitialized: vi.fn().mockReturnValue(true),
        getChat: vi.fn().mockReturnValue({
          getHistory: chatGetHistory,
        }),
        getHistory: vi.fn(async () => {
          throw new Error('refreshAuth should not wait for idle history');
        }),
        getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
      };

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue(committedHistory),
        getHistoryService: vi.fn().mockReturnValue(null),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
        storeHistoryServiceForReuse: vi.fn(),
      };

      (
        config as unknown as { agentClient: typeof mockExistingClient }
      ).agentClient = mockExistingClient;
      AgentClient.mockImplementation(() => mockNewClient);

      await config.refreshAuth();

      expect(mockExistingClient.getHistory).not.toHaveBeenCalled();
      expect(mockExistingClient.getChat).toHaveBeenCalled();
      expect(chatGetHistory).toHaveBeenCalled();
      expect(mockExistingClient.getHistoryService).not.toHaveBeenCalled();
      expect(mockNewClient.storeHistoryServiceForReuse).not.toHaveBeenCalled();
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalledWith(
        committedHistory,
      );
      expect(mockNewClient.storeHistoryForLaterUse).not.toHaveBeenCalledWith(
        partialInFlightHistory,
      );
    });

    it('should handle case when no existing client is initialized', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        setHistory: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
      };

      // No existing client
      (config as unknown as { agentClient: null }).agentClient = null;
      AgentClient.mockImplementation(() => mockNewClient);

      await config.refreshAuth();

      // Verify that new client was created and initialized
      expect(AgentClient).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          provider: expect.any(String),
        }),
      );
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);

      // Verify that setHistory was not called since there was no existing history
      expect(mockNewClient.setHistory).not.toHaveBeenCalled();
    });

    it('should strip thought signatures when switching from GenAI to Vertex', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
        vertexai: false,
      };
      (
        config as unknown as { contentGeneratorConfig: ContentGeneratorConfig }
      ).contentGeneratorConfig = mockContentConfig;

      (createContentGeneratorConfig as Mock).mockReturnValue({
        ...mockContentConfig,
        vertexai: true,
      });

      const mockExistingHistory: Content[] = [
        {
          role: 'model',
          parts: [
            {
              text: 'Hidden reasoning',
              thought: true,
              thoughtSignature: 'genai-signature',
            },
            { text: 'Visible response' },
          ],
        },
      ];
      const mockHistoryService = { setTokenizerFactory: vi.fn() };
      const mockExistingClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue(mockExistingHistory),
        getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
      };
      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        setHistory: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
        storeHistoryServiceForReuse: vi.fn(),
      };

      (
        config as unknown as { agentClient: typeof mockExistingClient }
      ).agentClient = mockExistingClient;
      AgentClient.mockImplementation(() => mockNewClient);

      await config.refreshAuth();

      expect(mockNewClient.storeHistoryServiceForReuse).not.toHaveBeenCalled();
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalled();

      const storedHistory =
        mockNewClient.storeHistoryForLaterUse.mock.calls[0][0];
      expect(storedHistory).toStrictEqual([
        {
          role: 'model',
          parts: [
            {
              text: 'Hidden reasoning',
              thought: true,
            },
            { text: 'Visible response' },
          ],
        },
      ]);
    });

    it('should not strip thoughts when switching from Vertex to GenAI', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
        vertexai: true,
      };
      (
        config as unknown as { contentGeneratorConfig: ContentGeneratorConfig }
      ).contentGeneratorConfig = mockContentConfig;

      (createContentGeneratorConfig as Mock).mockReturnValue({
        ...mockContentConfig,
        vertexai: false,
      });

      const mockExistingHistory = [
        { role: 'user', parts: [{ text: 'Hello' }] },
      ];
      const mockExistingClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue(mockExistingHistory),
        getHistoryService: vi.fn().mockReturnValue(null),
      };
      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        setHistory: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
      };

      (
        config as unknown as { agentClient: typeof mockExistingClient }
      ).agentClient = mockExistingClient;
      AgentClient.mockImplementation(() => mockNewClient);

      await config.refreshAuth();

      // When switching from Vertex to GenAI, thoughts should NOT be stripped
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalledWith(
        mockExistingHistory,
      );
    });

    it('should not trigger OAuth when refreshing authentication', async () => {
      const config = new Config(baseParams);

      // Mock OAuth manager that tracks if authenticate was called
      const mockOAuthManager = {
        authenticate: vi.fn().mockResolvedValue(undefined),
        isAuthenticated: vi.fn().mockResolvedValue(false),
        isOAuthEnabled: vi.fn().mockReturnValue(true),
        toggleOAuthEnabled: vi.fn(),
      };

      // Mock provider manager with OAuth-enabled provider
      const mockProviderManager = {
        getProvider: vi.fn().mockReturnValue({
          name: 'anthropic',
          getAuthToken: vi.fn(),
          hasNonOAuthAuthentication: vi.fn().mockResolvedValue(false),
        }),
        switchProvider: vi.fn(),
      };

      // Set up config with provider manager
      (
        config as unknown as { providerManager: typeof mockProviderManager }
      ).providerManager = mockProviderManager;

      const mockContentConfig = {
        model: 'claude-3-5-sonnet-20241022',
        oauthManager: mockOAuthManager,
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
        storeHistoryServiceForReuse: vi.fn(),
      };

      AgentClient.mockImplementation(() => mockNewClient);

      // Call initializeContentGeneratorConfig - this should NOT trigger OAuth
      await config.initializeContentGeneratorConfig();

      // Verify OAuth authenticate was NOT called
      expect(mockOAuthManager.authenticate).not.toHaveBeenCalled();

      // Verify the client was initialized but OAuth was not triggered
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);
    });

    it('should preserve all state after refresh without triggering OAuth', async () => {
      const config = new Config(baseParams);
      await initializeTestConfig(config);

      // Create a client with history
      const mockExistingHistory = [
        { role: 'user', parts: [{ text: 'Previous conversation' }] },
        { role: 'model', parts: [{ text: 'Previous response' }] },
      ];

      const mockHistoryService = {
        addMessage: vi.fn(),
        getMessages: vi.fn().mockReturnValue(mockExistingHistory),
      };

      const mockExistingClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue(mockExistingHistory),
        getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
      };

      // Mock OAuth manager - should not be called
      const mockOAuthManager = {
        authenticate: vi.fn().mockResolvedValue(undefined),
        isAuthenticated: vi.fn().mockResolvedValue(false),
      };

      (
        config as unknown as { agentClient: typeof mockExistingClient }
      ).agentClient = mockExistingClient;

      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
        oauthManager: mockOAuthManager,
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue(mockExistingHistory),
        getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
        initialize: vi.fn().mockResolvedValue(undefined),
        storeHistoryForLaterUse: vi.fn(),
        storeHistoryServiceForReuse: vi.fn(),
      };

      AgentClient.mockImplementation(() => mockNewClient);

      // Refresh auth
      await config.refreshAuth();

      // Verify history was preserved
      expect(mockExistingClient.getHistory).toHaveBeenCalled();
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalledWith(
        mockExistingHistory,
      );
      expect(mockNewClient.storeHistoryServiceForReuse).not.toHaveBeenCalled();

      // CRITICAL: Verify OAuth was NOT triggered during refresh
      expect(mockOAuthManager.authenticate).not.toHaveBeenCalled();
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();

      // Verify client was initialized
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);
    });

    it('should dispose the previous Gemini client before replacing it', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      const dispose = vi.fn();
      const mockExistingClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockResolvedValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        dispose,
      };

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        getHistoryService: vi.fn().mockReturnValue(null),
        storeHistoryForLaterUse: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
      };

      (
        config as unknown as { agentClient: typeof mockExistingClient }
      ).agentClient = mockExistingClient;
      AgentClient.mockImplementation(() => mockNewClient);

      await config.refreshAuth();

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);
    });
  });

  it('Config constructor should store userMemory correctly', () => {
    const config = new Config(baseParams);

    expect(config.getUserMemory()).toBe(USER_MEMORY);
    // Verify other getters if needed
    expect(config.getTargetDir()).toBe(path.resolve(TARGET_DIR)); // Check resolved path
  });

  it('Config constructor should default userMemory to empty string if not provided', () => {
    const paramsWithoutMemory: ConfigParameters = { ...baseParams };
    delete paramsWithoutMemory.userMemory;
    const config = new Config(paramsWithoutMemory);

    expect(config.getUserMemory()).toBe('');
  });

  it('getCoreMemory should delegate to contextManager when JIT context is enabled', async () => {
    const config = new Config({
      ...baseParams,
      jitContextEnabled: true,
    });
    await initializeTestConfig(config);

    const contextManager = config.getContextManager();
    expect(contextManager).toBeDefined();

    const expected = 'Always use TypeScript';
    vi.spyOn(contextManager!, 'getCoreMemory').mockReturnValue(expected);

    expect(config.getCoreMemory()).toBe(expected);
  });

  it('getCoreMemory should return undefined when JIT context is disabled', () => {
    const config = new Config({
      ...baseParams,
      jitContextEnabled: false,
    });

    expect(config.getCoreMemory()).toBeUndefined();
  });

  it('getCoreMemory should return empty string when contextManager has no core memory files', async () => {
    const config = new Config({
      ...baseParams,
      jitContextEnabled: true,
    });
    await initializeTestConfig(config);

    const contextManager = config.getContextManager();
    vi.spyOn(contextManager!, 'getCoreMemory').mockReturnValue('');

    expect(config.getCoreMemory()).toBe('');
  });

  it('Config constructor should call setLlxprtMdFilename with contextFileName if provided', () => {
    const contextFileName = 'CUSTOM_AGENTS.md';
    const paramsWithContextFile: ConfigParameters = {
      ...baseParams,
      contextFileName,
    };
    new Config(paramsWithContextFile);
    expect(mockSetLlxprtMdFilename).toHaveBeenCalledWith(contextFileName);
  });

  it('Config constructor should not call setLlxprtMdFilename if contextFileName is not provided', () => {
    new Config(baseParams); // baseParams does not have contextFileName
    expect(mockSetLlxprtMdFilename).not.toHaveBeenCalled();
  });

  it('should set default file filtering settings when not provided', () => {
    const config = new Config(baseParams);
    expect(config.getFileFilteringRespectGitIgnore()).toBe(
      DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
    );
  });

  it('should set custom file filtering settings when provided', () => {
    const paramsWithFileFiltering: ConfigParameters = {
      ...baseParams,
      fileFiltering: {
        respectGitIgnore: false,
      },
    };
    const config = new Config(paramsWithFileFiltering);
    expect(config.getFileFilteringRespectGitIgnore()).toBe(false);
  });

  it('should initialize WorkspaceContext with includeDirectories', () => {
    // Use real directories that exist for this test
    const tempDir = os.tmpdir();
    const resolved = fs.realpathSync(tempDir);
    // Create test subdirectories
    const dir1 = path.join(tempDir, `test-include-dir1-${Date.now()}`);
    const dir2 = path.join(tempDir, `test-include-dir2-${Date.now()}`);
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });
    try {
      const paramsWithIncludeDirs: ConfigParameters = {
        ...baseParams,
        targetDir: tempDir,
        includeDirectories: [dir1, dir2],
      };
      const config = new Config(paramsWithIncludeDirs);
      const workspaceContext = config.getWorkspaceContext();
      const directories = workspaceContext.getDirectories();
      // Should include the target directory plus the included directories
      expect(directories).toHaveLength(3);
      expect(directories).toContain(resolved);
      expect(directories).toContain(fs.realpathSync(dir1));
      expect(directories).toContain(fs.realpathSync(dir2));
    } finally {
      // Cleanup
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('Config constructor should set telemetry to true when provided as true', () => {
    const paramsWithTelemetry: ConfigParameters = {
      ...baseParams,
      telemetry: { enabled: true },
    };
    const config = new Config(paramsWithTelemetry);
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('Config constructor should set telemetry to false when provided as false', () => {
    const paramsWithTelemetry: ConfigParameters = {
      ...baseParams,
      telemetry: { enabled: false },
    };
    const config = new Config(paramsWithTelemetry);
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('Config constructor should default telemetry to default value if not provided', () => {
    const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
    delete paramsWithoutTelemetry.telemetry;
    const config = new Config(paramsWithoutTelemetry);
    expect(config.getTelemetryEnabled()).toBe(TELEMETRY_SETTINGS.enabled);
  });

  it('should have a getFileService method that returns FileDiscoveryService', () => {
    const config = new Config(baseParams);
    const fileService = config.getFileService();
    expect(fileService).toBeDefined();
  });
});
