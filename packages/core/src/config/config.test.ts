/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { ConfigParameters, SandboxConfig } from './config.js';
import { Config, ApprovalMode } from './config.js';
import * as path from 'node:path';
import { setLlxprtMdFilename as mockSetLlxprtMdFilename } from '../tools/memoryTool.js';
import {
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';
import {
  AuthType,
  ContentGeneratorConfig,
  createContentGeneratorConfig,
} from '../core/contentGenerator.js';
import { GeminiClient } from '../core/client.js';
import { GitService } from '../services/gitService.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import type { SettingsService } from '../settings/SettingsService.js';

import { ShellTool } from '../tools/shell.js';
import { ReadFileTool } from '../tools/read-file.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({
      isDirectory: vi.fn().mockReturnValue(true),
    }),
    realpathSync: vi.fn((path) => path),
  };
});

// Mock dependencies that might be called during Config construction or createServerConfig
vi.mock('../tools/tool-registry', () => {
  const ToolRegistryMock = vi.fn();
  ToolRegistryMock.prototype.registerTool = vi.fn();
  ToolRegistryMock.prototype.discoverAllTools = vi.fn();
  ToolRegistryMock.prototype.getAllTools = vi.fn(() => []); // Mock methods if needed
  ToolRegistryMock.prototype.getTool = vi.fn();
  ToolRegistryMock.prototype.getFunctionDeclarations = vi.fn(() => []);
  return { ToolRegistry: ToolRegistryMock };
});

// Mock individual tools if their constructors are complex or have side effects
vi.mock('../tools/ls');
vi.mock('../tools/read-file');
vi.mock('../tools/grep');
vi.mock('../tools/glob');
vi.mock('../tools/edit');
vi.mock('../tools/shell');
vi.mock('../tools/write-file');
vi.mock('../tools/web-fetch');
vi.mock('../tools/read-many-files');
vi.mock('../tools/memoryTool', () => ({
  MemoryTool: vi.fn(),
  setLlxprtMdFilename: vi.fn(),
  getCurrentLlxprtMdFilename: vi.fn(() => 'LLXPRT.md'), // Mock the original filename
  DEFAULT_CONTEXT_FILENAME: 'LLXPRT.md',
  LLXPRT_CONFIG_DIR: '.llxprt',
}));

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../core/contentGenerator.js')>();
  return {
    ...actual,
    createContentGeneratorConfig: vi.fn(),
  };
});

vi.mock('../core/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(false),
    getHistory: vi.fn().mockReturnValue([]),
    getHistoryService: vi.fn().mockReturnValue(null),
    setHistory: vi.fn(),
  })),
}));

vi.mock('../telemetry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../telemetry/index.js')>();
  return {
    ...actual,
    initializeTelemetry: vi.fn(),
  };
});

vi.mock('../services/gitService.js', () => {
  const GitServiceMock = vi.fn();
  GitServiceMock.prototype.initialize = vi.fn();
  return { GitService: GitServiceMock };
});

vi.mock('../settings/settingsServiceInstance.js', () => {
  const mockSettingsService = {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    getProviderSettings: vi.fn(() => ({})),
  };
  return {
    getSettingsService: vi.fn(() => mockSettingsService),
    resetSettingsService: vi.fn(),
    registerSettingsService: vi.fn(),
  };
});

vi.mock('../ide/ide-client.js', () => ({
  IdeClient: {
    getInstance: vi.fn().mockResolvedValue({
      getConnectionStatus: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn(),
    }),
  },
}));

describe('Server Config (config.ts)', () => {
  const MODEL = 'gemini-pro';
  const SANDBOX: SandboxConfig = {
    command: 'docker',
    image: 'gemini-cli-sandbox',
  };
  const TARGET_DIR = '/path/to/target';
  const DEBUG_MODE = false;
  const QUESTION = 'test question';
  const FULL_CONTEXT = false;
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
    fullContext: FULL_CONTEXT,
    userMemory: USER_MEMORY,
    telemetry: TELEMETRY_SETTINGS,
    sessionId: SESSION_ID,
    model: MODEL,
    settingsService: sharedSettingsService,
  };

  beforeEach(() => {
    // Reset mocks if necessary
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should throw an error if checkpointing is enabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (GitService.prototype.initialize as Mock).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      await expect(config.initialize()).rejects.toThrow(gitError);
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (GitService.prototype.initialize as Mock).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await expect(config.initialize()).resolves.toBeUndefined();
    });

    it('should throw an error if initialized more than once', async () => {
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await expect(config.initialize()).resolves.toBeUndefined();
      await expect(config.initialize()).rejects.toThrow(
        'Config was already initialized',
      );
    });
  });

  describe('refreshAuth', () => {
    it('should refresh auth and update config', async () => {
      const config = new Config(baseParams);
      // Initialize config to create GeminiClient instance
      await config.initialize();

      const authType = AuthType.USE_GEMINI;
      const newModel = 'gemini-flash';
      const mockContentConfig = {
        model: newModel,
        apiKey: 'test-key',
      };

      (createContentGeneratorConfig as Mock).mockReturnValue(mockContentConfig);

      // Set fallback mode to true to ensure it gets reset
      config.setFallbackMode(true);
      expect(config.isInFallbackMode()).toBe(true);

      await config.refreshAuth(authType);

      expect(createContentGeneratorConfig).toHaveBeenCalledWith(
        config,
        authType,
      );
      // Verify that contentGeneratorConfig is updated with the new model
      expect(config.getContentGeneratorConfig()).toEqual(mockContentConfig);
      expect(config.getContentGeneratorConfig()?.model).toBe(newModel);
      expect(config.getModel()).toBe(newModel); // getModel() should return the updated model
      expect(GeminiClient).toHaveBeenCalledWith(
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
      const authType = AuthType.USE_GEMINI;
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
        config as unknown as { geminiClient: typeof mockExistingClient }
      ).geminiClient = mockExistingClient;
      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      await config.refreshAuth(authType);

      // Verify that existing history was retrieved
      expect(mockExistingClient.getHistory).toHaveBeenCalled();

      // Verify that new client was created and initialized
      expect(GeminiClient).toHaveBeenCalledWith(
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

    it('should handle case when no existing client is initialized', async () => {
      const config = new Config(baseParams);
      const authType = AuthType.USE_GEMINI;
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
      (config as unknown as { geminiClient: null }).geminiClient = null;
      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      await config.refreshAuth(authType);

      // Verify that new client was created and initialized
      expect(GeminiClient).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          provider: expect.any(String),
        }),
      );
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);

      // Verify that setHistory was not called since there was no existing history
      expect(mockNewClient.setHistory).not.toHaveBeenCalled();
    });

    it('should strip thoughts when switching from GenAI to Vertex', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
        authType: AuthType.USE_GEMINI,
      };
      (
        config as unknown as { contentGeneratorConfig: ContentGeneratorConfig }
      ).contentGeneratorConfig = mockContentConfig;

      (createContentGeneratorConfig as Mock).mockReturnValue({
        ...mockContentConfig,
        authType: AuthType.LOGIN_WITH_GOOGLE,
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
        config as unknown as { geminiClient: typeof mockExistingClient }
      ).geminiClient = mockExistingClient;
      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);

      // When switching from GenAI to Vertex, thoughts should be stripped
      // The history is stored with thoughts stripped before initialize
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalled();

      // Get the actual call arguments to verify thoughts stripping
      const storedHistory =
        mockNewClient.storeHistoryForLaterUse.mock.calls[0][0];
      expect(storedHistory).toEqual(mockExistingHistory);
    });

    it('should not strip thoughts when switching from Vertex to GenAI', async () => {
      const config = new Config(baseParams);
      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
        authType: AuthType.LOGIN_WITH_GOOGLE,
      };
      (
        config as unknown as { contentGeneratorConfig: ContentGeneratorConfig }
      ).contentGeneratorConfig = mockContentConfig;

      (createContentGeneratorConfig as Mock).mockReturnValue({
        ...mockContentConfig,
        authType: AuthType.USE_GEMINI,
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
        config as unknown as { geminiClient: typeof mockExistingClient }
      ).geminiClient = mockExistingClient;
      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      await config.refreshAuth(AuthType.USE_GEMINI);

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
        authType: AuthType.USE_PROVIDER,
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

      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      // Call refreshAuth - this should NOT trigger OAuth
      await config.refreshAuth(AuthType.USE_PROVIDER);

      // Verify OAuth authenticate was NOT called
      expect(mockOAuthManager.authenticate).not.toHaveBeenCalled();

      // Verify the client was initialized but OAuth was not triggered
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);
    });

    it('should preserve all state after refresh without triggering OAuth', async () => {
      const config = new Config(baseParams);
      await config.initialize();

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
        config as unknown as { geminiClient: typeof mockExistingClient }
      ).geminiClient = mockExistingClient;

      const mockContentConfig = {
        model: 'gemini-pro',
        apiKey: 'test-key',
        authType: AuthType.USE_GEMINI,
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

      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      // Refresh auth
      await config.refreshAuth(AuthType.USE_GEMINI);

      // Verify history was preserved
      expect(mockExistingClient.getHistory).toHaveBeenCalled();
      expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalledWith(
        mockExistingHistory,
      );
      expect(mockNewClient.storeHistoryServiceForReuse).toHaveBeenCalledWith(
        mockHistoryService,
      );

      // CRITICAL: Verify OAuth was NOT triggered during refresh
      expect(mockOAuthManager.authenticate).not.toHaveBeenCalled();
      expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();

      // Verify client was initialized
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
    expect(config.getFileFilteringRespectGitIgnore()).toBe(true);
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
    const includeDirectories = ['/path/to/dir1', '/path/to/dir2'];
    const paramsWithIncludeDirs: ConfigParameters = {
      ...baseParams,
      includeDirectories,
    };
    const config = new Config(paramsWithIncludeDirs);
    const workspaceContext = config.getWorkspaceContext();
    const directories = workspaceContext.getDirectories();

    // Should include the target directory plus the included directories
    expect(directories).toHaveLength(3);
    expect(directories).toContain(path.resolve(baseParams.targetDir));
    expect(directories).toContain('/path/to/dir1');
    expect(directories).toContain('/path/to/dir2');
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

  describe('Telemetry Settings', () => {
    it('should return default telemetry target if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryTarget()).toBe(DEFAULT_TELEMETRY_TARGET);
    });

    it('should return provided OTLP endpoint', () => {
      const endpoint = 'http://custom.otel.collector:4317';
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true, otlpEndpoint: endpoint },
      };
      const config = new Config(params);
      expect(config.getTelemetryOtlpEndpoint()).toBe(endpoint);
    });

    it('should return default OTLP endpoint if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryOtlpEndpoint()).toBe(DEFAULT_OTLP_ENDPOINT);
    });

    it('should return provided logPrompts setting', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true, logPrompts: false },
      };
      const config = new Config(params);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
    });

    it('should return default logPrompts setting (true) if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
    });

    it('should return default logPrompts setting (true) if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
    });

    it('should return default telemetry target if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryTarget()).toBe(DEFAULT_TELEMETRY_TARGET);
    });

    it('should return default OTLP endpoint if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryOtlpEndpoint()).toBe(DEFAULT_OTLP_ENDPOINT);
    });
  });

  describe('Ephemeral Settings with SettingsService Integration', () => {
    let mockSettingsService: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockSettingsService = getSettingsService() as ReturnType<typeof vi.fn>;
      vi.clearAllMocks();
    });

    /**
     * @requirement REQ-002.1
     * @scenario Config delegates ephemeral get
     * @given SettingsService has 'model' = 'gpt-4'
     * @when config.getEphemeralSetting('model') called
     * @then Returns 'gpt-4' from SettingsService
     * @and No local storage accessed
     */
    it('should delegate getEphemeralSetting to SettingsService', () => {
      const config = new Config(baseParams);

      // Reset mock after construction to isolate test
      vi.clearAllMocks();
      mockSettingsService.get.mockReturnValue('gpt-4');

      const result = config.getEphemeralSetting('model');

      expect(mockSettingsService.get).toHaveBeenCalledWith('model');
      expect(result).toBe('gpt-4');
      expect(mockSettingsService.get).toHaveBeenCalledTimes(1);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Config delegates ephemeral set
     * @given SettingsService is available
     * @when config.setEphemeralSetting('temperature', 0.8) called
     * @then SettingsService.set called with 'temperature', 0.8
     * @and No local storage occurs
     */
    it('should delegate setEphemeralSetting to SettingsService', () => {
      const config = new Config(baseParams);

      config.setEphemeralSetting('temperature', 0.8);

      expect(mockSettingsService.set).toHaveBeenCalledWith('temperature', 0.8);
      expect(mockSettingsService.set).toHaveBeenCalledTimes(1);
    });

    /**
     * @requirement REQ-002.3
     * @scenario Config has no local ephemeral storage
     * @given Config instance created
     * @when ephemeral setting is set
     * @then No local ephemeralSettings property exists
     */
    it('should not maintain local ephemeral storage', () => {
      const config = new Config(baseParams);

      config.setEphemeralSetting('test', 'value');

      // Verify no local storage property exists
      expect(
        (config as unknown as { ephemeralSettings?: unknown })
          .ephemeralSettings,
      ).toBeUndefined();
    });

    /**
     * @requirement REQ-002.4
     * @scenario Config operations are synchronous
     * @given Config instance available
     * @when setEphemeralSetting and getEphemeralSetting called
     * @then Operations complete synchronously without await
     */
    it('should complete operations synchronously', () => {
      const config = new Config(baseParams);
      mockSettingsService.get.mockReturnValue(true);

      // No await needed - operations must be synchronous
      config.setEphemeralSetting('instant', true);
      const result = config.getEphemeralSetting('instant');

      expect(result).toBe(true);
      expect(mockSettingsService.set).toHaveBeenCalledWith('instant', true);
      expect(mockSettingsService.get).toHaveBeenCalledWith('instant');
    });

    /**
     * @requirement REQ-002.4
     * @scenario Multiple settings operations are synchronous
     * @given Config instance available
     * @when multiple ephemeral settings are modified
     * @then All operations complete synchronously
     */
    it('should handle multiple synchronous operations', () => {
      const config = new Config(baseParams);

      // Reset mock after construction to isolate test
      vi.clearAllMocks();
      mockSettingsService.get
        .mockReturnValueOnce('provider1')
        .mockReturnValueOnce('model1')
        .mockReturnValueOnce(0.7);

      // All operations should be synchronous
      config.setEphemeralSetting('provider', 'provider1');
      config.setEphemeralSetting('model', 'model1');
      config.setEphemeralSetting('temperature', 0.7);

      const provider = config.getEphemeralSetting('provider');
      const model = config.getEphemeralSetting('model');
      const temperature = config.getEphemeralSetting('temperature');

      expect(provider).toBe('provider1');
      expect(model).toBe('model1');
      expect(temperature).toBe(0.7);

      expect(mockSettingsService.set).toHaveBeenCalledTimes(3);
      expect(mockSettingsService.get).toHaveBeenCalledTimes(3);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Config delegates get with various data types
     * @given SettingsService returns different types
     * @when getEphemeralSetting called for different keys
     * @then Correct values returned for each type
     */
    it('should delegate get operations for various data types', () => {
      const config = new Config(baseParams);

      // Reset mock after construction to isolate test
      vi.clearAllMocks();
      mockSettingsService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'stringValue':
            return 'test string';
          case 'numberValue':
            return 42;
          case 'booleanValue':
            return true;
          case 'objectValue':
            return { nested: 'object' };
          case 'arrayValue':
            return [1, 2, 3];
          case 'undefinedValue':
            return undefined;
          default:
            return null;
        }
      });

      expect(config.getEphemeralSetting('stringValue')).toBe('test string');
      expect(config.getEphemeralSetting('numberValue')).toBe(42);
      expect(config.getEphemeralSetting('booleanValue')).toBe(true);
      expect(config.getEphemeralSetting('objectValue')).toEqual({
        nested: 'object',
      });
      expect(config.getEphemeralSetting('arrayValue')).toEqual([1, 2, 3]);
      expect(config.getEphemeralSetting('undefinedValue')).toBeUndefined();

      expect(mockSettingsService.get).toHaveBeenCalledTimes(6);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Config delegates set with various data types
     * @given Config instance available
     * @when setEphemeralSetting called with different types
     * @then All values properly delegated to SettingsService
     */
    it('should delegate set operations for various data types', () => {
      const config = new Config(baseParams);

      const testValues = {
        stringValue: 'test string',
        numberValue: 42,
        booleanValue: true,
        objectValue: { nested: 'object' },
        arrayValue: [1, 2, 3],
        nullValue: null,
      };

      Object.entries(testValues).forEach(([key, value]) => {
        config.setEphemeralSetting(key, value);
        expect(mockSettingsService.set).toHaveBeenCalledWith(key, value);
      });

      expect(mockSettingsService.set).toHaveBeenCalledTimes(6);
    });

    /**
     * @requirement REQ-001.3
     * @scenario Return to SettingsService clear functionality
     * @given Config instance exists
     * @when clear ephemeral settings is needed
     * @then SettingsService clear is called
     */
    it('should use SettingsService for clearing operations', () => {
      const config = new Config(baseParams);
      const settingsService = config.getSettingsService();

      // Call clear on the settings service directly
      settingsService.clear();

      expect(mockSettingsService.clear).toHaveBeenCalledTimes(1);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Config accesses SettingsService correctly
     * @given Config instance exists
     * @when getSettingsService is called
     * @then Same instance is returned
     */
    it('should provide access to SettingsService instance', () => {
      const config = new Config(baseParams);

      const settingsService1 = config.getSettingsService();
      const settingsService2 = config.getSettingsService();

      expect(settingsService1).toBe(settingsService2);
      expect(settingsService1).toBe(mockSettingsService);
    });
  });

  describe('UseRipgrep Configuration', () => {
    it('should default useRipgrep to false when not provided', () => {
      const config = new Config(baseParams);
      expect(config.getUseRipgrep()).toBe(false);
    });

    it('should set useRipgrep to true when provided as true', () => {
      const paramsWithRipgrep: ConfigParameters = {
        ...baseParams,
        useRipgrep: true,
      };
      const config = new Config(paramsWithRipgrep);
      expect(config.getUseRipgrep()).toBe(true);
    });

    it('should set useRipgrep to false when explicitly provided as false', () => {
      const paramsWithRipgrep: ConfigParameters = {
        ...baseParams,
        useRipgrep: false,
      };
      const config = new Config(paramsWithRipgrep);
      expect(config.getUseRipgrep()).toBe(false);
    });

    it('should default useRipgrep to false when undefined', () => {
      const paramsWithUndefinedRipgrep: ConfigParameters = {
        ...baseParams,
        useRipgrep: undefined,
      };
      const config = new Config(paramsWithUndefinedRipgrep);
      expect(config.getUseRipgrep()).toBe(false);
    });
  });

  describe('createToolRegistry', () => {
    it('should register a tool if coreTools contains an argument-specific pattern', async () => {
      const params: ConfigParameters = {
        ...baseParams,
        coreTools: ['ShellTool(git status)'],
      };
      const config = new Config(params);
      await config.initialize();

      // The ToolRegistry class is mocked, so we can inspect its prototype's methods.
      const registerToolMock = (
        (await vi.importMock('../tools/tool-registry')) as {
          ToolRegistry: { prototype: { registerTool: Mock } };
        }
      ).ToolRegistry.prototype.registerTool;

      // Check that registerTool was called for ShellTool
      const wasShellToolRegistered = (registerToolMock as Mock).mock.calls.some(
        (call) => call[0] instanceof vi.mocked(ShellTool),
      );
      expect(wasShellToolRegistered).toBe(true);

      // Check that registerTool was NOT called for ReadFileTool
      const wasReadFileToolRegistered = (
        registerToolMock as Mock
      ).mock.calls.some((call) => call[0] instanceof vi.mocked(ReadFileTool));
      expect(wasReadFileToolRegistered).toBe(false);
    });
  });
});

describe('setApprovalMode with folder trust', () => {
  const baseParams: ConfigParameters = {
    sessionId: 'test',
    targetDir: '.',
    debugMode: false,
    model: 'test-model',
    cwd: '.',
  };

  it('should throw an error when setting YOLO mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(false);
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('should throw an error when setting AUTO_EDIT mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(false);
    expect(() => config.setApprovalMode(ApprovalMode.AUTO_EDIT)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('should NOT throw an error when setting DEFAULT mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(false);
    expect(() => config.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });

  it('should NOT throw an error when setting any mode in a trusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(true);
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.AUTO_EDIT)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });

  it('should NOT throw an error when setting any mode if trustedFolder is undefined', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(true); // isTrustedFolder defaults to true
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.AUTO_EDIT)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });
});
