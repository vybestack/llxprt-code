/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-neutral wire-format structural types for the tool/part contract.
 *
 * These are minimal structural shapes for content parts, function calls,
 * and function declarations that flow between the model layer and the tool
 * layer. They are intentionally provider-agnostic — concrete SDK objects
 * from any provider are structurally assignable to these types via
 * TypeScript's structural typing, with no runtime dependency on any
 * specific provider SDK.
 *
 * The tools package is a leaf workspace package (zero workspace deps),
 * so these canonical types live here and are re-exported for downstream
 * packages (e.g. mcp) that need the same contract.
 */

/**
 * A request from the model to invoke a tool.
 *
 * `name` is required — every tool invocation must name the target tool.
 * This eliminates the need for non-null assertions at call sites.
 */
export interface ToolCallRequest {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
  partialArgs?: Array<Record<string, unknown>>;
  willContinue?: boolean;
}

/**
 * A response from a tool invocation, delivered back to the model.
 */
export interface ToolCallResponse {
  name?: string;
  response?: Record<string, unknown>;
  id?: string;
}

/**
 * Inline binary data embedded in a content part.
 */
export interface InlineData {
  mimeType?: string;
  data?: string;
  displayName?: string;
}

/**
 * A single content part in a multi-modal message exchange.
 *
 * Only the fields consumed by the tools layer are modeled.
 * Concrete SDK part objects are structurally assignable to this type.
 */
export interface ContentPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: ToolCallRequest;
  functionResponse?: ToolCallResponse;
  inlineData?: InlineData;
  fileData?: Record<string, unknown>;
  executableCode?: Record<string, unknown>;
  codeExecutionResult?: Record<string, unknown>;
  mediaResolution?: unknown;
  videoMetadata?: Record<string, unknown>;
}

/**
 * A content part or a plain string (the common "just text" case).
 */
export type ContentPartUnion = ContentPart | string;

/**
 * A list of content parts, a single part, or a plain string.
 */
export type ContentPartListUnion = ContentPartUnion[] | ContentPartUnion;

/**
 * A declaration of a tool's schema, consumed by the model layer to
 * understand available tools.
 *
 * Only the fields consumed by the tools layer are modeled.
 */
export interface FunctionDeclaration {
  name?: string;
  description?: string;
  parametersJsonSchema?: unknown;
  parameters?: unknown;
  response?: unknown;
  responseJsonSchema?: unknown;
}

/**
 * A collection of function declarations, forming the complete tool set
 * offered to the model.
 */
export interface ToolDeclarations {
  functionDeclarations?: FunctionDeclaration[];
}

/**
 * Interface for an object that can be called as a tool by the model layer.
 *
 * Implemented by adapters (e.g. MCP tool adapter) to bridge external
 * tool protocols to the neutral wire contract.
 */
export interface CallableTool {
  tool(): Promise<ToolDeclarations>;
  callTool(functionCalls: ToolCallRequest[]): Promise<ContentPart[]>;
}
