/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  convertSchemaToOpenAIResponses,
  convertToolsToOpenAIResponses,
  type OpenAIResponsesParameters,
} from './schemaConverter.js';

describe('Responses JSON schema fidelity', () => {
  it('retains nullable types, enum data, unions, references and closed nested schemas without mutation', () => {
    const schema = {
      type: 'object',
      properties: {
        maybe: { type: ['string', 'null'], enum: ['value', null] },
        choice: { anyOf: [{ type: 'integer', minimum: 2 }, { type: 'null' }] },
        nested: {
          type: 'object',
          properties: { value: { $ref: '#/$defs/value' } },
          required: ['value'],
          additionalProperties: false,
        },
        data: { const: { type: 'DATA', properties: { untouched: true } } },
        tuple: {
          type: 'array',
          items: [{ type: 'string' }, { type: 'integer' }],
        },
      },
      required: ['choice'],
      additionalProperties: false,
      $defs: { value: { oneOf: [{ type: 'number' }, { type: 'null' }] } },
      allOf: [{ properties: { choice: { not: { type: 'string' } } } }],
    } satisfies OpenAIResponsesParameters;
    const before = structuredClone(schema);
    expect(convertSchemaToOpenAIResponses(schema)).toStrictEqual(schema);
    expect(schema).toStrictEqual(before);
  });

  it('normalizes schema types and numeric constraints inside unions but leaves literal data alone', () => {
    const converted = convertSchemaToOpenAIResponses({
      type: 'OBJECT',
      properties: {
        union: { anyOf: [{ type: 'INTEGER', minimum: '2' }, { type: 'NULL' }] },
        nullable: { type: ['STRING', 'NULL'] },
        rows: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { x: { type: 'NUMBER', maximum: '5' } },
          },
        },
        literal: { default: { type: 'OBJECT' } },
      },
      additionalProperties: { type: 'BOOLEAN' },
    });
    expect(converted).toStrictEqual({
      type: 'object',
      required: [],
      properties: {
        union: { anyOf: [{ type: 'integer', minimum: 2 }, { type: 'null' }] },
        nullable: { type: ['string', 'null'] },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number', maximum: 5 } },
            required: [],
          },
        },
        literal: { default: { type: 'OBJECT' } },
      },
      additionalProperties: { type: 'boolean' },
    });
  });

  it('rejects missing primary schemas even when a usable authoring schema is present', () => {
    const declaration = {
      name: 'sentinel',
      parametersJsonSchema: {},
      parameters: {
        type: 'object',
        properties: { fallback: { type: 'string' } },
      },
    };
    Reflect.deleteProperty(declaration, 'parametersJsonSchema');
    expect(() => convertToolsToOpenAIResponses([declaration])).toThrow(
      'Tool "sentinel" is missing parametersJsonSchema',
    );
  });
});
