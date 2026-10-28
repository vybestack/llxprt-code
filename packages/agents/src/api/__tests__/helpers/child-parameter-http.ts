/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer } from 'node:http';
import { once } from 'node:events';
import { json } from 'node:stream/consumers';
import type { LoadBalancerProfile } from '@vybestack/llxprt-code-settings';

interface Gate {
  readonly promise: Promise<void>;
  release(): void;
}

function gate(): Gate {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export interface Wire {
  model: string;
  temperature?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  messages?: unknown;
}

export interface ChildParameterEndpoint {
  readonly url: string;
  readonly received: Promise<void>;
  release(): void;
  requests(): readonly Wire[];
  stop(): Promise<void>;
}

function answerChunk(model: string, toolDirectory: string | undefined) {
  const useTool = toolDirectory !== undefined;
  return {
    id: 'child-capture',
    object: 'chat.completion.chunk',
    model,
    choices: [
      {
        index: 0,
        delta: useTool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'child-list-directory',
                  type: 'function',
                  function: {
                    name: 'list_directory',
                    arguments: JSON.stringify({ dir_path: toolDirectory }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: 'Done.' },
        finish_reason: useTool ? 'tool_calls' : 'stop',
      },
    ],
  };
}

/**
 * An OpenAI-compatible chat endpoint. `holdFirst` keeps the first request
 * unanswered until `release()`. With `toolDirectory` the first answer is a
 * `list_directory` tool call, later answers are `Done.`. `failFirst` answers
 * every request with a 503.
 */
export async function startChildParameterEndpoint(
  holdFirst: boolean,
  toolDirectory?: string,
  failFirst = false,
): Promise<ChildParameterEndpoint> {
  const received = gate();
  const release = gate();
  const requests: Wire[] = [];
  const server = createServer((request, reply) => {
    void json(request)
      .then(async (body: unknown) => {
        if (
          typeof body !== 'object' ||
          body === null ||
          !('model' in body) ||
          typeof body.model !== 'string'
        )
          throw new Error('Invalid HTTP request');
        const wire = body as Wire;
        requests.push(wire);
        if (holdFirst && requests.length === 1) {
          received.release();
          await release.promise;
        }
        if (failFirst) {
          reply.writeHead(503, { 'Content-Type': 'application/json' });
          reply.end(
            JSON.stringify({ error: { message: 'Primary unavailable' } }),
          );
          return;
        }
        const useTool = toolDirectory !== undefined && requests.length === 1;
        const chunk = answerChunk(
          wire.model,
          useTool ? toolDirectory : undefined,
        );
        reply.writeHead(200, { 'Content-Type': 'text/event-stream' });
        reply.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })
      .catch((error: unknown) =>
        reply.destroy(error instanceof Error ? error : undefined),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    received: received.promise,
    release: release.release,
    requests: () => requests,
    stop: async () => {
      release.release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface ProfileWrites {
  saveProfile(name: string, profile: unknown): Promise<void>;
}

export interface ChildProfileEndpoints {
  /** Where the child's first request goes (the load-balancer's secondary member). */
  readonly childUrl: string;
  /** Present for the load-balancer variant: the failing primary member. */
  readonly primaryUrl?: string;
}

function childProfile(
  url: string,
  temperature: number,
  presence_penalty: number,
) {
  return {
    version: 1,
    provider: 'openai',
    model: 'child-model',
    modelParams: { temperature },
    ephemeralSettings: {
      'auth-key': 'test-key',
      'base-url': url,
      presence_penalty,
    },
  };
}

function memberProfile(
  model: string,
  url: string,
  presence_penalty: number,
  frequency_penalty?: number,
) {
  return {
    version: 1,
    provider: 'openai',
    model,
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'test-key',
      'base-url': url,
      presence_penalty,
      ...(frequency_penalty === undefined ? {} : { frequency_penalty }),
    },
  };
}

function loadBalancerProfile(temperature: number): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    provider: '',
    model: '',
    modelParams: { temperature },
    ephemeralSettings: {},
    policy: 'failover',
    profiles: ['primary', 'secondary'],
  };
}

/** The `child` profile the first launch reads (temperature 0.3, penalty 0.4). */
export async function saveInitialChildProfiles(
  profiles: ProfileWrites,
  endpoints: ChildProfileEndpoints,
): Promise<void> {
  if (endpoints.primaryUrl === undefined) {
    await profiles.saveProfile(
      'child',
      childProfile(endpoints.childUrl, 0.3, 0.4),
    );
    return;
  }
  await profiles.saveProfile(
    'primary',
    memberProfile('primary-model', endpoints.primaryUrl, 0.2),
  );
  await profiles.saveProfile(
    'secondary',
    memberProfile('secondary-model', endpoints.childUrl, 0.4),
  );
  await profiles.saveProfile('child', loadBalancerProfile(0.3));
}

/** The profile the next launch reads (temperature 0.7, penalty 0.8, lb frequency 0.6). */
export async function saveNextChildProfiles(
  profiles: ProfileWrites,
  endpoints: ChildProfileEndpoints,
): Promise<void> {
  if (endpoints.primaryUrl === undefined) {
    await profiles.saveProfile(
      'child',
      childProfile(endpoints.childUrl, 0.7, 0.8),
    );
    return;
  }
  await profiles.saveProfile(
    'secondary',
    memberProfile('secondary-model', endpoints.childUrl, 0.8, 0.6),
  );
  await profiles.saveProfile('child', loadBalancerProfile(0.7));
}
