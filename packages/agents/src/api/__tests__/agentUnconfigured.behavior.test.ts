/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving an Agent backed by a manager with no active
 * provider fails closed on every model-dependent operation (#2481).
 *
 * Uses a REAL recording client whose generation methods are vi.fn spies so we
 * can assert ZERO calls reached the client — the fail-closed guard fires
 * BEFORE any model/client/MCP interaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AgentDeps } from '../agentImpl.js';
import { AgentImpl } from '../agentImpl.js';
import type { AgentEvent } from '../event-types.js';
import type { LoopHolder } from '../loop/rebuildLoop.js';
import type { DisplayCallbacks } from '../../core/agenticLoop/types.js';
import type { EditorCallbacks } from '../config-types.js';
import type { OwnershipRecord } from '../agentBootstrap.js';
import type { StableDisplayCallbacksHolder } from '../agentBootstrap.js';
import {
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';

function makeUnconfiguredProviderManager(): RuntimeProviderManager {
  return {
    hasActiveProvider: () => false,
    getActiveProvider: () => undefined,
    getActiveProviderName: () => undefined,
    listProviders: () => [],
    getServerToolsProvider: () => null,
    setConfig: () => {},
    registerProvider: () => {},
    setActiveProvider: () => {},
    clearActiveProvider: () => {},
    getAvailableModels: async () => [],
    setServerToolsProvider: () => {},
    accumulateSessionTokens: () => {},
    getSessionTokenUsage: () => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
    getProviderMetrics: () => null,
    resetSessionTokenUsage: () => {},
    setTokenizerFactory: () => {},
    getTokenizerFactory: () => undefined,
  } as unknown as RuntimeProviderManager;
}

function makeUnconfiguredRuntimeState(): AgentRuntimeState {
  return {
    runtimeId: 'test-unconfigured-runtime',
    provider: UNCONFIGURED_PROVIDER,
    model: PLACEHOLDER_MODEL,
    sessionId: 'test-unconfigured-session',
    updatedAt: Date.now(),
  };
}

/**
 * Builds a client with vi.fn spies on every generation entry-point.
 * The spies are returned so tests can assert they were never called.
 */
function makeRecordingClient(): AgentClientContract & {
  __spies: {
    generateDirectMessage: ReturnType<typeof vi.fn>;
    generateJson: ReturnType<typeof vi.fn>;
    generateEmbedding: ReturnType<typeof vi.fn>;
    startChat: ReturnType<typeof vi.fn>;
    getChat: ReturnType<typeof vi.fn>;
  };
} {
  const generateDirectMessage = vi.fn(async () => ({
    content: { blocks: [] },
  }));
  const generateJson = vi.fn(async () => ({}));
  const generateEmbedding = vi.fn(async () => []);
  const startChat = vi.fn(async () => {});
  const getChat = vi.fn();

  const client = {
    isInitialized: () => true,
    getHistory: async () => [],
    setHistory: async () => {},
    addHistory: async () => {},
    restoreHistory: async () => {},
    resetChat: async () => {},
    updateSystemInstruction: async () => {},
    addDirectoryContext: async () => {},
    getChat,
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    hasChatInitialized: () => false,
    startChat,
    generateDirectMessage,
    generateJson,
    generateEmbedding,
    getUserTier: () => undefined,
    getCurrentSequenceModel: () => null,
  } as unknown as AgentClientContract;

  return Object.assign(client, {
    __spies: {
      generateDirectMessage,
      generateJson,
      generateEmbedding,
      startChat,
      getChat,
    },
  });
}

function makeLoopHolder(): LoopHolder {
  return {
    loop: null,
    activeRunController: null,
    subscriptions: [],
  };
}

function makeOwnership(): OwnershipRecord {
  return {
    config: {
      dispose: async () => {},
      getExtensionLoader: () => ({ unloadExtension: async () => {} }),
      shutdownLspService: async () => {},
    } as unknown as Config,
    messageBus: {} as MessageBus,
    loopHolder: makeLoopHolder(),
    runtimeState: makeUnconfiguredRuntimeState(),
    injectedSchedulerHandles: [],
    configOwnership: 'agent',
    disposed: false,
    lspShutDown: false,
    extensionsDisposed: false,
    sessionLocks: [],
    sessionLocksReleased: false,
  } as unknown as OwnershipRecord;
}

function makeDeps(
  manager: RuntimeProviderManager,
  client: AgentClientContract,
): AgentDeps {
  const policyEngine = {
    getRules: () => [],
    getActiveDecision: () => 'allow',
  };
  const messageBus = new MessageBus(policyEngine as never, false);
  const config = {
    getAgentClient: () => client,
    getSettingsService: () => ({}) as unknown as SettingsService,
    getProviderManager: () => manager,
    getToolRegistry: () => ({
      getAllTools: () => [],
      getEnabledTools: () => [],
    }),
    getPolicyEngine: () => policyEngine,
    getDebugMode: () => false,
    getApprovalMode: () => 'default',
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: () => {},
    getEphemeralSettings: () => ({}),
    getMcpClientManager: () => undefined,
    getModel: () => PLACEHOLDER_MODEL,
    getProvider: () => undefined,
    initializeContentGeneratorConfig: async () => {},
    getConversationLoggingEnabled: () => false,
    getAsyncTaskManager: () => undefined,
    getIdeMode: () => false,
    getTargetDir: () => '/tmp',
    getProjectRoot: () => '/tmp',
    getProxy: () => undefined,
    getWorkspaceContext: () => ({ addDirectory: () => {} }),
    getUsageStatisticsEnabled: () => false,
    setProviderManager: () => {},
    getLspConfig: () => undefined,
    getLspServiceClient: () => undefined,
    getSkillManager: () => undefined,
    getExtensionLoader: () => ({ unloadExtension: async () => {} }),
    getMemory: () => '',
    getFileCount: () => 0,
    getFilePaths: () => [],
    getCoreMemory: () => undefined,
    getCoreFileCount: () => 0,
    setCoreMemory: () => {},
    getRuntimeMessageBus: () => undefined,
    getRuntimeOAuthManager: () => undefined,
  } as unknown as Config;

  return {
    config,
    providerManager: manager,
    oauthManager: {
      dispose: async () => {},
      attachAddItemToProviders: () => {},
    } as unknown as OAuthManager,
    settingsService: {} as unknown as SettingsService,
    runtimeId: 'test-unconfigured-runtime',
    runtimeHandle: { cleanup: () => {} },
    messageBus,
    loopHolder: makeLoopHolder(),
    runtimeState: makeUnconfiguredRuntimeState(),
    ownership: makeOwnership(),
    rebuildLoop: () => {},
    resolveClient: () => client,
    displayCallbacks: {} as unknown as DisplayCallbacks,
    editorCallbacksHolder: { editorCallbacks: {} as EditorCallbacks },
    displayCallbacksHolder: {} as unknown as StableDisplayCallbacksHolder,
  };
}

describe('AgentImpl: fail-closed when unconfigured (#2481)', () => {
  let manager: RuntimeProviderManager;
  let client: ReturnType<typeof makeRecordingClient>;
  let deps: AgentDeps;
  let agent: AgentImpl;

  beforeEach(() => {
    manager = makeUnconfiguredProviderManager();
    client = makeRecordingClient();
    deps = makeDeps(manager, client);
    agent = new AgentImpl(deps);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stream yields error + done with actionable /setup message', async () => {
    const events: AgentEvent[] = [];
    for await (const event of agent.stream('hello')) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === 'error');
    const doneEvent = events.find((e) => e.type === 'done');
    expect(errorEvent).toBeDefined();
    expect(doneEvent).toBeDefined();
    expect(errorEvent?.type === 'error' && errorEvent.error.message).toContain(
      '/setup',
    );
    expect(doneEvent?.type === 'done' && doneEvent.reason).toBe('error');

    // Event contract: the error event precedes the done event, and the done
    // event carries reason 'error' without a finished payload (the error
    // details live on the error event, not the done event's optional
    // `finished` field).
    const errorIdx = events.findIndex((e) => e.type === 'error');
    const doneIdx = events.findIndex((e) => e.type === 'done');
    expect(errorIdx).toBeLessThan(doneIdx);
    // doneEvent is guaranteed to be the 'done' variant by the assertion above.
    const doneTyped = doneEvent as Extract<
      (typeof events)[number],
      { type: 'done' }
    >;
    expect(doneTyped.finished).toBeUndefined();
  });

  it('stream makes ZERO generation calls to the client', async () => {
    for await (const _event of agent.stream('hello')) {
      // drain
    }
    expect(client.__spies.generateDirectMessage).not.toHaveBeenCalled();
    expect(client.__spies.generateJson).not.toHaveBeenCalled();
    expect(client.__spies.generateEmbedding).not.toHaveBeenCalled();
    expect(client.__spies.startChat).not.toHaveBeenCalled();
    expect(client.__spies.getChat).not.toHaveBeenCalled();
  });

  it('chat returns AgentResult with error and done reason error', async () => {
    const result = await agent.chat('hello');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('/setup');
    expect(result.finishReason).toBe('error');
  });

  it('chat makes ZERO generation calls to the client', async () => {
    await agent.chat('hello');
    expect(client.__spies.generateDirectMessage).not.toHaveBeenCalled();
    expect(client.__spies.startChat).not.toHaveBeenCalled();
  });

  it('generate rejects with actionable /setup error', async () => {
    await expect(agent.generate('hello')).rejects.toThrow('/setup');
    expect(client.__spies.generateDirectMessage).not.toHaveBeenCalled();
  });

  it('generateJson rejects with actionable /setup error', async () => {
    await expect(agent.generateJson([], { type: 'object' })).rejects.toThrow(
      '/setup',
    );
    expect(client.__spies.generateJson).not.toHaveBeenCalled();
  });

  it('generateEmbedding rejects with actionable /setup error', async () => {
    await expect(agent.generateEmbedding(['hello'])).rejects.toThrow('/setup');
    expect(client.__spies.generateEmbedding).not.toHaveBeenCalled();
  });

  it('setModel rejects with actionable /setup error', async () => {
    await expect(agent.setModel('gpt-4')).rejects.toThrow('/setup');
  });

  it('compress rejects with actionable /setup error', async () => {
    await expect(agent.compress()).rejects.toThrow('/setup');
  });

  it('getProvider returns sentinel UNCONFIGURED_PROVIDER when unconfigured', () => {
    expect(agent.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('getProviderStatus does not expose the UNCONFIGURED_PROVIDER sentinel', () => {
    const status = agent.getProviderStatus();
    // The sentinel must not be exposed as a real provider name in public status.
    expect(status.provider).not.toBe(UNCONFIGURED_PROVIDER);
    // A neutral empty string is the safe representation.
    expect(status.provider).toBe('');
    expect(status.provider).not.toBe('gemini');
    expect(status.provider).not.toBe('openai');
    expect(status.provider).not.toBe('anthropic');
  });

  it('setProvider from unconfigured returns previousProvider null, not sentinel (#2481)', async () => {
    // Under the fake seam, switchActiveProvider throws (no registered runtime)
    // but the error is swallowed — the sentinel must NOT leak as previousProvider.
    const prevFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = '/tmp/fake-unconfigured-test.jsonl';
    try {
      const result = await agent.setProvider('openai');
      expect(result.previousProvider).toBeNull();
    } finally {
      if (prevFake === undefined) {
        delete process.env.LLXPRT_FAKE_RESPONSES;
      } else {
        process.env.LLXPRT_FAKE_RESPONSES = prevFake;
      }
    }
  });
});

describe('fromConfig real orchestration: configured vs unconfigured (#2481)', () => {
  it('fromConfig over a real Config (buildCliStyleConfig) drives a real turn when configured', async () => {
    const { buildCliStyleConfig } = await import(
      './helpers/buildCliStyleConfig.js'
    );
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');

    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // The real Config has FakeProvider active (configured state).
      expect(built.config.getProviderManager()?.hasActiveProvider()).toBe(true);

      const agent = await fromConfig({ config: built.config });

      // A real stream turn must resolve with exactly one done event.
      const events: Array<{ type: string; reason?: string }> = [];
      for await (const event of agent.stream('hello')) {
        events.push(event as { type: string; reason?: string });
      }
      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    } finally {
      await built.cleanup();
    }
  });

  it('first Agent selection: fromConfig picks up the configured active provider', async () => {
    const { buildCliStyleConfig } = await import(
      './helpers/buildCliStyleConfig.js'
    );
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');

    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent = await fromConfig({ config: built.config });

      // The agent should reflect the active FakeProvider, not a sentinel.
      const provider = agent.getProvider();
      expect(provider).toBeDefined();
      expect(provider).not.toBe('unconfigured');
    } finally {
      await built.cleanup();
    }
  });
});
