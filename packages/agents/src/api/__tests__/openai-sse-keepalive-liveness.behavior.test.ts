/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4135: OpenAI-compatible servers that buffer a tool-call generation
 * (mlx-dspark) send only SSE comment frames (`: keepalive`) until the whole
 * response is ready. Those frames prove the stream is alive, so they must
 * satisfy the first-response and inter-chunk watchdogs. A stream that sends
 * nothing must still hit the first-response timeout.
 */

import { describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { json } from 'node:stream/consumers';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createAgent } from '../createAgent.js';
import {
  collect,
  successful,
  type Observation,
} from './turn-revision-capture.fixture.js';

// The first-response threshold must also cover request setup and the trip
// to the loopback server, which can take a few hundred milliseconds in a
// loaded test run.
const FIRST_RESPONSE_TIMEOUT_MS = 2000;
const IDLE_TIMEOUT_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 250;
// Well past both thresholds, so either watchdog would fire without keepalive
// liveness.
const BUFFERED_GENERATION_MS = 5000;

const wireSchema = z
  .object({
    model: z.string(),
    stream: z.literal(true),
    tools: z
      .array(z.object({ function: z.object({ name: z.string() }) }))
      .optional(),
  })
  .passthrough();

type WireRequest = z.infer<typeof wireSchema>;

function failureMessages(observation: Observation): readonly string[] {
  return observation.events.flatMap((event) =>
    event.type === 'idle-timeout' || event.type === 'error'
      ? [event.error.message]
      : [],
  );
}

/** How the fake server behaves before it sends the buffered tool call. */
type FirstResponseBehavior = 'keepalive-comments' | 'silent-open-stream';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dataFrame(model: string, delta: object, finishReason: string): string {
  const chunk = {
    id: 'keepalive-completion',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

async function sendBufferedToolCall(
  reply: ServerResponse,
  request: WireRequest,
  behavior: FirstResponseBehavior,
  targetPath: string,
): Promise<void> {
  reply.writeHead(200, { 'content-type': 'text/event-stream' });
  reply.flushHeaders();
  const deadline = Date.now() + BUFFERED_GENERATION_MS;
  while (Date.now() < deadline && !reply.destroyed) {
    if (behavior === 'keepalive-comments') reply.write(': keepalive\n\n');
    await wait(KEEPALIVE_INTERVAL_MS);
  }
  if (reply.destroyed) return;
  reply.end(
    dataFrame(
      request.model,
      {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'buffered-read',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ absolute_path: targetPath }),
            },
          },
        ],
      },
      'tool_calls',
    ) + 'data: [DONE]\n\n',
  );
}

async function startBufferingServer(
  behavior: FirstResponseBehavior,
  targetPath: string,
) {
  let requests: readonly WireRequest[] = [];
  let handlers: ReadonlyArray<Promise<void>> = [];
  const server = createServer((request, reply) => {
    if (request.url === '/v1/models') {
      reply
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    const handled = json(request)
      .then(async (body: unknown): Promise<void> => {
        const captured = wireSchema.parse(body);
        requests = [...requests, captured];
        if (requests.length === 1) {
          await sendBufferedToolCall(reply, captured, behavior, targetPath);
          return;
        }
        reply
          .writeHead(200, { 'content-type': 'text/event-stream' })
          .end(
            dataFrame(
              captured.model,
              { role: 'assistant', content: 'Read complete.' },
              'stop',
            ) + 'data: [DONE]\n\n',
          );
      })
      .catch((cause: unknown) => {
        reply.destroy(new Error('Invalid loopback chat request', { cause }));
      });
    handlers = [...handlers, handled];
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected loopback TCP server address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    stop: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await Promise.all(handlers);
    },
  };
}

function restoreEnvironment(
  environment: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withBufferingServer(
  behavior: FirstResponseBehavior,
  run: (
    agent: Agent,
    endpoint: Awaited<ReturnType<typeof startBufferingServer>>,
    targetPath: string,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sse-keepalive-'));
  // The watchdog env overrides take priority over the ephemeral settings
  // below, so an inherited value would replace the thresholds under test.
  const environment = Object.fromEntries(
    [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_FAKE_RESPONSES',
      'LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS',
      'LLXPRT_STREAM_IDLE_TIMEOUT_MS',
    ].map((key) => [key, process.env[key]]),
  );
  process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
  process.env.LLXPRT_DATA_HOME = join(directory, 'data');
  delete process.env.LLXPRT_FAKE_RESPONSES;
  delete process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
  delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  const workingDir = join(directory, 'work');
  await mkdir(workingDir);
  const targetPath = join(workingDir, 'notes.txt');
  await writeFile(targetPath, 'buffered generation target\n');
  const endpoint = await startBufferingServer(behavior, targetPath);
  let agent: Agent | undefined;
  try {
    agent = await createAgent({
      provider: 'openai',
      tools: ['read_file'],
      model: 'buffering-local-model',
      workingDir,
      auth: { apiKey: 'keepalive-local-only', baseUrl: endpoint.url },
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
    });
    agent.setEphemeralSetting(
      'stream-first-response-timeout-ms',
      FIRST_RESPONSE_TIMEOUT_MS,
    );
    agent.setEphemeralSetting('stream-idle-timeout-ms', IDLE_TIMEOUT_MS);
    await run(agent, endpoint, targetPath);
  } finally {
    try {
      await agent?.dispose();
    } finally {
      await endpoint.stop();
      restoreEnvironment(environment);
      await rm(directory, { recursive: true, force: true });
    }
  }
}

describe('OpenAI chat SSE keepalive comments as stream liveness (issue #4135)', () => {
  it('completes a buffered tool-call turn while the server only sends keepalive comments past both watchdog thresholds', async () => {
    await withBufferingServer(
      'keepalive-comments',
      async (agent, endpoint, targetPath) => {
        const observation = await collect(
          agent.stream('Read the notes file.', { mcpDiscovery: 'skip' }),
        );

        expect(failureMessages(observation)).toStrictEqual([]);
        expect(
          observation.events.filter((event) => event.type === 'retry'),
        ).toStrictEqual([]);
        successful(observation);
        const toolCalls = observation.events.flatMap((event) =>
          event.type === 'tool-call'
            ? [{ name: event.call.name, args: event.call.args }]
            : [],
        );
        expect(toolCalls).toStrictEqual([
          { name: 'read_file', args: { absolute_path: targetPath } },
        ]);
        // One buffered tool-call request (no retry) plus the follow-up that
        // carries the tool result.
        expect(endpoint.requests()).toHaveLength(2);
        expect(
          endpoint.requests()[0].tools?.map((tool) => tool.function.name),
        ).toContain('read_file');
      },
    );
  }, 30_000);

  it('still reports the first-response timeout when an open stream sends nothing before the threshold', async () => {
    await withBufferingServer('silent-open-stream', async (agent) => {
      const observation = await collect(
        agent.stream('Read the notes file.', { mcpDiscovery: 'skip' }),
      );

      expect(failureMessages(observation)).toContainEqual(
        expect.stringContaining(
          `First-response timeout: no response received within the allowed time (threshold ${FIRST_RESPONSE_TIMEOUT_MS}ms)`,
        ),
      );
      expect(
        observation.events.filter((event) => event.type === 'tool-call'),
      ).toStrictEqual([]);
    });
  }, 30_000);
});
