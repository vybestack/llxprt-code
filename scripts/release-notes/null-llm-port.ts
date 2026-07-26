/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlmPort } from './types.js';

/**
 * Creates an LLM port that always throws, forcing the deterministic fallback
 * path. Used when no LLM credentials are configured (e.g. local dry-runs).
 */
export function createNullLlmPort(): LlmPort {
  return {
    async generateHighlights(_context: string): Promise<string> {
      throw new Error('No LLM configured; using deterministic fallback.');
    },
  };
}
