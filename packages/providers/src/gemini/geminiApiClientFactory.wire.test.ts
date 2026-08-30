/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire-level tests for the Gemini client seam.
 *
 * The other gemini suites mock this seam, which is why they stayed green while
 * the provider could not answer a single prompt: a converter that emits
 * well-typed nonsense looks identical to a correct one from behind a mock, and
 * `type: 'STRING'` versus `type: 'string'` is invisible to the compiler.
 *
 * These tests run the real factory and the real `@ai-sdk/google` conversion
 * against a local HTTP server, then assert on the bytes that reach it. No
 * network, no mocked seam.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGeminiApiClient } from './geminiApiClientFactory.js';
import { SchemaType } from './geminiWireTypes.js';

interface CapturedRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

let server: Server;
let port = 0;
let captured: CapturedRequest[] = [];
let nextResponse: Record<string, unknown> = {};

function textResponse(text: string): Record<string, unknown> {
  return {
    candidates: [
      {
        content: { role: 'model', parts: [{ text }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2,
    },
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      captured.push({
        path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
        body: raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nextResponse));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function origin(): string {
  return `http://127.0.0.1:${String(port)}`;
}

async function callWith(
  config: Record<string, unknown>,
  contents?: unknown,
): Promise<CapturedRequest> {
  captured = [];
  nextResponse = textResponse('ok');
  const client = await createGeminiApiClient({
    apiKey: 'test-key',
    // The BARE origin, which is what llxprt carries: @google/genai appended the
    // API version itself.
    httpOptions: { baseUrl: origin() },
  });
  await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: contents ?? [{ role: 'user', parts: [{ text: 'hi' }] }],
    config,
  } as never);
  const request = captured[0];
  expect(request).toBeDefined();
  return request;
}

function firstTool(body: Record<string, unknown>): Record<string, unknown> {
  const tools = body['tools'] as Array<Record<string, unknown>> | undefined;
  expect(tools).toBeDefined();
  const declarations = (tools as Array<Record<string, unknown>>)[0][
    'functionDeclarations'
  ] as Array<Record<string, unknown>> | undefined;
  expect(declarations).toBeDefined();
  return (declarations as Array<Record<string, unknown>>)[0];
}

describe('Gemini client seam: request URL', () => {
  it('sends to the versioned Gemini path when given a bare origin', async () => {
    const request = await callWith({ maxOutputTokens: 16 });
    // The AI SDK joins the model path onto whatever base URL it is handed, so a
    // bare origin yields /models/... and a 404 from the real API.
    expect(request.path).toBe(
      '/v1beta/models/gemini-3-flash-preview:generateContent',
    );
  });
});

describe('Gemini client seam: tool schema conversion', () => {
  // Tool authors write schemas with Gemini's own constants, which are uppercase
  // because that IS the wire form. The AI SDK expects lowercase JSON Schema and
  // converts to the wire form itself.
  const todoLikeSchema = {
    type: SchemaType.OBJECT,
    properties: {
      status: {
        type: SchemaType.STRING,
        enum: ['pending', 'in_progress', 'completed'],
        description: 'Current status',
      },
      tags: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
    },
    required: ['status'],
  };

  const toolConfig = {
    maxOutputTokens: 16,
    tools: [
      {
        functionDeclarations: [
          {
            name: 'todo_write',
            description: 'Write todos',
            parametersJsonSchema: todoLikeSchema,
          },
        ],
      },
    ],
  };

  it('accepts a schema written with uppercase Gemini type constants', async () => {
    // Before normalisation the SDK rejected this outright, because an enum whose
    // declared type is 'STRING' matches none of its supported primitives:
    // "Google does not support this JSON Schema enum."
    const request = await callWith(toolConfig);
    const parameters = firstTool(request.body)['parameters'] as Record<
      string,
      unknown
    >;
    const properties = parameters['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    // The SDK converts JSON Schema to the wire form itself, so what it receives
    // must be JSON Schema: lowercase, not the uppercase Gemini constants.
    expect(parameters['type']).toBe('object');
    expect(properties['status']['type']).toBe('string');
    expect(properties['tags']['type']).toBe('array');
  });

  it('preserves the enum values through conversion', async () => {
    const request = await callWith(toolConfig);
    const parameters = firstTool(request.body)['parameters'] as Record<
      string,
      unknown
    >;
    const properties = parameters['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties['status']['enum']).toEqual([
      'pending',
      'in_progress',
      'completed',
    ]);
  });

  it('carries the declared name and required fields to the wire', async () => {
    const request = await callWith(toolConfig);
    const declaration = firstTool(request.body);
    expect(declaration['name']).toBe('todo_write');
    const parameters = declaration['parameters'] as Record<string, unknown>;
    expect(parameters['required']).toEqual(['status']);
  });
});

describe('Gemini client seam: server tools', () => {
  it('forwards a googleSearch marker rather than dropping it', async () => {
    // Server tools arrive as bare markers with no function declarations. A
    // converter that only walks functionDeclarations drops them silently and
    // the model answers ungrounded.
    const request = await callWith({
      maxOutputTokens: 16,
      tools: [{ googleSearch: {} }],
    });
    // Round-trips back to the Gemini wire spelling. If the marker were dropped
    // there would be no tools on the request at all.
    expect(request.body['tools']).toEqual([{ googleSearch: {} }]);
  });

  it('forwards a urlContext marker rather than dropping it', async () => {
    const request = await callWith({
      maxOutputTokens: 16,
      tools: [{ urlContext: {} }],
    });
    expect(request.body['tools']).toEqual([{ urlContext: {} }]);
  });
});

describe('Gemini client seam: replayed assistant turns', () => {
  const history = [
    { role: 'user', parts: [{ text: 'weather in Paris?' }] },
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'call-1',
            name: 'get_weather',
            args: { city: 'Paris' },
          },
          thoughtSignature: 'sig-abc',
        },
      ],
    },
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'get_weather',
            response: { tempC: 18 },
          },
        },
      ],
    },
  ];

  it('sends replayed tool arguments as an object, not a JSON string', async () => {
    // doGenerate RETURNS input as a JSON string; the prompt side takes the
    // parsed value. Stringifying here double-encodes and the API answers
    // INVALID_ARGUMENT on function_call.args.
    const request = await callWith({ maxOutputTokens: 16 }, history);
    const contents = request.body['contents'] as Array<Record<string, unknown>>;
    const modelTurn = contents.find((turn) => turn['role'] === 'model');
    expect(modelTurn).toBeDefined();
    const parts = (modelTurn as Record<string, unknown>)['parts'] as Array<
      Record<string, unknown>
    >;
    const call = parts.find((part) => part['functionCall'] !== undefined);
    expect(call).toBeDefined();
    const args = (call as Record<string, unknown>)['functionCall'] as Record<
      string,
      unknown
    >;
    expect(args['args']).toEqual({ city: 'Paris' });
  });

  it('carries the thought signature of a replayed function call', async () => {
    // Gemini 3 rejects a replayed turn whose signature is missing.
    const request = await callWith({ maxOutputTokens: 16 }, history);
    expect(JSON.stringify(request.body['contents'])).toContain('sig-abc');
  });
});

describe('Gemini client seam: anyOf branches that only constrain requiredness', () => {
  // apply_patch declares `anyOf: [{ required: ['absolute_path'] },
  // { required: ['file_path'] }]`, meaning "at least one of these". Gemini
  // rejects a branch that marks a property required without being an object
  // schema that defines it:
  //   any_of[0].required: only allowed for OBJECT type
  //   any_of[0].required[0]: property is not defined
  const applyPatchLike = {
    maxOutputTokens: 16,
    tools: [
      {
        functionDeclarations: [
          {
            name: 'apply_patch',
            description: 'Apply a patch',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                absolute_path: { type: 'string' },
                file_path: { type: 'string' },
                patch_content: { type: 'string' },
              },
              required: ['patch_content'],
              anyOf: [
                { required: ['absolute_path'] },
                { required: ['file_path'] },
              ],
            },
          },
        ],
      },
    ],
  };

  it('gives each branch an object type and the property it requires', async () => {
    const request = await callWith(applyPatchLike);
    const parameters = firstTool(request.body)['parameters'] as Record<
      string,
      unknown
    >;
    const branches = parameters['anyOf'] as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      const required = branch['required'] as string[];
      expect(branch['type']).toBe('object');
      const properties = branch['properties'] as Record<string, unknown>;
      for (const name of required) {
        expect(properties[name]).toBeTruthy();
      }
    }
  });

  it('keeps the branches distinct so the either/or meaning survives', async () => {
    const request = await callWith(applyPatchLike);
    const parameters = firstTool(request.body)['parameters'] as Record<
      string,
      unknown
    >;
    const branches = parameters['anyOf'] as Array<Record<string, unknown>>;
    expect(branches.map((b) => b['required'])).toEqual([
      ['absolute_path'],
      ['file_path'],
    ]);
  });
});
