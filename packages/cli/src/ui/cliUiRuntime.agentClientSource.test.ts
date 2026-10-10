/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { json } from 'node:stream/consumers';
import { z } from 'zod';
import { fetchGitHubSuggestions } from './hooks/githubAtCompletion.js';
import { FakeProvider } from '../../../providers/src/fake/FakeProvider.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { createSessionClientEngineFixture } from '../../../agents/src/api/__tests__/helpers/session-client-engine-fixture.js';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from './cliUiRuntime.js';

describe('UI session client ownership', () => {
  it('routes completion through the explicit session report tool and closes retained completion admission', async () => {
    const fixture = await createSessionClientEngineFixture();
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
    const agent = await fromConfig({
      config: fixture.config,
      settingsService: fixture.settingsService,
      settingsOwner: fixture.handle.settingsOwner,
      providerManager: fixture.handle.providerManager,
      messageBus: fixture.messageBus,
      mcpRuntime: fixture.mcp,
      agentClient: fixture.owner.getAgentClient(),
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
    try {
      const runtime = buildUiRuntimeFromSource(fixture.config, agent);
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
      await agent.dispose();
      await fixture.cleanup();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    }
  });

  it('resolves the published current client without embedding it in the workspace command projection', async () => {
    const fixture = await createSessionClientEngineFixture();
    const agent = await fromConfig({
      settingsService: fixture.settingsService,
      settingsOwner: fixture.handle.settingsOwner,
      config: fixture.config,
      providerManager: fixture.handle.providerManager,
      messageBus: fixture.messageBus,
      mcpRuntime: fixture.mcp,
      agentClient: fixture.owner.getAgentClient(),
    });
    try {
      const ui = buildUiRuntimeFromSource(fixture.config, agent);
      const workspace = buildSlashCommandRuntime(fixture.config, agent);
      const previous = ui.agentClientSource.getAgentClient();
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'carried history' }],
        },
      ]);
      const provider = new FakeProvider(
        fileURLToPath(
          new URL(
            '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
            import.meta.url,
          ),
        ),
        fixture.config.getTargetDir(),
      );
      provider.name = 'ui-profile-owner';
      fixture.handle.providerManager.registerProvider(provider);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: provider.name,
        model: 'replacement-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      const current = ui.agentClientSource.getAgentClient();
      expect(current).not.toBe(previous);
      expect(
        (await agent.getHistory()).filter(
          (content) => content.speaker === 'human',
        ),
      ).toHaveLength(1);
      expect('getAgentClient' in workspace).toBe(false);
      expect('createDetachedAgentClient' in workspace).toBe(false);
      expect('getAgentClientFactory' in workspace).toBe(false);
      await agent.dispose();
      await fixture.mcp.refreshContext();
      await previous.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'borrowed caller survives' }],
      });
      expect(
        (await previous.getHistory()).filter(
          (content) => content.speaker === 'human',
        ),
      ).toHaveLength(2);
    } finally {
      await agent.dispose();
      await fixture.cleanup();
    }
  });

  it('creates detached clients from the session owner while retaining the primary client', async () => {
    const fixture = await createSessionClientEngineFixture();
    try {
      const agent = await fromConfig({
        config: fixture.config,
        settingsService: fixture.settingsService,
        settingsOwner: fixture.handle.settingsOwner,
        providerManager: fixture.handle.providerManager,
        messageBus: fixture.messageBus,
        mcpRuntime: fixture.mcp,
        agentClient: fixture.owner.getAgentClient(),
      });
      const ui = buildUiRuntimeFromSource(fixture.config, agent);
      const detached = await ui.agentClientSource.createDetachedAgentClient?.();
      expect(detached).toBeDefined();
      expect(detached).not.toBe(agent.agentClient);
      expect(detached?.mediaStore).toBe(agent.agentClient.mediaStore);
      expect(detached?.hasChatInitialized()).toBe(false);
      await detached?.dispose();
      expect(
        agent.agentClient.getHistoryService()?.getRawHistory(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
