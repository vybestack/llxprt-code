/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { createGeminiApiClient } from '../gemini/geminiApiClientFactory.js';
import { buildGeminiTools } from '../gemini/geminiRequestBuilding.js';
import { SchemaValidator } from '../../../../packages/tools/src/utils/schemaValidator.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Expected a wire schema object');
  }
  return value;
}

function first(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Expected a nonempty wire array');
  }
  return value[0];
}

const properties = {
  absolute_path: { type: 'string', description: 'Primary path', pattern: '^/' },
  file_path: { type: 'string', description: 'Alternative path', pattern: '^/' },
  patch_content: { type: 'string', description: 'Patch body', minLength: 1 },
  mode: { type: 'string', description: 'Write mode', enum: ['safe', 'force'] },
  date: { type: 'string', description: 'Patch date', format: 'date' },
};
const source = {
  type: 'object',
  properties,
  required: ['patch_content'],
  anyOf: [{ required: ['absolute_path'] }, { required: ['file_path'] }],
};

async function wireSchema(
  streaming: boolean,
): Promise<Record<string, unknown>> {
  let received: unknown;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const body = JSON.stringify({
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
      });
      response.writeHead(200, {
        'content-type': streaming ? 'text/event-stream' : 'application/json',
      });
      response.end(streaming ? `data: ${body}\n\n` : body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a local HTTP server address');
    }
    const { geminiTools } = buildGeminiTools([
      { name: 'constrained_patch', parametersJsonSchema: source },
    ]);
    const client = await createGeminiApiClient({
      apiKey: 'local-test-key',
      httpOptions: { baseUrl: `http://127.0.0.1:${address.port}` },
    });
    const parameters = {
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'patch' }] }],
      config: { tools: geminiTools },
    };
    if (streaming) {
      const stream = await client.models.generateContentStream(parameters);
      for await (const response of stream) {
        expect(response.candidates?.length).toBeGreaterThan(0);
      }
    } else {
      await client.models.generateContent(parameters);
    }
    const tool = record(first(record(received)['tools']));
    const declaration = record(first(tool['functionDeclarations']));
    return record(declaration['parameters']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const valid = {
  absolute_path: '/a',
  file_path: '/b',
  patch_content: 'patch',
  mode: 'safe',
  date: '2026-10-01',
};
const invalid = [
  { ...valid, mode: 'unsafe' },
  { ...valid, date: 'not-a-date' },
  { ...valid, absolute_path: 'relative' },
  { ...valid, file_path: 'relative' },
  { ...valid, file_path: 42 },
  { ...valid, patch_content: '' },
  { ...valid, patch_content: 42 },
  { absolute_path: '/a' },
  { patch_content: 'patch' },
  [],
];

describe('Gemini required-only unions retain supplied optional constraints', () => {
  for (const streaming of [false, true]) {
    it(`${streaming ? 'streaming' : 'non-streaming'} preserves branch metadata and rejects invalid inputs on the wire`, async () => {
      const snapshot = structuredClone(source);
      const emitted = await wireSchema(streaming);
      const branches = emitted['anyOf'];
      if (!Array.isArray(branches)) {
        throw new Error('Expected emitted required-only alternatives');
      }
      expect(branches).toHaveLength(2);
      for (const branch of branches) {
        expect(record(branch)['properties']).toStrictEqual(properties);
        expect(record(branch)['required']).toContain('patch_content');
        expect(SchemaValidator.validate(branch, valid)).toBeNull();
        for (const input of invalid) {
          expect(SchemaValidator.validate(branch, input)).not.toBeNull();
        }
      }
      expect(SchemaValidator.validate(emitted, valid)).toBeNull();
      expect(
        SchemaValidator.validate(emitted, {
          file_path: '/b',
          patch_content: 'patch',
          mode: 'force',
          date: '2026-10-02',
        }),
      ).toBeNull();
      for (const input of invalid) {
        expect(SchemaValidator.validate(emitted, input)).not.toBeNull();
        expect(SchemaValidator.validate(source, input)).not.toBeNull();
      }
      expect(source).toStrictEqual(snapshot);
    });
  }
});
