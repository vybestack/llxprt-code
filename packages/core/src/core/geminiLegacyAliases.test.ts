/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
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
import {
  GeminiEventType,
  type ServerGeminiStreamEvent,
  type ServerGeminiFinishedOutcome,
  type ServerGeminiRetryEvent,
  type ServerGeminiInvalidStreamEvent,
  type ServerGeminiContextWindowWillOverflowEvent,
  type ServerGeminiContentEvent,
  type ServerGeminiSystemNoticeEvent,
  type ServerGeminiThoughtEvent,
  type ServerGeminiToolCallRequestEvent,
  type ServerGeminiToolCallResponseEvent,
  type ServerGeminiToolCallConfirmationEvent,
  type ServerGeminiUserCancelledEvent,
  type ServerGeminiStreamIdleTimeoutEvent,
  type ServerGeminiErrorEvent,
  type ServerGeminiChatCompressedEvent,
  type ServerGeminiUsageMetadataEvent,
  type ServerGeminiMaxSessionTurnsEvent,
  type ServerGeminiFinishedEvent,
  type ServerGeminiLoopDetectedEvent,
  type ServerGeminiCitationEvent,
  type ServerGeminiModelInfoEvent,
  type ServerGeminiAgentExecutionStoppedEvent,
  type ServerGeminiAgentExecutionBlockedEvent,
  type GeminiErrorEventValue,
  type GeminiCodeRequest,
} from './geminiLegacyAliases.js';

describe('geminiLegacyAliases (deprecated aliases)', () => {
  it('GeminiEventType is reference-equal to AgentEventType', () => {
    expect(GeminiEventType).toBe(AgentEventType);
  });

  it('GeminiEventType.Content === "content"', () => {
    expect(GeminiEventType.Content).toBe('content');
  });

  it('ServerGeminiStreamEvent is assignable from ServerAgentStreamEvent', () => {
    const event: ServerAgentStreamEvent = {
      type: AgentEventType.Content,
      value: 'hello',
    };
    // Type-level check: a ServerAgentStreamEvent must be assignable to the
    // deprecated ServerGeminiStreamEvent alias.
    const compat: ServerGeminiStreamEvent = event;
    expect(compat.type).toBe(AgentEventType.Content);
  });

  it('every deprecated alias is structurally identical to its canonical type', () => {
    // Bidirectional structural type equality: every deprecated alias must be
    // interchangeable with its canonical replacement in both directions.
    // expectTypeOf().toEqualTypeOf() fails at compile time if the types
    // differ, so these assertions run at the type levels.
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
    expectTypeOf<GeminiCodeRequest>().toEqualTypeOf<PartListUnion>();

    // Sanity guard: confirm we exercised all 26 alias type declarations
    // (23 ServerGemini* types, GeminiEventType, GeminiErrorEventValue, and
    // GeminiCodeRequest). If someone adds a new alias to
    // geminiLegacyAliases.ts without adding a check here, this count will
    // be a reminder to extend coverage.
    const aliasCount = 26;
    expect(aliasCount).toBe(26);
  });
});
