import { adoptFixture } from './helpers/adoption-fixture.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  ProviderManager,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { Agent } from '../agent.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  describe,
  expect,
  it,
  afterEach as disposeOwnedPolicies,
  vi,
  beforeEach,
  afterEach,
} from 'bun:test';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  type RuntimeProviderManager,
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '../event-types.js';

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

function makeUnconfiguredProviderManager(
  authority: CredentialAuthority,
): ProviderManager {
  return new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    new SettingsService(),
    undefined,
    undefined,
    authority,
  );
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
    bindTelemetry: () => {},
    bindRuntimeSettings: () => {},
    clearTools: () => {},
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

describe('AgentImpl: fail-closed when unconfigured (#2481)', () => {
  const credentials = useOwnedCredentials();
  const releases: Array<() => void | Promise<void>> = [];
  disposeOwnedPolicies(async () => {
    await runCleanupSteps(releases.splice(0).reverse());
  });

  async function makeAgent(
    manager: ProviderManager,
    client: AgentClientContract,
  ): Promise<Agent> {
    const directory = await makeScratchDir('agent-unconfigured-');
    releases.push(() => rm(directory, { recursive: true, force: true }));
    const config = new Config({
      sessionId: 'test-unconfigured-session',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: PLACEHOLDER_MODEL,
      telemetry: { enabled: false },
    });
    releases.push(() => config.dispose());
    releases.push(() => manager.dispose());
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    settingsOwner.bindTelemetry(config);
    releases.push(() => settingsOwner.dispose());
    const policy = new RuntimePolicyOwner(config);
    releases.push(() => policy.dispose());
    const workspace = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    releases.push(() => workspace.dispose());
    await workspace.initialize();
    const mediaStore = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024,
    });
    Object.assign(client, {
      mediaStore,
      assertConfig: (candidate: Config) => {
        if (candidate !== config) throw new Error('Unexpected Config');
      },
      assertProviderManager: (candidate: RuntimeProviderManager) => {
        if (candidate !== manager)
          throw new Error('Unexpected provider manager');
      },
    });
    const providerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    const adopted = await adoptFixture(
      config,
      settingsService,
      { sessionId: 'test-unconfigured-runtime' },
      settingsOwner,
      manager,
      undefined,
      policy.session.messageBus,
      workspace,
      undefined,
      client,
      providerFiles,
      configureProviderTokenizer(manager),
      createRuntimeContentGeneratorFactory(),
      undefined,
      undefined,
      credentials().authority,
      policy,
    );
    releases.push(() => adopted.dispose());
    return adopted;
  }

  let manager: ProviderManager;
  let client: ReturnType<typeof makeRecordingClient>;
  let agent: Agent;

  beforeEach(async () => {
    manager = makeUnconfiguredProviderManager(credentials().authority);
    client = makeRecordingClient();
    agent = await makeAgent(manager, client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stream yields error + done with actionable /setup message', async () => {
    const {
      errorEvent,
      doneEvent,
      errorIdx,
      doneIdx,
      doneTyped,
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
      streamYieldsErrorDoneWithActionableSetupMessageObservation2,
    } = await observeStreamYieldsErrorDoneWithActionableSetupMessage();
    expect(errorEvent).toBeDefined();
    expect(doneEvent).toBeDefined();
    expect(
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
    ).toContain('/setup');
    expect(streamYieldsErrorDoneWithActionableSetupMessageObservation2).toBe(
      'error',
    );
    expect(errorIdx).toBeLessThan(doneIdx);
    expect(doneTyped.finished).toBeUndefined();
  });

  const observeStreamYieldsErrorDoneWithActionableSetupMessage = async () => {
    const events: AgentEvent[] = [];
    for await (const event of agent.stream('hello')) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === 'error');
    const doneEvent = events.find((e) => e.type === 'done');

    // Event contract: the error event precedes the done event, and the done
    // event carries reason 'error' without a finished payload (the error
    // details live on the error event, not the done event's optional
    // `finished` field).
    const errorIdx = events.findIndex((e) => e.type === 'error');
    const doneIdx = events.findIndex((e) => e.type === 'done');

    // doneEvent is guaranteed to be the 'done' variant by the assertion above.
    const doneTyped = doneEvent as Extract<
      (typeof events)[number],
      { type: 'done' }
    >;

    const streamYieldsErrorDoneWithActionableSetupMessageObservation1 =
      errorEvent?.type === 'error' && errorEvent.error.message;
    const streamYieldsErrorDoneWithActionableSetupMessageObservation2 =
      doneEvent?.type === 'done' && doneEvent.reason;
    return {
      errorEvent,
      doneEvent,
      errorIdx,
      doneIdx,
      doneTyped,
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
      streamYieldsErrorDoneWithActionableSetupMessageObservation2,
    };
  };

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
    const { result } =
      await observeSetProviderFromUnconfiguredReturnsPreviousProviderNullNotSentinel2481();
    expect(result.previousProvider).toBeNull();
  });

  const observeSetProviderFromUnconfiguredReturnsPreviousProviderNullNotSentinel2481 =
    async () => {
      // Under the fake seam, switchActiveProvider throws (no registered runtime)
      // but the error is swallowed — the sentinel must NOT leak as previousProvider.
      const prevFake = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = '/tmp/fake-unconfigured-test.jsonl';
      try {
        const result = await agent.setProvider('openai');

        return { result };
      } finally {
        if (prevFake === undefined) {
          delete process.env.LLXPRT_FAKE_RESPONSES;
        } else {
          process.env.LLXPRT_FAKE_RESPONSES = prevFake;
        }
      }
    };
});
