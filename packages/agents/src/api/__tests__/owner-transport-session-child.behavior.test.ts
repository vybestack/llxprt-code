/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  startLocalForwardProxy,
  type ForwardProxyRequest,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { Agent } from '../agent.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgent } from '../createAgent.js';
import { fromConfig } from '../fromConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const SETTLE_LIMIT_MS = 5_000;

class KeepingFetchProvider extends OpenAIProvider {
  constructor(
    baseUrl: string,
    private readonly keep: (sessionFetch: NetworkFetch) => void,
  ) {
    super('test-key', baseUrl);
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.keep(options.invocation.fetch);
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'kept' }] };
  }
}

function respond(host: string, request: ForwardProxyRequest): Response {
  if (request.path === '/v1/chat/completions') {
    const text = `from-${host}`;
    const chunk = (delta: object, finish: string | null): string =>
      `data: ${JSON.stringify({
        id: 'proxied',
        object: 'chat.completion.chunk',
        model: 'child-model',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    return new Response(
      chunk({ role: 'assistant', content: text }, null) +
        chunk({}, 'stop') +
        'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  return new Response(`canned-${host}`);
}

async function eventually(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + SETTLE_LIMIT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settlesWithin(work: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), SETTLE_LIMIT_MS);
  });
  const outcome = await Promise.race([work.then(() => 'settled'), limit]);
  clearTimeout(timer);
  return outcome === 'settled';
}

describe('owner transport below the root', () => {
  const credentials = useOwnedCredentials();
  const proxies: LocalForwardProxy[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  let promptDirectory: string;
  let directory: string;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'owner-transport-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'owner-transport-session-'));
  });

  afterEach(async () => {
    for (const proxy of proxies) {
      proxy.release('model-a.invalid');
      proxy.release('model-b.invalid');
    }
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const proxy of proxies.splice(0)) await proxy.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function startProxy(
    ...hosts: readonly string[]
  ): Promise<LocalForwardProxy> {
    const proxy = await startLocalForwardProxy(
      Object.fromEntries(
        hosts.map((host) => [
          host,
          (request: ForwardProxyRequest) => respond(host, request),
        ]),
      ),
    );
    proxies.push(proxy);
    return proxy;
  }

  describe('subagent requests', () => {
    interface ParentRoot {
      readonly agent: Agent;
      readonly proxy: LocalForwardProxy;
      readonly childHost: string;
      readonly parentHost: string;
    }

    async function createParent(letter: 'a' | 'b'): Promise<ParentRoot> {
      const parentHost = `model-${letter}.invalid`;
      const childHost = `child-${letter}.invalid`;
      const proxy = await startProxy(parentHost, childHost);
      const root = join(directory, letter);
      const profileDirectory = join(root, 'profiles');
      const subagentDirectory = join(root, 'subagents');
      const profiles = new ProfileManager(profileDirectory);
      await profiles.saveProfile('child-profile', {
        version: 1,
        provider: 'openai',
        model: 'child-model',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': 'test-key',
          'base-url': `http://${childHost}/v1`,
        },
      });
      await new SubagentManager(subagentDirectory, profiles).saveSubagent(
        'proxied-child',
        'child-profile',
        'Return the requested text.',
      );
      const config = new Config({
        ...toConfigParameters({
          provider: 'openai',
          model: 'gpt-4o',
          workingDir: directory,
          proxy: proxy.url,
          approvalMode: ApprovalMode.YOLO,
          folderTrust: true,
          coreTools: ['task'],
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
        }),
        sessionId: `owner-transport-parent-${letter}`,
        profileDirectory,
        subagentDirectory,
      });
      const settings = new SettingsService();
      for (const [key, value] of Object.entries(config.getInitialSettings()))
        settings.set(key, value);
      const agent = await fromConfig(
        config,
        settings,
        {
          activation: {
            provider: 'openai',
            model: 'gpt-4o',
            authMode: 'auto',
            cliOverrides: {
              key: 'test-key',
              baseUrl: `http://${parentHost}/v1`,
            },
          },
        },
        credentials().authority,
      );
      cleanups.push(async () => {
        await agent.dispose();
        await config.dispose();
      });
      return { agent, proxy, childHost, parentHost };
    }

    async function runChild(root: ParentRoot): Promise<void> {
      const task = root.agent.tools.get('task');
      if (task === undefined) throw new Error('Parent has no task tool');
      const outcome = await task
        .build({
          subagent_name: 'proxied-child',
          goal_prompt: 'Return the requested text.',
          async: false,
          timeout_seconds: 8,
        })
        .execute(new AbortController().signal);
      expect(outcome.error).toBeUndefined();
    }

    it('sends each child request through its own parent proxy and leaves the parent network open afterwards', async () => {
      const left = await createParent('a');
      const right = await createParent('b');

      await runChild(left);
      await runChild(right);

      expect(
        left.proxy.requestsTo(left.childHost).map(({ path }) => path),
      ).toContain('/v1/chat/completions');
      expect(left.proxy.requestsTo('child-b.invalid')).toHaveLength(0);
      expect(
        right.proxy.requestsTo(right.childHost).map(({ path }) => path),
      ).toContain('/v1/chat/completions');
      expect(right.proxy.requestsTo('child-a.invalid')).toHaveLength(0);

      expect(await left.agent.generate('hi')).toContain(
        `from-${left.parentHost}`,
      );
      expect(
        left.proxy.requestsTo(left.parentHost).map(({ path }) => path),
      ).toContain('/v1/chat/completions');
    }, 60_000);
  });

  describe('the fetch a session hands to its provider', () => {
    interface TurnRoot {
      readonly agent: Agent;
      readonly proxy: LocalForwardProxy;
      readonly host: string;
      readonly sessionFetch: () => NetworkFetch;
    }

    async function createTurnRoot(letter: 'a' | 'b'): Promise<TurnRoot> {
      const host = `model-${letter}.invalid`;
      const proxy = await startProxy(host);
      let kept: NetworkFetch | undefined;
      const providerContributions = buildProviderContributionRegistry([
        {
          specifier: `memory:session-fetch-${letter}`,
          manifest: {
            apiVersion: 1,
            id: `session-fetch-${letter}`,
            providers: [
              {
                providerId: `kept-openai-${letter}`,
                createProvider: (entry) => {
                  const provider = new KeepingFetchProvider(
                    `http://${host}/v1`,
                    (sessionFetch) => {
                      kept = sessionFetch;
                    },
                  );
                  bindProviderAliasIdentity(provider, entry.alias);
                  return provider;
                },
                builtinAliases: [
                  {
                    alias: `kept-local-${letter}`,
                    config: {
                      baseProvider: `kept-openai-${letter}`,
                      'base-url': `http://${host}/v1`,
                      'requires-auth': false,
                      defaultModel: 'kept-default',
                      staticModels: [{ id: 'kept-default', name: 'Kept' }],
                    },
                  },
                ],
              },
            ],
          },
        },
      ]);
      const agent = await createAgent({
        provider: `kept-local-${letter}`,
        model: 'kept-default',
        providerContributions,
        proxy: proxy.url,
        workingDir: directory,
        credentialAuthority: credentials().authority,
        harness: { includeProcessCwd: false },
      });
      cleanups.push(() => agent.dispose());
      for await (const _event of agent.stream('hello')) {
        // Drain the turn so the provider has been called.
      }
      return {
        agent,
        proxy,
        host,
        sessionFetch: () => {
          if (kept === undefined) throw new Error('No session fetch was kept');
          return kept;
        },
      };
    }

    it('works while the root is alive and stays on its own root proxy', async () => {
      const left = await createTurnRoot('a');
      const right = await createTurnRoot('b');

      const response = await left.sessionFetch()(
        `http://${left.host}/v1/models`,
      );

      expect(await response.text()).toBe(`canned-${left.host}`);
      expect(
        left.proxy.requestsTo(left.host).map(({ path }) => path),
      ).toContain('/v1/models');
      expect(right.proxy.requestsTo(right.host)).toHaveLength(0);
    }, 60_000);

    it('is aborted by the root disposal without waiting for the held request, and only for that root', async () => {
      const left = await createTurnRoot('a');
      const right = await createTurnRoot('b');
      left.proxy.hold(left.host);
      right.proxy.hold(right.host);
      const leftHeld = left
        .sessionFetch()(`http://${left.host}/v1/held`)
        .then(
          () => 'answered',
          (error: unknown) => error,
        );
      const rightHeld = right
        .sessionFetch()(`http://${right.host}/v1/held`)
        .then(
          async (response) => response.text(),
          (error: unknown) => error,
        );
      await eventually(
        () =>
          left.proxy
            .requestsTo(left.host)
            .some(({ path }) => path === '/v1/held') &&
          right.proxy
            .requestsTo(right.host)
            .some(({ path }) => path === '/v1/held'),
        'both held requests reach their proxies',
      );

      const disposeSettled = await settlesWithin(left.agent.dispose());
      right.proxy.release(right.host);

      expect(disposeSettled).toBe(true);
      expect(await leftHeld).toBeInstanceOf(Error);
      await eventually(
        () =>
          left.proxy
            .requestsTo(left.host)
            .filter(({ path }) => path === '/v1/held')
            .every(({ closed }) => closed),
        'the held socket closes',
      );
      expect(await rightHeld).toBe(`canned-${right.host}`);
    }, 60_000);

    it('rejects new requests after the root disposed and records none at the proxy', async () => {
      const left = await createTurnRoot('a');
      await left.agent.dispose();
      const recorded = left.proxy.requests.length;

      const outcome = await left
        .sessionFetch()(`http://${left.host}/v1/models`)
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(outcome).toMatchObject({ message: 'Root fetch is closed' });
      expect(left.proxy.requests).toHaveLength(recorded);
    }, 60_000);

    it('ends a turn whose model request is held when the root disposes', async () => {
      const host = 'model-a.invalid';
      const proxy = await startProxy(host);
      const agent = await createAgent({
        provider: 'openai',
        model: 'gpt-4o',
        auth: { apiKey: 'test-key', baseUrl: `http://${host}/v1` },
        proxy: proxy.url,
        workingDir: directory,
        credentialAuthority: credentials().authority,
        harness: { includeProcessCwd: false },
      });
      cleanups.push(() => agent.dispose());
      proxy.hold(host);
      const turn = (async (): Promise<void> => {
        for await (const _event of agent.stream('hello')) {
          // Drain until the turn ends.
        }
      })().then(
        () => undefined,
        (error: unknown) => error,
      );
      await eventually(
        () => proxy.requestsTo(host).length === 1,
        'the held model request reaches the proxy',
      );

      expect(await settlesWithin(agent.dispose())).toBe(true);
      await turn;
      await eventually(
        () => proxy.requestsTo(host)[0].closed,
        'the held socket closes',
      );
    }, 60_000);
  });
});
