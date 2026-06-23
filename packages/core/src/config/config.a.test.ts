/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { ConfigParameters, SandboxConfig } from './config.js';
import { Config } from './config.js';
import type { ToolSchedulerFactoryOptions } from '../core/toolSchedulerContract.js';
import { GitService } from '../services/gitService.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
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

  describe('initialize', () => {
    it('should throw an error if checkpointing is enabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (GitService.prototype.initialize as Mock).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      await expect(initializeTestConfig(config)).rejects.toThrow(gitError);
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (GitService.prototype.initialize as Mock).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await expect(initializeTestConfig(config)).resolves.toBeUndefined();
    });

    it('should throw an error if initialized more than once', async () => {
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await expect(initializeTestConfig(config)).resolves.toBeUndefined();
      await expect(initializeTestConfig(config)).rejects.toThrow(
        'Config was already initialized',
      );
    });

    it('should initialize and expose a ResourceRegistry instance', async () => {
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await initializeTestConfig(config);

      const getResourceRegistry = (
        config as unknown as {
          getResourceRegistry?: () => unknown;
        }
      ).getResourceRegistry;
      expect(getResourceRegistry).toBeTypeOf('function');
      expect(getResourceRegistry?.call(config)).toBeInstanceOf(
        ResourceRegistry,
      );
    });
  });
});
