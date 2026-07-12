/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * clean-neutral.ts — P02 fixture: zero #2424 vectors.
 *
 * Imports only neutral types, constructs neutral IContent with .blocks, uses
 * no @google/genai, no banned symbols, no Contract* aliases, no FinishReason/
 * Type enum re-declaration. `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

// Neutral types imported from a SAFE module (core llm-types). No banned module.
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

export function buildNeutralMessage(): IContent {
  const block: ContentBlock = { type: 'text', text: 'ok' };
  return {
    speaker: 'ai',
    blocks: [block],
  };
}
