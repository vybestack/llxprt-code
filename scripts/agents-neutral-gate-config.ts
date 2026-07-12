/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared configuration constants and types for the agents-neutral-gate
 * (PLAN-20260707-AGENTNEUTRAL.P31).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type CheckSubkind =
  | 'A-raw-genai-import'
  | 'B-banned-symbol'
  | 'B2-banned-alias-target'
  | 'B3-banned-local-decl'
  | 'C-contract-alias'
  | 'D-roundtrip-symbol'
  | 'E-enum-redeclaration'
  | 'F1-candidates-content'
  | 'F3-role-parts'
  | 'F5-parts-access'
  | 'F6-parts-destructure'
  | 'F7-candidates-typed-envelope'
  | 'G-call-toGeminiContent'
  | 'G-barrel-GeminiContent'
  | 'H-usage-key';

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly subkind: CheckSubkind;
  readonly contextSnippet: string;
  readonly reason: string;
  /** Enclosing named function (for checkH AST-context allow-listing). */
  readonly enclosingFn?: string | null;
  /** Whether the hit is inside a type declaration (checkH context). */
  readonly inTypeDecl?: boolean;
}

export interface AllowlistEntry {
  readonly file: string;
  readonly subkind: string;
  readonly contextPattern: string;
  readonly justification: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Substrings identifying a BANNED module (banned-symbol provenance). */
export const BANNED_MODULE_PATTERNS: readonly string[] = [
  '@google/genai',
  'clientContract',
  'geminiContent',
];

/** §1.3 banned Google symbols — flagged ONLY when from a banned module. */
export const BANNED_SYMBOLS: ReadonlySet<string> = new Set([
  'GenerateContentResponse',
  'Candidate',
  'Part',
  'PartListUnion',
  'PartUnion',
  'FunctionCall',
  'Content',
  'SendMessageParameters',
  'GenerateContentConfig',
  'FinishReason',
  'Type',
  'Schema',
  'Tool',
  'FunctionDeclaration',
  'ApiError',
  'GoogleGenAI',
  'GenerateContentResponseUsageMetadata',
  'createUserContent',
]);

/** Contract* payload aliases (the #2424 aliasing bypass). */
export const CONTRACT_PREFIX_TYPES: readonly string[] = [
  'ContractPart',
  'ContractContent',
  'ContractContentUnion',
  'ContractPartListUnion',
  'ContractPartUnion',
  'ContractGenerateContentResponse',
  'ContractSendMessageParameters',
  'ContractGenerateContentConfig',
  'ContractUsageMetadata',
];

/** Google enum names whose local re-declaration is flagged. */
export const GOOGLE_ENUM_NAMES: ReadonlySet<string> = new Set([
  'FinishReason',
  'Type',
]);

/**
 * Google Type enum uppercase string values. A local `Type` const/enum is
 * flagged ONLY when it carries at least one of these values (value-aware
 * detection — avoids false positives on neutral lowercase Type aliases).
 */
export const GOOGLE_TYPE_VALUES: ReadonlySet<string> = new Set([
  'STRING',
  'OBJECT',
  'ARRAY',
  'NUMBER',
  'BOOLEAN',
  'INTEGER',
]);

/**
 * Round-trip conversion symbols — deleted-helper/bridge names whose
 * re-introduction signals a Google↔neutral round-trip path (checkD).
 * Flagged as identifiers in import specifiers, type references, or
 * call/new expressions. @pseudocode line 18.
 */
export const ROUNDTRIP_SYMBOLS: ReadonlySet<string> = new Set([
  'sdkTypeBridge',
  'convertIContentToResponse',
  'streamChunkWrapper',
  'responseToModelStreamChunk',
  'chunkToParts',
  'providerStopReason',
  'setProviderStopReason',
  'getProviderStopReason',
]);

/**
 * GeminiContent* barrel type names — flagged when imported from ANY module
 * (checkG-barrel). These are the barrel re-export names for the Google
 * payload shape. @pseudocode line 21.
 */
export const GEMINI_CONTENT_BARREL_TYPES: ReadonlySet<string> = new Set([
  'GeminiContent',
  'GeminiContentPart',
  'GeminiFunctionCall',
]);

/**
 * Gemini usage-metadata key names — flagged as property/identifier usage
 * outside boundary modules (checkH). @pseudocode lines 36-39.
 */
export const GEMINI_USAGE_KEYS: ReadonlySet<string> = new Set([
  'promptTokenCount',
  'candidatesTokenCount',
  'cachedContentTokenCount',
  'totalTokenCount',
  'thoughtsTokenCount',
]);

/** Domain *Candidate[] suffixes EXCLUDED from checkF (false-positive guard). */
export const DOMAIN_CANDIDATE_SUFFIXES: readonly string[] = [
  'Candidate[]',
  'PublicProfileCandidate[]',
  'CompressionLoadBalancerCandidate[]',
];

/** Patterns requiring enclosing-function/schema-name match. */
export const H_FUNCTION_BODY_PATTERNS: ReadonlySet<string> = new Set([
  'usageStatsToPublicUsageMetadata',
  'usageFromHookResponse',
  'UsageMetadataValueSchema',
]);
