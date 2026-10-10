/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { CoreToolHostAdapter, Config } from '@vybestack/llxprt-code-core';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import { createProviderCallOptions } from './testSupport.js';

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
import { createGeminiApiClient } from '../gemini/geminiApiClientFactory.js';
import {
  SchemaType,
  type GenerateContentParameters,
} from '../gemini/geminiWireTypes.js';
import { ApplyPatchTool } from '../../../../packages/tools/src/index.js';
import { SchemaValidator } from '../../../../packages/tools/src/utils/schemaValidator.js';
import { buildGeminiTools } from '../gemini/geminiRequestBuilding.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Expected a schema record');
  }
  return value;
}

function assertUnionTypesAreSeparate(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertUnionTypesAreSeparate);
  } else if (typeof value === 'object' && value !== null) {
    const node = record(value);
    if (Array.isArray(node['anyOf'])) {
      expect(node['type']).toBeUndefined();
      expect(node['properties']).toBeUndefined();
      expect(node['required']).toBeUndefined();
    }
    Object.values(node).forEach(assertUnionTypesAreSeparate);
  }
}

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

describe('geminiApiClientFactory', () => {
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
        if (req.url?.includes(':streamGenerateContent')) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`data: ${JSON.stringify(nextResponse)}

`);
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(nextResponse));
        }
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
    contents?: GenerateContentParameters['contents'],
    streaming = false,
  ): Promise<CapturedRequest> {
    captured = [];
    nextResponse = textResponse('ok');
    const client = await createGeminiApiClient({
      apiKey: 'test-key',
      // The BARE origin, which is what llxprt carries: @google/genai appended the
      // API version itself.
      httpOptions: { baseUrl: origin() },
    });
    const params = {
      model: 'gemini-3-flash-preview',
      contents: contents ?? [{ role: 'user', parts: [{ text: 'hi' }] }],
      config,
    };
    if (streaming) {
      const stream = await client.models.generateContentStream(params);
      const responses = [];
      for await (const response of stream) {
        responses.push(response);
      }
      expect(responses.length).toBeGreaterThan(0);
    } else {
      await client.models.generateContent(params);
    }
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

  it.each([true, false])(
    'keeps empty-tools logging metadata out of actual provider HTTP requests (streaming=%s)',
    async (streaming) => {
      const settings = new SettingsService();
      const provider = new GeminiProvider('test-key', origin(), {
        defaultModel: 'gemini-3-flash-preview',
      });
      captured = [];
      nextResponse = textResponse('ok');
      for (const conversationLogEmptyTools of [undefined, true, false]) {
        const options = createProviderCallOptions({
          providerName: 'gemini',
          settings,
          ephemerals: { streaming: streaming ? 'enabled' : 'disabled' },
          contents: [
            { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
          ],
          tools: [],
          runtimeMetadata: { conversationLogEmptyTools },
          metadata: { conversationLogEmptyTools },
          systemInstruction: 'Answer briefly.',
          resolved: { model: 'gemini-3-flash-preview', baseURL: origin() },
        });
        const chunks = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          chunks.push(chunk);
        }
        expect(chunks.length).toBeGreaterThan(0);
      }
      expect(captured).toHaveLength(3);
      expect(captured[1]).toStrictEqual(captured[0]);
      expect(captured[2]).toStrictEqual(captured[0]);
      expect(captured[0].path).toBe(
        `/v1beta/models/gemini-3-flash-preview:${streaming ? 'streamGenerateContent' : 'generateContent'}`,
      );
      expect(JSON.stringify(captured)).not.toContain(
        'conversationLogEmptyTools',
      );
    },
  );

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
      expect(properties['status']['enum']).toStrictEqual([
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
      expect(parameters['required']).toStrictEqual(['status']);
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
      expect(request.body['tools']).toStrictEqual([{ googleSearch: {} }]);
    });

    it('forwards a urlContext marker rather than dropping it', async () => {
      const request = await callWith({
        maxOutputTokens: 16,
        tools: [{ urlContext: {} }],
      });
      expect(request.body['tools']).toStrictEqual([{ urlContext: {} }]);
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
      const contents = request.body['contents'] as Array<
        Record<string, unknown>
      >;
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
      expect(args['args']).toStrictEqual({ city: 'Paris' });
    });

    it('carries the thought signature of a replayed function call', async () => {
      // Gemini 3 rejects a replayed turn whose signature is missing.
      const request = await callWith({ maxOutputTokens: 16 }, history);
      expect(JSON.stringify(request.body['contents'])).toContain('sig-abc');
    });
  });

  describe('Gemini client seam: required-only object unions', () => {
    const declarationRoot = new WorkspaceFilesystemOwner({
      targetDir: process.cwd(),
      isTrusted: () => true,
    });
    const declarationSettings = new SessionSettingsOwner(new SettingsService());
    const declarationConfig = new Config({
      sessionId: 'gemini-schema',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
    });
    declarationSettings.bindTelemetry(declarationConfig);
    afterAll(async () => {
      await declarationSettings.dispose();
      await declarationRoot.dispose();
      await declarationConfig.dispose();
    });
    const declaration = new ApplyPatchTool(
      new CoreToolHostAdapter(
        declarationConfig,
        declarationRoot.paths,
        declarationRoot.files,
        declarationRoot.ignore,
        declarationRoot.scans,
        () => declarationSettings.readToolExecutionPolicy(),
        { isTrustedFolder: () => true, getIdeTrust: () => undefined },
        declarationSettings.telemetry,
      ),
    ).schema;
    const name = declaration.name;
    if (typeof name !== 'string') {
      throw new Error('Expected the apply_patch declaration name');
    }
    const source = record(declaration.parametersJsonSchema);
    const cases = [
      { data: { absolute_path: '/a', patch_content: 'patch' }, valid: true },
      { data: { file_path: '/a', patch_content: 'patch' }, valid: true },
      {
        data: { absolute_path: '/a', file_path: '/b', patch_content: 'patch' },
        valid: true,
      },
      { data: { patch_content: 'patch' }, valid: false },
      { data: { absolute_path: '/a' }, valid: false },
      { data: { file_path: '/a' }, valid: false },
      { data: { absolute_path: '/a', file_path: '/b' }, valid: false },
      { data: { absolute_path: 42, patch_content: 'patch' }, valid: false },
      { data: { file_path: 42, patch_content: 'patch' }, valid: false },
      {
        data: { absolute_path: '/a', file_path: 42, patch_content: 'patch' },
        valid: false,
      },
      {
        data: { absolute_path: 42, file_path: '/b', patch_content: 'patch' },
        valid: false,
      },
      { data: { absolute_path: '/a', patch_content: 42 }, valid: false },
      { data: { file_path: '/a', patch_content: 42 }, valid: false },
      { data: [], valid: false },
      ...['absolute_path', 'file_path', 'patch_content'].flatMap((field) =>
        [null, false, [], {}].map((value) => ({
          data: {
            absolute_path: '/a',
            file_path: '/b',
            patch_content: 'patch',
            [field]: value,
          },
          valid: false,
        })),
      ),
    ];

    for (const streaming of [false, true]) {
      describe(streaming ? 'streaming' : 'non-streaming', () => {
        for (const casing of ['lowercase', 'uppercase']) {
          const schema =
            casing === 'lowercase'
              ? source
              : {
                  ...source,
                  type: SchemaType.OBJECT,
                  properties: Object.fromEntries(
                    Object.entries(record(source['properties'])).map(
                      ([name, property]) => [
                        name,
                        { ...record(property), type: SchemaType.STRING },
                      ],
                    ),
                  ),
                };
          for (const location of ['root', 'properties', 'items']) {
            const parametersJsonSchema =
              location === 'root'
                ? schema
                : {
                    type: SchemaType.OBJECT,
                    properties: {
                      patch:
                        location === 'properties'
                          ? schema
                          : { type: SchemaType.ARRAY, items: schema },
                    },
                    required: ['patch'],
                  };
            const toolDeclaration = {
              ...declaration,
              name,
              parametersJsonSchema,
            };

            it(`preserves ${casing} ${location} patch constraints on the wire`, async () => {
              const snapshot = structuredClone(toolDeclaration);
              const { geminiTools } = buildGeminiTools([toolDeclaration]);
              const request = await callWith(
                { tools: geminiTools },
                undefined,
                streaming,
              );
              expect(request.path).toEndWith(
                streaming ? ':streamGenerateContent' : ':generateContent',
              );
              expect(firstTool(request.body)['name']).toBe(declaration.name);
              const parameters = record(firstTool(request.body)['parameters']);
              assertUnionTypesAreSeparate(parameters);
              const patchSchema =
                location === 'root'
                  ? parameters
                  : location === 'properties'
                    ? record(record(parameters['properties'])['patch'])
                    : record(
                        record(record(parameters['properties'])['patch'])[
                          'items'
                        ],
                      );
              const branches = patchSchema['anyOf'];
              if (!Array.isArray(branches)) {
                throw new Error('Expected patch alternatives');
              }
              expect(branches).toHaveLength(2);
              for (const [index, branchValue] of branches.entries()) {
                const branch = record(branchValue);
                expect(branch['type']).toBe('object');
                expect(branch['required']).toEqual(
                  expect.arrayContaining([
                    'patch_content',
                    index === 0 ? 'absolute_path' : 'file_path',
                  ]),
                );
                const properties = record(branch['properties']);
                for (const name of [
                  'absolute_path',
                  'file_path',
                  'patch_content',
                ]) {
                  expect(record(properties[name])['type']).toBe('string');
                }
              }
              for (const { data, valid } of cases) {
                expect(
                  SchemaValidator.validate({ anyOf: branches }, data) === null,
                ).toBe(valid);
              }
              expect(toolDeclaration).toStrictEqual(snapshot);
            });

            it(`validates the ${casing} ${location} emitted patch truth table`, async () => {
              const { geminiTools } = buildGeminiTools([toolDeclaration]);
              const request = await callWith(
                { tools: geminiTools },
                undefined,
                streaming,
              );
              const parameters = record(firstTool(request.body)['parameters']);
              for (const { data, valid } of cases) {
                const input =
                  location === 'root'
                    ? data
                    : { patch: location === 'properties' ? data : [data] };
                expect(
                  SchemaValidator.validate(parameters, input) === null,
                ).toBe(valid);
              }
            });
          }
        }

        it.each([
          {
            name: 'mixed typed and required-only alternatives',
            anyOf: [
              { required: ['a'] },
              {
                type: 'object',
                properties: { b: { type: 'string' } },
                required: ['b'],
              },
            ],
          },
          {
            name: 'an empty alternative',
            anyOf: [{ required: ['a'] }, {}],
          },
          {
            name: 'an alternative with empty required names',
            anyOf: [{ required: ['a'] }, { required: [] }],
          },
          {
            name: 'an alternative with its own property constraints',
            anyOf: [
              { required: ['a'] },
              {
                properties: { b: { type: 'string', minLength: 3 } },
                required: ['b'],
              },
            ],
          },
        ])(
          'preserves common constraints outside normalization for $name',
          async ({ anyOf }) => {
            const parametersJsonSchema = {
              type: 'object',
              properties: {
                a: { type: 'string' },
                b: { type: 'string' },
                common: { type: 'string' },
              },
              required: ['common'],
              anyOf,
            };
            const snapshot = structuredClone(parametersJsonSchema);
            const { geminiTools } = buildGeminiTools([
              { name: 'mixed_boundary', parametersJsonSchema },
            ]);
            const request = await callWith(
              { tools: geminiTools },
              undefined,
              streaming,
            );
            const parameters = record(firstTool(request.body)['parameters']);
            for (const data of [
              { b: 'ok' },
              { b: 'ok', common: 42 },
              { a: 'ok', common: 'yes' },
              { b: 'long', common: 'yes' },
              { a: 42, b: 'long', common: 'yes' },
              { a: 'ok', b: 42, common: 'yes' },
              { b: 'ok', common: 'yes' },
              [],
            ]) {
              expect(SchemaValidator.validate(parameters, data) === null).toBe(
                SchemaValidator.validate(parametersJsonSchema, data) === null,
              );
            }
            expect(parameters['type']).toBe('object');
            expect(parameters['properties']).toStrictEqual(
              parametersJsonSchema.properties,
            );
            expect(parameters['required']).toStrictEqual(['common']);
            expect(parameters['anyOf']).toStrictEqual(anyOf);
            expect(parametersJsonSchema).toStrictEqual(snapshot);
          },
        );

        it('retains common constraints when the alternatives are empty', async () => {
          const parametersJsonSchema = {
            type: 'object',
            properties: { common: { type: 'string' } },
            required: ['common'],
            anyOf: [],
          };
          const { geminiTools } = buildGeminiTools([
            { name: 'empty_boundary', parametersJsonSchema },
          ]);
          const request = await callWith(
            { tools: geminiTools },
            undefined,
            streaming,
          );
          const parameters = record(firstTool(request.body)['parameters']);
          expect(parameters['type']).toBe('object');
          expect(parameters['properties']).toStrictEqual(
            parametersJsonSchema.properties,
          );
          expect(parameters['required']).toStrictEqual(['common']);
        });

        it.each(['object', SchemaType.OBJECT, undefined])(
          'preserves ordinary object constraints with root type %s and their source declaration',
          async (type) => {
            const parametersJsonSchema = {
              ...(type === undefined ? {} : { type }),
              properties: {
                label: { type: 'string', minLength: 2 },
                entries: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { value: { type: 'string' } },
                    required: ['value'],
                  },
                },
              },
              required: ['label'],
            };
            const snapshot = structuredClone(parametersJsonSchema);
            const { geminiTools } = buildGeminiTools([
              { name: 'ordinary', parametersJsonSchema },
            ]);
            const request = await callWith(
              { tools: geminiTools },
              undefined,
              streaming,
            );
            const parameters = record(firstTool(request.body)['parameters']);
            expect(parameters['type']).toBe('object');
            expect(parameters['anyOf']).toBeUndefined();
            for (const { data, valid } of [
              { data: { label: 'ok', entries: [{ value: 'v' }] }, valid: true },
              { data: {}, valid: false },
              { data: { label: 'x' }, valid: false },
              { data: { label: 42 }, valid: false },
              { data: { label: 'ok', entries: [{}] }, valid: false },
              { data: { label: 'ok', entries: [{ value: 42 }] }, valid: false },
            ]) {
              expect(SchemaValidator.validate(parameters, data) === null).toBe(
                valid,
              );
            }
            expect(parametersJsonSchema).toStrictEqual(snapshot);
          },
        );

        it('does not insert an object type into an existing anyOf-only root union', async () => {
          const parametersJsonSchema = {
            anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'integer' }],
          };
          const snapshot = structuredClone(parametersJsonSchema);
          const { geminiTools } = buildGeminiTools([
            { name: 'existing_union', parametersJsonSchema },
          ]);
          expect(
            geminiTools?.[0].functionDeclarations[0].parameters.type,
          ).toBeUndefined();
          const request = await callWith(
            { tools: geminiTools },
            undefined,
            streaming,
          );
          const parameters = record(firstTool(request.body)['parameters']);
          assertUnionTypesAreSeparate(parameters);
          expect(parameters['anyOf']).toStrictEqual(parametersJsonSchema.anyOf);
          expect(parametersJsonSchema).toStrictEqual(snapshot);
        });
      });
    }
  });
});
