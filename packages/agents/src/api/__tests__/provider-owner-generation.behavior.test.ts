/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import { describe, expect, it } from 'bun:test';
import type { Agent } from '../agent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import {
  collect,
  successful,
  type Observation,
} from './turn-revision-capture.fixture.js';

async function textFrom(
  stream: AsyncIterable<{ type: string; text?: string }>,
): Promise<string> {
  let text = '';
  for await (const event of stream) {
    if (event.type === 'error') throw new Error(JSON.stringify(event));
    if (event.type === 'text') text += event.text ?? '';
  }
  return text;
}

function denyManagerDiscovery(config: object): () => void {
  Object.defineProperty(config, 'getProviderManager', {
    configurable: true,
    value: () => {
      throw new Error('Forbidden Config manager discovery');
    },
  });
  return () => {
    Reflect.deleteProperty(config, 'getProviderManager');
  };
}

interface LoopbackChat {
  readonly url: string;
  readonly entered: Promise<void>;
  release(): void;
  temperatures(): ReadonlyArray<number | undefined>;
  stop(): Promise<void>;
}

/**
 * A loopback OpenAI-compatible chat server that records each request's
 * temperature and holds request number `holdRequest` until `release()`.
 */
async function openLoopbackChat(holdRequest: number): Promise<LoopbackChat> {
  let release = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markEntered = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let temperatures: ReadonlyArray<number | undefined> = [];
  const server = createServer((request, reply) => {
    if (request.url === '/v1/models') {
      reply
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    void json(request)
      .then(async (body: unknown): Promise<void> => {
        if (typeof body !== 'object' || body === null || !('model' in body))
          throw new Error(`Unexpected chat request: ${JSON.stringify(body)}`);
        temperatures = [
          ...temperatures,
          'temperature' in body && typeof body.temperature === 'number'
            ? body.temperature
            : undefined,
        ];
        if (temperatures.length === holdRequest) {
          markEntered();
          await released;
        }
        const chunk = {
          id: 'same-completion',
          object: 'chat.completion.chunk',
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Transport completed.' },
              finish_reason: 'stop',
            },
          ],
        };
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
  if (address === null || typeof address === 'string')
    throw new Error('Expected loopback TCP server address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    entered,
    release,
    temperatures: () => temperatures,
    stop: async () => {
      release();
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

function restoreEnvironment(
  environment: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function openOwner(
  name: string,
  endpoint: string,
  temperature: number,
): Promise<RouteAAgent> {
  const model = `capture-${name}`;
  return openRouteAAgent({
    config: {
      provider: 'openai',
      tools: ['read_file'],
      model,
      sessionId: 'same-turn-capture-label',
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
      continueOnFailedApiCall: false,
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
    },
    intent: {
      activation: {
        provider: 'openai',
        model,
        cliOverrides: { key: 'turn-capture-local-only', baseUrl: endpoint },
      },
    },
  }).then((owner) => {
    owner.agent.setModelParam('temperature', temperature);
    return owner;
  });
}

describe('provider owner generation boundary', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');

  it('drives public generation and parameter changes without consulting Config for a manager', async () => {
    const built = await openRouteAAgent();
    const blocked = denyManagerDiscovery(built.config);
    try {
      built.agent.setModelParam('temperature', 0.4);
      expect(
        await textFrom(built.agent.stream('Use the explicit owner')),
      ).not.toBe('');
      built.agent.clearModelParam('temperature');
      expect(built.agent.getModelParams()).not.toHaveProperty('temperature');
    } finally {
      blocked();
      await built.close();
    }
  });

  it('retains admitted parameters through HTTP steering while a fresh admission observes the owner change', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'provider-owner-generation-'),
    );
    const environment = Object.fromEntries(
      ['LLXPRT_CONFIG_HOME', 'LLXPRT_DATA_HOME', 'LLXPRT_FAKE_RESPONSES'].map(
        (key) => [key, process.env[key]],
      ),
    );
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const left = await openLoopbackChat(1);
    const right = await openLoopbackChat(0);
    let owners: readonly RouteAAgent[] = [];
    let pending: ReadonlyArray<Promise<Observation>> = [];
    const start = (agent: Agent, text: string): Promise<Observation> => {
      const result = collect(
        agent.stream(text, { promptId: 'same-prompt', mcpDiscovery: 'skip' }),
      );
      pending = [...pending, result];
      return result;
    };
    let denied: ReadonlyArray<() => void> = [];
    try {
      const first = await openOwner('a', left.url, 0.2);
      owners = [...owners, first];
      const second = await openOwner('b', right.url, 0.7);
      owners = [...owners, second];
      const a = first.agent;
      const b = second.agent;
      denied = owners.map((owner) => denyManagerDiscovery(owner.config));
      const firstTurn = start(a, 'First owner');
      await Promise.race([
        left.entered,
        firstTurn.then(() => {
          throw new Error('Generation stopped before transport');
        }),
      ]);
      a.setModelParam('temperature', 0.9);
      a.injectSteer('Same admitted route');
      successful(await start(b, 'Sibling owner'));
      left.release();
      successful(await firstTurn);
      successful(await start(a, 'Fresh owner admission'));
      expect(left.temperatures()).toStrictEqual([0.2, 0.2, 0.9]);
      expect(right.temperatures()).toStrictEqual([0.7]);
    } finally {
      left.release();
      right.release();
      for (const restore of denied) restore();
      try {
        await Promise.all(pending);
        await runCleanupSteps(owners.map((owner) => () => owner.close()));
      } finally {
        await Promise.all([left.stop(), right.stop()]);
        restoreEnvironment(environment);
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
});
