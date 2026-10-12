/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';

const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export interface PhysicalCatalogFixture {
  readonly url: string;
  release(): void;
  stop(): Promise<void>;
}

export async function startCatalogFixture(
  directory: string,
): Promise<PhysicalCatalogFixture> {
  await writeFile(join(directory, 'quantity'), '7');
  const releases = new Set<() => void>();
  const handle = createCatalogHandler(directory, releases);
  const server = createHttpFixtureServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected HTTP address');
  const release = (): void => {
    for (const resolve of releases) resolve();
    releases.clear();
  };
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    release,
    stop: async (): Promise<void> => {
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

const multiplyDeclaration = {
  name: 'multiply',
  description: 'Multiply the physical workspace quantity',
  inputSchema: {
    type: 'object',
    properties: { factor: { type: 'number' } },
    required: ['factor'],
  },
};

type PhysicalRpc = z.infer<typeof requestSchema>;

function createCatalogHandler(
  directory: string,
  releases: Set<() => void>,
): (rpc: PhysicalRpc) => Promise<Response> {
  const pending = new Map<string | number, () => void>();
  return async (rpc: z.infer<typeof requestSchema>): Promise<Response> => {
    await appendFile(join(directory, 'requests'), `${rpc.method}\n`);
    if (rpc.method === 'notifications/cancelled') {
      const { requestId } = z
        .object({ requestId: z.union([z.string(), z.number()]) })
        .parse(rpc.params);
      const cancel = pending.get(requestId);
      if (cancel === undefined)
        throw new Error('Cancellation has no active tool request');
      await writeFile(join(directory, 'tool-cancelled'), String(requestId));
      cancel();
    }
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    switch (rpc.method) {
      case 'initialize':
        result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {}, prompts: {}, resources: {} },
          serverInfo: { name: 'physical-catalog', version: '1.0.0' },
        };
        break;
      case 'tools/list':
        result = { tools: [multiplyDeclaration] };
        break;
      case 'tools/call': {
        const argumentsValue = z
          .object({ factor: z.number() })
          .parse(rpc.params?.arguments);
        if (argumentsValue.factor === 99) {
          const id = rpc.id;
          const gate = new Promise<boolean>((resolve) => {
            const release = (): void => resolve(false);
            releases.add(release);
            pending.set(id, () => {
              releases.delete(release);
              resolve(true);
            });
          });
          await writeFile(join(directory, 'tool-entered'), String(id));
          const cancelled = await gate;
          pending.delete(id);
          if (cancelled) return new Response(null, { status: 202 });
        }
        const total =
          Number(await readFile(join(directory, 'quantity'), 'utf8')) *
          argumentsValue.factor;
        await writeFile(join(directory, 'product'), String(total));
        result = { content: [{ type: 'text', text: String(total) }] };
        break;
      }
      case 'prompts/list':
        result = {
          prompts: [{ name: 'quantity', arguments: [{ name: 'hold' }] }],
        };
        break;
      case 'resources/list':
        result = {
          resources: [{ name: 'quantity', uri: 'fixture:///quantity' }],
        };
        break;
      case 'prompts/get':
      case 'resources/read':
        result = await readPhysicalCapability(directory, rpc, releases);
        break;
      default:
        return Response.json({
          jsonrpc: '2.0',
          id: rpc.id,
          error: { code: -32601, message: 'Unknown method' },
        });
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  };
}

function createHttpFixtureServer(
  handle: (rpc: PhysicalRpc) => Promise<Response>,
): Server {
  return createServer((request, response) => {
    const respond = async (): Promise<void> => {
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      request.setEncoding('utf8');
      let body = '';
      for await (const chunk of request) {
        const value: unknown = chunk;
        if (typeof value !== 'string')
          throw new Error('Expected UTF8 RPC body');
        body += value;
      }
      const result = await handle(requestSchema.parse(JSON.parse(body)));
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(await result.text());
    };
    void respond().catch((error: unknown) =>
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  });
}

async function readPhysicalCapability(
  directory: string,
  rpc: PhysicalRpc,
  releases: Set<() => void>,
): Promise<unknown> {
  const held =
    rpc.params?.uri === 'fixture:///held' ||
    z.record(z.unknown()).optional().parse(rpc.params?.arguments)?.hold ===
      'yes';
  if (held) {
    await writeFile(join(directory, 'entered'), rpc.method);
    await new Promise<void>((resolve) => releases.add(resolve));
  }
  const quantity = await readFile(join(directory, 'quantity'), 'utf8');
  return rpc.method === 'prompts/get'
    ? {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Quantity squared is ${Number(quantity) ** 2}`,
            },
          },
        ],
      }
    : { contents: [{ uri: rpc.params?.uri, text: quantity }] };
}

export async function waitForFixtureFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Fixture did not produce ${path}`);
}
