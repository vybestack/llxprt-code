/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expectTypeOf } from 'vitest';
import type { AgentEventType } from './turn.js';
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
import type { ContentBlock } from '../services/history/IContent.js';
import type {
  GeminiEventType,
  ServerGeminiStreamEvent,
  ServerGeminiFinishedOutcome,
  ServerGeminiRetryEvent,
  ServerGeminiInvalidStreamEvent,
  ServerGeminiContextWindowWillOverflowEvent,
  ServerGeminiContentEvent,
  ServerGeminiSystemNoticeEvent,
  ServerGeminiThoughtEvent,
  ServerGeminiToolCallRequestEvent,
  ServerGeminiToolCallResponseEvent,
  ServerGeminiToolCallConfirmationEvent,
  ServerGeminiUserCancelledEvent,
  ServerGeminiStreamIdleTimeoutEvent,
  ServerGeminiErrorEvent,
  ServerGeminiChatCompressedEvent,
  ServerGeminiUsageMetadataEvent,
  ServerGeminiMaxSessionTurnsEvent,
  ServerGeminiFinishedEvent,
  ServerGeminiLoopDetectedEvent,
  ServerGeminiCitationEvent,
  ServerGeminiModelInfoEvent,
  ServerGeminiAgentExecutionStoppedEvent,
  ServerGeminiAgentExecutionBlockedEvent,
  GeminiErrorEventValue,
  GeminiCodeRequest,
} from './geminiLegacyAliases.js';

// Bidirectional structural type equality: every deprecated alias must be
// interchangeable with its canonical replacement in both directions.
// expectTypeOf().toEqualTypeOf() fails at compile time (via vitest
// typechecking) if the types differ. This file is a type-test (`.test-d.ts`)
// and is typechecked by vitest's `typecheck` feature enabled in
// vitest.config.ts.
expectTypeOf<GeminiEventType>().toEqualTypeOf<AgentEventType>();
expectTypeOf<ServerGeminiStreamEvent>().toEqualTypeOf<ServerAgentStreamEvent>();
expectTypeOf<ServerGeminiFinishedOutcome>().toEqualTypeOf<ServerFinishedOutcome>();
expectTypeOf<ServerGeminiRetryEvent>().toEqualTypeOf<ServerRetryEvent>();
expectTypeOf<ServerGeminiInvalidStreamEvent>().toEqualTypeOf<ServerInvalidStreamEvent>();
expectTypeOf<ServerGeminiContextWindowWillOverflowEvent>().toEqualTypeOf<ServerContextWindowWillOverflowEvent>();
expectTypeOf<ServerGeminiContentEvent>().toEqualTypeOf<ServerContentEvent>();
expectTypeOf<ServerGeminiSystemNoticeEvent>().toEqualTypeOf<ServerSystemNoticeEvent>();
expectTypeOf<ServerGeminiThoughtEvent>().toEqualTypeOf<ServerThoughtEvent>();
expectTypeOf<ServerGeminiToolCallRequestEvent>().toEqualTypeOf<ServerToolCallRequestEvent>();
expectTypeOf<ServerGeminiToolCallResponseEvent>().toEqualTypeOf<ServerToolCallResponseEvent>();
expectTypeOf<ServerGeminiToolCallConfirmationEvent>().toEqualTypeOf<ServerToolCallConfirmationEvent>();
expectTypeOf<ServerGeminiUserCancelledEvent>().toEqualTypeOf<ServerUserCancelledEvent>();
expectTypeOf<ServerGeminiStreamIdleTimeoutEvent>().toEqualTypeOf<ServerStreamIdleTimeoutEvent>();
expectTypeOf<ServerGeminiErrorEvent>().toEqualTypeOf<ServerErrorEvent>();
expectTypeOf<ServerGeminiChatCompressedEvent>().toEqualTypeOf<ServerChatCompressedEvent>();
expectTypeOf<ServerGeminiUsageMetadataEvent>().toEqualTypeOf<ServerUsageMetadataEvent>();
expectTypeOf<ServerGeminiMaxSessionTurnsEvent>().toEqualTypeOf<ServerMaxSessionTurnsEvent>();
expectTypeOf<ServerGeminiFinishedEvent>().toEqualTypeOf<ServerFinishedEvent>();
expectTypeOf<ServerGeminiLoopDetectedEvent>().toEqualTypeOf<ServerLoopDetectedEvent>();
expectTypeOf<ServerGeminiCitationEvent>().toEqualTypeOf<ServerCitationEvent>();
expectTypeOf<ServerGeminiModelInfoEvent>().toEqualTypeOf<ServerModelInfoEvent>();
expectTypeOf<ServerGeminiAgentExecutionStoppedEvent>().toEqualTypeOf<ServerAgentExecutionStoppedEvent>();
expectTypeOf<ServerGeminiAgentExecutionBlockedEvent>().toEqualTypeOf<ServerAgentExecutionBlockedEvent>();
expectTypeOf<GeminiErrorEventValue>().toEqualTypeOf<AgentErrorEventValue>();
expectTypeOf<GeminiCodeRequest>().toEqualTypeOf<
  string | ContentBlock | ContentBlock[]
>();
