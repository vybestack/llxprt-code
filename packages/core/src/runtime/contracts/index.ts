/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned runtime contract exports.
 *
 * These structural contracts describe what core runtime needs from provider
 * implementations. They are NOT provider API compatibility types — they
 * do not import from or re-export any provider package symbols.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */

export type {
  RuntimeProvider,
  RuntimeToolDeclaration,
  RuntimeToolset,
} from './RuntimeProvider.js';
export type {
  RuntimeProviderManager,
  RuntimeProviderMetrics,
  RuntimeSessionTokenUsage,
} from './RuntimeProviderManager.js';
export type { RuntimeModel } from './RuntimeModel.js';
export type { RuntimeTokenizer } from './RuntimeTokenizer.js';
export type { RuntimeTokenizerFactory } from './RuntimeTokenizerFactory.js';
export type { RuntimeContentGeneratorFactory } from './RuntimeContentGeneratorFactory.js';
export type { TelemetryContext } from './TelemetryContext.js';
export type { BucketFailureReason } from './BucketFailureReason.js';
export type { ReasoningOutput } from './ReasoningOutput.js';
export type {
  MediaBlockType,
  ClassifiedMediaBlock,
} from './MediaBlockContracts.js';
export type {
  RuntimeGenerateChatOptions,
  RuntimeProviderTool,
  RuntimeProviderToolset,
  RuntimeResolvedAuthToken,
} from './RuntimeProviderChat.js';
