/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { Agent } from '../agent.js';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/runtimeTokenizerFactory.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { fromConfig } from '../fromConfig.js';
import { toConfigParameters } from '../agentConfig.adapter.js';

import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { SubAgentScope } from '../../core/subagent.js';

async function transport(): Promise<{
  url: string;
  bodies: string[];
  stop(): Promise<void>;
}> {
  const bodies: string[] = [];
  const server = createServer((request, reply) => {
    if (request.url === '/v1/models') {
      reply
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"data":[]}');
      return;
    }
    void json(request)
      .then((body: unknown) => {
        bodies.push(JSON.stringify(body));
        const streaming =
          typeof body === 'object' &&
          body !== null &&
          'stream' in body &&
          body.stream === true;
        const message = { role: 'assistant', content: '{"ok":true}' };
        const response = {
          id: 'same-response',
          object: streaming ? 'chat.completion.chunk' : 'chat.completion',
          created: 1,
          model: 'instruction-model',
          choices: [
            {
              index: 0,
              ...(streaming ? { delta: message } : { message }),
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        reply
          .writeHead(200, {
            'content-type': streaming
              ? 'text/event-stream'
              : 'application/json',
          })
          .end(
            streaming
              ? `data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`
              : JSON.stringify(response),
          );
      })
      .catch((cause: unknown) =>
        reply.destroy(new Error('Invalid local request', { cause })),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    bodies,
    stop: () =>
      new Promise<void>((resolveStop, reject) => {
        server.close((error) => (error ? reject(error) : resolveStop()));
        server.closeAllConnections();
      }),
  };
}

describe('MCP instruction ownership', () => {
  it('keeps live owner instructions isolated across same-key agents, auxiliary requests and child scopes', async () => {
    const evidence = join(tmpdir(), 'llxprt-mcp-instruction-threading');
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'owners-'));
    const environment = Object.fromEntries(
      ['LLXPRT_CONFIG_HOME', 'LLXPRT_DATA_HOME', 'LLXPRT_FAKE_RESPONSES'].map(
        (key) => [key, process.env[key]],
      ),
    );
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const endpoint = await transport();
    interface Owner {
      settingsService: ReturnType<
        typeof createSessionSettingsFixture
      >['settingsService'];
      settingsOwner: ReturnType<
        typeof createSessionSettingsFixture
      >['settingsOwner'];
      config: Config;
      mcp: McpRuntimeOwner;
      agent: Agent;
      instructionPath: string;
      tokenizerFactory: RuntimeTokenizerFactory;
    }
    const owners: Owner[] = [];
    let auxiliaryTransport: ContentGenerator | undefined;
    async function owner(name: string): Promise<Owner> {
      const workingDir = join(directory, name);
      await mkdir(workingDir);
      const instructionPath = join(workingDir, 'instructions.txt');
      await writeFile(instructionPath, `INSTRUCTION_OWNER_${name}`);
      const config = new Config({
        ...toConfigParameters({
          provider: 'openai',
          model: 'instruction-model',
          workingDir,
          sessionId: 'same-instruction-session',
          folderTrust: true,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
          mcpServers: {
            same: {
              command: process.execPath,
              args: [
                resolveRepositoryFixture(
                  import.meta.url,
                  'scripts/tests/mcp-instruction-stdio-fixture.ts',
                ),
                instructionPath,
              ],
            },
          },
        }),
      });
      const mcp = await McpRuntimeOwner.create(
        createTestOAuthBinding(),
        config,
      );
      const settingsRoot = createSessionSettingsFixture(config);
      const tokenizerFactory = createRuntimeTokenizerFactory();
      const agent = await fromConfig({
        tokenizerFactory,
        contentGeneratorFactory: {
          createContentGenerator: () =>
            auxiliaryTransport ?? new ProviderContentGenerator(),
        },
        settingsOwner: settingsRoot.settingsOwner,
        settingsService: settingsRoot.settingsService,
        config,
        mcpRuntime: mcp,
        sessionId: 'same-instruction-session',
        activation: {
          provider: 'openai',
          model: 'instruction-model',
          cliOverrides: { key: 'local-only', baseUrl: endpoint.url },
        },
      });

      Object.defineProperty(config, 'getMcpInstructions', {
        value: () => {
          throw new Error('Config instruction lookup is forbidden');
        },
      });
      const result = {
        ...settingsRoot,
        config,
        mcp,
        agent,
        instructionPath,
        tokenizerFactory,
      };
      owners.push(result);
      expect(Array.from(await mcp.awaitDiscovery())).toStrictEqual([]);
      expect(mcp.readInstructions()).toContain(`INSTRUCTION_OWNER_${name}`);
      return result;
    }
    const signal = new AbortController().signal;
    const messages = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Return JSON.' }],
      },
    ];
    async function observed(
      action: () => Promise<unknown>,
      present: string,
      absent: string,
    ): Promise<void> {
      const start = endpoint.bodies.length;
      await action();
      const bodies = endpoint.bodies.slice(start);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body).toContain(present);
        expect(body).not.toContain(absent);
      }
    }
    async function turn(
      candidate: Awaited<ReturnType<typeof owner>>,
    ): Promise<void> {
      const events = [];
      for await (const event of candidate.agent.stream('Reply once.', {
        signal,
        mcpDiscovery: 'await',
      }))
        events.push(event);
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
    }
    async function child(
      candidate: Awaited<ReturnType<typeof owner>>,
    ): Promise<void> {
      const config = candidate.config;
      const state = createAgentRuntimeState({
        runtimeId: 'same-child',
        sessionId: 'same-child',
        provider: 'openai',
        model: 'instruction-model',
      });
      const runtimeBundle = await loadAgentRuntime({
        mediaStore: requireMediaStore(candidate.agent.agentClient),
        profile: {
          config,
          telemetry: candidate.settingsOwner.telemetry,
          state,
          promptEstimator: candidate.tokenizerFactory,
          settings: candidate.settingsOwner.readRuntimePolicy(),
          prepareProviderInvocation: (providerName, modelParameters, signal) =>
            candidate.settingsOwner.prepareProviderInvocation(
              state.runtimeId,
              providerName,
              modelParameters,
              signal,
            ),
          readToolGovernance: () =>
            candidate.settingsOwner.readToolGovernance(
              config.getExcludeTools() ?? [],
            ),
          providerRuntime: createProviderRuntimeContext({
            config,
            settingsService: candidate.settingsService,
            runtimeId: state.runtimeId,
          }),
          contentGeneratorConfig:
            candidate.agent.agentClient.getContentGeneratorConfig(),
          toolRegistry: candidate.agent.agentClient.tools,
          providerManager: candidate.agent.providerManager,
        },
      });
      const scope = await SubAgentScope.create(
        'child',
        config,
        { systemPrompt: 'Reply once.' },
        { model: 'instruction-model', temp: 0, top_p: 1 },
        { max_turns: 1, max_time_minutes: 1 },
        undefined,
        undefined,
        {
          instructions: emptyInstructionReads,
          workspacePaths: candidate.mcp.workspacePaths,
          runtimeBundle,
          messageBus: candidate.mcp.messageBus,
          readMcpInstructions: candidate.mcp.readInstructions,
          environmentContextLoader: async () => [],
        },
      );
      try {
        await scope.runNonInteractive(new ContextState());
      } finally {
        scope.dispose();
      }
    }
    try {
      const a = await owner('A');
      const b = await owner('B');
      expect(a.agent.getRuntimeId()).toBe(b.agent.getRuntimeId());
      expect(a.mcp.messageBus).not.toBe(b.mcp.messageBus);
      expect(a.agent.agentClient.tools).not.toBe(b.agent.agentClient.tools);
      await observed(
        () => turn(a),
        'INSTRUCTION_OWNER_A',
        'INSTRUCTION_OWNER_B',
      );
      await observed(
        () => turn(b),
        'INSTRUCTION_OWNER_B',
        'INSTRUCTION_OWNER_A',
      );
      await observed(
        () =>
          a.agent.agentClient.generateDirectMessage(
            { message: 'Direct request.' },
            'same-direct',
          ),
        'INSTRUCTION_OWNER_A',
        'INSTRUCTION_OWNER_B',
      );
      auxiliaryTransport = {
        generateContent: async (request) => {
          const response = await fetch(`${endpoint.url}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: request.model,
              messages: [
                {
                  role: 'system',
                  content: request.settings?.systemInstruction,
                },
                ...request.contents,
              ],
            }),
            signal: request.abortSignal,
          });
          if (!response.ok)
            throw new Error(`Local provider returned ${response.status}`);
          await response.text();
          return {
            content: {
              speaker: 'ai',
              blocks: [{ type: 'text', text: '{"ok":true}' }],
            },
          };
        },
        generateContentStream: async () => {
          throw new Error('Unexpected auxiliary stream');
        },
        countTokens: async () => ({ totalTokens: 1 }),
        embedContent: async () => ({ embeddings: [] }),
      };
      for (const candidate of [a, b]) {
        await candidate.agent.sessionClient.refreshAuth();
      }
      await observed(
        () => a.agent.generateJson(messages, { type: 'object' }),
        'INSTRUCTION_OWNER_A',
        'INSTRUCTION_OWNER_B',
      );
      await observed(
        () =>
          b.agent.agentClient.generateContent(
            messages,
            {},
            signal,
            'instruction-model',
          ),
        'INSTRUCTION_OWNER_B',
        'INSTRUCTION_OWNER_A',
      );
      await observed(
        () => child(a),
        'INSTRUCTION_OWNER_A',
        'INSTRUCTION_OWNER_B',
      );
      await observed(
        () => child(b),
        'INSTRUCTION_OWNER_B',
        'INSTRUCTION_OWNER_A',
      );
      await writeFile(a.instructionPath, 'INSTRUCTION_REFRESH_A');
      await a.mcp.refresh();
      await observed(
        () => turn(a),
        'INSTRUCTION_REFRESH_A',
        'INSTRUCTION_OWNER_A',
      );
      await observed(
        () => child(a),
        'INSTRUCTION_REFRESH_A',
        'INSTRUCTION_OWNER_A',
      );
      await observed(
        () => a.agent.generateJson(messages, { type: 'object' }),
        'INSTRUCTION_REFRESH_A',
        'INSTRUCTION_OWNER_A',
      );
      await a.agent.ide.setTrustedFolderLive(false);
      const start = endpoint.bodies.length;
      await turn(a);
      await a.agent.generateJson(messages, { type: 'object' });
      await child(a);
      expect(endpoint.bodies.slice(start).join('\n')).not.toContain(
        'INSTRUCTION_REFRESH_A',
      );
      await observed(
        () => turn(b),
        'INSTRUCTION_OWNER_B',
        'INSTRUCTION_REFRESH_A',
      );
      await writeFile(
        join(evidence, 'owner-provider-bodies.json'),
        JSON.stringify(endpoint.bodies, null, 2),
      );
    } finally {
      for (const candidate of owners) {
        await candidate.agent.dispose();
        await candidate.mcp.dispose();
        await candidate.config.dispose();
      }
      await endpoint.stop();
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
