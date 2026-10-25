/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/runtimeTokenizerFactory.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import {
  openClientOwner,
  type OpenedClientOwner,
} from './helpers/client-owner-session.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';

const CHILD_TURN = 'Run the child.';
const CHILD_GOAL = 'Return the requested text.';
/** Only the child's own request carries the goal as a user message. */
const CHILD_REQUEST = `{"role":"user","content":"${CHILD_GOAL}"}`;

/**
 * The parent request that must answer with a `task` tool call: the history
 * ends with the user's child turn, not with a tool result.
 */
function isChildLaunch(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('messages' in body))
    return false;
  const { messages } = body;
  if (!Array.isArray(messages)) return false;
  const last: unknown = messages[messages.length - 1];
  if (typeof last !== 'object' || last === null) return false;
  if (!('role' in last) || last.role !== 'user') return false;
  return 'content' in last && last.content === CHILD_TURN;
}

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
        const text = JSON.stringify(body);
        bodies.push(text);
        const streaming =
          typeof body === 'object' &&
          body !== null &&
          'stream' in body &&
          body.stream === true;
        const launchesChild = isChildLaunch(body);
        const message = launchesChild
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  ...(streaming ? { index: 0 } : {}),
                  id: 'call_child_1',
                  type: 'function',
                  function: {
                    name: 'task',
                    arguments: JSON.stringify({
                      subagent_name: 'instruction-child',
                      goal_prompt: CHILD_GOAL,
                      async: false,
                      timeout_seconds: 20,
                    }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: '{"ok":true}' };
        const response = {
          id: 'same-response',
          object: streaming ? 'chat.completion.chunk' : 'chat.completion',
          created: 1,
          model: 'instruction-model',
          choices: [
            {
              index: 0,
              ...(streaming ? { delta: message } : { message }),
              finish_reason: launchesChild ? 'tool_calls' : 'stop',
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

/** An auxiliary content generator that posts the request to the local endpoint. */
function auxiliaryGenerator(url: string): ContentGenerator {
  return {
    generateContent: async (request) => {
      const response = await fetch(`${url}/chat/completions`, {
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
}

describe('MCP instruction ownership', () => {
  // The prompt service initializes once per process from LLXPRT_CONFIG_HOME,
  // so both tests share one home that outlives each test's own directory.
  const environment = Object.fromEntries(
    ['LLXPRT_CONFIG_HOME', 'LLXPRT_DATA_HOME', 'LLXPRT_FAKE_RESPONSES'].map(
      (key) => [key, process.env[key]],
    ),
  );
  let home: string;
  let configHome: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'llxprt-mcp-instruction-home-'));
    configHome = join(home, 'config');
    process.env.LLXPRT_CONFIG_HOME = configHome;
    process.env.LLXPRT_DATA_HOME = join(home, 'data');
    delete process.env.LLXPRT_FAKE_RESPONSES;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  });

  it('keeps live owner instructions isolated across same-key agents, auxiliary requests and child scopes', async () => {
    const evidence = join(tmpdir(), 'llxprt-mcp-instruction-threading');
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'owners-'));
    const endpoint = await transport();
    interface Owner {
      agent: Agent;
      instructionPath: string;
    }
    const owners: Owner[] = [];
    let auxiliaryTransport: ContentGenerator | undefined;
    const tokenizerFactory = createRuntimeTokenizerFactory();
    const profiles = new ProfileManager(join(configHome, 'profiles'));
    await profiles.saveProfile('child-profile', {
      version: 1,
      provider: 'openai',
      model: 'instruction-model',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'local-only',
        'base-url': endpoint.url,
      },
    });
    await new SubagentManager(
      join(configHome, 'subagents'),
      profiles,
    ).saveSubagent('instruction-child', 'child-profile', 'Reply once.');
    async function owner(name: string): Promise<Owner> {
      const workingDir = join(directory, name);
      await mkdir(workingDir);
      const instructionPath = join(workingDir, 'instructions.txt');
      await writeFile(instructionPath, `INSTRUCTION_OWNER_${name}`);
      const agent = await createAgent({
        provider: 'openai',
        model: 'instruction-model',
        auth: { apiKey: 'local-only', baseUrl: endpoint.url },
        workingDir,
        sessionId: 'same-instruction-session',
        folderTrust: true,
        approvalMode: ApprovalMode.YOLO,
        coreTools: ['task'],
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
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
        credentialAuthority: new CredentialAuthority(),
        tokenizerFactory,
        contentGeneratorFactory: {
          createContentGenerator: () =>
            auxiliaryTransport ?? new ProviderContentGenerator(),
        },
      });
      const result = { agent, instructionPath };
      owners.push(result);
      await awaitMcpDiscoveryReady(agent);
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
    ): Promise<string[]> {
      const start = endpoint.bodies.length;
      await action();
      const bodies = endpoint.bodies.slice(start);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body).toContain(present);
        expect(body).not.toContain(absent);
      }
      return bodies;
    }
    async function observedChild(
      candidate: Awaited<ReturnType<typeof owner>>,
      present: string,
      absent: string,
    ): Promise<void> {
      const bodies = await observed(
        () => turn(candidate, CHILD_TURN),
        present,
        absent,
      );
      expect(
        bodies.filter((body) => body.includes(CHILD_REQUEST)).length,
      ).toBeGreaterThan(0);
    }
    async function turn(
      candidate: Awaited<ReturnType<typeof owner>>,
      prompt = 'Reply once.',
    ): Promise<void> {
      const events = [];
      for await (const event of candidate.agent.stream(prompt, {
        signal,
        mcpDiscovery: 'await',
      }))
        events.push(event);
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
    }
    try {
      const a = await owner('A');
      const b = await owner('B');
      expect(a.agent.getRuntimeId()).toBe(b.agent.getRuntimeId());
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
        () => a.agent.generate('Direct request.'),
        'INSTRUCTION_OWNER_A',
        'INSTRUCTION_OWNER_B',
      );
      auxiliaryTransport = auxiliaryGenerator(endpoint.url);
      for (const candidate of [a, b]) {
        await candidate.agent.sessionClient.refreshAuth();
      }
      await observed(
        () => a.agent.generateJson(messages, { type: 'object' }),
        'INSTRUCTION_OWNER_A',
        'INSTRUCTION_OWNER_B',
      );
      await observed(
        () => b.agent.generateJson(messages, { type: 'object' }),
        'INSTRUCTION_OWNER_B',
        'INSTRUCTION_OWNER_A',
      );
      await observedChild(a, 'INSTRUCTION_OWNER_A', 'INSTRUCTION_OWNER_B');
      await observedChild(b, 'INSTRUCTION_OWNER_B', 'INSTRUCTION_OWNER_A');
      await writeFile(a.instructionPath, 'INSTRUCTION_REFRESH_A');
      await a.agent.mcp.refresh();
      await observed(
        () => turn(a),
        'INSTRUCTION_REFRESH_A',
        'INSTRUCTION_OWNER_A',
      );
      await observedChild(a, 'INSTRUCTION_REFRESH_A', 'INSTRUCTION_OWNER_A');
      await observed(
        () => a.agent.generateJson(messages, { type: 'object' }),
        'INSTRUCTION_REFRESH_A',
        'INSTRUCTION_OWNER_A',
      );
      await a.agent.ide.setTrustedFolderLive(false);
      const start = endpoint.bodies.length;
      await turn(a);
      await a.agent.generateJson(messages, { type: 'object' });
      await turn(a, CHILD_TURN);
      const revoked = endpoint.bodies.slice(start);
      expect(revoked.some((body) => body.includes(CHILD_REQUEST))).toBe(true);
      expect(revoked.join('\n')).not.toContain('INSTRUCTION_REFRESH_A');
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
      }
      await endpoint.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it("carries each session client owner's MCP instructions into lightweight generateContent requests", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'llxprt-mcp-instruction-gc-'),
    );
    const endpoint = await transport();
    const signal = new AbortController().signal;
    const messages = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Return JSON.' }],
      },
    ];
    const opened: OpenedClientOwner[] = [];
    async function open(name: string): Promise<OpenedClientOwner> {
      const workingDir = join(directory, name);
      await mkdir(workingDir);
      const instructionPath = join(workingDir, 'instructions.txt');
      await writeFile(instructionPath, `INSTRUCTION_OWNER_${name}`);
      const owner = await openClientOwner(
        new CredentialAuthority(),
        {
          provider: 'openai',
          model: 'instruction-model',
          auth: { apiKey: 'local-only', baseUrl: endpoint.url },
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
        },
        { provider: 'openai', model: 'instruction-model' },
        {
          contentGeneratorFactory: {
            createContentGenerator: () => auxiliaryGenerator(endpoint.url),
          },
        },
      );
      opened.push(owner);
      return owner;
    }
    async function generated(
      candidate: OpenedClientOwner,
      present: string,
      absent: string,
    ): Promise<void> {
      const start = endpoint.bodies.length;
      await candidate.client.generateContent(
        messages,
        {},
        signal,
        'instruction-model',
      );
      const bodies = endpoint.bodies.slice(start);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain(present);
      expect(bodies[0]).not.toContain(absent);
    }
    try {
      const a = await open('A');
      const b = await open('B');
      await generated(a, 'INSTRUCTION_OWNER_A', 'INSTRUCTION_OWNER_B');
      await generated(b, 'INSTRUCTION_OWNER_B', 'INSTRUCTION_OWNER_A');
    } finally {
      for (const candidate of opened) await candidate.close();
      await endpoint.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
