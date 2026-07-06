/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural shape for legacy Google Content — operates on `unknown` with
 * structural checks so NO @google/genai import is needed in this file.
 * Consumers (agents, #2349-owned) still pass Google Content objects today;
 * the structural narrowing accepts them.
 */
interface LegacyContentLike {
  role?: string;
  parts?:
    | Array<{
        functionResponse?: unknown;
        functionCall?: unknown;
      }>
    | undefined;
}

export function isFunctionResponse(content: LegacyContentLike): boolean {
  return (
    content.role === 'user' &&
    content.parts != null &&
    content.parts.length > 0 &&
    content.parts.every((part) => part.functionResponse != null)
  );
}

export function isFunctionCall(content: LegacyContentLike): boolean {
  return (
    content.role === 'model' &&
    content.parts != null &&
    content.parts.length > 0 &&
    content.parts.every((part) => part.functionCall != null)
  );
}
