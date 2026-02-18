/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
 * @requirement:HOOK-175
 */

// Export types
export * from './types.js';

// Export core components
export {
  HookRegistry,
  HookRegistryNotInitializedError,
} from './hookRegistry.js';
export { HookPlanner } from './hookPlanner.js';

// Export HookSystem and HookEventHandler
// @requirement:HOOK-175 - Export HookSystem and HookEventHandler from index.ts
export { HookSystem, type HookSystemStatus } from './hookSystem.js';
export { HookEventHandler } from './hookEventHandler.js';
export { HookSystemNotInitializedError } from './errors.js';

// Export interfaces and enums
export type { HookRegistryEntry } from './hookRegistry.js';
export { ConfigSource } from './hookRegistry.js';
export type { HookEventContext } from './hookPlanner.js';

// Export translator
export {
  HookTranslator,
  HookTranslatorGenAIv1,
  defaultHookTranslator,
  type LLMRequest,
  type LLMResponse,
  type HookToolConfig,
} from './hookTranslator.js';

// Export aggregator types
export type { AggregatedHookResult } from './hookAggregator.js';

// Export lifecycle hook triggers
export {
  triggerSessionStartHook,
  triggerSessionEndHook,
  triggerBeforeAgentHook,
  triggerAfterAgentHook,
} from '../core/lifecycleHookTriggers.js';
