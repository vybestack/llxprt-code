/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Type } from '../types/schema-type.js';
import {
  type GeminiFunctionDeclaration,
  type PartUnion,
  type PartListUnion,
  type GeminiPart,
  type GeminiFunctionCall,
} from '../types/gemini-neutral.js';
import { TodoWrite } from '../tools/todo-write.js';
import { TodoRead } from '../tools/todo-read.js';
import { TodoPause } from '../tools/todo-pause.js';

describe('neutral Type enum runtime values', () => {
  it('Type.STRING serializes to the string "STRING"', () => {
    expect(Type.STRING).toBe('STRING');
  });

  it('Type.OBJECT serializes to the string "OBJECT"', () => {
    expect(Type.OBJECT).toBe('OBJECT');
  });

  it('Type.ARRAY serializes to the string "ARRAY"', () => {
    expect(Type.ARRAY).toBe('ARRAY');
  });

  it('Type.NUMBER serializes to the string "NUMBER"', () => {
    expect(Type.NUMBER).toBe('NUMBER');
  });

  it('Type.INTEGER serializes to the string "INTEGER"', () => {
    expect(Type.INTEGER).toBe('INTEGER');
  });

  it('Type.BOOLEAN serializes to the string "BOOLEAN"', () => {
    expect(Type.BOOLEAN).toBe('BOOLEAN');
  });
});

describe('todo tools schema preserves exact runtime values', () => {
  it('TodoWrite schema has type: "OBJECT" at root (not a symbol or enum object)', () => {
    const tool = new TodoWrite(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const schema = tool.schema;
    const jsonSchema = schema.parametersJsonSchema as Record<string, unknown>;
    expect(jsonSchema['type']).toBe('OBJECT');
  });

  it('TodoRead schema has type: "OBJECT"', () => {
    const tool = new TodoRead(undefined);
    const schema = tool.schema;
    const jsonSchema = schema.parametersJsonSchema as Record<string, unknown>;
    expect(jsonSchema['type']).toBe('OBJECT');
  });

  it('TodoPause schema has type: "OBJECT" and reason.type: "STRING"', () => {
    const tool = new TodoPause(undefined, undefined);
    const schema = tool.schema;
    const jsonSchema = schema.parametersJsonSchema as {
      type: string;
      properties: { reason: { type: string } };
    };
    expect(jsonSchema.type).toBe('OBJECT');
    expect(jsonSchema.properties.reason.type).toBe('STRING');
  });
});

describe('schema is JSON-serializable (no enum symbols leak)', () => {
  it('TodoWrite schema round-trips through JSON.stringify without data loss', () => {
    const tool = new TodoWrite(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const schema = tool.schema;
    const serialized = JSON.stringify(schema);
    const parsed = JSON.parse(serialized);
    expect(parsed.parametersJsonSchema.type).toBe('OBJECT');
    expect(parsed.parametersJsonSchema.properties.todos.type).toBe('ARRAY');
  });
});

describe('neutral GeminiFunctionDeclaration structural assignability', () => {
  it('accepts the shape produced by DeclarativeTool.schema', () => {
    const tool = new TodoRead(undefined);
    const schema = tool.schema;
    // If this compiles, the neutral type is structurally compatible.
    const _check: GeminiFunctionDeclaration = schema;
    expect(_check.name).toBe(TodoRead.Name);
  });
});

describe('neutral Part types are usable as ToolResult.llmContent', () => {
  it('a string is assignable to PartListUnion', () => {
    const content: PartListUnion = 'hello world';
    expect(content).toBe('hello world');
  });

  it('a GeminiPart is assignable to PartUnion', () => {
    const part: PartUnion = { text: 'hello' } satisfies GeminiPart;
    expect(part).toEqual({ text: 'hello' });
  });

  it('a FunctionCall shape is structurally compatible', () => {
    const call: GeminiFunctionCall = { name: 'test', args: { a: 1 } };
    expect(call.name).toBe('test');
  });
});
