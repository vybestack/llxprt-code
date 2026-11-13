/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  DefinitionError,
  validateAdapterFormat,
  validateDefinition,
  validateJsonValue,
  validateModelRecovery,
  validatePreparedCall,
  validateTranscriptEntry,
  type AgentDefinition,
} from '../index.js';

const validDefinition: AgentDefinition = {
  name: 'assistant',
  instructions: [],
  model: {
    primary: { ref: { provider: 'local', model: 'test' }, parameters: {} },
    fallbacks: [],
    fallbackOn: [],
  },
  tools: [],
  policy: {
    authority: [],
    preferences: [],
    sourceStacks: [],
    approvalMode: 'default',
    fallback: 'deny',
  },
  limits: { maxStepsPerTurn: 12, maxParallelChildren: 2 },
  context: {
    compactAtRatio: 0.8,
    keepRecentTurns: 4,
    summarizer: 'active-model',
  },
  retry: { maxAttempts: 3, backoffMs: [10, 30] },
  loop: { maxIdenticalCalls: 2, maxStepsWithoutProgress: 5 },
  subagents: [],
  toolOutput: {
    maxResultBytes: 4096,
    maxStepResultBytes: 8192,
    truncation: 'head-and-tail',
  },
};

describe('agent-core validation boundaries', () => {
  it('rejects slash-free scheme URLs containing user information', () => {
    expect(() =>
      validateModelRecovery({
        scope: {
          provider: 'p',
          model: 'm',
          endpoint: 'https:user:pass@example.test',
          principal: 'opaque',
        },
        invalidates: [],
        format: 'v1',
        data: null,
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects credential parameters after a fragment route', () => {
    expect(() =>
      validateModelRecovery({
        scope: {
          provider: 'p',
          model: 'm',
          endpoint: 'https://example.test/#/callback?access_token=abc',
          principal: 'opaque',
        },
        invalidates: [],
        format: 'v1',
        data: null,
      }),
    ).toThrow(DefinitionError);
  });

  it('uses a validation-neutral DefinitionError message for adapter and prepared-call errors', () => {
    let adapterError: unknown;
    let preparedCallError: unknown;
    try {
      validateAdapterFormat('provider/v2', ['provider/v1']);
    } catch (error) {
      adapterError = error;
    }
    try {
      validatePreparedCall(
        { token: 'prepared-1', args: { command: 'echo ok' } },
        'command',
      );
    } catch (error) {
      preparedCallError = error;
    }

    expect(adapterError).toBeInstanceOf(DefinitionError);
    expect(preparedCallError).toBeInstanceOf(DefinitionError);
    if (
      !(adapterError instanceof DefinitionError) ||
      !(preparedCallError instanceof DefinitionError)
    )
      throw new Error('Validation did not produce DefinitionError');
    expect(adapterError.message).toContain('Validation');
    expect(preparedCallError.message).toContain('Validation');
    expect(adapterError.message).not.toContain('Agent definition');
    expect(preparedCallError.message).not.toContain('Agent definition');
  });

  it('rejects binary content with an own accessor', () => {
    const data = new Uint8Array([1, 2]);
    Object.defineProperty(data, 'metadata', {
      enumerable: true,
      get: () => 'unsafe',
    });

    expect(() =>
      validateTranscriptEntry({
        id: 'image-entry',
        role: 'user',
        parts: [
          {
            id: 'image-part',
            content: { kind: 'image', mediaType: 'image/png', data },
          },
        ],
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects binary content with an own toJSON method', () => {
    const data = new Uint8Array([3, 4]);
    Object.defineProperty(data, 'toJSON', {
      enumerable: true,
      value: () => 'unsafe',
    });

    expect(() =>
      validateTranscriptEntry({
        id: 'image-entry',
        role: 'user',
        parts: [
          {
            id: 'image-part',
            content: { kind: 'image', mediaType: 'image/png', data },
          },
        ],
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects a sparse definition array with the maximum possible length promptly', () => {
    const tools = Array(2 ** 32 - 1);
    expect(() => validateDefinition({ ...validDefinition, tools })).toThrow(
      DefinitionError,
    );
  });

  it('rejects executable, accessor-backed, symbol-keyed, hidden, cyclic, and non-finite data without invoking getters', () => {
    let getterCalls = 0;
    const getterValue = Object.defineProperty({ ...validDefinition }, 'name', {
      get() {
        getterCalls += 1;
        return 'getter';
      },
    });
    expect(() => validateDefinition(getterValue)).toThrow(DefinitionError);
    expect(() =>
      validateDefinition({ ...validDefinition, [Symbol('hidden')]: 1 }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateDefinition(
        Object.defineProperty({ ...validDefinition }, 'hidden', { value: 1 }),
      ),
    ).toThrow(DefinitionError);
    expect(() =>
      validateDefinition({
        ...validDefinition,
        context: { ...validDefinition.context, extra: () => 1 },
      }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateDefinition({
        ...validDefinition,
        policy: {
          authority: [
            {
              id: 'numeric',
              match: { args: [{ arg: 'x', equals: Infinity }] },
              outcome: 'deny',
            },
          ],
          preferences: [],
          fallback: 'deny',
        },
      }),
    ).toThrow(DefinitionError);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => validateJsonValue(cycle)).toThrow(DefinitionError);
    expect(() =>
      validateJsonValue(
        Object.defineProperty([], 'hidden', { value: () => 1 }),
      ),
    ).toThrow(DefinitionError);
    const arrayGetter: unknown[] = [];
    Object.defineProperty(arrayGetter, '0', {
      get() {
        getterCalls += 1;
        return 'bad';
      },
      enumerable: true,
    });
    arrayGetter.length = 1;
    expect(() => validateJsonValue(arrayGetter)).toThrow(DefinitionError);
    expect(getterCalls).toBe(0);
  });
});
