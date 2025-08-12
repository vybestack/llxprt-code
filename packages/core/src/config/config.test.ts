/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { Config, ConfigParameters, SandboxConfig } from './config.js';
import * as path from 'path';
import { setLlxprtMdFilename as mockSetGeminiMdFilename } from '../tools/memoryTool.js';
import {
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';
import {
  AuthType,
  createContentGeneratorConfig,
} from '../core/contentGenerator.js';
import { GeminiClient } from '../core/client.js';
import { GitService } from '../services/gitService.js';
import { IdeClient } from '../ide/ide-client.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';

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
  };
  return {
    getSettingsService: vi.fn(() => mockSettingsService),
    resetSettingsService: vi.fn(),
  };
});

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
    ideClient: IdeClient.getInstance(false),
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
      expect(GeminiClient).toHaveBeenCalledWith(config);
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
      };

      const mockNewClient = {
        isInitialized: vi.fn().mockReturnValue(true),
        getHistory: vi.fn().mockReturnValue([]),
        setHistory: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
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
      expect(GeminiClient).toHaveBeenCalledWith(config);
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);

      // Verify that history was restored to the new client
      expect(mockNewClient.setHistory).toHaveBeenCalledWith(
        mockExistingHistory,
      );
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
        setHistory: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
      };

      // No existing client
      (config as unknown as { geminiClient: null }).geminiClient = null;
      (GeminiClient as Mock).mockImplementation(() => mockNewClient);

      await config.refreshAuth(authType);

      // Verify that new client was created and initialized
      expect(GeminiClient).toHaveBeenCalledWith(config);
      expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig);

      // Verify that setHistory was not called since there was no existing history
      expect(mockNewClient.setHistory).not.toHaveBeenCalled();
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
    expect(mockSetGeminiMdFilename).toHaveBeenCalledWith(contextFileName);
  });

  it('Config constructor should not call setLlxprtMdFilename if contextFileName is not provided', () => {
    new Config(baseParams); // baseParams does not have contextFileName
    expect(mockSetGeminiMdFilename).not.toHaveBeenCalled();
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
});
