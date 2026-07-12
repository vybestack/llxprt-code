/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local neutral structural types for the Gemini-style tool/part wire format.
 *
 * These mirror only the fields that the tools package references at
 * compile time. They are structurally compatible with (but do not import)
 * {@link @google/genai} so that concrete SDK objects continue to work via
 * TypeScript structural assignability without a runtime dependency.
 *
 * The tools package is a leaf package and cannot depend on core's
 * llm-types layer, so the minimal shapes are replicated here.
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
 *
 * Only the fields consumed by the tools package are modeled.
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
 * Neutral structural shape of a single Gemini content part.
 *
 * Only the fields consumed by the tools package are modeled.
 * Concrete SDK `Part` objects are structurally assignable to this type.
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
 * Union equivalent of {@link @google/genai} `PartUnion`.
 */
export type PartUnion = GeminiPart | string;

/**
 * Union equivalent of {@link @google/genai} `PartListUnion`.
 */
export type PartListUnion = PartUnion[] | PartUnion;
