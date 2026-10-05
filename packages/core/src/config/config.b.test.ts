/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';
import type { ConfigParameters } from './configTypes.js';
import type { IContent } from '../services/history/IContent.js';
import {
  captureConfigHistory,
  configHistoryRows,
  disposeConfigHistoryJournals,
  readConfigHistory,
} from './config-stream-test-helpers.js';
import { Config, DEFAULT_FILE_FILTERING_OPTIONS } from './config.js';
import * as path from 'node:path';
import { setLlxprtMdFilename as mockSetLlxprtMdFilename } from '@vybestack/llxprt-code-tools';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import { createContentGeneratorConfig } from '../core/contentGenerator.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestConfig } from '../test-utils/config.js';
import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildSettingsMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildFetchMockBody,
  AgentClient,
  createBaseParams,
  resetAgentClientMock,
  streamConfigHistory,
  sharedConfigTestConstants,
  type HoistedConfigMocks,
} from './configTestHarness.js';

const { USER_MEMORY, TARGET_DIR, TELEMETRY_SETTINGS } =
  sharedConfigTestConstants;

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = {
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
} as HoistedConfigMocks;

const __actual = { ...(await import('fs')) };
void vi.mock('fs', () => buildFsMockBody(__actual));

// Mock dependencies that might be called during Config construction or createServerConfig.
const __actual2 = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () =>
  buildToolsMockBody(__actual2),
);

// Mock individual tools if their constructors are complex or have side effects

const __actual3 = { ...(await import('../core/contentGenerator.js')) };
void vi.mock('../core/contentGenerator.js', () =>
  buildContentGeneratorMockBody(__actual3),
);

void vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

void vi.mock('@vybestack/llxprt-code-settings', () => buildSettingsMockBody());

const __actual4 = {
  ...(await import('@vybestack/llxprt-code-ide-integration')),
};
void vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(__actual4),
);

void vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

void vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

const baseParams = createBaseParams(
  getSettingsService() as unknown as SettingsService,
);

describe('Server Config (config.ts)', () => {
  beforeEach(() => {
    resetAgentClientMock();
  });
  afterEach(disposeConfigHistoryJournals);
  describe('refreshAuth', () => {
    it('should refresh auth and update config', configCase0);

    it(
      'should preserve conversation history when refreshing auth',
      configCase1,
    );

    it(
      'preserves carried history when the previous client is not yet initialized (#2500)',
      configCase2,
    );

    it(
      'preserves committed chat history without waiting for an active turn to become idle',
      configCase3,
    );

    it(
      'should handle case when no existing client is initialized',
      configCase4,
    );

    it(
      'should strip thought signatures when switching from GenAI to Vertex',
      configCase5,
    );

    it(
      'should not strip thoughts when switching from Vertex to GenAI',
      configCase6,
    );

    it('should not trigger OAuth when refreshing authentication', configCase7);

    it(
      'should preserve all state after refresh without triggering OAuth',
      configCase8,
    );

    it(
      'should dispose the previous Gemini client before replacing it',
      configCase9,
    );
  });
  it(
    'should have a getFileService method that returns FileDiscoveryService',
    configCase22,
  );
});
describe('Server Config (config.ts): defaults', () => {
  beforeEach(() => {
    resetAgentClientMock();
  });
  afterEach(disposeConfigHistoryJournals);
  it('Config constructor should store userMemory correctly', configCase10);
  it(
    'Config constructor should default userMemory to empty string if not provided',
    configCase11,
  );
  it(
    'getCoreMemory should delegate to contextManager when JIT context is enabled',
    configCase12,
  );
  it(
    'getCoreMemory should return undefined when JIT context is disabled',
    configCase13,
  );
  it(
    'getCoreMemory should return empty string when contextManager has no core memory files',
    configCase14,
  );
  it(
    'Config constructor should call setLlxprtMdFilename with contextFileName if provided',
    configCase15,
  );
  it(
    'Config constructor should not call setLlxprtMdFilename if contextFileName is not provided',
    configCase16,
  );
  it(
    'should set default file filtering settings when not provided',
    configCase17,
  );
  it('should set custom file filtering settings when provided', configCase18);
  it(
    'Config constructor should set telemetry to true when provided as true',
    configCase19,
  );
  it(
    'Config constructor should set telemetry to false when provided as false',
    configCase20,
  );
  it(
    'Config constructor should default telemetry to default value if not provided',
    configCase21,
  );
});

async function configCase0(): Promise<void> {
  const config = new Config(baseParams);
  // Initialize config to create AgentClient instance
  await initializeTestConfig(config);

  const newModel = 'gemini-flash';
  const mockContentConfig = {
    model: newModel,
    apiKey: 'test-key',
  };

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  // Set fallback mode to true to ensure it gets reset
  config.setFallbackMode(true);
  expect(config.isInFallbackMode()).toBe(true);

  await config.refreshAuth();

  expect(createContentGeneratorConfig).toHaveBeenCalledWith(config);
  // Verify that contentGeneratorConfig is updated with the new model
  expect(config.getContentGeneratorConfig()).toStrictEqual(mockContentConfig);
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
}

async function configCase1(): Promise<void> {
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
  };

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  // Mock the existing client with some history
  const mockExistingHistory = configHistoryRows(
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there!' }] },
    { speaker: 'human', blocks: [{ type: 'text', text: 'How are you?' }] },
  );

  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue(mockExistingHistory),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
  };

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    setHistory: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
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
  expect(await readConfigHistory(mockNewClient.streamHistory())).toStrictEqual(
    mockExistingHistory,
  );
  expect(mockNewClient.initializedHistoryCount()).toBe(
    mockExistingHistory.length,
  );

  // Verify that initialize was called after storing history
  expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig, {});
}

async function configCase2(): Promise<void> {
  // Reproduces the --continue second-rebuild scenario: the previous
  // client was created by an earlier refreshAuth + finalizeAgent. It
  // holds restored conversation in `_previousHistory` (surfaced via
  // getHistory()) but its chat/content generator were never lazily
  // initialized (isInitialized() === false). The old `!isInitialized()`
  // guard in extractExistingState discarded that history, so --continue
  // lost model context. getHistory() must still be consulted.
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
  };
  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  const carriedHistory = configHistoryRows(
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Remember the passphrase' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'PURPLE-TANGERINE-7741' }],
    },
  );

  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(false),
    hasChatInitialized: vi.fn().mockReturnValue(false),
    getHistory: vi.fn().mockResolvedValue(carriedHistory),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
  };

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockResolvedValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
  };

  (
    config as unknown as { agentClient: typeof mockExistingClient }
  ).agentClient = mockExistingClient;
  AgentClient.mockImplementation(() => mockNewClient);

  await config.refreshAuth();

  // The carried history must be recovered despite !isInitialized().
  expect(mockExistingClient.getHistory).toHaveBeenCalled();
  expect(await readConfigHistory(mockNewClient.streamHistory())).toStrictEqual(
    carriedHistory,
  );
  expect(mockNewClient.initializedHistoryCount()).toBe(carriedHistory.length);
}

async function configCase3(): Promise<void> {
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
  };
  const committedHistory = configHistoryRows(
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Remember we are fixing issue 2049' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'We are preserving history.' }],
    },
  );
  const partialInFlightHistory: IContent[] = [
    ...committedHistory,
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'This turn is still retrying' }],
    },
  ];

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  const chatGetHistory = vi.fn().mockReturnValue(committedHistory);
  const chatStreamHistory = async function* (): AsyncGenerator<
    IContent,
    void,
    unknown
  > {
    yield* chatGetHistory();
  };
  const mockHistoryService = { setTokenizerFactory: vi.fn() };
  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    hasChatInitialized: vi.fn().mockReturnValue(true),
    getChat: vi.fn().mockReturnValue({
      getHistory: chatGetHistory,
      streamHistory: chatStreamHistory,
    }),
    getHistory: vi.fn(async () => {
      throw new Error('refreshAuth should not wait for idle history');
    }),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
  };

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue(committedHistory),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
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
  const storedHistory = await readConfigHistory(mockNewClient.streamHistory());
  expect(storedHistory).toStrictEqual(committedHistory);
  expect(storedHistory).not.toStrictEqual(partialInFlightHistory);
  expect(mockNewClient.initializedHistoryCount()).toBe(committedHistory.length);
}

async function configCase4(): Promise<void> {
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
  };

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    setHistory: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
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
  expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig, {});

  // Verify that setHistory was not called since there was no existing history
  expect(mockNewClient.setHistory).not.toHaveBeenCalled();
}

async function configCase5(): Promise<void> {
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
    vertexai: false,
  };
  (
    config as unknown as { contentGeneratorConfig: ContentGeneratorConfig }
  ).contentGeneratorConfig = mockContentConfig;

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue({
    ...mockContentConfig,
    vertexai: true,
  });

  const mockExistingHistory = configHistoryRows({
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'Hidden reasoning',
        signature: 'genai-signature',
      },
      { type: 'text', text: 'Visible response' },
    ],
  });
  const mockHistoryService = { setTokenizerFactory: vi.fn() };
  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue(mockExistingHistory),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
  };
  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    setHistory: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
    storeHistoryServiceForReuse: vi.fn(),
  };

  (
    config as unknown as { agentClient: typeof mockExistingClient }
  ).agentClient = mockExistingClient;
  AgentClient.mockImplementation(() => mockNewClient);

  await config.refreshAuth();

  expect(mockNewClient.storeHistoryServiceForReuse).not.toHaveBeenCalled();
  expect(mockNewClient.storeHistoryForLaterUse).toHaveBeenCalled();

  const storedHistory = await readConfigHistory(mockNewClient.streamHistory());
  expect(storedHistory).toStrictEqual(
    configHistoryRows({
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'Hidden reasoning',
        },
        { type: 'text', text: 'Visible response' },
      ],
    }),
  );
}

async function configCase6(): Promise<void> {
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
    vertexai: true,
  };
  (
    config as unknown as { contentGeneratorConfig: ContentGeneratorConfig }
  ).contentGeneratorConfig = mockContentConfig;

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue({
    ...mockContentConfig,
    vertexai: false,
  });

  const mockExistingHistory = configHistoryRows({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Hello' }],
  });
  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue(mockExistingHistory),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
  };
  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    setHistory: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
  };

  (
    config as unknown as { agentClient: typeof mockExistingClient }
  ).agentClient = mockExistingClient;
  AgentClient.mockImplementation(() => mockNewClient);

  await config.refreshAuth();

  // When switching from Vertex to GenAI, thoughts should NOT be stripped
  expect(await readConfigHistory(mockNewClient.streamHistory())).toStrictEqual(
    mockExistingHistory,
  );
  expect(mockNewClient.initializedHistoryCount()).toBe(
    mockExistingHistory.length,
  );
}

async function configCase7(): Promise<void> {
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

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
    storeHistoryServiceForReuse: vi.fn(),
  };

  AgentClient.mockImplementation(() => mockNewClient);

  // Call initializeContentGeneratorConfig - this should NOT trigger OAuth
  await config.initializeContentGeneratorConfig();

  // Verify OAuth authenticate was NOT called
  expect(mockOAuthManager.authenticate).not.toHaveBeenCalled();

  // Verify the client was initialized but OAuth was not triggered
  expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig, {});
}

async function configCase8(): Promise<void> {
  const config = new Config(baseParams);
  await initializeTestConfig(config);

  // Create a client with history
  const mockExistingHistory = configHistoryRows(
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Previous conversation' }],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'Previous response' }] },
  );

  const mockHistoryService = {
    addMessage: vi.fn(),
    getMessages: vi.fn().mockReturnValue(mockExistingHistory),
  };

  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue(mockExistingHistory),
    streamHistory: streamConfigHistory,
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

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue(mockExistingHistory),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(mockHistoryService),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...captureConfigHistory(),
    storeHistoryServiceForReuse: vi.fn(),
  };

  AgentClient.mockImplementation(() => mockNewClient);

  // Refresh auth
  await config.refreshAuth();

  // Verify history was preserved
  expect(mockExistingClient.getHistory).toHaveBeenCalled();
  expect(await readConfigHistory(mockNewClient.streamHistory())).toStrictEqual(
    mockExistingHistory,
  );
  expect(mockNewClient.initializedHistoryCount()).toBe(
    mockExistingHistory.length,
  );
  expect(mockNewClient.storeHistoryServiceForReuse).not.toHaveBeenCalled();

  // CRITICAL: Verify OAuth was NOT triggered during refresh
  expect(mockOAuthManager.authenticate).not.toHaveBeenCalled();
  expect(mockOAuthManager.isAuthenticated).not.toHaveBeenCalled();

  // Verify client was initialized
  expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig, {});
}

async function configCase9(): Promise<void> {
  const config = new Config(baseParams);
  const mockContentConfig = {
    model: 'gemini-pro',
    apiKey: 'test-key',
  };

  (
    createContentGeneratorConfig as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(mockContentConfig);

  const dispose = vi.fn();
  const mockExistingClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockResolvedValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    dispose,
  };

  const mockNewClient = {
    isInitialized: vi.fn().mockReturnValue(true),
    getHistory: vi.fn().mockReturnValue([]),
    streamHistory: streamConfigHistory,
    getHistoryService: vi.fn().mockReturnValue(null),
    ...captureConfigHistory(),
    initialize: vi.fn().mockResolvedValue(undefined),
  };

  (
    config as unknown as { agentClient: typeof mockExistingClient }
  ).agentClient = mockExistingClient;
  AgentClient.mockImplementation(() => mockNewClient);

  await config.refreshAuth();

  expect(dispose).toHaveBeenCalledTimes(1);
  expect(mockNewClient.initialize).toHaveBeenCalledWith(mockContentConfig, {});
}

function configCase10(): void {
  const config = new Config(baseParams);

  expect(config.getUserMemory()).toBe(USER_MEMORY);
  // Verify other getters if needed
  expect(config.getTargetDir()).toBe(path.resolve(TARGET_DIR)); // Check resolved path
}

function configCase11(): void {
  const paramsWithoutMemory: ConfigParameters = { ...baseParams };
  delete paramsWithoutMemory.userMemory;
  const config = new Config(paramsWithoutMemory);

  expect(config.getUserMemory()).toBe('');
}

async function configCase12(): Promise<void> {
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
}

function configCase13(): void {
  const config = new Config({
    ...baseParams,
    jitContextEnabled: false,
  });

  expect(config.getCoreMemory()).toBeUndefined();
}

async function configCase14(): Promise<void> {
  const config = new Config({
    ...baseParams,
    jitContextEnabled: true,
  });
  await initializeTestConfig(config);

  const contextManager = config.getContextManager();
  vi.spyOn(contextManager!, 'getCoreMemory').mockReturnValue('');

  expect(config.getCoreMemory()).toBe('');
}

function configCase15(): void {
  const contextFileName = 'CUSTOM_AGENTS.md';
  const paramsWithContextFile: ConfigParameters = {
    ...baseParams,
    contextFileName,
  };
  new Config(paramsWithContextFile);
  expect(mockSetLlxprtMdFilename).toHaveBeenCalledWith(contextFileName);
}

function configCase16(): void {
  new Config(baseParams); // baseParams does not have contextFileName
  expect(mockSetLlxprtMdFilename).not.toHaveBeenCalled();
}

function configCase17(): void {
  const config = new Config(baseParams);
  expect(config.getFileFilteringRespectGitIgnore()).toBe(
    DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
  );
}

function configCase18(): void {
  const paramsWithFileFiltering: ConfigParameters = {
    ...baseParams,
    fileFiltering: {
      respectGitIgnore: false,
    },
  };
  const config = new Config(paramsWithFileFiltering);
  expect(config.getFileFilteringRespectGitIgnore()).toBe(false);
}

function configCase19(): void {
  const paramsWithTelemetry: ConfigParameters = {
    ...baseParams,
    telemetry: { enabled: true },
  };
  const config = new Config(paramsWithTelemetry);
  expect(config.getTelemetryEnabled()).toBe(true);
}

function configCase20(): void {
  const paramsWithTelemetry: ConfigParameters = {
    ...baseParams,
    telemetry: { enabled: false },
  };
  const config = new Config(paramsWithTelemetry);
  expect(config.getTelemetryEnabled()).toBe(false);
}

function configCase21(): void {
  const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
  delete paramsWithoutTelemetry.telemetry;
  const config = new Config(paramsWithoutTelemetry);
  expect(config.getTelemetryEnabled()).toBe(TELEMETRY_SETTINGS.enabled);
}

function configCase22(): void {
  const config = new Config(baseParams);
  const fileService = config.getFileService();
  expect(fileService).toBeDefined();
}
