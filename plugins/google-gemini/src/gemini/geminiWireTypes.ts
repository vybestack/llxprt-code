/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural types for the Gemini generateContent wire format.
 *
 * These describe the JSON the Gemini REST API accepts and returns. They were
 * previously imported from `@google/genai`, which meant a 26-package
 * dependency existed largely to supply type declarations: only a single
 * runtime value, `Type.OBJECT`, was ever read from it inside this provider.
 *
 * Declaring the shapes here removes that coupling. They are deliberately
 * permissive where the API is permissive, and index signatures are used where
 * the provider preserves fields it does not itself interpret.
 */

/** Schema type discriminants, mirroring the API's `Type` enum values. */
export const SchemaType = {
  TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
  NULL: 'NULL',
} as const;

export type SchemaTypeValue = (typeof SchemaType)[keyof typeof SchemaType];

/** Result status of a code-execution part. */
export const Outcome = {
  OUTCOME_UNSPECIFIED: 'OUTCOME_UNSPECIFIED',
  OUTCOME_OK: 'OUTCOME_OK',
  OUTCOME_FAILED: 'OUTCOME_FAILED',
  OUTCOME_DEADLINE_EXCEEDED: 'OUTCOME_DEADLINE_EXCEEDED',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

/** Language of an executable-code part. */
export const Language = {
  LANGUAGE_UNSPECIFIED: 'LANGUAGE_UNSPECIFIED',
  PYTHON: 'PYTHON',
} as const;
export type Language = (typeof Language)[keyof typeof Language];

/**
 * A JSON-Schema-like tool parameter schema.
 *
 * The API accepts a subset of JSON Schema, and llxprt deliberately preserves
 * `format`, `title`, `anyOf` and `default` rather than stripping them.
 */
export interface Schema {
  type?: SchemaTypeValue | string;
  format?: string;
  title?: string;
  description?: string;
  nullable?: boolean;
  enum?: string[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: string | number;
  maxItems?: string | number;
  [key: string]: unknown;
}

export interface FunctionDeclaration {
  name?: string;
  description?: string;
  parameters?: Schema;
  parametersJsonSchema?: unknown;
  response?: Schema;
  [key: string]: unknown;
}

export interface FunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface FunctionResponse {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
  parts?: Part[];
}

export interface Blob {
  mimeType?: string;
  data?: string;
  displayName?: string;
}

export interface FileData {
  mimeType?: string;
  fileUri?: string;
  displayName?: string;
}

export interface ExecutableCode {
  code?: string;
  language?: Language;
}

export interface CodeExecutionResult {
  outcome?: Outcome;
  output?: string;
}

/**
 * One piece of message content.
 *
 * `thought` and `thoughtSignature` carry Gemini 3 reasoning data; the
 * signature must be echoed back on replay or the API rejects the turn.
 */
export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: Blob;
  fileData?: FileData;
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
  executableCode?: ExecutableCode;
  codeExecutionResult?: CodeExecutionResult;
  [key: string]: unknown;
}

export interface Content {
  role?: string;
  parts?: Part[];
}

export interface UrlMetadata {
  retrievedUrl?: string;
  urlRetrievalStatus?: string;
}

export interface GroundingChunkWeb {
  uri?: string;
  title?: string;
  domain?: string;
}

export interface GroundingChunk {
  web?: GroundingChunkWeb;
  retrievedContext?: { uri?: string; title?: string };
}

export interface GroundingSupportSegment {
  startIndex?: number;
  endIndex?: number;
  text?: string;
  partIndex?: number;
}

export interface GroundingSupport {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
  webSearchQueries?: string[];
  searchEntryPoint?: unknown;
  retrievalMetadata?: unknown;
}

export interface Candidate {
  content?: Content;
  finishReason?: string;
  index?: number;
  safetyRatings?: unknown[];
  groundingMetadata?: GroundingMetadata;
  urlContextMetadata?: { urlMetadata?: UrlMetadata[] };
  [key: string]: unknown;
}

export interface GenerateContentResponseUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  [key: string]: unknown;
}

export interface GenerateContentResponse {
  candidates?: Candidate[];
  automaticFunctionCallingHistory?: Content[];
  usageMetadata?: GenerateContentResponseUsageMetadata;
  promptFeedback?: unknown;
  responseId?: string;
  modelVersion?: string;
  text?: string;
  [key: string]: unknown;
}

export interface GenerateContentParameters {
  model: string;
  contents: Content[] | Content | string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Error thrown for a non-2xx Gemini response.
 *
 * This is a class rather than a plain interface because callers construct and
 * `instanceof`-check it, and because `status` is genuinely polymorphic: the
 * REST API returns an HTTP number while gRPC-shaped payloads return a string
 * such as `RESOURCE_EXHAUSTED`. Both are classified downstream.
 */
export class ApiError extends Error {
  readonly status?: number | string;
  readonly code?: number;
  readonly details?: unknown[];

  constructor(info: {
    message: string;
    status?: number | string;
    code?: number;
    details?: unknown[];
  }) {
    super(info.message);
    this.name = 'ApiError';
    this.status = info.status;
    this.code = info.code;
    this.details = info.details;
  }
}

/** Per-request HTTP options accepted by the generate seam. */
export interface HttpOptions {
  baseUrl?: string;
  apiVersion?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * The narrow surface this provider actually consumes.
 *
 * Both call sites already depended on exactly these two methods rather than on
 * a concrete client class, so this is the seam an adapter implements.
 */
export interface GeminiModelsSeam {
  generateContent: (
    params: GenerateContentParameters,
  ) => Promise<GenerateContentResponse>;
  generateContentStream: (
    params: GenerateContentParameters,
  ) => Promise<AsyncIterable<GenerateContentResponse>>;
}

/**
 * Options accepted when constructing a Gemini client.
 *
 * `vertexai` plus `project`/`location` select the Vertex endpoint; `apiKey`
 * with `httpOptions.baseUrl` selects the Generative Language endpoint.
 */
export interface GeminiApiClientOptions {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  httpOptions?: HttpOptions;
}

/**
 * A constructed Gemini client.
 *
 * Server-tool callers reach through `.models`, so the client is modelled as a
 * holder of the generate seam rather than as the seam itself.
 */
export interface GeminiApiClient {
  models: GeminiModelsSeam;
}
