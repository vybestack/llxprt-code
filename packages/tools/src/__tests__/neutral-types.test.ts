/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Type } from '../types/schema-type.js';
import {
  type FunctionDeclaration,
  type ContentPartUnion,
  type ContentPartListUnion,
  type ToolCallRequest,
  type ContentPart,
} from '../types/wire-types.js';
import { TodoWrite } from '../tools/todo-write.js';
import { TodoRead } from '../tools/todo-read.js';
import { TodoPause } from '../tools/todo-pause.js';
import type { ITodoService } from '../interfaces/ITodoService.js';

// Minimal neutral ITodoService fixture. The todo tools now require this
// dependency at the type boundary; the schema/type tests below never invoke
// execute(), so no real storage is needed. This fixture exists only to satisfy
// the mandatory constructor contract — it is a real object, not a mock of the
// tool under test.
const neutralTodoService: ITodoService = {
  getTodoStore: () => ({}),
  getReminderService: () => ({}),
  getContextTracker: () => ({}),
  getDefaultAgentId: () => 'neutral',
};

describe('Type enum runtime values', () => {
  it.each([
    ['STRING', Type.STRING, 'STRING'],
    ['NUMBER', Type.NUMBER, 'NUMBER'],
    ['INTEGER', Type.INTEGER, 'INTEGER'],
    ['BOOLEAN', Type.BOOLEAN, 'BOOLEAN'],
    ['ARRAY', Type.ARRAY, 'ARRAY'],
    ['OBJECT', Type.OBJECT, 'OBJECT'],
  ])('Type.%s serializes to the expected wire value', (_name, value, wire) => {
    expect(value).toBe(wire);
  });
});

describe('todo tools schema preserves exact runtime values', () => {
  it('TodoWrite schema has type: "OBJECT" at root (not a symbol or enum object)', () => {
    const tool = new TodoWrite(neutralTodoService);
    const schema = tool.schema;
    const jsonSchema = schema.parametersJsonSchema as Record<string, unknown>;
    expect(jsonSchema['type']).toBe('OBJECT');
  });

  it('TodoRead schema has type: "OBJECT"', () => {
    const tool = new TodoRead(neutralTodoService);
    const schema = tool.schema;
    const jsonSchema = schema.parametersJsonSchema as Record<string, unknown>;
    expect(jsonSchema['type']).toBe('OBJECT');
  });

  it('TodoPause schema has type: "OBJECT" and reason.type: "STRING"', () => {
    const tool = new TodoPause(neutralTodoService);
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
    const tool = new TodoWrite(neutralTodoService);
    const schema = tool.schema;
    const serialized = JSON.stringify(schema);
    const parsed = JSON.parse(serialized);
    expect(parsed.parametersJsonSchema.type).toBe('OBJECT');
    expect(parsed.parametersJsonSchema.properties.todos.type).toBe('ARRAY');
  });
});

describe('FunctionDeclaration structural assignability', () => {
  it('accepts the shape produced by DeclarativeTool.schema', () => {
    const tool = new TodoRead(neutralTodoService);
    const schema = tool.schema;
    const _check: FunctionDeclaration = schema;
    expect(_check.name).toBe(TodoRead.Name);
  });
});

describe('wire types are usable as ToolResult.llmContent', () => {
  it('a string is assignable to ContentPartListUnion', () => {
    const content: ContentPartListUnion = 'hello world';
    expect(content).toBe('hello world');
  });

  it('a ContentPart is assignable to ContentPartUnion', () => {
    const part: ContentPartUnion = { text: 'hello' } satisfies ContentPart;
    expect(part).toEqual({ text: 'hello' });
  });

  it('a ToolCallRequest shape is structurally compatible', () => {
    const call: ToolCallRequest = { name: 'test', args: { a: 1 } };
    expect(call.name).toBe('test');
  });
});
