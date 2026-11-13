/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  AfterModelEffectSchema,
  BeforeModelEffectSchema,
  DefinitionError,
  HookModelResponseSchema,
  validateHookError,
  validateHookEventResult,
  validateHookModelResponse,
  validateHookRequestPatch,
  type AgentEvent,
  type HookModelResponse,
  type ModelAttemptSource,
  type ModelResponseFrame,
  type ModelRef,
  type TranscriptEntry,
} from '../index.js';

describe('P01a D20 hook contracts', () => {
  it('retains request-local message rewrites and selected model identity', () => {
    const message: TranscriptEntry = {
      id: 'message-1',
      role: 'user',
      parts: [
        {
          id: 'text-1',
          content: { kind: 'text', text: 'rewritten request' },
        },
      ],
    };
    const editedCall: TranscriptEntry = {
      id: 'assistant-turn',
      role: 'model',
      parts: [
        {
          id: 'call-1',
          call: { id: 'call-1', tool: 'tool/read', args: { path: 'edited' } },
        },
      ],
    };
    const model: ModelRef = { provider: 'provider', model: 'selected' };
    const request = validateHookRequestPatch({
      messages: [message, editedCall],
      model,
      boundary: {
        status: 'valid',
        boundary: { pendingMessageStartIndex: 0, pendingMessageCount: 1 },
      },
    });

    expect(request.messages).toStrictEqual([message, editedCall]);
    expect(request.model).toStrictEqual(model);
    expect(request.boundary.status).toBe('valid');
  });

  it('uses effect schemas and preserves ordered audit outputs and typed admission failures', () => {
    const hook = (id: string, order: number) => ({
      id,
      event: 'before-model',
      source: 'configuration',
      order,
    });
    const result = validateHookEventResult(
      {
        effective: {
          control: { action: 'continue' },
          value: { request: { boundary: { status: 'absent' } } },
          systemMessage: 'Informational only',
          producers: [{ path: 'request', provenance: hook('first', 0) }],
        },
        audit: [
          {
            provenance: hook('first', 0),
            status: 'success',
            output: {
              request: { boundary: { status: 'absent' } },
            },
          },
          {
            provenance: hook('second', 1),
            status: 'timeout',
            diagnostic: 'Hook deadline elapsed.',
          },
        ],
      },
      BeforeModelEffectSchema,
    );
    expect(result.audit.map((entry) => entry.provenance.id)).toStrictEqual([
      'first',
      'second',
    ]);
    expect(() =>
      validateHookEventResult(
        {
          effective: { control: { action: 'continue' }, producers: [] },
          audit: [
            { provenance: hook('second', 1), status: 'timeout' },
            { provenance: hook('first', 0), status: 'success', output: {} },
          ],
        },
        BeforeModelEffectSchema,
      ),
    ).toThrow(DefinitionError);
    expect(AfterModelEffectSchema.safeParse({}).success).toBe(true);
    expect(
      AfterModelEffectSchema.safeParse({ replacement: { parts: [] } }).success,
    ).toBe(true);
    expect(
      validateHookError({
        kind: 'tool-set-widened',
        provenance: hook('widening-hook', 2),
        message: 'The requested tool set exceeds the pinned selection.',
      }).kind,
    ).toBe('tool-set-widened');
    expect(
      validateHookError({
        kind: 'model-not-allowed',
        provenance: hook('model-hook', 3),
        message: 'The requested model is outside the active selection.',
      }).kind,
    ).toBe('model-not-allowed');
    expect(() =>
      validateHookEventResult(
        {
          effective: { control: { action: 'continue' }, producers: [] },
          audit: [
            {
              provenance: hook('timed-out-with-output', 4),
              status: 'timeout',
              output: { request: { boundary: { status: 'absent' } } },
            },
          ],
        },
        BeforeModelEffectSchema,
      ),
    ).toThrow(DefinitionError);
    const cancelled = validateHookEventResult(
      {
        effective: {
          control: { action: 'stop', reason: 'cancelled' },
          producers: [],
        },
        audit: [
          {
            provenance: hook('cancelled-hook', 0),
            status: 'cancelled',
            diagnostic: 'Turn cancelled.',
          },
        ],
      },
      BeforeModelEffectSchema,
    );
    expect(cancelled.audit[0]?.status).toBe('cancelled');
  });

  it('preserves hook-sourced attempt accounting and cumulative source-frame snapshots', () => {
    const source: ModelAttemptSource = {
      source: 'hook',
      hook: {
        id: 'synthetic-hook',
        event: 'before-model',
        source: 'configuration',
        order: 0,
      },
    };
    const zeroUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    };
    const events: AgentEvent[] = [
      {
        seq: 1,
        at: 1,
        agent: 'agent-1',
        type: 'model.attempt',
        step: 1,
        attempt: 'attempt-1',
        model: { provider: 'provider', model: 'selected' },
        tokens: 0,
        source,
        requestTools: ['tool/a'],
      },
      {
        seq: 2,
        at: 2,
        agent: 'agent-1',
        type: 'model.response',
        attempt: 'attempt-1',
        source,
        usage: zeroUsage,
        finish: 'stop',
      },
      {
        seq: 3,
        at: 3,
        agent: 'agent-1',
        type: 'attempt.budget.settled',
        attempt: 'attempt-1',
        source,
        reported: {
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
          },
          complete: true,
        },
        charged: zeroUsage,
        estimated: false,
      },
      {
        seq: 4,
        at: 4,
        agent: 'agent-1',
        type: 'model.part.replaced',
        attempt: 'attempt-1',
        part: 'thinking-1',
        value: 'A',
      },
      {
        seq: 5,
        at: 5,
        agent: 'agent-1',
        type: 'model.attempt',
        step: 2,
        attempt: 'attempt-provider',
        model: { provider: 'provider', model: 'selected' },
        tokens: 0,
        source: { source: 'provider' },
        requestTools: [],
      },
    ];
    expect(
      events.filter((event) => event.type === 'model.attempt')[0]?.source,
    ).toStrictEqual(source);
    expect(
      events.filter((event) => event.type === 'model.response')[0]?.usage,
    ).toStrictEqual(zeroUsage);
    expect(
      events
        .filter((event) => event.type === 'model.attempt')
        .map((event) => event.source),
    ).toStrictEqual([source, { source: 'provider' }]);
    expect(
      events.find((event) => event.type === 'model.part.replaced')?.value,
    ).toBe('A');
    const syntheticResponse = validateHookModelResponse({
      parts: [],
      declaredUsage: {
        totals: {
          inputTokens: 17,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        complete: true,
      },
    });
    expect(syntheticResponse.declaredUsage?.totals.inputTokens).toBe(17);
    expect(
      events.find((event) => event.type === 'attempt.budget.settled')?.reported
        .totals.inputTokens,
    ).toBe(0);

    const allPartKinds: HookModelResponse = {
      parts: [
        {
          value: {
            id: 'text-part',
            content: { kind: 'text', text: 'visible' },
          },
          accumulation: 'append',
        },
        {
          value: {
            id: 'image-part',
            content: {
              kind: 'image',
              mediaType: 'image/png',
              data: { ref: 'blob-image' },
            },
          },
          accumulation: 'append',
        },
        {
          value: { id: 'thinking-part', thinking: 'reasoning' },
          accumulation: 'replace',
        },
        {
          value: {
            id: 'tool-part',
            call: { id: 'call-1', tool: 'tool/read', args: { path: 'file' } },
          },
          accumulation: 'append',
        },
      ],
    };
    expect(
      validateHookModelResponse(allPartKinds).parts.map(
        (part) => part.value.id,
      ),
    ).toStrictEqual(['text-part', 'image-part', 'thinking-part', 'tool-part']);

    const snapshots: readonly ModelResponseFrame[] = [
      {
        id: 'frame-a',
        response: {
          parts: [
            {
              value: { id: 'thinking-1', thinking: 'A' },
              accumulation: 'append',
              stream: { id: 'stream-1', status: 'delta' },
              hookFields: {
                format: 'provider/v1',
                data: { signature: 'late' },
              },
            },
          ],
        },
      },
      {
        id: 'frame-ab',
        response: {
          parts: [
            {
              value: { id: 'thinking-1', thinking: 'AB' },
              accumulation: 'replace',
              stream: { id: 'stream-1', status: 'delta' },
              hookFields: {
                format: 'provider/v1',
                data: { hidden: 'ciphertext' },
              },
            },
          ],
        },
      },
      {
        id: 'frame-complete',
        response: {
          parts: [
            {
              value: { id: 'thinking-1', thinking: 'AB' },
              accumulation: 'replace',
              stream: { id: 'stream-1', status: 'complete' },
              hookFields: {
                format: 'provider/v1',
                data: { providerField: 'opaque' },
              },
            },
          ],
          finishReason: 'stop',
          rawStopReason: 'end_turn',
          declaredUsage: { totals: { inputTokens: 0 }, complete: false },
        },
      },
      { id: 'frame-removed', response: { parts: [] } },
    ];
    expect(
      snapshots.slice(0, 3).map((frame) => frame.response.parts[0]?.value),
    ).toStrictEqual([
      { id: 'thinking-1', thinking: 'A' },
      { id: 'thinking-1', thinking: 'AB' },
      { id: 'thinking-1', thinking: 'AB' },
    ]);
    expect(snapshots.map((frame) => frame.response.parts.length)).toStrictEqual(
      [1, 1, 1, 0],
    );
    expect(
      snapshots
        .slice(0, 3)
        .map((frame) => frame.response.parts[0]?.stream?.status),
    ).toStrictEqual(['delta', 'delta', 'complete']);
    expect(
      snapshots
        .slice(0, 3)
        .map((frame) => frame.response.parts[0]?.hookFields?.data),
    ).toStrictEqual([
      { signature: 'late' },
      { hidden: 'ciphertext' },
      { providerField: 'opaque' },
    ]);
    expect(snapshots[2]?.response.declaredUsage?.totals.inputTokens).toBe(0);
    expect(
      HookModelResponseSchema.safeParse({
        ...snapshots[2]?.response,
        replay: [],
      }).success,
    ).toBe(false);
    expect(
      AfterModelEffectSchema.safeParse({
        replacement: { parts: [] },
      }).success,
    ).toBe(true);
  });
});
