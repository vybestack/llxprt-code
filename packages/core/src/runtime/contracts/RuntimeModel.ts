/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for model data.
 *
 * Core model hydration works with RuntimeModel instead of provider IModel.
 * Provider IModel remains in the providers package and is structurally
 * compatible with this contract without importing it.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-06, lines 60-63
 */

/**
 * Structural model contract owned by core.
 *
 * Fields match the subset of IModel that core runtime actually consumes.
 * Provider IModel implementations satisfy this structurally.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface RuntimeModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportedToolFormats?: string[];
}
