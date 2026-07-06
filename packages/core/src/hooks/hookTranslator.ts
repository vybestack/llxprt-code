/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { getResponseText } from '../utils/partUtils.js';

/**
 * Structural shapes matching the portions of the @google/genai SDK types used
 * by the hook translator's internal plumbing. Defined locally so core does
 * not import @google/genai. The external LLMRequest/LLMResponse wire format
 * (the stable user-facing hook JSON contract) is unchanged.
 *
 * The agents layer (#2349) passes objects that are structurally compatible
 * with these shapes.
 */
export interface HookPart {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: {
    id?: string;
    name?: string;
    response?: Record<string, unknown>;
  };
  inlineData?: { mimeType?: string; data?: string };
}

export interface HookContent {
  role?: string;
  parts?: HookPart[];
}

export interface HookGenerateContentConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  systemInstruction?: unknown;
  [key: string]: unknown;
}

type HookFinishReason =
  | 'FINISH_REASON_UNSPECIFIED'
  | 'STOP'
  | 'MAX_TOKENS'
  | 'SAFETY'
  | 'RECITATION'
  | 'LANGUAGE'
  | 'OTHER'
  | 'BLOCKLIST'
  | 'PROHIBITED_CONTENT'
  | 'SPII'
  | 'MALFORMED_FUNCTION_CALL'
  | 'IMAGE_SAFETY'
  | 'UNEXPECTED_TOOL_CALL'
  | 'IMAGE_PROHIBITED_CONTENT'
  | 'NO_IMAGE';

export interface HookGenerateContentParameters {
  model?: string;
  contents: HookContent[] | HookContent | string;
  config?: HookGenerateContentConfig;
  [key: string]: unknown;
}

export interface HookCandidate {
  content?: { role?: string; parts?: HookPart[] };
  finishReason?: HookFinishReason;
  index?: number;
  safetyRatings?: Array<{
    category?: unknown;
    probability?: unknown;
    blocked?: boolean;
  }>;
}

export interface HookGenerateContentResponse {
  text?: string;
  data?: unknown;
  functionCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  executableCode?: unknown;
  codeExecutionResult?: unknown;
  candidates?: HookCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
}

export interface HookFunctionCallingConfig {
  mode?: 'AUTO' | 'ANY' | 'NONE';
  allowedFunctionNames?: string[];
  [key: string]: unknown;
}

export interface HookSdkToolConfig {
  functionCallingConfig?: HookFunctionCallingConfig;
  [key: string]: unknown;
}

/**
 * Decoupled LLM request format - stable across LLxprt CLI versions
 */
export interface LLMRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'model' | 'system';
    content: string | Array<{ type: string; [key: string]: unknown }>;
  }>;
  config?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    candidateCount?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    [key: string]: unknown;
  };
  toolConfig?: HookToolConfig;
}

/**
 * Decoupled LLM response format - stable across LLxprt CLI versions
 */
export interface LLMResponse {
  text?: string;
  candidates: Array<{
    content: {
      role: 'model';
      parts: string[];
    };
    finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    index?: number;
    safetyRatings?: Array<{
      category: string;
      probability: string;
      blocked?: boolean;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Decoupled tool configuration - stable across LLxprt CLI versions
 */
export interface HookToolConfig {
  mode?: 'AUTO' | 'ANY' | 'NONE';
  allowedFunctionNames?: string[];
}

/**
 * Optional boundary metadata that a BeforeModel hook may return alongside a
 * full-replacement llm_request. This lets compression recover the pending
 * region when differential analysis cannot (e.g. the hook rewrote the whole
 * conversation). The pending region MUST be a suffix of the modified contents
 * because recomposition appends pending after curated history.
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
  version?: 1;
  pendingMessageStartIndex: number;
  pendingMessageCount?: number;
  onInvalidBoundary?: 'skip-compression' | 'throw';
}

/**
 * Base class for hook translators - handles version-specific translation logic
 */
export abstract class HookTranslator {
  abstract toHookLLMRequest(
    sdkRequest: HookGenerateContentParameters,
  ): LLMRequest;
  abstract fromHookLLMRequest(
    hookRequest: LLMRequest,
    baseRequest?: HookGenerateContentParameters,
  ): HookGenerateContentParameters;
  abstract toHookLLMResponse(
    sdkResponse: HookGenerateContentResponse,
  ): LLMResponse;
  abstract fromHookLLMResponse(
    hookResponse: LLMResponse,
  ): HookGenerateContentResponse;
  abstract toHookToolConfig(sdkToolConfig: HookSdkToolConfig): HookToolConfig;
  abstract fromHookToolConfig(
    hookToolConfig: HookToolConfig,
  ): HookSdkToolConfig;
}

/**
 * Type guard to check if a value has a text property
 */
function hasTextProperty(value: unknown): value is { text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof (value as { text: unknown }).text === 'string'
  );
}

/**
 * Checks whether a value from an untyped SDK boundary is present (not
 * undefined, null, false, 0, empty string, or NaN).
 */
function isPresent(value: unknown): boolean {
  return Boolean(value);
}

function resolveMessageRole(role: string): 'user' | 'model' | 'system' {
  if (role === 'model') {
    return 'model';
  }
  if (role === 'system') {
    return 'system';
  }
  return 'user';
}

/**
 * Type guard to check if content has role and parts properties
 */
function isContentWithParts(
  content: unknown,
): content is { role: string; parts: unknown } {
  return (
    typeof content === 'object' &&
    content !== null &&
    'role' in content &&
    'parts' in content
  );
}

/**
 * Helper to safely extract generation config from SDK request
 * The SDK uses a config field that contains generation parameters
 */
function extractGenerationConfig(request: HookGenerateContentParameters):
  | {
      temperature?: number;
      maxOutputTokens?: number;
      topP?: number;
      topK?: number;
    }
  | undefined {
  // Access the config field which contains generation settings
  // Use type assertion after checking the field exists
  if (request.config && typeof request.config === 'object') {
    const config = request.config as {
      temperature?: number;
      maxOutputTokens?: number;
      topP?: number;
      topK?: number;
    };
    return {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      topK: config.topK,
    };
  }

  return undefined;
}

/**
 * Hook translator for GenAI SDK v1.x
 * Handles translation between GenAI SDK types and stable Hook API types
 */
export class HookTranslatorGenAIv1 extends HookTranslator {
  /**
   * Convert genai SDK GenerateContentParameters to stable LLMRequest
   *
   * Note: This implementation intentionally extracts only text content from parts.
   * Non-text parts (images, function calls, etc.) are filtered out in v1 to provide
   * a simplified, stable interface for hooks. This allows hooks to focus on text
   * manipulation without needing to handle complex multimodal content.
   * Future versions may expose additional content types if needed.
   */
  toHookLLMRequest(sdkRequest: HookGenerateContentParameters): LLMRequest {
    const messages: LLMRequest['messages'] = [];

    const rawContents = sdkRequest.contents as unknown;
    const hasContents = isPresent(rawContents);

    if (hasContents) {
      const contents = Array.isArray(sdkRequest.contents)
        ? sdkRequest.contents
        : [sdkRequest.contents];

      for (const content of contents) {
        if (typeof content === 'string') {
          messages.push({
            role: 'user',
            content,
          });
        } else if (isContentWithParts(content)) {
          this.pushTextMessage(messages, content);
        }
      }
    }

    // Safely extract generation config using proper type access
    const config = extractGenerationConfig(sdkRequest);

    return {
      model:
        sdkRequest.model === ''
          ? DEFAULT_GEMINI_FLASH_MODEL
          : (sdkRequest.model ?? DEFAULT_GEMINI_FLASH_MODEL),
      messages,
      config: {
        temperature: config?.temperature,
        maxOutputTokens: config?.maxOutputTokens,
        topP: config?.topP,
        topK: config?.topK,
      },
    };
  }

  private pushTextMessage(
    messages: LLMRequest['messages'],
    content: { role: string; parts: unknown },
  ): void {
    const role = resolveMessageRole(content.role);

    const parts = Array.isArray(content.parts)
      ? content.parts
      : [content.parts];

    // Extract only text parts - intentionally filtering out non-text content
    const textContent = parts
      .filter(hasTextProperty)
      .map((part) => part.text)
      .join('');

    if (textContent !== '') {
      messages.push({ role, content: textContent });
    }
  }

  /**
   * Convert stable LLMRequest to genai SDK GenerateContentParameters
   *
   * H2 defensive guard: when the hook supplied an llm_request without a
   * messages array (e.g. only model/config overrides), the contents are NOT
   * rebuilt from messages — the baseRequest contents are preserved. This
   * prevents a crash (messages.map on undefined) and avoids destroying tool
   * calls/ids/metadata that a text-only round-trip would strip.
   */
  fromHookLLMRequest(
    hookRequest: LLMRequest,
    baseRequest?: HookGenerateContentParameters,
  ): HookGenerateContentParameters {
    // When the hook did not supply messages, preserve the base contents.
    // Only rebuild contents from messages when the hook actually provided them.
    // Shallow-copy the base contents array (when present and an array) so that
    // downstream in-place mutation of the result cannot corrupt baseRequest.
    const hookMessages = hookRequest.messages;
    const baseContents = baseRequest?.contents;
    let contents: HookGenerateContentParameters['contents'];
    if (Array.isArray(hookMessages)) {
      contents = hookMessages.map((message) => ({
        role: message.role === 'model' ? 'model' : message.role,
        parts: [
          {
            text:
              typeof message.content === 'string'
                ? message.content
                : String(message.content),
          },
        ],
      }));
    } else if (Array.isArray(baseContents)) {
      // Shallow copy: a new array protects baseRequest from array-level
      // mutation (push/splice on the result), but the Content objects/parts
      // within are SHARED by reference. Downstream code must not mutate
      // nested objects/parts in place.
      contents = baseContents.slice();
    } else {
      contents = baseContents ?? [];
    }

    // Build the result with proper typing.
    // model must be defined: a config-only hook llm_request may omit model
    // (hooks send arbitrary JSON), and an explicit `model: undefined` here
    // would clobber the target's model when spread in applyLLMRequestModifications.
    // hookRequest is typed LLMRequest but arrives as Partial at runtime, so
    // read model defensively as an optional string before coalescing.
    const hookModel =
      typeof hookRequest.model === 'string' ? hookRequest.model : undefined;
    const result: HookGenerateContentParameters = {
      ...baseRequest,
      model: hookModel ?? baseRequest?.model ?? DEFAULT_GEMINI_FLASH_MODEL,
      contents,
    };

    // Add generation config if it exists in the hook request
    if (hookRequest.config) {
      const baseConfig = baseRequest
        ? extractGenerationConfig(baseRequest)
        : undefined;

      result.config = {
        ...baseConfig,
        temperature: hookRequest.config.temperature,
        maxOutputTokens: hookRequest.config.maxOutputTokens,
        topP: hookRequest.config.topP,
        topK: hookRequest.config.topK,
      } as HookGenerateContentParameters['config'];
    }

    return result;
  }

  /**
   * Convert genai SDK GenerateContentResponse to stable LLMResponse
   */
  toHookLLMResponse(sdkResponse: HookGenerateContentResponse): LLMResponse {
    return {
      text: getResponseText(sdkResponse) ?? undefined,
      candidates: (sdkResponse.candidates ?? []).map((candidate) => {
        // Extract text parts from the candidate
        const textParts =
          candidate.content?.parts
            ?.filter(hasTextProperty)
            .map((part) => part.text) ?? [];

        return {
          content: {
            role: 'model' as const,
            parts: textParts,
          },
          finishReason:
            candidate.finishReason as LLMResponse['candidates'][0]['finishReason'],
          index: candidate.index,
          safetyRatings: candidate.safetyRatings?.map((rating) => ({
            category: String(rating.category ?? ''),
            probability: String(rating.probability ?? ''),
          })),
        };
      }),
      usageMetadata: sdkResponse.usageMetadata
        ? {
            promptTokenCount: sdkResponse.usageMetadata.promptTokenCount,
            candidatesTokenCount:
              sdkResponse.usageMetadata.candidatesTokenCount,
            totalTokenCount: sdkResponse.usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }

  /**
   * Convert stable LLMResponse to genai SDK GenerateContentResponse
   */
  fromHookLLMResponse(hookResponse: LLMResponse): HookGenerateContentResponse {
    // Build response object with proper structure
    const response: HookGenerateContentResponse = {
      text: hookResponse.text,
      candidates: hookResponse.candidates.map((candidate) => ({
        content: {
          role: 'model',
          parts: candidate.content.parts.map((part) => ({
            text: part,
          })),
        },
        finishReason: candidate.finishReason,
        index: candidate.index,
        safetyRatings: candidate.safetyRatings,
      })),
      usageMetadata: hookResponse.usageMetadata,
    };

    return response;
  }

  /**
   * Convert genai SDK ToolConfig to stable HookToolConfig
   */
  toHookToolConfig(sdkToolConfig: HookSdkToolConfig): HookToolConfig {
    return {
      mode: sdkToolConfig.functionCallingConfig?.mode,
      allowedFunctionNames:
        sdkToolConfig.functionCallingConfig?.allowedFunctionNames,
    };
  }

  /**
   * Convert stable HookToolConfig to genai SDK ToolConfig
   */
  fromHookToolConfig(hookToolConfig: HookToolConfig): HookSdkToolConfig {
    const functionCallingConfig: HookFunctionCallingConfig | undefined =
      hookToolConfig.mode !== undefined ||
      hookToolConfig.allowedFunctionNames !== undefined
        ? {
            mode: hookToolConfig.mode,
            allowedFunctionNames: hookToolConfig.allowedFunctionNames,
          }
        : undefined;

    return {
      functionCallingConfig,
    };
  }
}

/**
 * Default translator instance for current GenAI SDK version
 */
export const defaultHookTranslator = new HookTranslatorGenAIv1();

/**
 * Zod schema for the optional llm_request_boundary metadata a BeforeModel hook
 * may return. Fail-open at the parse level means malformed metadata is rejected
 * structurally (wrong types, bad enum values); the caller decides policy when
 * boundary indices do not fit the contents positionally (resolution level).
 *
 * Two validation layers (see R4/R6):
 *  - STRUCTURAL (parse level, this schema): field types, enum values, version
 *    literal. Failure here → discriminated result status 'malformed'.
 *  - POSITIONAL (resolution level, streamRequestHelpers): the pending region
 *    described by valid indices must be a suffix of the modified contents.
 *    Failure there → invalid boundary honored per onInvalidBoundary.
 */
const hookLLMRequestBoundarySchema = z.object({
  version: z.literal(1).optional(),
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
