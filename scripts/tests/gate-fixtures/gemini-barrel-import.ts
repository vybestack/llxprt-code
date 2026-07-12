/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * gemini-barrel-import.ts — P31 NEGATIVE fixture triggering checkG-barrel.
 *
 * Imports a GeminiContent* barrel type (GeminiContent) from a module.
 * This signals a direct structural dependency on the Google payload shape.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

import type { GeminiContent } from '@vybestack/llxprt-code-core/llm-types/geminiContent.js';

export function useBarrel(content: GeminiContent): void {
  void content;
}
