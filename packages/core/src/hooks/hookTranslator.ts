/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260914-HOOKWIREV2 (issue #2624)
 *
 * v2 hook wire format: versioned, provider-neutral envelopes over IContent.
 * Field names match ModelGenerationRequest / ModelStreamChunk so no DTO
 * translation exists in either direction — the to-hook direction stamps the
 * envelope centrally (hookEventHandler) and the from-hook direction is a
 * shallow zod decode that preserves contents/content blocks verbatim.
 */

import { z } from 'zod';
import type { IContent, UsageStats } from '../services/history/IContent.js';
import type {
  ToolChoice,
  ToolDeclaration,
} from '../llm-types/toolDeclaration.js';
import type { ModelGenerationSettings } from '../llm-types/modelRequest.js';
import {
  CANONICAL_FINISH_REASONS,
  type CanonicalFinishReason,
} from '../llm-types/finishReasons.js';

/**
 * v2 request envelope (BeforeModel input, BeforeToolSelection input —
 * contents omitted/empty there, tools populated). Field names are identical
 * to ModelGenerationRequest so providers and hooks see one vocabulary.
 */
export interface HookLLMRequest {
  version: 2;
  model: string;
  contents: IContent[];
  tools?: ToolDeclaration[];
  settings?: ModelGenerationSettings;
}

/**
 * v2 response payload (AfterModel input `llm_response` and hook-returned
 * responses). finishReason is optional on the wire: AfterModel fires per
 * chunk and non-terminal chunks carry none.
 */
export interface HookLLMResponse {
  version: 2;
  content: IContent;
  finishReason?: CanonicalFinishReason;
  rawStopReason?: string;
  usage?: UsageStats;
}

/**
 * Optional boundary metadata that a BeforeModel hook may return alongside a
 * full-replacement llm_request. This lets compression recover the pending
 * region when differential analysis cannot (e.g. the hook rewrote the whole
 * conversation). The pending region MUST be a suffix of the modified contents
 * because recomposition appends pending after curated history. Indices are
 * interpreted over the v2 `contents` array.
 *
 * METADATA CONTRACT (issue #2306, intentional design): the boundary declares
 * a verbatim-preserved pending SUFFIX — everything from
 * pendingMessageStartIndex onward is sent to the provider unchanged through
 * compression. Everything BEFORE that index is declared history-semantics:
 * when compression runs, recomposition (buildProviderContent over
 * HistoryService.getCurated() [compressed] + pendingContents) REPLACES that
 * prefix with the compressed real history from HistoryService. This is an
 * explicit opt-in — hooks that rewrite/redact history-side content and then
 * supply boundary metadata accept that compression supersedes their prefix
 * with compressed real history. Hooks that need their history-side rewrites
 * to survive compression must NOT rely on metadata for that: they should
 * instead accept skip-compression (omit the metadata entirely), under which
 * their modifications always survive the non-compressed path (contents are
 * sent as-is under the limit; a clear error is thrown over the limit).
 */
export interface HookLLMRequestBoundary {
  version?: 2;
  pendingMessageStartIndex: number;
  pendingMessageCount?: number;
  onInvalidBoundary?: 'skip-compression' | 'throw';
}

// ---------------------------------------------------------------------------
// From-hook decode (v2)
//
// Hooks return arbitrary JSON, so every hook-supplied payload crosses a zod
// boundary here. Validation is deliberately SHALLOW on IContent blocks:
// contents/content pass through by reference so tool_call/tool_response/
// thinking blocks survive verbatim (no text-only rebuild). Hooks are a
// trusted extension seam; the envelope (version, model, array/object shapes)
// is what must not be trusted.
// ---------------------------------------------------------------------------

const hookLLMRequestSchema = z.object({
  version: z.literal(2).optional(),
  model: z.string(),
  contents: z.array(z.unknown()),
  tools: z.array(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

const hookLLMResponseSchema = z.object({
  version: z.literal(2).optional(),
  content: z.record(z.unknown()),
  finishReason: z.enum(CANONICAL_FINISH_REASONS).optional(),
  rawStopReason: z.string().optional(),
  usage: z.record(z.unknown()).optional(),
});

const hookToolChoiceSchema = z.object({
  mode: z.enum(['auto', 'required', 'none']),
  allowedToolNames: z.array(z.string()).optional(),
});

/**
 * Decode a hook-returned llm_request envelope. A missing `version` is
 * accepted as v2 (there is no v1 fallback decode); any other structurally
 * invalid shape is rejected with undefined so callers keep the original
 * request. Contents/tools/settings are returned as the hook supplied them
 * (zod validates, never rebuilds).
 */
export function decodeHookLLMRequest(raw: unknown): HookLLMRequest | undefined {
  const parsed = hookLLMRequestSchema.safeParse(raw);
  if (!parsed.success || !isNonNullObjectRecord(raw)) {
    return undefined;
  }
  return {
    version: 2,
    model: parsed.data.model,
    contents: raw['contents'] as IContent[],
    ...(raw['tools'] !== undefined
      ? { tools: raw['tools'] as ToolDeclaration[] }
      : {}),
    ...(raw['settings'] !== undefined
      ? { settings: raw['settings'] as ModelGenerationSettings }
      : {}),
  };
}

/**
 * Decode a hook-returned llm_response envelope (AfterModel modification or
 * BeforeModel synthetic response). Presence is keyed on `content` being a
 * non-null object; finishReason must be a canonical value when present.
 * Content/usage are returned as the hook supplied them.
 */
export function decodeHookLLMResponse(
  raw: unknown,
): HookLLMResponse | undefined {
  const parsed = hookLLMResponseSchema.safeParse(raw);
  if (!parsed.success || !isNonNullObjectRecord(raw)) {
    return undefined;
  }
  return {
    version: 2,
    content: raw['content'] as IContent,
    ...(parsed.data.finishReason !== undefined
      ? { finishReason: parsed.data.finishReason }
      : {}),
    ...(raw['rawStopReason'] !== undefined
      ? { rawStopReason: raw['rawStopReason'] as string }
      : {}),
    ...(raw['usage'] !== undefined
      ? { usage: raw['usage'] as UsageStats }
      : {}),
  };
}

/**
 * Decode a hook-returned toolChoice (BeforeToolSelection output). Rejects
 * unknown modes and non-string allowlists; undefined means the hook supplied
 * no (valid) tool choice and the caller keeps its target unchanged.
 */
export function decodeHookToolChoice(raw: unknown): ToolChoice | undefined {
  const parsed = hookToolChoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

/**
 * Merge a hook-supplied (partial, untyped) llm_request override onto a v2
 * target. Merge semantics: contents/tools REPLACE when provided as arrays;
 * model overrides when a string; settings shallow-merges when an object.
 * Field-provided-but-wrong-typed and absent fields leave the target value
 * untouched, so a config-only override cannot destroy tool calls or ids.
 */
export function mergeHookLLMRequest(
  target: HookLLMRequest,
  override: unknown,
): HookLLMRequest {
  if (typeof override !== 'object' || override === null) {
    return target;
  }
  const partial = override as Record<string, unknown>;
  const result: HookLLMRequest = {
    ...target,
    version: 2,
    ...(typeof partial['model'] === 'string'
      ? { model: partial['model'] }
      : {}),
    ...(Array.isArray(partial['contents'])
      ? { contents: partial['contents'] as IContent[] }
      : {}),
    ...(Array.isArray(partial['tools'])
      ? { tools: partial['tools'] as ToolDeclaration[] }
      : {}),
  };
  const settings = partial['settings'];
  if (typeof settings === 'object' && settings !== null) {
    result.settings = {
      ...(target.settings ?? {}),
      ...(settings as ModelGenerationSettings),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// llm_request_boundary (v2)
//
// Two validation layers (see R4/R6):
//  - STRUCTURAL (parse level, this schema): field types, enum values, version
//    literal. Failure here → discriminated result status 'malformed'.
//  - POSITIONAL (resolution level, streamRequestHelpers): the pending region
//    described by valid indices must be a suffix of the modified contents.
//    Failure there → invalid boundary honored per onInvalidBoundary.
// ---------------------------------------------------------------------------

const hookLLMRequestBoundarySchema = z.object({
  version: z.literal(2).optional(),
  pendingMessageStartIndex: z.number().int().nonnegative(),
  pendingMessageCount: z.number().int().nonnegative().optional(),
  onInvalidBoundary: z.enum(['skip-compression', 'throw']).optional(),
});

/**
 * Discriminated parse result distinguishing three outcomes so the resolution
 * layer can apply different policies (R4):
 *  - 'absent': no boundary metadata key — fall back to differential analysis.
 *  - 'valid': structurally well-formed boundary — proceed to positional checks.
 *  - 'malformed': key present but structurally invalid — treat as INVALID
 *    boundary (honor onInvalidBoundary); do NOT fall back to differential
 *    analysis, because the hook explicitly attempted to control the boundary.
 */
export type HookLLMRequestBoundaryParseResult =
  | { status: 'absent' }
  | { status: 'valid'; boundary: HookLLMRequestBoundary }
  | { status: 'malformed'; onInvalidBoundary: 'skip-compression' | 'throw' };

/**
 * Read the onInvalidBoundary policy from an untyped raw value. Returns
 * 'throw' only when the value is exactly the string 'throw'; otherwise
 * defaults to 'skip-compression'.
 */
function readOnInvalidBoundaryPolicy(
  raw: unknown,
): 'skip-compression' | 'throw' {
  return raw === 'throw' ? 'throw' : 'skip-compression';
}

/**
 * Parse and validate llm_request_boundary metadata from an untyped hook
 * payload. Returns undefined for absent or malformed values (fail-open).
 *
 * @deprecated This function conflates 'absent' and 'malformed' into a single
 * `undefined` return, so callers cannot honor `onInvalidBoundary` for
 * malformed metadata and would wrongly fall back to differential analysis.
 * Use {@link parseHookLLMRequestBoundaryResult} instead, which returns a
 * discriminated result distinguishing absent from malformed.
 *
 * Kept for backward compatibility. Callers with key context
 * (BeforeModelHookOutput.getLLMRequestBoundaryResult) perform the presence
 * check themselves via hasOwnProperty.
 */
export function parseHookLLMRequestBoundary(
  value: unknown,
): HookLLMRequestBoundary | undefined {
  if (value === undefined) return undefined;
  const parsed = hookLLMRequestBoundarySchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data;
}

/**
 * Parse llm_request_boundary metadata into a discriminated result that
 * distinguishes "absent" from "present-but-malformed" (R4). A hook that
 * ATTEMPTED to provide boundary metadata (key present but malformed)
 * explicitly signaled that it wants to control the boundary; the resolution
 * layer must NOT fall back to differential analysis in that case.
 *
 * G2: absence is decided by KEY PRESENCE, not truthiness. The caller
 * (BeforeModelHookOutput.getLLMRequestBoundaryResult, which has access to the
 * hookSpecificOutput object and can use hasOwnProperty) passes `present: true`
 * when the key exists in the output. A present-but-falsy value (null, false,
 * 0, '') is MALFORMED, not absent — the hook attempted to control the boundary.
 *
 * `present` defaults to checking `value !== undefined` for backward
 * compatibility with direct callers that do not have key context: a present
 * value of `undefined` signals "not provided" in JS conventions and is
 * indistinguishable from absent after JSON parsing.
 */
export function parseHookLLMRequestBoundaryResult(
  value: unknown,
  // Default: `value !== undefined`. After a JSON round-trip, `undefined` is
  // indistinguishable from an absent key (JSON cannot encode undefined), so
  // it defaults to absent. All other values (including null, false, 0, '')
  // are treated as present — the hook attempted to control the boundary.
  // Callers with key context (hasOwnProperty) pass `present` explicitly.
  present: boolean = value !== undefined,
): HookLLMRequestBoundaryParseResult {
  if (!present) return { status: 'absent' };
  const parsed = hookLLMRequestBoundarySchema.safeParse(value);
  if (!parsed.success) {
    return {
      status: 'malformed',
      onInvalidBoundary: readOnInvalidBoundaryPolicy(
        isNonNullObjectRecord(value) ? value['onInvalidBoundary'] : undefined,
      ),
    };
  }
  return { status: 'valid', boundary: parsed.data };
}

/** True when `value` is a non-null object record (local helper to avoid import cycles). */
function isNonNullObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
