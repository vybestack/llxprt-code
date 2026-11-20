/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The Gemini client reports the byte length of each JSON body it posts, with
 * and without declared tools (the tool-schema path re-serializes the body).
 * The real factory and `@ai-sdk/google` run against a local HTTP server, and
 * the reported size is compared with the bytes the server received.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeminiApiClient } from '../gemini/geminiApiClientFactory.js';
import {
  SchemaType,
  type GenerateContentParameters,
} from '../gemini/geminiWireTypes.js';

const response = {
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'ok' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 1,
    candidatesTokenCount: 1,
    totalTokenCount: 2,
  },
};

let server: Server;
let origin = '';
let receivedBytes: number[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      receivedBytes.push(Buffer.concat(chunks).byteLength);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

async function send(
  config: GenerateContentParameters['config'],
): Promise<{ reported: number[]; received: number[] }> {
  receivedBytes = [];
  const reported: number[] = [];
  const client = await createGeminiApiClient({
    fetch: globalThis.fetch,
    apiKey: 'test-key',
    httpOptions: { baseUrl: origin },
    onRequestBytes: (bytes) => reported.push(bytes),
  });
  await client.models.generateContent({
    model: 'gemini-test',
    contents: [{ role: 'user', parts: [{ text: 'héllo 😀 日本語' }] }],
    config,
  });
  return { reported, received: receivedBytes };
}

describe('gemini client request size report', () => {
  it('reports the bytes of a request without tools', async () => {
    const { reported, received } = await send({ maxOutputTokens: 16 });

    expect(received).toHaveLength(1);
    expect(reported).toStrictEqual(received);
  });

  it('reports the bytes of a request whose tool schemas are re-serialized', async () => {
    const { reported, received } = await send({
      maxOutputTokens: 16,
      tools: [
        {
          functionDeclarations: [
            {
              name: 'todo_write',
              description: 'Write todos',
              parametersJsonSchema: {
                type: SchemaType.OBJECT,
                properties: {
                  path: { type: SchemaType.STRING, pattern: '^[a-z]+$' },
                },
                required: ['path'],
              },
            },
          ],
        },
      ],
    });

    expect(received).toHaveLength(1);
    expect(reported).toStrictEqual(received);
  });
});
