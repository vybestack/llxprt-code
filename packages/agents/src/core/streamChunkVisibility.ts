/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';

export function hasVisibleOrThinkingContent(
  response: GenerateContentResponse,
): boolean {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.some(
    (part) =>
      (typeof part.text === 'string' && part.text.length > 0) ||
      part.thought === true,
  );
}
