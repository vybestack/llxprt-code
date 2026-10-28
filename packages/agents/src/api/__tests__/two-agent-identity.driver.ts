/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'bun:test';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createAgent } from '../createAgent.js';
import { collect, successful } from './turn-revision-capture.fixture.js';

type Requests = ReadonlyArray<Record<string, unknown>>;

function respond(provider: string, response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (provider === 'openai') {
    response.end(
      `data: ${JSON.stringify({
        id: 'equal-completion',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Completed.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
      })}\n\ndata: [DONE]\n\n`,
    );
    return;
  }
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'equal-completion',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 17, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Completed.' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  ];
  response.end(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
  );
}

async function endpoint(provider: string): Promise<{
  url: string;
  requests(): Requests;
  close(): Promise<void>;
}> {
  let requests: Requests = [];
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    void json(request)
      .then((body: unknown) => {
        if (typeof body !== 'object' || body === null)
          throw new Error('Expected request object');
        requests = [
          ...requests,
          {
            ...body,
            authorization: request.headers.authorization,
            apiKey: request.headers['x-api-key'],
          },
        ];
        respond(provider, response);
      })
      .catch((cause: unknown) =>
        response.destroy(new Error('Invalid external request', { cause })),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function snapshot(agent: Agent): Promise<object> {
  const stats = agent.getStats();
  return {
    provider: agent.getProvider(),
    model: agent.getModel(),
    settings: agent.getRuntimeDiagnosticsSnapshot(),
    tools: agent.tools
      .list()
      .map((tool) => tool.name)
      .sort(),
    counters: {
      apiRequests: stats.apiRequests,
      promptTokens: stats.promptTokens,
      candidateTokens: stats.candidateTokens,
      toolCalls: stats.toolCalls,
      toolSuccesses: stats.toolSuccesses,
      toolFailures: stats.toolFailures,
      toolCancellations: stats.toolCancellations,
      contextWindowUsed: stats.contextWindowUsed,
      totalApiLatencyMs: stats.totalApiLatencyMs,
    },
    history: await agent.getHistory(),
  };
}

async function writeEffect(agent: Agent, content: string): Promise<void> {
  const writer = agent.tools.get('write_file');
  if (writer === undefined) throw new Error('Missing public file writer');
  const result = await writer.buildAndExecute(
    {
      absolute_path: join(agent.workspace.getWorkingDirectory(), 'effect.txt'),
      content,
    },
    new AbortController().signal,
  );
  expect(result.error).toBeUndefined();
}

async function turn(agent: Agent, text: string): Promise<void> {
  successful(
    await collect(
      agent.stream(text, { mcpDiscovery: 'skip', promptId: 'equal-prompt' }),
    ),
  );
}

async function changeProfile(
  agent: Agent,
  name: string,
  url: string,
  directory: string,
): Promise<void> {
  await agent.setModel(`identity-${name}-next`);
  await agent.profiles.applySnapshot({
    version: 1,
    provider: name === 'a' ? 'openai' : 'anthropic',
    model: `identity-${name}-profile`,
    modelParams: { temperature: name === 'a' ? 0.4 : 0.6 },
    ephemeralSettings: {
      'base-url': url,
      'auth-keyfile': join(directory, `${name}.key`),
      'tools.disabled': [name === 'a' ? 'read_file' : 'write_file'],
    },
  });
  await turn(agent, `${name.toUpperCase()} changed profile marker`);
}

async function interleave(
  a: Agent,
  b: Agent,
  aWire: string,
  bWire: string,
  directory: string,
  prompts: () => readonly string[][],
): Promise<void> {
  expect(a).not.toBe(b);
  expect(a.session.getSessionId()).toBe(b.session.getSessionId());
  a.setModelParam('temperature', 0.2);
  b.setModelParam('temperature', 0.7);
  const initialB = await snapshot(b);
  await turn(a, 'A private history marker');
  await writeEffect(a, 'A physical effect');
  await expect(a.auth.login('anthropic')).rejects.toThrow(
    'OAuth login was declined',
  );
  expect(prompts()).toStrictEqual([['anthropic'], []]);
  expect(await snapshot(b)).toStrictEqual(initialB);
  const firstA = await snapshot(a);
  await turn(b, 'B private history marker');
  await writeEffect(b, 'B physical effect');
  await expect(b.auth.login('anthropic')).rejects.toThrow(
    'OAuth login was declined',
  );
  expect(prompts()).toStrictEqual([['anthropic'], ['anthropic']]);
  expect(await snapshot(a)).toStrictEqual(firstA);
  const firstB = await snapshot(b);
  await changeProfile(a, 'a', aWire, directory);
  expect(await snapshot(b)).toStrictEqual(firstB);
  expect(a.tools.get('read_file')).toBeUndefined();
  expect(b.tools.get('read_file')).toBeDefined();
  const changedA = await snapshot(a);
  await changeProfile(b, 'b', bWire, directory);
  expect(await snapshot(a)).toStrictEqual(changedA);
  expect(b.tools.get('write_file')).toBeUndefined();
  expect(a.tools.get('write_file')).toBeDefined();
  const beforeCloseB = await snapshot(b);
  expect(a.getStats().apiRequests).toBe(2);
  await a.dispose();
  expect(await snapshot(b)).toStrictEqual(beforeCloseB);
  await turn(b, 'B surviving root marker');
  const reader = b.tools.get('read_file');
  if (reader === undefined) throw new Error('Surviving reader missing');
  expect(
    String(
      (
        await reader.buildAndExecute(
          { absolute_path: join(directory, 'b/effect.txt') },
          new AbortController().signal,
        )
      ).llmContent,
    ),
  ).toContain('B physical effect');
}

async function assertStreams(
  b: Agent,
  requestsA: Requests,
  requestsB: Requests,
  directory: string,
): Promise<void> {
  expect(
    requestsA.map(({ model, temperature }) => ({ model, temperature })),
  ).toStrictEqual([
    { model: 'identity-a', temperature: 0.2 },
    { model: 'identity-a-profile', temperature: 0.4 },
  ]);
  expect(
    requestsB.map(({ model, temperature }) => ({ model, temperature })),
  ).toStrictEqual([
    { model: 'identity-b', temperature: 0.7 },
    { model: 'identity-b-profile', temperature: 0.6 },
    { model: 'identity-b-profile', temperature: 0.6 },
  ]);
  for (const request of requestsA) {
    expect(request.authorization).toBe('Bearer private-a-credential');
    expect(JSON.stringify(request)).not.toContain('B private history marker');
    expect(JSON.stringify(request)).not.toContain('private-b-credential');
  }
  for (const request of requestsB) {
    expect(request.apiKey).toBe('private-b-credential');
    expect(JSON.stringify(request)).not.toContain('A private history marker');
    expect(JSON.stringify(request)).not.toContain('private-a-credential');
  }
  expect(JSON.stringify(await b.getHistory())).toContain(
    'B surviving root marker',
  );
  expect(JSON.stringify(await b.getHistory())).not.toContain(
    'A private history marker',
  );
  expect(b.getStats().apiRequests).toBe(3);
  expect(await readdir(join(directory, 'a'))).toStrictEqual(['effect.txt']);
  expect(await readdir(join(directory, 'b'))).toStrictEqual(['effect.txt']);
  expect(await readFile(join(directory, 'a/effect.txt'), 'utf8')).toBe(
    'A physical effect',
  );
  expect(await readFile(join(directory, 'b/effect.txt'), 'utf8')).toBe(
    'B physical effect',
  );
}

export async function runTwoAgentIdentity(): Promise<{
  requestsA: Requests;
  requestsB: Requests;
}> {
  const directory = await mkdtemp(join(tmpdir(), 's1-two-roots-'));
  const keys = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_FAKE_RESPONSES',
  ];
  const environment = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  const aWire = await endpoint('openai');
  const bWire = await endpoint('anthropic');
  let agents: readonly Agent[] = [];
  let promptsA: string[] = [];
  let promptsB: string[] = [];
  try {
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    for (const name of ['a', 'b']) {
      await mkdir(join(directory, name));
      await writeFile(
        join(directory, `${name}.key`),
        `private-${name}-credential`,
      );
    }
    const common = {
      sessionId: 'equal-user-label',
      tools: ['read_file', 'write_file'],
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
    };
    const a = await createAgent({
      ...common,
      provider: 'openai',
      model: 'identity-a',
      workingDir: join(directory, 'a'),
      auth: { apiKeyFile: join(directory, 'a.key'), baseUrl: aWire.url },
      onOAuthPrompt: (prompt) => {
        promptsA = [...promptsA, prompt.provider];
        return false;
      },
    });
    agents = [...agents, a];
    const b = await createAgent({
      ...common,
      provider: 'anthropic',
      model: 'identity-b',
      workingDir: join(directory, 'b'),
      auth: { apiKeyFile: join(directory, 'b.key'), baseUrl: bWire.url },
      onOAuthPrompt: (prompt) => {
        promptsB = [...promptsB, prompt.provider];
        return false;
      },
    });
    agents = [...agents, b];
    await interleave(a, b, aWire.url, bWire.url, directory, () => [
      promptsA,
      promptsB,
    ]);
    await assertStreams(b, aWire.requests(), bWire.requests(), directory);
    return { requestsA: aWire.requests(), requestsB: bWire.requests() };
  } finally {
    await Promise.all(agents.map((agent) => agent.dispose()));
    await Promise.all([aWire.close(), bWire.close()]);
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
