/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

// Provider interfaces and implementations live in the providers package.
export {
  IProvider,
  IModel,
  ITool,
  IProviderManager,
  ContentGeneratorRole,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
export type { IContent } from '@vybestack/llxprt-code-core';

// Provider management
export * from '@vybestack/llxprt-code-providers/composition.js';
