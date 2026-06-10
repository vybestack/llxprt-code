/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local tool formatter interface.
 *
 * Defines the contract for converting tools between provider formats.
 * This interface is self-contained with zero core dependencies.
 *
 * The types used here are simplified from core to avoid importing
 * core-specific types. Implementations will bridge to core types
 * via adapters.
 */

/** Supported tool serialization formats. */
export type ToolFormat =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'mistral'
  | 'hermes'
  | 'xml'
  | 'llama'
  | 'gemma';

/** An OpenAI-format function declaration. */
export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: object;
}

/** An OpenAI-format tool wrapper. */
export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

/** An OpenAI Responses API tool representation. */
export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string | null;
  parameters: Record<string, unknown> | null;
  strict: boolean | null;
}

/** A generic tool representation for formatter input. */
export interface FormatterTool {
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call block produced by format parsing. */
export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  name: string;
  description?: string;
  parameters: unknown;
}

/**
 * Interface for converting tools between provider formats.
 *
 * Implementations handle format-specific serialization while
 * consuming the generic FormatterTool shape.
 */
export interface IToolFormatter {
  /**
   * Convert tools to the specified provider format.
   * @param tools - Tools in generic format.
   * @param format - Target provider format.
   * @returns Tools in provider-specific format.
   */
  toProviderFormat(tools: FormatterTool[], format: ToolFormat): unknown;

  /**
   * Parse a raw provider tool call into tool call blocks.
   * @param rawToolCall - Raw tool call from provider.
   * @param format - Provider format of the raw call.
   * @returns Parsed tool call blocks.
   */
  fromProviderFormat(rawToolCall: unknown, format: ToolFormat): ToolCallBlock[];

  /**
   * Convert tools to OpenAI Responses API format.
   * @param tools - Tools in generic format.
   * @returns Tools in Responses API format.
   */
  toResponsesTool(tools: FormatterTool[]): ResponsesTool[];
}
