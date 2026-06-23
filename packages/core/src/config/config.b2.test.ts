/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigParameters, SandboxConfig } from './config.js';
import { Config } from './config.js';
import {
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';
import type { ToolSchedulerFactoryOptions } from '../core/toolSchedulerContract.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestConfig } from '../test-utils/config.js';

import { ShellTool, ReadFileTool } from '@vybestack/llxprt-code-tools';

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
      expect(config.getEphemeralSetting('objectValue')).toStrictEqual({
        nested: 'object',
      });
      expect(config.getEphemeralSetting('arrayValue')).toStrictEqual([1, 2, 3]);
      expect(config.getEphemeralSetting('undefinedValue')).toBeUndefined();

      expect(mockSettingsService.get).toHaveBeenCalledTimes(6);
    });

    it('should coerce numeric string context-limit values when reading', () => {
      const config = new Config(baseParams);

      vi.clearAllMocks();
      mockSettingsService.get.mockImplementation((key: string) => {
        if (key === 'context-limit') {
          return '190000';
        }
        return undefined;
      });

      expect(config.getEphemeralSetting('context-limit')).toBe(190000);
      expect(mockSettingsService.get).toHaveBeenCalledWith('context-limit');
      expect(mockSettingsService.set).toHaveBeenCalledWith(
        'context-limit',
        190000,
      );
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

    it('should normalize context-limit inputs before persisting', () => {
      const config = new Config(baseParams);

      vi.clearAllMocks();
      config.setEphemeralSetting('context-limit', '190000');

      expect(mockSettingsService.set).toHaveBeenCalledWith(
        'context-limit',
        190000,
      );
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

  describe('ContinueOnFailedApiCall Configuration', () => {
    it('should default continueOnFailedApiCall to true when not provided', () => {
      const config = new Config(baseParams);
      expect(config.getContinueOnFailedApiCall()).toBe(true);
    });

    it('should set continueOnFailedApiCall to true when provided as true', () => {
      const paramsWithContinueOnFailedApiCall: ConfigParameters = {
        ...baseParams,
        continueOnFailedApiCall: true,
      };
      const config = new Config(paramsWithContinueOnFailedApiCall);
      expect(config.getContinueOnFailedApiCall()).toBe(true);
    });

    it('should set continueOnFailedApiCall to false when explicitly provided as false', () => {
      const paramsWithContinueOnFailedApiCall: ConfigParameters = {
        ...baseParams,
        continueOnFailedApiCall: false,
      };
      const config = new Config(paramsWithContinueOnFailedApiCall);
      expect(config.getContinueOnFailedApiCall()).toBe(false);
    });
  });

  describe('PTY terminal size configuration', () => {
    it('should accept only positive finite PTY dimensions', () => {
      const config = new Config(baseParams);

      config.setPtyTerminalSize(120.9, 40.1);
      expect(config.getPtyTerminalWidth()).toBe(120);
      expect(config.getPtyTerminalHeight()).toBe(40);

      config.setPtyTerminalSize(0, 25);
      expect(config.getPtyTerminalWidth()).toBeUndefined();
      expect(config.getPtyTerminalHeight()).toBe(25);

      config.setPtyTerminalSize(-10, Number.NaN);
      expect(config.getPtyTerminalWidth()).toBeUndefined();
      expect(config.getPtyTerminalHeight()).toBeUndefined();

      config.setPtyTerminalSize(Number.POSITIVE_INFINITY, -1);
      expect(config.getPtyTerminalWidth()).toBeUndefined();
      expect(config.getPtyTerminalHeight()).toBeUndefined();
    });
  });

  describe('createToolRegistry', () => {
    it('should register a tool if coreTools contains an argument-specific pattern', async () => {
      const params: ConfigParameters = {
        ...baseParams,
        coreTools: ['ShellTool(git status)'],
      };
      const config = new Config(params);
      await initializeTestConfig(config);

      // The ToolRegistry class is mocked, so inspect the created instance method.
      const registerToolMock = vi.mocked(config.getToolRegistry().registerTool);

      // Check that registerTool was called for ShellTool
      const wasShellToolRegistered = registerToolMock.mock.calls.some(
        (call) => call[0] instanceof vi.mocked(ShellTool),
      );
      expect(wasShellToolRegistered).toBe(true);

      // Check that registerTool was NOT called for ReadFileTool
      const wasReadFileToolRegistered = registerToolMock.mock.calls.some(
        (call) => call[0] instanceof vi.mocked(ReadFileTool),
      );
      expect(wasReadFileToolRegistered).toBe(false);
    });
  });

  describe('Proxy Configuration Error Handling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should call setGlobalProxy when proxy is configured', () => {
      const paramsWithProxy: ConfigParameters = {
        ...baseParams,
        proxy: 'http://proxy.example.com:8080',
      };
      new Config(paramsWithProxy);

      expect(mockSetGlobalProxy).toHaveBeenCalledWith(
        'http://proxy.example.com:8080',
      );
    });

    it('should not call setGlobalProxy when proxy is not configured', () => {
      new Config(baseParams);

      expect(mockSetGlobalProxy).not.toHaveBeenCalled();
    });

    it('should emit error feedback when setGlobalProxy throws an error', () => {
      const proxyError = new Error('Invalid proxy URL');
      mockSetGlobalProxy.mockImplementation(() => {
        throw proxyError;
      });

      const paramsWithProxy: ConfigParameters = {
        ...baseParams,
        proxy: 'invalid-proxy',
      };
      new Config(paramsWithProxy);

      expect(mockCoreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        'Invalid proxy configuration detected. Check debug drawer for more details (F12)',
        proxyError,
      );
    });

    it('should not emit error feedback when setGlobalProxy succeeds', () => {
      mockSetGlobalProxy.mockImplementation(() => {
        // Success - no error thrown
      });

      const paramsWithProxy: ConfigParameters = {
        ...baseParams,
        proxy: 'http://proxy.example.com:8080',
      };
      new Config(paramsWithProxy);

      expect(mockCoreEvents.emitFeedback).not.toHaveBeenCalled();
    });
  });
});
