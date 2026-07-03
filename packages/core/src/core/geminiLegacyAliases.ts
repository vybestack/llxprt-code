/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deprecated backward-compatibility aliases for the provider-agnostic event
 * stream types that were renamed from Gemini-prefixed names.
 *
 * Nothing inside this repo may import from this module. It exists solely so
 * that external consumers of the published @vybestack/llxprt-code-core package
 * continue to compile after the rename. All aliases here will be removed in a
 * future major release.
 *
 * @see AgentEventType, ServerAgentStreamEvent in ./turn.js for the canonical names.
 */

import { AgentEventType } from './turn.js';
import type {
  ServerAgentStreamEvent,
  ServerRetryEvent,
  ServerInvalidStreamEvent,
  ServerContextWindowWillOverflowEvent,
  ServerContentEvent,
  ServerSystemNoticeEvent,
  ServerThoughtEvent,
  ServerToolCallRequestEvent,
  ServerToolCallResponseEvent,
  ServerToolCallConfirmationEvent,
  ServerUserCancelledEvent,
  ServerStreamIdleTimeoutEvent,
  ServerErrorEvent,
  ServerChatCompressedEvent,
  ServerUsageMetadataEvent,
  ServerMaxSessionTurnsEvent,
  ServerFinishedEvent,
  ServerLoopDetectedEvent,
  ServerCitationEvent,
  ServerModelInfoEvent,
  ServerAgentExecutionStoppedEvent,
  ServerAgentExecutionBlockedEvent,
  ServerFinishedOutcome,
  AgentErrorEventValue,
} from './turn.js';
import type { PartListUnion } from '@google/genai';

/** @deprecated Use AgentEventType instead. Will be removed in a future major. */
export const GeminiEventType = AgentEventType;
/** @deprecated Use AgentEventType instead. Will be removed in a future major. */
export type GeminiEventType = AgentEventType;

/** @deprecated Use ServerAgentStreamEvent instead. Will be removed in a future major. */
export type ServerGeminiStreamEvent = ServerAgentStreamEvent;
/** @deprecated Use ServerFinishedOutcome instead. Will be removed in a future major. */
export type ServerGeminiFinishedOutcome = ServerFinishedOutcome;
/** @deprecated Use ServerRetryEvent instead. Will be removed in a future major. */
export type ServerGeminiRetryEvent = ServerRetryEvent;
/** @deprecated Use ServerInvalidStreamEvent instead. Will be removed in a future major. */
export type ServerGeminiInvalidStreamEvent = ServerInvalidStreamEvent;
/** @deprecated Use ServerContextWindowWillOverflowEvent instead. Will be removed in a future major. */
export type ServerGeminiContextWindowWillOverflowEvent =
  ServerContextWindowWillOverflowEvent;
/** @deprecated Use ServerContentEvent instead. Will be removed in a future major. */
export type ServerGeminiContentEvent = ServerContentEvent;
/** @deprecated Use ServerSystemNoticeEvent instead. Will be removed in a future major. */
export type ServerGeminiSystemNoticeEvent = ServerSystemNoticeEvent;
/** @deprecated Use ServerThoughtEvent instead. Will be removed in a future major. */
export type ServerGeminiThoughtEvent = ServerThoughtEvent;
/** @deprecated Use ServerToolCallRequestEvent instead. Will be removed in a future major. */
export type ServerGeminiToolCallRequestEvent = ServerToolCallRequestEvent;
/** @deprecated Use ServerToolCallResponseEvent instead. Will be removed in a future major. */
export type ServerGeminiToolCallResponseEvent = ServerToolCallResponseEvent;
/** @deprecated Use ServerToolCallConfirmationEvent instead. Will be removed in a future major. */
export type ServerGeminiToolCallConfirmationEvent =
  ServerToolCallConfirmationEvent;
/** @deprecated Use ServerUserCancelledEvent instead. Will be removed in a future major. */
export type ServerGeminiUserCancelledEvent = ServerUserCancelledEvent;
/** @deprecated Use ServerStreamIdleTimeoutEvent instead. Will be removed in a future major. */
export type ServerGeminiStreamIdleTimeoutEvent = ServerStreamIdleTimeoutEvent;
/** @deprecated Use ServerErrorEvent instead. Will be removed in a future major. */
export type ServerGeminiErrorEvent = ServerErrorEvent;
/** @deprecated Use ServerChatCompressedEvent instead. Will be removed in a future major. */
export type ServerGeminiChatCompressedEvent = ServerChatCompressedEvent;
/** @deprecated Use ServerUsageMetadataEvent instead. Will be removed in a future major. */
export type ServerGeminiUsageMetadataEvent = ServerUsageMetadataEvent;
/** @deprecated Use ServerMaxSessionTurnsEvent instead. Will be removed in a future major. */
export type ServerGeminiMaxSessionTurnsEvent = ServerMaxSessionTurnsEvent;
/** @deprecated Use ServerFinishedEvent instead. Will be removed in a future major. */
export type ServerGeminiFinishedEvent = ServerFinishedEvent;
/** @deprecated Use ServerLoopDetectedEvent instead. Will be removed in a future major. */
export type ServerGeminiLoopDetectedEvent = ServerLoopDetectedEvent;
/** @deprecated Use ServerCitationEvent instead. Will be removed in a future major. */
export type ServerGeminiCitationEvent = ServerCitationEvent;
/** @deprecated Use ServerModelInfoEvent instead. Will be removed in a future major. */
export type ServerGeminiModelInfoEvent = ServerModelInfoEvent;
/** @deprecated Use ServerAgentExecutionStoppedEvent instead. Will be removed in a future major. */
export type ServerGeminiAgentExecutionStoppedEvent =
  ServerAgentExecutionStoppedEvent;
/** @deprecated Use ServerAgentExecutionBlockedEvent instead. Will be removed in a future major. */
export type ServerGeminiAgentExecutionBlockedEvent =
  ServerAgentExecutionBlockedEvent;

/** @deprecated Use AgentErrorEventValue instead. Will be removed in a future major. */
export type GeminiErrorEventValue = AgentErrorEventValue;

/** @deprecated Use PartListUnion from @google/genai directly. Will be removed in a future major. */
export type GeminiCodeRequest = PartListUnion;
