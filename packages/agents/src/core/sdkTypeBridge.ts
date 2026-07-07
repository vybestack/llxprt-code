/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Transitional re-export shim that aliases the historical Google-shaped
 * wire-format names used across the agents package to the core-owned
 * structural contract types in clientContract.ts.
 *
 * This module exists ONLY to minimize churn at the ~100 legacy import sites
 * while the runtime pipeline migrates to llxprt-owned IContent/ModelStreamChunk.
 * It defines NO runtime classes and NO fake provider SDK. All type aliases are
 * re-exports or structural aliases of core-owned definitions; the only runtime
 * values are the legacy Type and FinishReason string-literal namespaces, kept
 * locally until core-owned enums are available.
 *
 * Call sites that still need the provider-API-error check use
 * {@link isProviderApiError} from core llm-types instead of a class
 * instanceof test.
 */

export type {
  ContractPart as Part,
  ContractContent as Content,
  ContractContentUnion as ContentUnion,
  ContractPartListUnion as PartListUnion,
  ContractPartUnion as PartUnion,
  ContractGenerateContentConfig as GenerateContentConfig,
  ContractGenerateContentResponse as GenerateContentResponse,
  ContractSendMessageParameters as SendMessageParameters,
  ContractUsageMetadata as GenerateContentResponseUsageMetadata,
} from '@vybestack/llxprt-code-core/core/clientContract.js';

export {
  isProviderApiError,
  type ProviderApiError,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Structural alias for the legacy FunctionCall wire shape, anchored on the
 * ContractPart's functionCall field. Kept inline pending a core-owned
 * dedicated legacy-function-call type.
 */
import type {
  ContractContent,
  ContractGenerateContentResponse,
  ContractPart,
  ContractPartListUnion,
} from '@vybestack/llxprt-code-core/core/clientContract.js';

export type FunctionCall = NonNullable<ContractPart['functionCall']>;
export type FunctionResponse = NonNullable<ContractPart['functionResponse']>;
export type InlineData = NonNullable<ContractPart['inlineData']>;
export type FileData = NonNullable<ContractPart['fileData']>;

/**
 * Structural alias for a single candidate entry on a generate-content
 * response. Anchored on ContractGenerateContentResponse['candidates'].
 */
export type Candidate = NonNullable<
  NonNullable<ContractGenerateContentResponse['candidates']>[number]
>;

/**
 * Provider-neutral schema type. Kept as an open structural record so it is
 * assignment-compatible with both legacy Google Schema objects and neutral
 * JsonSchemaObject values. The legacy `Type` enum (below) supplies the
 * well-known string values for `type` fields.
 */
export interface Schema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: unknown[];
  description?: string;
  nullable?: boolean;
  [key: string]: unknown;
}

export interface FunctionDeclaration {
  name?: string;
  description?: string;
  parameters?: Schema;
  parametersJsonSchema?: unknown;
}

export interface Tool {
  functionDeclarations?: FunctionDeclaration[];
}

export interface EmbedContentResponse {
  embeddings?: Array<{ values?: number[] }>;
}

/**
 * Legacy schema "type" string-literal namespace. These uppercase values match
 * the historical SDK shape. Provider-boundary serializers are responsible for
 * mapping them when a provider expects lowercase JSON-Schema type strings.
 */
export const Type = {
  TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
  NULL: 'NULL',
} as const;

export type Type = (typeof Type)[keyof typeof Type];

/**
 * Legacy Gemini finish-reason string-literal namespace. Call sites comparing
 * against raw provider stop strings use these constants. The neutral
 * canonical mapping lives in core llm-types/finishReasons.ts (GEMINI_FINISH_MAP).
 */
export const FinishReason = {
  FINISH_REASON_UNSPECIFIED: 'FINISH_REASON_UNSPECIFIED',
  STOP: 'STOP',
  MAX_TOKENS: 'MAX_TOKENS',
  SAFETY: 'SAFETY',
  RECITATION: 'RECITATION',
  LANGUAGE: 'LANGUAGE',
  BLOCKLIST: 'BLOCKLIST',
  PROHIBITED_CONTENT: 'PROHIBITED_CONTENT',
  SPII: 'SPII',
  MALFORMED_FUNCTION_CALL: 'MALFORMED_FUNCTION_CALL',
  OTHER: 'OTHER',
  IMAGE_SAFETY: 'IMAGE_SAFETY',
  IMAGE_PROHIBITED_CONTENT: 'IMAGE_PROHIBITED_CONTENT',
  NO_IMAGE: 'NO_IMAGE',
  UNEXPECTED_TOOL_CALL: 'UNEXPECTED_TOOL_CALL',
} as const;

export type FinishReason = (typeof FinishReason)[keyof typeof FinishReason];

/**
 * Build a user-role Content from a part-list union. Provider-neutral.
 */
export function createUserContent(
  message: ContractPartListUnion,
): ContractContent {
  const parts: unknown[] = Array.isArray(message) ? message : [message];
  return {
    role: 'user',
    parts: parts.map((part) => {
      if (typeof part === 'string') {
        return { text: part };
      }
      if (part === null || part === undefined) {
        throw new TypeError('Expected a non-null part in createUserContent.');
      }
      assertBridgePart(part);
      // Clone the top level and mutable nested call/response objects while
      // avoiding copies of large inlineData/fileData payloads.
      const clonedPart: ContractPart = { ...part };
      if (clonedPart.functionCall !== undefined) {
        clonedPart.functionCall = {
          ...clonedPart.functionCall,
          args:
            clonedPart.functionCall.args !== undefined
              ? { ...clonedPart.functionCall.args }
              : clonedPart.functionCall.args,
        };
      }
      if (clonedPart.functionResponse !== undefined) {
        clonedPart.functionResponse = {
          ...clonedPart.functionResponse,
          response:
            clonedPart.functionResponse.response !== undefined
              ? { ...clonedPart.functionResponse.response }
              : clonedPart.functionResponse.response,
        };
      }
      return clonedPart;
    }),
  };
}

/**
 * Cast helpers for the transitional boundary where core converters return
 * `unknown` and the legacy pipeline still expects the Contract Content shape.
 * These are pure structural passes (no runtime transformation).
 */
export function toBridgeContentArray(contents: unknown): ContractContent[] {
  if (!Array.isArray(contents)) {
    throw new TypeError('Expected an array of contract content entries.');
  }
  for (const content of contents) {
    assertBridgeContent(content);
  }
  return contents as ContractContent[];
}

export function toBridgeFunctionDeclaration(
  declaration: FunctionDeclaration | Record<string, unknown>,
): FunctionDeclaration {
  if (
    'name' in declaration &&
    declaration.name !== undefined &&
    typeof declaration.name !== 'string'
  ) {
    throw new TypeError('Expected function declaration name to be a string.');
  }
  if (
    'description' in declaration &&
    declaration.description !== undefined &&
    typeof declaration.description !== 'string'
  ) {
    throw new TypeError(
      'Expected function declaration description to be a string.',
    );
  }
  if (
    'parameters' in declaration &&
    declaration.parameters !== undefined &&
    (typeof declaration.parameters !== 'object' ||
      declaration.parameters === null)
  ) {
    throw new TypeError(
      'Expected function declaration parameters to be an object.',
    );
  }
  return declaration as FunctionDeclaration;
}

export function toBridgeFunctionDeclarations(
  declarations: unknown,
): FunctionDeclaration[] {
  if (!Array.isArray(declarations)) {
    throw new TypeError('Expected an array of function declarations.');
  }
  return declarations.map((declaration) => {
    assertRecord(declaration, 'Expected a function declaration object.');
    return toBridgeFunctionDeclaration(declaration);
  });
}

function assertBridgeContent(
  content: unknown,
): asserts content is ContractContent {
  assertRecord(content, 'Expected a contract content object.');
  if ('role' in content && typeof content.role !== 'string') {
    throw new TypeError('Expected contract content role to be a string.');
  }
  if (!('parts' in content)) {
    // ContractContent keeps parts optional for provider responses that carry
    // metadata-only candidates; downstream code already treats missing parts as
    // an empty part list.
    return;
  }
  if (!Array.isArray(content.parts)) {
    throw new TypeError('Expected contract content parts to be an array.');
  }
  for (const part of content.parts) {
    assertBridgePart(part);
  }
}

function assertBridgePart(part: unknown): asserts part is ContractPart {
  assertRecord(part, 'Expected a contract part object.');
  if (!BRIDGE_PART_KEYS.some((key) => key in part)) {
    throw new TypeError(
      'Expected contract part to contain at least one known part property.',
    );
  }
  validateBridgePartVariants(part);
}

function validateBridgePartVariants(part: Record<string, unknown>): void {
  if ('functionCall' in part && part.functionCall !== undefined) {
    assertRecord(part.functionCall, 'Expected functionCall to be an object.');
  }
  if ('functionResponse' in part && part.functionResponse !== undefined) {
    assertRecord(
      part.functionResponse,
      'Expected functionResponse to be an object.',
    );
  }
  if ('inlineData' in part && part.inlineData !== undefined) {
    assertRecord(part.inlineData, 'Expected inlineData to be an object.');
  }
  if ('fileData' in part && part.fileData !== undefined) {
    assertRecord(part.fileData, 'Expected fileData to be an object.');
  }
  if (
    'text' in part &&
    part.text !== undefined &&
    typeof part.text !== 'string'
  ) {
    throw new TypeError('Expected part text to be a string.');
  }
  if (
    'thought' in part &&
    part.thought !== undefined &&
    typeof part.thought !== 'boolean'
  ) {
    throw new TypeError('Expected part thought to be a boolean.');
  }
  if (
    'thoughtSignature' in part &&
    part.thoughtSignature !== undefined &&
    typeof part.thoughtSignature !== 'string'
  ) {
    throw new TypeError('Expected part thoughtSignature to be a string.');
  }
}

const BRIDGE_PART_KEYS = [
  'text',
  'inlineData',
  'functionCall',
  'functionResponse',
  'fileData',
  'thought',
  'thoughtSignature',
] as const satisfies ReadonlyArray<keyof ContractPart>;

function assertRecord(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(message);
  }
}
