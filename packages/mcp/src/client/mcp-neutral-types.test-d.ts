/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expectTypeOf } from 'vitest';
import type {
  CallableTool,
  ContentPart,
  ContentPartUnion,
  ContentPartListUnion,
  ToolCallRequest,
  FunctionDeclaration,
  ToolDeclarations,
} from '@vybestack/llxprt-code-tools';
import type { McpCallableTool } from './mcp-callable-tool.js';

// McpCallableTool must satisfy the neutral CallableTool interface.
expectTypeOf<McpCallableTool>().toMatchTypeOf<CallableTool>();

// ToolCallRequest.name must be required (string, not string | undefined).
expectTypeOf<ToolCallRequest['name']>().toEqualTypeOf<string>();

// ContentPart must allow text, functionResponse, and inlineData.
expectTypeOf<ContentPart>().toMatchTypeOf<{
  text?: string;
  functionResponse?: { name?: string; response?: Record<string, unknown> };
  inlineData?: { mimeType?: string; data?: string };
}>();

// A plain string must be assignable to ContentPartUnion.
expectTypeOf<string>().toMatchTypeOf<ContentPartUnion>();

// ContentPartListUnion accepts arrays, single parts, and strings.
expectTypeOf<ContentPart[]>().toMatchTypeOf<ContentPartListUnion>();
expectTypeOf<string>().toMatchTypeOf<ContentPartListUnion>();

// FunctionDeclaration must have parametersJsonSchema.
expectTypeOf<FunctionDeclaration>().toMatchTypeOf<{
  name?: string;
  parametersJsonSchema?: unknown;
}>();

// ToolDeclarations is the container for function declarations.
expectTypeOf<ToolDeclarations>().toMatchTypeOf<{
  functionDeclarations?: FunctionDeclaration[];
}>();
