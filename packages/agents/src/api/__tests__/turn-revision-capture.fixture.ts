/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, expect } from 'bun:test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import { tmpdir } from 'node:os';
import {
  createAgent,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';

function barrier(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface WireRequest {
  readonly [key: string]: unknown;
  readonly model: string;
  readonly temperature?: number;
  readonly messages: unknown;
}

function wireRequest(value: unknown): WireRequest {
  if (typeof value !== 'object' || value === null || !('model' in value)) {
    throw new Error(`Unexpected chat request: ${JSON.stringify(value)}`);
  }
  if (
    typeof value.model !== 'string' ||
    ('temperature' in value && typeof value.temperature !== 'number') ||
    !('messages' in value)
  ) {
    throw new Error(`Invalid chat request fields: ${JSON.stringify(value)}`);
  }
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'temperature'),
  );
  return {
    ...body,
    model: value.model,
    messages: value.messages,
    ...('temperature' in value && typeof value.temperature === 'number'
      ? { temperature: value.temperature }
      : {}),
  };
}

function sseChunk(captured: WireRequest, callTool: boolean): object {
  return {
    id: 'same-completion',
    object: 'chat.completion.chunk',
    created: 1,
    model: captured.model,
    choices: [
      {
        index: 0,
        delta: callTool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'read-binding-file',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({
                      absolute_path: join(process.cwd(), 'AGENTS.md'),
                    }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: 'Transport completed.' },
        finish_reason: callTool ? 'tool_calls' : 'stop',
      },
    ],
  };
}

function respondWithFailure(reply: ServerResponse, status: number): void {
  reply.writeHead(status, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      error: {
        message: status === 413 ? 'Context too large' : 'Rejected request',
      },
    }),
  );
}

async function transport(
  holdRequest: number,
  failFirst = false,
  toolFirst = false,
  failRequest = 0,
  failStatus = 413,
): Promise<{
  readonly url: string;
  readonly entered: Promise<void>;
  release(): void;
  requests(): readonly WireRequest[];
  stop(): Promise<void>;
}> {
  const entered = barrier();
  const response = barrier();
  let requests: readonly WireRequest[] = [];
  const server = createServer((request, reply) => {
    if (request.url === '/v1/models') {
      reply
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    void json(request)
      .then(async (body: unknown): Promise<void> => {
        const captured = {
          ...wireRequest(body),
          authorization: request.headers.authorization,
        };
        requests = [...requests, captured];
        if (requests.length === holdRequest) {
          entered.release();
          await response.promise;
        }
        if (requests.length === failRequest) {
          respondWithFailure(reply, failStatus);
          return;
        }
        if (failFirst) {
          reply
            .writeHead(503, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: { message: 'Unavailable member' } }));
          return;
        }
        const chunk = sseChunk(captured, toolFirst && requests.length === 1);
        reply
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((cause: unknown) => {
        reply.destroy(new Error('Invalid loopback chat request', { cause }));
      });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected loopback TCP server address');
  }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    entered: entered.promise,
    release: response.release,
    requests: () => requests,
    stop: async () => {
      response.release();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

export interface Observation {
  readonly events: readonly AgentEvent[];
  readonly rejection?: unknown;
}

export async function collect(
  stream: AsyncIterable<AgentEvent>,
): Promise<Observation> {
  let events: readonly AgentEvent[] = [];
  try {
    for await (const event of stream) events = [...events, event];
    return { events };
  } catch (rejection) {
    return { events, rejection };
  }
}

export function successful(observation: Observation): void {
  expect(observation.rejection).toBeUndefined();
  expect(
    observation.events.filter((event) => event.type === 'error'),
  ).toStrictEqual([]);
  expect(
    observation.events.filter((event) => event.type === 'done'),
  ).toMatchObject([{ type: 'done', reason: 'stop' }]);
}

function restoreEnvironment(
  environment: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function createOwner(
  directory: string,
  name: string,
  endpoint: string,
  temperature: number,
  continueOnFailedApiCall = false,
): Promise<Agent> {
  const workingDir = join(directory, name);
  await mkdir(workingDir);
  const agent = await createAgent({
    provider: 'openai',
    tools: ['read_file'],
    model: `capture-${name}`,
    workingDir,
    sessionId: 'same-turn-capture-label',
    auth: { apiKey: 'turn-capture-local-only', baseUrl: endpoint },
    telemetry: { enabled: false },
    recording: { enabled: false },
    mcpEnabled: false,
    skillsSupport: false,
    continueOnFailedApiCall,
    harness: {
      forceInteractive: false,
      forceConfirmations: false,
      includeProcessCwd: false,
    },
  });
  agent.setModelParam('temperature', temperature);
  return agent;
}

const promptRoot = await mkdtemp(join(tmpdir(), 'turn-prompts-'));
const fixturePrompts = join(promptRoot, 'prompts');
await mkdir(join(fixturePrompts, 'core'), { recursive: true });
await writeFile(
  join(fixturePrompts, 'core', 'default.md'),
  'Test core prompt.',
);
afterAll(() => rm(promptRoot, { recursive: true, force: true }));

export async function withOwners(
  run: (
    a: Agent,
    b: Agent,
    endpointA: Awaited<ReturnType<typeof transport>>,
    endpointB: Awaited<ReturnType<typeof transport>>,
    start: (agent: Agent, text: string) => Promise<Observation>,
  ) => Promise<void>,
  failFirst = false,
  toolFirst = false,
  holdRequest = 1,
  failRequest = 0,
  continueOnFailedApiCall = failRequest > 0,
  failStatus = 413,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'turn-capture-'));
  const prompts = fixturePrompts;
  const environment = Object.fromEntries(
    [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_FAKE_RESPONSES',
      'LLXPRT_PROMPTS_DIR',
    ].map((key) => [key, process.env[key]]),
  );
  process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
  process.env.LLXPRT_DATA_HOME = join(directory, 'data');
  process.env.LLXPRT_PROMPTS_DIR = prompts;
  delete process.env.LLXPRT_FAKE_RESPONSES;
  const endpointA = await transport(
    holdRequest,
    failFirst,
    toolFirst,
    failRequest,
    failStatus,
  );
  const endpointB = await transport(0);
  let agents: readonly Agent[] = [];
  let pending: ReadonlyArray<Promise<Observation>> = [];
  const start = (agent: Agent, text: string): Promise<Observation> => {
    const result = collect(
      agent.stream(text, { promptId: 'same-prompt', mcpDiscovery: 'skip' }),
    );
    pending = [...pending, result];
    return result;
  };
  try {
    const a = await createOwner(
      directory,
      'a',
      endpointA.url,
      0.2,
      continueOnFailedApiCall,
    );
    agents = [...agents, a];
    const b = await createOwner(directory, 'b', endpointB.url, 0.7);
    agents = [...agents, b];
    await run(a, b, endpointA, endpointB, start);
  } finally {
    endpointA.release();
    endpointB.release();
    try {
      await Promise.all(pending);
      await Promise.all(agents.map((agent) => agent.dispose()));
    } finally {
      await Promise.all([endpointA.stop(), endpointB.stop()]);
      restoreEnvironment(environment);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
