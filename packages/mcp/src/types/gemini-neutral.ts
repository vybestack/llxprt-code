/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local neutral structural types for the Gemini-style tool/part wire format.
 *
 * The mcp package is a leaf package and cannot depend on core's
 * llm-types layer, so the minimal shapes needed by MCP tool adaptation
 * are replicated here. These are structurally compatible with (but do
 * not import) {@link @google/genai}.
 */

/**
 * Structural equivalent of {@link @google/genai} `FunctionCall`.
 */
export interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  partialArgs?: Array<Record<string, unknown>>;
  willContinue?: boolean;
  [key: string]: unknown;
}

/**
 * Structural equivalent of {@link @google/genai} `FunctionResponse`.
 */
export interface GeminiFunctionResponse {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
}

/**
 * Structural equivalent of {@link @google/genai} `Blob`.
 */
export interface GeminiInlineData {
  mimeType?: string;
  data?: string;
  displayName?: string;
}

/**
 * Structural equivalent of {@link @google/genai} `FunctionDeclaration`.
 */
export interface GeminiFunctionDeclaration {
  name?: string;
  description?: string;
  parametersJsonSchema?: unknown;
  parameters?: unknown;
  response?: unknown;
  responseJsonSchema?: unknown;
}

/**
 * Structural equivalent of {@link @google/genai} `Part`.
 */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
  inlineData?: GeminiInlineData;
  fileData?: Record<string, unknown>;
  executableCode?: Record<string, unknown>;
  codeExecutionResult?: Record<string, unknown>;
  mediaResolution?: unknown;
  videoMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Structural equivalent of {@link @google/genai} `Tool`.
 */
export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

/**
 * Structural equivalent of {@link @google/genai} `CallableTool`.
 *
 * Implemented by {@link McpCallableTool} to adapt MCP tools.
 */
export interface CallableTool {
  tool(): Promise<GeminiTool>;
  callTool(functionCalls: GeminiFunctionCall[]): Promise<GeminiPart[]>;
}
