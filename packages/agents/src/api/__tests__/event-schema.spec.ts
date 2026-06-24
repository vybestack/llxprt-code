/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P04
 * @requirement:REQ-003
 *
 * Behavioral validation of the public AgentEvent zod schemas. Each test parses
 * a well-formed example of a real AgentEvent variant through AgentEventSchema
 * and asserts the parsed value round-trips by type discriminator and payload,
 * then asserts that a malformed payload for the same variant is rejected. This
 * exercises the discriminatedUnion membership (every variant's literal type tag
 * and object shape) plus the leaf schemas (DoneReason, ToolUpdateStatus, etc.)
 * as observable accept/reject behavior — no mock theater; only parse outcomes.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  AgentEventSchema,
  DoneReasonSchema,
  ToolUpdateStatusSchema,
  AgentToolCallSchema,
  AgentToolResultSchema,
  ToolConfirmationSchema,
  ToolUpdateSchema,
  ModelInfoSchema,
  ChatCompressionInfoSchema,
  StructuredErrorSchema,
  AgentStopInfoSchema,
  ThoughtSummarySchema,
  UsageMetadataValueSchema,
  FinishedValueSchema,
} from '@vybestack/llxprt-code-agents';

describe('Event schema @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
  // ─── discriminatedUnion: every variant accepts a real payload and the
  //     parsed result preserves discriminator + payload ────────────────────

  it('parses a text event and preserves type + text @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({ type: 'text', text: 'hello' });
    expect(parsed.type).toBe('text');
    expect(parsed).toStrictEqual({ type: 'text', text: 'hello' });
  });

  it('parses a thinking event with a thought summary @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'thinking',
      thought: { subject: 'plan', description: 'thinking it through' },
    });
    expect(parsed.type).toBe('thinking');
    expect(parsed).toStrictEqual({
      type: 'thinking',
      thought: { subject: 'plan', description: 'thinking it through' },
    });
  });

  it('parses a tool-call event preserving id/name/args @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'tool-call',
      call: { id: 'c1', name: 'read_file', args: { path: '/tmp/x' } },
    });
    expect(parsed.type).toBe('tool-call');
    expect(parsed).toStrictEqual({
      type: 'tool-call',
      call: { id: 'c1', name: 'read_file', args: { path: '/tmp/x' } },
    });
  });

  it('parses a tool-result event preserving id/name/output/isError @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'tool-result',
      result: { id: 'c1', name: 'read_file', output: 'data', isError: false },
    });
    expect(parsed.type).toBe('tool-result');
    expect(parsed).toStrictEqual({
      type: 'tool-result',
      result: { id: 'c1', name: 'read_file', output: 'data', isError: false },
    });
  });

  it('parses a tool-confirmation event preserving ids/name/details @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'tool-confirmation',
      confirmation: {
        confirmationId: 'cf1',
        toolCallId: 'c1',
        name: 'shell',
        details: { kind: 'exec' },
      },
    });
    expect(parsed.type).toBe('tool-confirmation');
    expect(parsed).toStrictEqual({
      type: 'tool-confirmation',
      confirmation: {
        confirmationId: 'cf1',
        toolCallId: 'c1',
        name: 'shell',
        details: { kind: 'exec' },
      },
    });
  });

  it('parses a tool-status event preserving id/name/status @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'tool-status',
      update: { id: 'c1', name: 'shell', status: 'executing' },
    });
    expect(parsed.type).toBe('tool-status');
    expect(parsed).toStrictEqual({
      type: 'tool-status',
      update: { id: 'c1', name: 'shell', status: 'executing' },
    });
  });

  it('parses a usage event preserving usage metadata @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'usage',
      usage: { promptTokenCount: 10, totalTokenCount: 25 },
    });
    expect(parsed.type).toBe('usage');
    expect(parsed).toStrictEqual({
      type: 'usage',
      usage: { promptTokenCount: 10, totalTokenCount: 25 },
    });
  });

  it('parses a model-info event preserving model + provider @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'model-info',
      info: { model: 'gpt', providerName: 'openai', profileName: null },
    });
    expect(parsed.type).toBe('model-info');
    expect(parsed).toStrictEqual({
      type: 'model-info',
      info: { model: 'gpt', providerName: 'openai', profileName: null },
    });
  });

  it('parses a notice event preserving message @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'notice',
      message: 'heads up',
    });
    expect(parsed.type).toBe('notice');
    expect(parsed).toStrictEqual({ type: 'notice', message: 'heads up' });
  });

  it('parses a compression event with info and with null info @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const withInfo = AgentEventSchema.parse({
      type: 'compression',
      info: {
        originalTokenCount: 100,
        newTokenCount: 40,
        compressionStatus: 1,
      },
    });
    expect(withInfo.type).toBe('compression');
    expect(withInfo).toStrictEqual({
      type: 'compression',
      info: {
        originalTokenCount: 100,
        newTokenCount: 40,
        compressionStatus: 1,
      },
    });

    const nullInfo = AgentEventSchema.parse({
      type: 'compression',
      info: null,
    });
    expect(nullInfo).toStrictEqual({ type: 'compression', info: null });
  });

  it('parses a context-warning event preserving token counts @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'context-warning',
      estimatedRequestTokenCount: 5000,
      remainingTokenCount: 1200,
    });
    expect(parsed.type).toBe('context-warning');
    expect(parsed).toStrictEqual({
      type: 'context-warning',
      estimatedRequestTokenCount: 5000,
      remainingTokenCount: 1200,
    });
  });

  it('parses a retry event (tag only) @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({ type: 'retry' });
    expect(parsed).toStrictEqual({ type: 'retry' });
  });

  it('parses a citation event preserving citation text @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'citation',
      citation: 'source-1',
    });
    expect(parsed.type).toBe('citation');
    expect(parsed).toStrictEqual({ type: 'citation', citation: 'source-1' });
  });

  it('parses a loop-detected event (tag only) @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({ type: 'loop-detected' });
    expect(parsed).toStrictEqual({ type: 'loop-detected' });
  });

  it('parses an idle-timeout event preserving structured error @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'idle-timeout',
      error: { message: 'no activity', status: 408 },
    });
    expect(parsed.type).toBe('idle-timeout');
    expect(parsed).toStrictEqual({
      type: 'idle-timeout',
      error: { message: 'no activity', status: 408 },
    });
  });

  it('parses an invalid-stream event (tag only) @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({ type: 'invalid-stream' });
    expect(parsed).toStrictEqual({ type: 'invalid-stream' });
  });

  it('parses a hook-blocked event preserving stop info @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'hook-blocked',
      info: { reason: 'policy', systemMessage: 'blocked' },
    });
    expect(parsed.type).toBe('hook-blocked');
    expect(parsed).toStrictEqual({
      type: 'hook-blocked',
      info: { reason: 'policy', systemMessage: 'blocked' },
    });
  });

  it('parses an error event preserving structured error @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'error',
      error: { message: 'boom' },
    });
    expect(parsed.type).toBe('error');
    expect(parsed).toStrictEqual({ type: 'error', error: { message: 'boom' } });
  });

  it('parses a done event preserving reason/finished/stop @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({
      type: 'done',
      reason: 'stop',
      finished: { reason: 'completed' },
      stop: { reason: 'completed', contextCleared: true },
    });
    expect(parsed.type).toBe('done');
    expect(parsed).toStrictEqual({
      type: 'done',
      reason: 'stop',
      finished: { reason: 'completed' },
      stop: { reason: 'completed', contextCleared: true },
    });
  });

  it('parses a minimal done event (reason only) @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    const parsed = AgentEventSchema.parse({ type: 'done', reason: 'aborted' });
    expect(parsed).toStrictEqual({ type: 'done', reason: 'aborted' });
  });

  // ─── discriminator rejection: unknown tag and wrong payload ──────────────

  it('rejects an event with an unknown discriminator tag @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(AgentEventSchema.safeParse({ type: 'no-such-type' }).success).toBe(
      false,
    );
  });

  it('rejects a text event missing its text field @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(AgentEventSchema.safeParse({ type: 'text' }).success).toBe(false);
  });

  it('rejects a tool-call event with a malformed call payload @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'tool-call',
        call: { id: 'c1', name: 'x' },
      }).success,
    ).toBe(false);
  });

  it('rejects a done event with an invalid reason @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      AgentEventSchema.safeParse({ type: 'done', reason: 'not-a-reason' })
        .success,
    ).toBe(false);
  });

  // ─── leaf enums: DoneReason + ToolUpdateStatus accept/reject ─────────────

  it('DoneReasonSchema accepts each canonical reason and rejects others @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    for (const reason of [
      'stop',
      'aborted',
      'max-turns',
      'context-overflow',
      'loop-detected',
      'error',
      'hook-stopped',
    ]) {
      expect(DoneReasonSchema.parse(reason)).toBe(reason);
    }
    expect(DoneReasonSchema.safeParse('finished').success).toBe(false);
  });

  it('ToolUpdateStatusSchema accepts each canonical status and rejects others @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    for (const status of [
      'validating',
      'scheduled',
      'awaiting-approval',
      'executing',
      'success',
      'error',
      'cancelled',
    ]) {
      expect(ToolUpdateStatusSchema.parse(status)).toBe(status);
    }
    expect(ToolUpdateStatusSchema.safeParse('awaiting_approval').success).toBe(
      false,
    );
  });

  // ─── leaf object schemas: required fields enforced ───────────────────────

  it('AgentToolCallSchema requires id, name and args @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      AgentToolCallSchema.parse({ id: 'a', name: 'b', args: { k: 1 } }),
    ).toStrictEqual({ id: 'a', name: 'b', args: { k: 1 } });
    expect(AgentToolCallSchema.safeParse({ id: 'a', name: 'b' }).success).toBe(
      false,
    );
  });

  it('AgentToolResultSchema requires id and name, output/isError optional @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(AgentToolResultSchema.parse({ id: 'a', name: 'b' })).toStrictEqual({
      id: 'a',
      name: 'b',
    });
    expect(AgentToolResultSchema.safeParse({ id: 'a' }).success).toBe(false);
  });

  it('ToolConfirmationSchema requires confirmationId/toolCallId/name @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      ToolConfirmationSchema.parse({
        confirmationId: 'cf',
        toolCallId: 'c',
        name: 'n',
        details: undefined,
      }),
    ).toMatchObject({ confirmationId: 'cf', toolCallId: 'c', name: 'n' });
    expect(
      ToolConfirmationSchema.safeParse({ confirmationId: 'cf' }).success,
    ).toBe(false);
  });

  it('ToolUpdateSchema requires id/name/status and validates status enum @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      ToolUpdateSchema.parse({ id: 'i', name: 'n', status: 'success' }),
    ).toStrictEqual({ id: 'i', name: 'n', status: 'success' });
    expect(
      ToolUpdateSchema.safeParse({ id: 'i', name: 'n', status: 'bogus' })
        .success,
    ).toBe(false);
  });

  it('ModelInfoSchema requires model and allows nullable profileName @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      ModelInfoSchema.parse({ model: 'm', profileName: null }),
    ).toStrictEqual({
      model: 'm',
      profileName: null,
    });
    expect(ModelInfoSchema.safeParse({ providerName: 'p' }).success).toBe(
      false,
    );
  });

  it('ChatCompressionInfoSchema requires all three numeric counts @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      ChatCompressionInfoSchema.parse({
        originalTokenCount: 1,
        newTokenCount: 2,
        compressionStatus: 3,
      }),
    ).toStrictEqual({
      originalTokenCount: 1,
      newTokenCount: 2,
      compressionStatus: 3,
    });
    expect(
      ChatCompressionInfoSchema.safeParse({
        originalTokenCount: 1,
        newTokenCount: 2,
      }).success,
    ).toBe(false);
  });

  it('StructuredErrorSchema requires message, status optional @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(StructuredErrorSchema.parse({ message: 'm' })).toStrictEqual({
      message: 'm',
    });
    expect(StructuredErrorSchema.safeParse({ status: 500 }).success).toBe(
      false,
    );
  });

  it('AgentStopInfoSchema requires reason, message/contextCleared optional @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(AgentStopInfoSchema.parse({ reason: 'r' })).toStrictEqual({
      reason: 'r',
    });
    expect(AgentStopInfoSchema.safeParse({ systemMessage: 's' }).success).toBe(
      false,
    );
  });

  it('ThoughtSummarySchema requires subject and description @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(
      ThoughtSummarySchema.parse({ subject: 's', description: 'd' }),
    ).toStrictEqual({ subject: 's', description: 'd' });
    expect(ThoughtSummarySchema.safeParse({ subject: 's' }).success).toBe(
      false,
    );
  });

  it('UsageMetadataValueSchema accepts an empty object (all optional) @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(UsageMetadataValueSchema.parse({})).toStrictEqual({});
    expect(
      UsageMetadataValueSchema.parse({ promptTokenCount: 7 }),
    ).toStrictEqual({ promptTokenCount: 7 });
  });

  it('FinishedValueSchema requires reason, usageMetadata optional @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    expect(FinishedValueSchema.parse({ reason: 'done' })).toStrictEqual({
      reason: 'done',
    });
    expect(FinishedValueSchema.safeParse({}).success).toBe(false);
  });

  // ─── property-based invariants ───────────────────────────────────────────

  // The canonical set of valid DoneReason discriminants.
  const VALID_DONE_REASONS = new Set([
    'stop',
    'aborted',
    'max-turns',
    'context-overflow',
    'loop-detected',
    'error',
    'hook-stopped',
  ]);

  // The complete set of known AgentEvent discriminator tags (19 variants).
  const KNOWN_EVENT_TYPES = new Set([
    'text',
    'thinking',
    'tool-call',
    'tool-result',
    'tool-confirmation',
    'tool-status',
    'usage',
    'model-info',
    'notice',
    'compression',
    'context-warning',
    'retry',
    'citation',
    'loop-detected',
    'idle-timeout',
    'invalid-stream',
    'hook-blocked',
    'error',
    'done',
  ]);

  it('property: DoneReasonSchema parses an arbitrary string IFF it is a canonical reason (completeness + soundness) @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    // Soundness: for ANY generated string, parse success must agree exactly
    // with membership in the canonical 7-reason set — no extra reason is
    // accepted, no canonical reason is rejected.
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(DoneReasonSchema.safeParse(s).success).toBe(
          VALID_DONE_REASONS.has(s),
        );
      }),
    );

    // Completeness: every canonical reason parses and round-trips by value.
    // `.parse` throws on failure and otherwise returns the parsed value, so
    // the round-trip assertion needs no conditional narrowing.
    fc.assert(
      fc.property(fc.constantFrom(...VALID_DONE_REASONS), (reason: string) => {
        expect(DoneReasonSchema.parse(reason)).toBe(reason);
      }),
    );
  });

  it('property: AgentEventSchema rejects ANY event whose discriminator tag is not one of the 19 known variants @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    fc.assert(
      fc.property(
        fc.string().filter((tag) => !KNOWN_EVENT_TYPES.has(tag)),
        (tag) => {
          // An unknown discriminator must never satisfy the discriminatedUnion.
          expect(AgentEventSchema.safeParse({ type: tag }).success).toBe(false);
        },
      ),
    );
  });

  it('property: a text event round-trips its exact text payload for any string @plan:PLAN-20260617-COREAPI.P04 @requirement:REQ-003', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        // `.parse` throws on rejection; on success the parsed object must be
        // structurally identical to the generated text event (preserving the
        // discriminator and the exact text payload for every input string).
        const parsed = AgentEventSchema.parse({ type: 'text', text });
        expect(parsed).toStrictEqual({ type: 'text', text });
      }),
    );
  });
});
