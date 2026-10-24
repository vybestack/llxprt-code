/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { OpenAIProvider } from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  startLocalForwardProxy,
  type ForwardProxyRequest,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import type { Agent } from '../agent.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgent } from '../createAgent.js';
import { fromConfig } from '../fromConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const HOST_A = 'model-a.invalid';
const HOST_B = 'model-b.invalid';
const CANNED_A = 'model-a-canned';
const CANNED_B = 'model-b-canned';
const SETTLE_LIMIT_MS = 5_000;

class HeldRequestProvider extends OpenAIProvider {
  private started = false;

  constructor(
    private readonly onRegistered: (rootFetch: NetworkFetch) => void,
    baseUrl: string,
  ) {
    super('test-key', baseUrl);
  }

  override bindOwnerAuthentication(
    ...args: Parameters<OpenAIProvider['bindOwnerAuthentication']>
  ): this {
    const [, readFetch] = args;
    if (readFetch !== undefined && !this.started) {
      this.started = true;
      this.onRegistered(readFetch());
    }
    return super.bindOwnerAuthentication(...args);
  }
}

function failingKeyReads(
  base: CredentialAuthority,
  failure: () => Promise<never>,
): CredentialAuthority {
  return new Proxy(base, {
    get(target, property) {
      if (property === 'createProviderKeyStorage') {
        return () => {
          const keys = target.createProviderKeyStorage();
          keys.getKey = failure;
          return keys;
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

type RootKind = 'preferred' | 'adopted';

interface Root {
  readonly agent: Agent;
  readonly proxy: LocalForwardProxy;
  readonly dispose: () => Promise<void>;
}

function respond(
  host: string,
  canned: string,
  request: ForwardProxyRequest,
): Response {
  if (request.path === '/v1/models') {
    return Response.json({
      object: 'list',
      data: [{ id: canned, object: 'model', created: 0, owned_by: host }],
    });
  }
  if (request.path === '/v1/chat/completions') {
    const streaming = (JSON.parse(request.body) as { stream?: boolean }).stream;
    const text = `from-${host}`;
    if (streaming !== true) {
      return Response.json({
        id: 'proxied',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
      });
    }
    const chunk = (delta: object, finish: string | null): string =>
      `data: ${JSON.stringify({
        id: 'proxied',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    return new Response(
      chunk({ role: 'assistant', content: text }, null) +
        chunk({}, 'stop') +
        'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }
  return new Response('ok');
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

describe('owner transport per root', () => {
  const credentials = useOwnedCredentials();
  const proxies: LocalForwardProxy[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'owner-transport-roots-'));
  });

  afterEach(async () => {
    for (const proxy of proxies) {
      proxy.release(HOST_A);
      proxy.release(HOST_B);
    }
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const proxy of proxies.splice(0)) await proxy.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function startProxy(
    host: string,
    canned: string,
  ): Promise<LocalForwardProxy> {
    const proxy = await startLocalForwardProxy({
      [host]: (request) => respond(host, canned, request),
    });
    proxies.push(proxy);
    return proxy;
  }

  async function createRoot(
    kind: RootKind,
    host: string,
    canned: string,
  ): Promise<Root> {
    const proxy = await startProxy(host, canned);
    const baseUrl = `http://${host}/v1`;
    if (kind === 'preferred') {
      const agent = await createAgent({
        provider: 'openai',
        model: 'gpt-4o',
        auth: { apiKey: 'test-key', baseUrl },
        proxy: proxy.url,
        workingDir: directory,
        credentialAuthority: credentials().authority,
        harness: { includeProcessCwd: false },
      });
      const dispose = (): Promise<void> => agent.dispose();
      cleanups.push(dispose);
      return { agent, proxy, dispose };
    }
    const config = new Config(
      toConfigParameters({
        provider: 'openai',
        model: 'gpt-4o',
        workingDir: directory,
        proxy: proxy.url,
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
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
          cliOverrides: { key: 'test-key', baseUrl },
        },
      },
      credentials().authority,
    );
    const dispose = async (): Promise<void> => {
      await agent.dispose();
      await config.dispose();
    };
    cleanups.push(dispose);
    return { agent, proxy, dispose };
  }

  async function modelIds(agent: Agent): Promise<string[]> {
    return (await agent.listAvailableModels()).map(({ id }) => id);
  }

  it('sends a turn through its own proxy only', async () => {
    const left = await createRoot('preferred', HOST_A, CANNED_A);
    const right = await createRoot('preferred', HOST_B, CANNED_B);

    expect(await left.agent.generate('hi')).toContain(`from-${HOST_A}`);
    expect(await right.agent.generate('hi')).toContain(`from-${HOST_B}`);

    expect(left.proxy.requestsTo(HOST_A).length).toBeGreaterThan(0);
    expect(left.proxy.requestsTo(HOST_B)).toHaveLength(0);
    expect(right.proxy.requestsTo(HOST_B).length).toBeGreaterThan(0);
    expect(right.proxy.requestsTo(HOST_A)).toHaveLength(0);
  }, 30_000);

  describe.each<RootKind>(['preferred', 'adopted'])('%s root', (kind) => {
    it('lists models through its own proxy before any turn', async () => {
      const left = await createRoot(kind, HOST_A, CANNED_A);
      const right = await createRoot(kind, HOST_B, CANNED_B);

      expect(await modelIds(left.agent)).toContain(CANNED_A);
      expect(await modelIds(right.agent)).toContain(CANNED_B);

      expect(left.proxy.requestsTo(HOST_A).map(({ path }) => path)).toContain(
        '/v1/models',
      );
      expect(right.proxy.requestsTo(HOST_A)).toHaveLength(0);
    }, 30_000);

    it('ends a held model listing at disposal without waiting for the hold', async () => {
      const left = await createRoot(kind, HOST_A, CANNED_A);
      const right = await createRoot(kind, HOST_B, CANNED_B);
      left.proxy.hold(HOST_A);

      const listing = modelIds(left.agent);
      await eventually(
        () => left.proxy.requestsTo(HOST_A).length === 1,
        'the held listing reaches its proxy',
      );
      const disposal = left.dispose();
      const disposeSettled = await settlesWithin(disposal);
      const rightListing = await modelIds(right.agent);
      left.proxy.release(HOST_A);
      await disposal;

      expect(disposeSettled).toBe(true);
      expect(rightListing).toContain(CANNED_B);
      expect(await listing).not.toContain(CANNED_A);
      await eventually(
        () => left.proxy.requestsTo(HOST_A)[0].closed,
        'the held socket closes',
      );
      expect(left.proxy.requestsTo(HOST_A)).toHaveLength(1);
    }, 30_000);
  });

  it('ends a request held on the root network when construction fails', async () => {
    const proxy = await startProxy(HOST_A, CANNED_A);
    proxy.hold(HOST_A);
    let heldOutcome: Promise<unknown> | undefined;
    const providerContributions = buildProviderContributionRegistry([
      {
        specifier: 'memory:held-root-network',
        manifest: {
          apiVersion: 1,
          id: 'held-root-network',
          providers: [
            {
              providerId: 'held-openai',
              createProvider: (entry) => {
                const provider = new HeldRequestProvider((rootFetch) => {
                  heldOutcome = rootFetch(`http://${HOST_A}/v1/held`).then(
                    () => 'answered',
                    (error: unknown) => error,
                  );
                }, `http://${HOST_A}/v1`);
                bindProviderAliasIdentity(provider, entry.alias);
                return provider;
              },
              builtinAliases: [
                {
                  alias: 'held-local',
                  config: {
                    baseProvider: 'held-openai',
                    'base-url': `http://${HOST_A}/v1`,
                    'requires-auth': false,
                    defaultModel: 'held-default',
                    staticModels: [{ id: 'held-default', name: 'Held' }],
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    const authority = failingKeyReads(credentials().authority, async () => {
      await eventually(
        () => proxy.requestsTo(HOST_A).length === 1,
        'the held request reaches its proxy',
      );
      throw new Error('key store failed');
    });

    const outcome = await createAgent({
      provider: 'held-local',
      model: 'held-default',
      auth: { keyName: 'held-key' },
      providerContributions,
      proxy: proxy.url,
      workingDir: directory,
      credentialAuthority: authority,
      harness: { includeProcessCwd: false },
    }).then(
      (agent) => {
        cleanups.push(() => agent.dispose());
        return undefined;
      },
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).toMatchObject({
      message: expect.stringContaining('key store failed'),
    });
    expect(proxy.requestsTo(HOST_A)).toHaveLength(1);
    expect(await heldOutcome).toBeInstanceOf(Error);
    await eventually(
      () => proxy.requestsTo(HOST_A)[0].closed,
      'the held socket closes',
    );
  }, 30_000);
});
