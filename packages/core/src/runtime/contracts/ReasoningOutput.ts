/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for reasoning output.
 *
 * Core CompressionHandler receives ReasoningOutput from provider through
 * the RuntimeProvider contract, not by importing provider reasoningUtils.
 * Provider package owns reasoning extraction and converts to this core type.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-08, lines 80-85
 */

/**
 * Structural representation of reasoning/thinking output from a provider.
 *
 * Core compression consumes these fields. Provider code that extracts
 * thinking blocks maps them to this contract before passing into core.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface ReasoningOutput {
  text?: string;
  reasoningText?: string;
  signature?: string;
  tokenCount?: number;
}
