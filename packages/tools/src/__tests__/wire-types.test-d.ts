/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expectTypeOf } from 'vitest';
import type {
  ContentPart,
  ContentPartUnion,
  ContentPartListUnion,
  ToolCallRequest,
  ToolCallResponse,
  FunctionDeclaration,
  ToolDeclarations,
  CallableTool,
  InlineData,
} from '../types/wire-types.js';
import type { TodoRead } from '../tools/todo-read.js';
import type { ToolResult } from '../tools/tools.js';

// ToolCallRequest.name is required (not optional).
expectTypeOf<ToolCallRequest['name']>().toEqualTypeOf<string>();

// ContentPartUnion accepts both ContentPart and string.
expectTypeOf<string>().toMatchTypeOf<ContentPartUnion>();
expectTypeOf<ContentPart>().toMatchTypeOf<ContentPartUnion>();

// ContentPartListUnion accepts arrays, single parts, and strings.
expectTypeOf<ContentPart[]>().toMatchTypeOf<ContentPartListUnion>();
expectTypeOf<string>().toMatchTypeOf<ContentPartListUnion>();

// ToolResult.llmContent is ContentPartListUnion.
expectTypeOf<ToolResult['llmContent']>().toEqualTypeOf<ContentPartListUnion>();

// FunctionDeclaration has the fields tools package uses.
expectTypeOf<FunctionDeclaration>().toMatchTypeOf<{
  name?: string;
  description?: string;
  parametersJsonSchema?: unknown;
}>();

// ToolDeclarations wraps function declarations.
expectTypeOf<ToolDeclarations>().toMatchTypeOf<{
  functionDeclarations?: FunctionDeclaration[];
}>();

// TodoRead.schema is assignable to FunctionDeclaration.
expectTypeOf<
  InstanceType<typeof TodoRead>['schema']
>().toMatchTypeOf<FunctionDeclaration>();

// CallableTool interface shape.
expectTypeOf<CallableTool>().toMatchTypeOf<{
  tool(): Promise<ToolDeclarations>;
  callTool(calls: ToolCallRequest[]): Promise<ContentPart[]>;
}>();

// ToolCallResponse shape.
expectTypeOf<ToolCallResponse>().toMatchTypeOf<{
  name?: string;
  response?: Record<string, unknown>;
}>();

// InlineData shape.
expectTypeOf<InlineData>().toMatchTypeOf<{
  mimeType?: string;
  data?: string;
}>();
