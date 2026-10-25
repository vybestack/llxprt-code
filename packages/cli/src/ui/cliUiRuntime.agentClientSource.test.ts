/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { json } from 'node:stream/consumers';
import { z } from 'zod';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';
import {
  generationRecording,
  withGenerationClientOwner,
} from '../../../agents/src/api/__tests__/helpers/generation-client-owner.js';
import { createGenerationProvider } from '../../../agents/src/api/__tests__/helpers/generation-provider.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { fetchGitHubSuggestions } from './hooks/githubAtCompletion.js';
import { buildUiRuntimeFromSource } from './cliUiRuntime.js';
import { buildSlashCommandRuntimeForTest } from '../__tests__/slash-command-runtime-fixture.js';

const MULTI_TURN_REPLAY = fileURLToPath(
  new URL(
    '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
    import.meta.url,
  ),
);
const INITIAL_ALIAS = 'ui-initial-owner';
const PROFILE_ALIAS = 'ui-profile-owner';

function contributeUiProviders(): ProviderContributionRegistry {
  const providerId = 'ui-owner-provider';
  const staticModels = [
    { id: 'fake-model', name: 'Fake model' },
    { id: 'replacement-model', name: 'Replacement model' },
  ];
  return buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry) => {
              const provider = new FakeProvider(
                MULTI_TURN_REPLAY,
                dirname(MULTI_TURN_REPLAY),
              );
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [INITIAL_ALIAS, PROFILE_ALIAS].map((alias) => ({
              alias,
              config: {
                baseProvider: providerId,
                'base-url': 'http://ui-owner.invalid/v1',
                'requires-auth': false,
                defaultModel: 'fake-model',
                staticModels,
              },
            })),
          },
        ],
      },
    },
  ]);
}

describe('UI session client ownership', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'ui-owner-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const credentials = useOwnedCredentials();
  it('routes completion through the explicit session report tool and closes retained completion admission', async () => {
    const requestSchema = z
      .object({
        op: z.enum(['issue.list', 'pr.list']),
        params: z
          .object({
            limit: z.literal(10),
            state: z.literal('open'),
            search: z.string(),
          })
          .strict(),
      })
      .strict();
    const server = createServer((request, response) => {
      void json(request)
        .then((input: unknown) => {
          const { op, params } = requestSchema.parse(input);
          const items = [
            { number: 27, title: params.search.toUpperCase(), state: 'OPEN' },
          ];
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ [op === 'issue.list' ? 'issues' : 'prs']: items }),
          );
        })
        .catch((cause: unknown) =>
          response.destroy(new Error('Invalid completion request', { cause })),
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing completion server');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = MULTI_TURN_REPLAY;
    let route: Awaited<ReturnType<typeof openRouteBPreflight>> | undefined;
    let agent: Agent | undefined;
    try {
      route = await openRouteBPreflight({ authority: credentials().authority });
      await route.prepare();
      agent = await route.createAgent(undefined, {
        githubBrokerClient: {
          runOperation: async (op, params, signal) => {
            const response = await fetch(endpoint, {
              method: 'POST',
              body: JSON.stringify({ op, params }),
              signal,
            });
            const input: unknown = await response.json();
            return z.record(z.unknown()).parse(input);
          },
        },
      });
      const runtime = buildUiRuntimeFromSource(route.config, agent);
      const reads = runtime.app.githubCompletion;
      if (reads === undefined)
        throw new Error('Missing GitHub completion reads');
      expect('submitReport' in reads).toBe(false);
      expect('getGitHubBrokerClient' in runtime.app).toBe(false);
      const suggestions = await fetchGitHubSuggestions(
        reads,
        { kind: 'issue', query: 'completion report' },
        new AbortController().signal,
      );
      expect(suggestions).toStrictEqual([
        {
          label: 'issue-27  COMPLETION REPORT',
          value: 'issue-27',
          description: 'issue · open',
        },
      ]);
      const invalid: unknown = Reflect.apply(reads.readReport, undefined, [
        'issue.create',
        { title: 'forbidden' },
        new AbortController().signal,
      ]);
      await expect(invalid).rejects.toThrow('Invalid enum value');
      await agent.dispose();
      await expect(
        reads.readReport(
          'issue.list',
          { limit: 10, state: 'open', search: 'after close' },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
      expect(
        await fetchGitHubSuggestions(
          reads,
          { kind: 'pr', query: 'closed' },
          new AbortController().signal,
        ),
      ).toStrictEqual([]);
    } finally {
      await runCleanupSteps([
        () => agent?.dispose(),
        () => route?.close(),
        () => {
          if (previousReplay === undefined)
            delete process.env.LLXPRT_FAKE_RESPONSES;
          else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
        },
        async () => {
          const closed = new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          server.closeAllConnections();
          await closed;
        },
      ]);
    }
  });

  it('resolves the published current client without embedding it in the workspace command projection', async () => {
    let route: Awaited<ReturnType<typeof openRouteBPreflight>> | undefined;
    let agent: Agent | undefined;
    try {
      route = await openRouteBPreflight({
        authority: credentials().authority,
        contributions: contributeUiProviders(),
        config: { provider: INITIAL_ALIAS, model: 'fake-model' },
      });
      await route.prepare();
      agent = await route.createAgent({
        provider: INITIAL_ALIAS,
        model: 'fake-model',
      });
      const workspace = buildSlashCommandRuntimeForTest(route.config, agent);
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'carried history' }],
        },
      ]);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: PROFILE_ALIAS,
        model: 'replacement-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(
        (await agent.getHistory()).filter(
          (content) => content.speaker === 'human',
        ),
      ).toHaveLength(1);
      expect('getAgentClient' in workspace).toBe(false);
      expect('createDetachedAgentClient' in workspace).toBe(false);
      expect('getAgentClientFactory' in workspace).toBe(false);
    } finally {
      await runCleanupSteps([() => agent?.dispose(), () => route?.close()]);
    }
  });

  it('creates detached clients from the session owner while retaining the primary client', async () => {
    const initializationChatStates: boolean[] = [];
    const cleanup = await withGenerationClientOwner(
      {
        authority: credentials().authority,
        provider: createGenerationProvider({ alias: 'gemini' }),
        acquired: (client) => {
          client.initializedEffect = () => {
            initializationChatStates.push(client.hasChatInitialized());
          };
        },
      },
      async ({ owner, clients }) => {
        const primary = clients[1];
        await primary.startChat();
        expect(
          await owner.generateText(
            'detached owner operation',
            undefined,
            generationRecording,
          ),
        ).toBe('turn one reply');
        const detached = clients[2];
        expect(detached).toBeDefined();
        expect(detached).not.toBe(primary);
        expect(detached.mediaStore).toBe(primary.mediaStore);
        expect(detached.initialized).toBe(1);
        expect(initializationChatStates).toStrictEqual([false, false]);
        expect(detached.disposed).toBe(1);
        expect(primary.disposed).toBe(0);
        expect(primary.getHistoryService()?.getRawHistory()).toHaveLength(0);
        await primary.startChat();
        expect(await primary.getHistory()).toStrictEqual([]);
      },
    );
    expect(cleanup).toStrictEqual([]);
  });
});
