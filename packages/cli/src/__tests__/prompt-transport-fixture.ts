/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json } from 'node:stream/consumers';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useCliGenerationEnvironment } from './utility-generation-fixture.js';

interface PromptWireRequest {
  readonly model: string;
  readonly messages: unknown[];
  readonly tools?: unknown;
  readonly tool_choice?: unknown;
}

function isPromptRequest(value: unknown): value is PromptWireRequest {
  if (typeof value !== 'object' || value === null) return false;
  if (!('model' in value) || typeof value.model !== 'string') return false;
  return 'messages' in value && Array.isArray(value.messages);
}

function respondWithChunks(
  response: ServerResponse,
  model: string,
  chunks: readonly string[],
): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const content of chunks) {
    response.write(
      `data: ${JSON.stringify({
        id: 'cli-prompt',
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  response.end(
    `data: ${JSON.stringify({
      id: 'cli-prompt',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\ndata: [DONE]\n\n`,
  );
}

async function startPromptTransport(): Promise<{
  readonly url: string;
  requests(): readonly PromptWireRequest[];
  respondWith(chunks: readonly string[]): void;
  failWith(message: string): void;
  close(): Promise<void>;
}> {
  let requests: readonly PromptWireRequest[] = [];
  let chunks: readonly string[] = ['Auto generated ', 'prompt'];
  let failure: string | undefined;
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    void json(request)
      .then((body: unknown) => {
        if (!isPromptRequest(body))
          throw new Error('Invalid prompt wire request');
        requests = [...requests, body];
        if (failure !== undefined) {
          response
            .writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: { message: failure } }));
        } else respondWithChunks(response, body.model, chunks);
      })
      .catch((error: unknown) => {
        response.writeHead(500).end(String(error));
      });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (typeof address !== 'object' || address === null)
    throw new Error('Expected local prompt transport address');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    respondWith: (next) => {
      chunks = next;
      failure = undefined;
    },
    failWith: (message) => {
      failure = message;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

interface PromptTransportFixture {
  readonly agent: Agent;
  requests(): readonly PromptWireRequest[];
  respondWith(chunks: readonly string[]): void;
  failWith(message: string): void;
}

export function usePromptTransport(): () => PromptTransportFixture {
  useCliGenerationEnvironment();
  const credentials = useOwnedCredentials();
  let current: PromptTransportFixture;
  let release: () => Promise<void>;
  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cli-prompt-transport-'));
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const transport = await startPromptTransport();
    const agent = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'openai',
      model: 'test-model',
      workingDir: directory,
      auth: { apiKey: 'local-test-key', baseUrl: transport.url },
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
    });
    current = { ...transport, agent };
    release = async () => {
      try {
        await agent.dispose();
      } finally {
        await transport.close();
        if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
        else process.env.LLXPRT_FAKE_RESPONSES = previous;
        await rm(directory, { recursive: true, force: true });
      }
    };
  });
  afterEach(async () => {
    await release();
  });
  return () => current;
}
