/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  IdeClient,
  IDEConnectionStatus,
  type IdeContext,
} from '@vybestack/llxprt-code-ide-integration';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AgentClient } from '../client.js';

export async function createClientIdeFixture(client: AgentClient): Promise<{
  update(context: IdeContext): Promise<void>;
  setEnabled(value: boolean): void;
  dispose(): Promise<void>;
}> {
  const { server, transport, http } = createIdeServer();
  let instance: IdeClient | undefined;
  let closing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    closing ??= closeIdeFixture(instance, server, http);
    return closing;
  };
  const previous = new Map<string, string | undefined>();
  try {
    await server.connect(transport);
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const address = http.address();
    if (address === null || typeof address === 'string')
      throw new Error('IDE fixture did not bind');
    for (const [key, value] of Object.entries({
      TERM_PROGRAM: 'vscode',
      LLXPRT_CODE_IDE_SERVER_PORT: String(address.port),
      LLXPRT_CODE_IDE_WORKSPACE_PATH: process.cwd(),
    })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    instance = await IdeClient.create();
    await instance.connect();
    if (instance.getConnectionStatus().status !== IDEConnectionStatus.Connected)
      throw new Error(
        `IDE fixture failed to connect: ${JSON.stringify(instance.getConnectionStatus())}`,
      );
  } catch (error) {
    try {
      await dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Client IDE fixture setup failed',
      );
    }
    throw error;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const connected = instance;
  let enabled = true;
  client.bindIdeContext(
    () => connected.getIdeContext(),
    () => enabled,
  );
  return {
    setEnabled: (value) => {
      enabled = value;
    },
    update: (context) => receiveIdeContext(transport, connected, context),
    dispose,
  };
}

function createIdeServer(): {
  server: Server;
  transport: StreamableHTTPServerTransport;
  http: ReturnType<typeof createServer>;
} {
  const server = new Server(
    { name: 'client-context-fixture', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const initial: IdeContext = { workspaceState: {} };
  server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
    await transport.send(
      { jsonrpc: '2.0', method: 'ide/contextUpdate', params: initial },
      { relatedRequestId: extra.requestId },
    );
    return {};
  });
  const http = createServer((request, response) => {
    void transport
      .handleRequest(request, response)
      .catch((error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
  });
  return { server, transport, http };
}

async function closeIdeFixture(
  instance: IdeClient | undefined,
  server: Server,
  http: ReturnType<typeof createServer>,
): Promise<void> {
  const results = await Promise.allSettled([
    instance?.disconnect(),
    server.close(),
    new Promise<void>((resolve, reject) => {
      if (!http.listening) {
        resolve();
        return;
      }
      http.close((error) => (error ? reject(error) : resolve()));
      http.closeAllConnections();
    }),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Client IDE fixture cleanup failed');
}

async function receiveIdeContext(
  transport: StreamableHTTPServerTransport,
  connected: IdeClient,
  context: IdeContext,
): Promise<void> {
  await transport.send({
    jsonrpc: '2.0',
    method: 'ide/contextUpdate',
    params: context,
  });
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (
      isDeepStrictEqual(
        connected.getIdeContext(),
        JSON.parse(JSON.stringify(context)),
      )
    )
      return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('IDE context notification was not received');
}
