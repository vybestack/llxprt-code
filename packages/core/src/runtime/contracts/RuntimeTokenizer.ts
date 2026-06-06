/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for token counting behavior.
 *
 * HistoryService receives this contract via injection; it never constructs or
 * imports provider tokenizer implementations. CLI/providers runtime supplies
 * concrete tokenizer instances that satisfy this contract structurally.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-01, lines 10-15
 */

/**
 * Minimal tokenizer contract required by core HistoryService.
 *
 * Concrete provider tokenizers (OpenAITokenizer, AnthropicTokenizer)
 * satisfy this contract structurally without importing it.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface RuntimeTokenizer {
  countTokens(content: unknown): number | Promise<number>;
}
