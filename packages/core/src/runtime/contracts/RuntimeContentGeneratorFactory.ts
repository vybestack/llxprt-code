/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for content generator factory injection.
 *
 * Core contentGenerator.ts receives a factory/structural generator instead of
 * importing/constructing ProviderContentGenerator. CLI/providers wiring constructs
 * the concrete ProviderContentGenerator and injects it.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-03, lines 30-34
 */

import type { RuntimeProviderManager } from './RuntimeProviderManager.js';

/**
 * Factory contract for creating a content generator from a provider manager.
 *
 * CLI constructs a factory that instantiates ProviderContentGenerator
 * from the providers package. Core content generation path receives
 * the factory result through this contract.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface RuntimeContentGeneratorFactory<TGenerator = unknown> {
  createContentGenerator(manager: RuntimeProviderManager): TGenerator;
}
