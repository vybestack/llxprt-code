/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Shared reasoning-field resolution for all OpenAI-compatible providers.
 *
 * Both the classic openai provider (OpenAIResponseParser) and the openai-vercel
 * provider (vercelReasoningCapture) previously duplicated this logic with subtly
 * different fallback semantics, causing provider drift. This module unifies the
 * policy so that all providers resolve reasoning deltas identically.
 *
 * @issue #2524
 */

/** Default reasoning delta field for standard OpenAI-compatible providers. */
export const DEFAULT_REASONING_FIELD = 'reasoning_content';

/** Ollama's reasoning delta field, used for auto-fallback when no field is configured. */
export const OLLAMA_REASONING_FIELD = 'reasoning';

export interface ResolvedReasoningField {
  value: string;
  actualFieldName: string;
}

/**
 * Normalize a raw reasoning field name. Empty/whitespace-only names are treated
 * as "unset" (undefined) so auto-fallback still applies. Non-empty names are trimmed.
 */
export function normalizeReasoningFieldName(
  fieldName: string | undefined,
): string | undefined {
  const trimmed = fieldName?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * True when a delta value is a usable reasoning string (issue #721: whitespace-only
 * strings are preserved for streaming formatting, so length > 0 is the only bar).
 */
export function isUsableReasoningValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Resolve which reasoning value to capture from a streaming delta, applying the
 * single shared fallback policy used by all OpenAI-compatible providers.
 *
 * - When fieldName is unset (undefined after normalization): the primary value
 *   (default field `reasoning_content`) is preferred; if it is not a usable
 *   non-empty string, auto-fallback to `delta.reasoning` (Ollama) applies.
 * - When fieldName is explicitly set: only that field is read; no auto-fallback.
 *
 * Returns undefined when no usable reasoning is available.
 */
export function resolveReasoningField(params: {
  fieldName: string | undefined;
  delta: Record<string, unknown>;
}): ResolvedReasoningField | undefined {
  const normalizedFieldName = normalizeReasoningFieldName(params.fieldName);
  const explicitField = normalizedFieldName ?? DEFAULT_REASONING_FIELD;
  const primaryValue = params.delta[explicitField];
  if (isUsableReasoningValue(primaryValue)) {
    return { value: primaryValue, actualFieldName: explicitField };
  }
  if (normalizedFieldName === undefined) {
    const ollamaValue = params.delta[OLLAMA_REASONING_FIELD];
    if (isUsableReasoningValue(ollamaValue)) {
      return {
        value: ollamaValue,
        actualFieldName: OLLAMA_REASONING_FIELD,
      };
    }
  }
  return undefined;
}
