/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared harness for the split config test files
 * (config.a/b/b2/d.test.ts). Centralizes the mock module bodies, the
 * AgentClient/CoreToolScheduler mock classes, the baseParams construction and
 * the beforeEach reset so the four files stay in sync.
 *
 * Hoisting note: vitest hoists `vi.mock(...)` to the top of the consuming file
 * and evaluates the factory before any module-scope imports (other than
 * `vi.hoisted`) are initialized. Therefore each test file keeps its own inline
 * `vi.mock(path, factory)` calls (so the factory is a literal arrow, not an
 * imported reference), but delegates the body to the helpers in this module via
 * a dynamic `await import('./configTestHarness.js')` inside the factory. The
 * three values that mock bodies close over (loadJitSubdirectoryMemory,
 * coreEvents, setGlobalProxy) are declared with `vi.hoisted` in each test file
 * and passed in.
 */

import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ConfigParameters, SandboxConfig } from './config.js';
import type { ToolSchedulerFactoryOptions } from '../core/toolSchedulerContract.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type * as SettingsModule from '@vybestack/llxprt-code-settings';
import type * as ToolsModule from '@vybestack/llxprt-code-tools';
import type * as IdeIntegrationModule from '@vybestack/llxprt-code-ide-integration';

// NOTE: This module intentionally has NO runtime (value) imports from any
// module that the config test files mock with `vi.mock`. Value imports here
// would be evaluated when a `vi.mock` factory does
// `await import('./configTestHarness.js')`, and because that happens during
// mock resolution it can deadlock if the harness pulls in a mocked module.
// `getSettingsService` (from the mocked settings package) is therefore passed
// into `createBaseParams` by each test file instead of being imported here.

// ---------------------------------------------------------------------------
// Hoisted mock value type aliases (consumers create these via vi.hoisted)
// ---------------------------------------------------------------------------

export type LoadJitSubdirectoryMemoryMock = ReturnType<typeof vi.fn>;
export type CoreEventsMock = {
  emitFeedback: ReturnType<typeof vi.fn>;
  emitModelChanged: ReturnType<typeof vi.fn>;
  emitConsoleLog: ReturnType<typeof vi.fn>;
};
export type SetGlobalProxyMock = ReturnType<typeof vi.fn>;

export interface HoistedConfigMocks {
  loadJitSubdirectoryMemory: LoadJitSubdirectoryMemoryMock;
  coreEvents: CoreEventsMock;
  setGlobalProxy: SetGlobalProxyMock;
}

// ---------------------------------------------------------------------------
// Mock module *body* builders. Each returns the object that the corresponding
// `vi.mock` factory should return. `actual` is the real module obtained by the
// factory via `await importOriginal()`.
// ---------------------------------------------------------------------------

export function buildFsMockBody(actual: unknown) {
  return {
    ...(actual as object),
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({
      isDirectory: vi.fn().mockReturnValue(true),
    }),
    realpathSync: vi.fn((p: unknown) => p),
  };
}

export function buildToolsMockBody(actual: typeof ToolsModule) {
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
}

export function buildContentGeneratorMockBody(actual: unknown) {
  return {
    ...(actual as object),
    createContentGeneratorConfig: vi.fn(),
  };
}

export function buildTelemetryMockBody() {
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
}

export function buildGitServiceMockBody() {
  const GitServiceMock = vi.fn();
  GitServiceMock.prototype.initialize = vi.fn();
  return { GitService: GitServiceMock };
}

export async function buildSettingsMockBody() {
  const actual = await vi.importActual<typeof SettingsModule>(
    '@vybestack/llxprt-code-settings',
  );
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
}

export function buildIdeIntegrationMockBody(
  actual: typeof IdeIntegrationModule,
) {
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
}

export function buildMemoryDiscoveryMockBody(hoisted: HoistedConfigMocks) {
  return {
    loadGlobalMemory: vi.fn().mockResolvedValue({ files: [] }),
    loadEnvironmentMemory: vi.fn().mockResolvedValue({ files: [] }),
    loadJitSubdirectoryMemory: hoisted.loadJitSubdirectoryMemory,
    loadCoreMemory: vi.fn().mockResolvedValue({ files: [] }),
    concatenateInstructions: vi.fn().mockReturnValue(''),
    getAllLlxprtMdFilenames: vi.fn().mockReturnValue([]),
    loadServerHierarchicalMemory: vi.fn().mockResolvedValue({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    }),
  };
}

export function buildEventsMockBody(
  actual: unknown,
  hoisted: HoistedConfigMocks,
) {
  return {
    ...(actual as object),
    coreEvents: {
      ...hoisted.coreEvents,
      emit: vi.fn(),
    },
  };
}

export function buildFetchMockBody(hoisted: HoistedConfigMocks) {
  return {
    setGlobalProxy: hoisted.setGlobalProxy,
  };
}

// ---------------------------------------------------------------------------
// Shared AgentClient / CoreToolScheduler mock classes
// ---------------------------------------------------------------------------

export const AgentClient = vi.fn().mockImplementation(() => ({
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

export class CoreToolScheduler {
  constructor(_options: ToolSchedulerFactoryOptions) {}
  schedule = vi.fn().mockResolvedValue(undefined);
  cancelAll = vi.fn();
  dispose = vi.fn();
  setCallbacks = vi.fn();
  handleConfirmationResponse = vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Shared base params + constants
// ---------------------------------------------------------------------------

export const sharedConfigTestConstants = {
  MODEL: 'gemini-pro',
  SANDBOX: {
    command: 'docker',
    image: 'llxprt-code-sandbox',
  } as SandboxConfig,
  TARGET_DIR: '/path/to/target',
  DEBUG_MODE: false,
  QUESTION: 'test question',
  USER_MEMORY: 'Test User Memory',
  TELEMETRY_SETTINGS: { enabled: false },
  EMBEDDING_MODEL: 'gemini-embedding',
  SESSION_ID: 'test-session-id',
};

/**
 * Shared `baseParams` used by config.a / config.b / config.b2. config.d declares
 * its own local baseParams per describe block, so it intentionally does not use
 * this helper.
 *
 * `settingsService` is passed in by the caller (rather than obtained via
 * `getSettingsService()` here) to keep this module free of runtime imports
 * from mocked modules (see file header).
 */
export function createBaseParams(
  settingsService: SettingsService,
): ConfigParameters {
  return {
    cwd: '/tmp',
    embeddingModel: sharedConfigTestConstants.EMBEDDING_MODEL,
    sandbox: sharedConfigTestConstants.SANDBOX,
    targetDir: sharedConfigTestConstants.TARGET_DIR,
    debugMode: sharedConfigTestConstants.DEBUG_MODE,
    question: sharedConfigTestConstants.QUESTION,
    userMemory: sharedConfigTestConstants.USER_MEMORY,
    telemetry: sharedConfigTestConstants.TELEMETRY_SETTINGS,
    sessionId: sharedConfigTestConstants.SESSION_ID,
    model: sharedConfigTestConstants.MODEL,
    settingsService,
    agentClientFactory: (config, runtimeState) =>
      new AgentClient(config, runtimeState),
    toolSchedulerFactory: (options) => new CoreToolScheduler(options),
  };
}

/**
 * Shared `beforeEach` body that resets the AgentClient mock implementation.
 */
export function resetAgentClientMock(): void {
  vi.clearAllMocks();
  (AgentClient as unknown as Mock).mockReset();
  (AgentClient as unknown as Mock).mockImplementation(() => ({
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
}
