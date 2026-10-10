/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { transferHistoryToNewClient } from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createTestAgentClient } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from './helpers/provider-auth-fixtures.js';
import type { BuiltCliConfig } from './helpers/buildCliStyleConfig.js';
import { describe, expect, it, vi } from 'bun:test';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { createRuntimeActivationBindings } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import {
  buildAgent,
  drain,
  internalConfig,
  internalSettingsOwner,
} from './helpers/agentHarness.js';

describe('explicit provider owner construction', () => {
  it('constructs a public Agent without storing manager authority on Config', async () => {
    const built = await buildAgent('multi-turn-text.jsonl');
    try {
      const events = await drain(
        built.agent.stream('Construct without a Config service locator'),
      );
      expect(events.some((event) => event.type === 'text')).toBe(true);
      expect('providerManager' in internalConfig(built.agent)).toBe(false);
      expect('getProviderManager' in internalConfig(built.agent)).toBe(false);
      expect('setProviderManager' in internalConfig(built.agent)).toBe(false);
    } finally {
      await built.cleanup();
    }
  });

  it('adopts an initialized caller Config and exact explicit manager without manager discovery', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const client = built.agentClient;
    await client.startChat();
    Object.defineProperty(built.config, 'getProviderManager', {
      configurable: true,
      value: () => {
        throw new Error('Forbidden Config provider manager discovery');
      },
    });
    try {
      const options = {
        settingsService: built.settingsService,
        config: built.config,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        mcpRuntime: built.mcpRuntime,
      };
      const agent = await fromConfig(options);
      try {
        expect(internalConfig(agent)).toBe(built.config);
        expect(agent.providerManager).toBe(built.providerManager);
        expect(client).toBe(built.agentClient);
        const events = await drain(agent.stream('Adopt the explicit owner'));
        expect(events.some((event) => event.type === 'text')).toBe(true);
        await agent.dispose();
        expect(client.isInitialized()).toBe(true);
        expect(built.providerManager.hasActiveProvider()).toBe(true);
        await client.startChat();
        expect(client.hasChatInitialized()).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('keeps the caller client usable after explicit-owner activation failure', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const client = built.agentClient;
    await client.startChat();
    Object.defineProperty(built.config, 'getProviderManager', {
      configurable: true,
      value: () => {
        throw new Error('Forbidden Config provider manager discovery');
      },
    });
    try {
      const options = {
        settingsService: built.settingsService,
        config: built.config,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        mcpRuntime: built.mcpRuntime,
        activation: { provider: 'missing-provider', authMode: 'auto' },
      };
      await expect(
        fromConfig({
          ...options,
          activation: { ...options.activation, authMode: 'auto' },
        }),
      ).rejects.toThrow('activation failed');
      expect(client.isInitialized()).toBe(true);
      expect(built.providerManager.getActiveProviderName()).toBe('fake');
      await client.startChat();
      expect(client.hasChatInitialized()).toBe(true);
    } finally {
      await built.cleanup();
    }
  });

  it('publishes telemetry changes to an explicit lifecycle subscriber without manager ownership', async () => {
    const built = await buildAgent('multi-turn-text.jsonl');
    const settings = internalSettingsOwner(built.agent);
    const observed: boolean[] = [];
    const unsubscribe = settings.onTelemetrySettingsChange(() =>
      observed.push(settings.readTelemetrySettings().enabled === true),
    );
    try {
      await settings.updateTelemetrySettings({ enabled: true });
      expect(observed.length).toBe(1);
      unsubscribe();
      await settings.updateTelemetrySettings({ enabled: false });
      expect(observed).toHaveLength(1);
    } finally {
      await built.cleanup();
    }
  });
  it('retains the caller OAuth owner through activation and borrowed facade shutdown', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const callerOAuth = built.runtime.oauthManager;
    const activated: OAuthManager[] = [];
    const bindings = createRuntimeActivationBindings();
    try {
      if (!(callerOAuth instanceof OAuthManager))
        throw new Error('Missing caller OAuth owner');
      const agent = await fromConfig({
        oauthManager: callerOAuth,
        providerFileLifecycle: built.runtime.providerFileLifecycle,
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        config: built.config,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        mcpRuntime: built.mcpRuntime,
        runtimeActivationBindings: {
          ...bindings,
          registerInfrastructure: (manager, oauth, context) => {
            activated.push(oauth);
            return bindings.registerInfrastructure(manager, oauth, context);
          },
        },
      });
      try {
        expect(callerOAuth).toBe(activated[0]);
        built.settingsOwner.writeUserParameter('auth.noBrowser', true);
        expect(activated[0]?.isBrowserDisabled()).toBe(true);
        await agent.dispose();
        built.settingsService.set('auth.noBrowser', false);
        expect(activated[0]?.isBrowserDisabled()).toBe(false);
        expect<typeof callerOAuth>(callerOAuth).toBe(
          built.runtime.oauthManager,
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });
});
describe('explicit session authentication lifecycle', () => {
  async function withSession(
    run: (built: BuiltCliConfig) => Promise<void>,
  ): Promise<void> {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    try {
      await run(built);
    } finally {
      await built.cleanup();
    }
  }
  const history: IContent[] = [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Remember the passphrase' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'PURPLE-TANGERINE-7741' }],
    },
  ];
  it('strips prior session thought signatures during a GenAI to Vertex client replacement', async () => {
    await withSession(async (built) => {
      const priorEnvironment = {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      };
      try {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        await built.agentClient.initialize({
          model: 'fake-model',
          vertexai: false,
        });
        await built.agentClient.setHistory([
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'Reasoning before migration',
                signature: 'genai-session-signature',
              },
              { type: 'text', text: 'Visible history' },
            ],
          },
        ]);
        process.env.GOOGLE_API_KEY = 'local-vertex-metadata-only';
        await built.sessionClient.refreshAuth();
        const retained = await built.agentClient.getHistory();
        expect(
          retained
            .flatMap((content) => content.blocks)
            .filter((block) => 'signature' in block),
        ).toHaveLength(0);
        expect(
          retained
            .flatMap((content) => content.blocks)
            .filter((block) => block.type === 'thinking'),
        ).toHaveLength(1);
      } finally {
        for (const [key, value] of Object.entries(priorEnvironment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  });
  it('refreshes authentication and clears fallback mode', async () => {
    await withSession(async (built) => {
      const previous = built.agentClient;
      built.settingsOwner.chooseModel('replacement-model');
      built.config.setFallbackMode(true);
      await built.sessionClient.refreshAuth();
      expect(built.agentClient.getContentGeneratorConfig()?.model).toBe(
        'replacement-model',
      );
      expect(built.sessionClient.getAgentClient()).not.toBe(previous);
      expect(built.config.isInFallbackMode()).toBe(false);
    });
  });
  it('preserves conversation history when refreshing authentication', async () => {
    await withSession(async (built) => {
      await built.agentClient.setHistory(history);
      await built.sessionClient.refreshAuth();
      await built.agentClient.startChat(await built.agentClient.getHistory());
      expect(
        (await built.agentClient.getHistory()).map(({ speaker, blocks }) => ({
          speaker,
          blocks,
        })),
      ).toStrictEqual(history);
    });
  });
  it('preserves carried history before chat initialization (#2500)', async () => {
    await withSession(async (built) => {
      await built.sessionClient.refreshAuth();
      expect(built.agentClient.hasChatInitialized()).toBe(false);
      await built.agentClient.storeHistoryForLaterUse(history);
      await built.sessionClient.refreshAuth();
      await built.agentClient.startChat(await built.agentClient.getHistory());
      expect(
        (await built.agentClient.getHistory()).map(({ speaker, blocks }) => ({
          speaker,
          blocks,
        })),
      ).toStrictEqual(history);
    });
  });
  it('preserves committed chat history without waiting for idle history', async () => {
    await withSession(async (built) => {
      await built.agentClient.setHistory(history);
      const idleHistory = vi
        .spyOn(built.agentClient, 'getHistory')
        .mockImplementation(async () => {
          throw new Error('Idle history must not be awaited');
        });
      try {
        await built.sessionClient.refreshAuth();
        await built.agentClient.startChat(await built.agentClient.getHistory());
        expect(
          (await built.agentClient.getHistory()).map(({ speaker, blocks }) => ({
            speaker,
            blocks,
          })),
        ).toStrictEqual(history);
      } finally {
        idleHistory.mockRestore();
      }
    });
  });
  it('initializes a replacement without conversation history', async () => {
    await withSession(async (built) => {
      await built.sessionClient.refreshAuth();
      await built.agentClient.startChat(await built.agentClient.getHistory());
      expect(built.agentClient.isInitialized()).toBe(true);
      expect(await built.agentClient.getHistory()).toStrictEqual([]);
    });
  });
  it('strips thought signatures when migrating from GenAI to Vertex', async () => {
    const thoughts: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Hidden reasoning',
            signature: 'genai-signature',
          },
          { type: 'text', text: 'Visible response' },
        ],
      },
    ];
    const stored: IContent[][] = [];
    const client = createTestAgentClient({
      storeHistoryForLaterUse: async (contents) => {
        stored.push(structuredClone([...contents]));
      },
    });
    await transferHistoryToNewClient(
      new DebugLogger('test'),
      client,
      thoughts,
      null,
      { model: 'vertex-model', vertexai: true },
      false,
    );
    expect(
      stored
        .flatMap((contents) => contents.flatMap((content) => content.blocks))
        .some((block) => 'signature' in block),
    ).toBe(false);
    expect(thoughts[0].blocks[0]).toHaveProperty('signature');
  });
  it('preserves thought signatures when migrating from Vertex to GenAI', async () => {
    const thoughts: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Reasoning',
            signature: 'vertex-signature',
          },
        ],
      },
    ];
    const stored: IContent[][] = [];
    const client = createTestAgentClient({
      storeHistoryForLaterUse: async (contents) => {
        stored.push(structuredClone([...contents]));
      },
    });
    await transferHistoryToNewClient(
      new DebugLogger('test'),
      client,
      thoughts,
      null,
      { model: 'genai-model', vertexai: false },
      true,
    );
    expect(
      stored
        .flatMap((contents) => contents.flatMap((content) => content.blocks))
        .filter((block) => 'signature' in block),
    ).toHaveLength(1);
  });
  it('does not trigger OAuth during explicit authentication refresh', async () => {
    await withSession(async (built) => {
      const store = new MemoryTokenStore();
      const oauth = new OAuthManager(store, undefined, {
        config: built.config,
      });
      const provider = createTestProvider('fake');
      let logins = 0;
      oauth.registerProvider({
        ...provider,
        initiateAuth: async () => {
          logins += 1;
          throw new Error('Unexpected OAuth login');
        },
      });
      built.sessionClient.bindProviderFiles(
        built.runtime.providerFileLifecycle,
        (provider) => oauth.composeRetryOperations(provider),
      );
      await built.sessionClient.refreshAuth();
      await built.agentClient.startChat(await built.agentClient.getHistory());
      expect(built.agentClient.isInitialized()).toBe(true);
      expect(logins).toBe(0);
    });
  });
  it('preserves history and caller OAuth ownership after refresh', async () => {
    await withSession(async (built) => {
      await built.agentClient.setHistory(history);
      const oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
        config: built.config,
      });
      built.sessionClient.bindProviderFiles(
        built.runtime.providerFileLifecycle,
        (provider) => oauth.composeRetryOperations(provider),
      );
      await built.sessionClient.refreshAuth();
      await built.agentClient.startChat(await built.agentClient.getHistory());
      expect(
        (await built.agentClient.getHistory()).map(({ speaker, blocks }) => ({
          speaker,
          blocks,
        })),
      ).toStrictEqual(history);
      expect(await oauth.getTokenStore().listProviders()).toStrictEqual([]);
    });
  });
  it('disposes the retired client without disposing the replacement', async () => {
    await withSession(async (built) => {
      const previous = built.agentClient;
      const previousListeners = coreEvents.listeners(CoreEvent.ModelChanged);
      await built.sessionClient.refreshAuth();
      expect(previous).not.toBe(built.agentClient);
      expect(
        coreEvents
          .listeners(CoreEvent.ModelChanged)
          .filter((listener) => previousListeners.includes(listener)),
      ).toStrictEqual([]);
      await built.agentClient.startChat(await built.agentClient.getHistory());
      expect(built.agentClient.isInitialized()).toBe(true);
    });
  });
});
