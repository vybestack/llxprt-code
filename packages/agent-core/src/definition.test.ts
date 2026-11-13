/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { MemorySessionStore } from './testing/fake-ports.js';
import { validDefinition } from '../type-fixtures/definition-fixtures.js';
import {
  DefinitionError,
  mergeUsageReports,
  validateAdapterFormat,
  validateDefinition,
  validateJsonValue,
  validateModelRecovery,
  validatePreparedCall,
  validateTranscriptEntry,
  validateUsage,
  validateUsageReport,
  type JournalRecord,
  type PreparedCall,
  type Usage,
  type UsageReport,
} from '../index.js';

describe('validateDefinition', () => {
  it('accepts complete definitions and preserves optional undefined fields', () => {
    const parsed = validateDefinition(validDefinition);
    expect(parsed).toStrictEqual(validDefinition);
    const withUndefined = {
      ...validDefinition,
      limits: { ...validDefinition.limits, turnTimeoutMs: undefined },
    };
    expect(
      validateDefinition(withUndefined).limits.turnTimeoutMs,
    ).toBeUndefined();
    expect(() =>
      validateDefinition({ ...validDefinition, unexpected: undefined }),
    ).toThrow(DefinitionError);
  });

  it('reports every malformed or missing definition field together', () => {
    const invalid = {
      ...validDefinition,
      name: '',
      model: undefined,
      limits: { maxStepsPerTurn: -1, maxParallelChildren: 0, hidden: true },
      context: { ...validDefinition.context, compactAtRatio: 1.2 },
    };

    let captured: unknown;
    try {
      validateDefinition(invalid);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(DefinitionError);
    if (!(captured instanceof DefinitionError)) {
      throw new Error('Definition validation did not produce DefinitionError');
    }
    expect(captured.problems.length).toBeGreaterThanOrEqual(5);
    expect(captured.problems.map((problem) => problem.path[0])).toContain(
      'model',
    );
  });

  it('rejects authority rules that grant authority', () => {
    const invalid = {
      ...validDefinition,
      policy: {
        ...validDefinition.policy,
        authority: [
          {
            id: 'host-allow',
            match: {},
            outcome: 'allow',
          },
        ],
      },
    };

    expect(() => validateDefinition(invalid)).toThrow(DefinitionError);
  });

  it('rejects replay scope values that contain credential material', () => {
    const recovery = {
      scope: {
        provider: 'p',
        model: 'm',
        endpoint: 'https://user:secret@example.test',
        principal: 'user:secret',
      },
      invalidates: [],
      format: 'provider/v1',
      data: { step: 1 },
    };

    expect(() => validateModelRecovery(recovery)).toThrow(DefinitionError);
    expect(() =>
      validateModelRecovery({
        ...recovery,
        scope: {
          ...recovery.scope,
          endpoint: 'https://alice:s3cr3t@example.test',
          principal: 'principal-1',
        },
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects dangling replay part targets, call-part id mismatches, and non-JSON payloads', () => {
    const entry = {
      id: 'entry-1',
      role: 'model',
      parts: [{ id: 'part-1', content: { kind: 'text', text: 'ok' } }],
      replay: [
        {
          id: 'replay-1',
          scope: {
            provider: 'p',
            model: 'm',
            endpoint: 'local-endpoint',
            principal: 'principal-1',
          },
          format: 'provider/v1',
          target: { kind: 'part', id: 'missing' },
          data: { value: 'plain data' },
        },
      ],
    };

    expect(() => validateTranscriptEntry(entry)).toThrow(DefinitionError);
    expect(() =>
      validateTranscriptEntry({
        id: 'model-entry',
        role: 'model',
        parts: [
          {
            id: 'part-id',
            call: { id: 'call-id', tool: 'builtin/read', args: {} },
          },
        ],
      }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateTranscriptEntry({
        id: 'model-entry',
        role: 'model',
        parts: [{ id: 'part-1', thinking: 'thought' }],
        replay: [
          {
            id: 'same',
            scope: {
              provider: 'p',
              model: 'm',
              endpoint: 'endpoint',
              principal: 'principal',
            },
            format: 'v1',
            target: { kind: 'entry' },
            data: null,
          },
          {
            id: 'same',
            scope: {
              provider: 'p',
              model: 'm',
              endpoint: 'endpoint',
              principal: 'principal',
            },
            format: 'v1',
            target: { kind: 'entry' },
            data: null,
          },
        ],
      }),
    ).toThrow(DefinitionError);
    expect(() => validateJsonValue({ value: () => 1 })).toThrow(
      DefinitionError,
    );
  });

  it('rejects complete reports with missing values, negative values, and cache subtotals above input', () => {
    expect(() =>
      validateUsageReport({ totals: { inputTokens: 1 }, complete: true }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateUsageReport({ totals: { inputTokens: -1 }, complete: false }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateUsageReport({
        totals: { inputTokens: 2, cacheReadInputTokens: 3 },
        complete: false,
      }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateUsageReport({
        totals: {
          inputTokens: 3,
          cacheReadInputTokens: 2,
          cacheWriteInputTokens: 2,
        },
        complete: false,
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects decreasing cumulative usage while merging reports', () => {
    const previous: UsageReport = {
      totals: { inputTokens: 4, outputTokens: 2 },
      complete: false,
    };
    const next: UsageReport = {
      totals: { inputTokens: 3, reasoningTokens: 1 },
      complete: false,
    };

    expect(() => mergeUsageReports(previous, next)).toThrow(DefinitionError);
  });

  it('preserves cumulative counters that a later partial report omits', () => {
    const merged = mergeUsageReports(
      { totals: { inputTokens: 4, outputTokens: 2 }, complete: false },
      { totals: { outputTokens: 3 }, complete: false },
    );

    expect(merged.totals).toStrictEqual({ inputTokens: 4, outputTokens: 3 });
  });

  it('rejects adapter formats outside the adapter supported set', () => {
    expect(() => validateAdapterFormat('provider/v2', ['provider/v1'])).toThrow(
      DefinitionError,
    );
  });

  it('requires trusted shell facts when a tool descriptor declares shell semantics', () => {
    const prepared = { token: 'prepared-1', args: { command: 'echo ok' } };

    expect(() => validatePreparedCall(prepared, 'command')).toThrow(
      DefinitionError,
    );
  });

  it('accepts a prepared shell only when its facts identify the final command segments', () => {
    const prepared: PreparedCall = {
      token: 'prepared-1',
      args: { command: 'echo ok' },
      shell: {
        parsed: true,
        rawCommand: 'echo ok',
        hasRedirection: false,
        policySplit: [{ text: 'echo ok', hasRedirection: false }],
        segments: [
          { command: 'echo ok', argv: ['echo', 'ok'], hasRedirection: false },
        ],
      },
    };

    expect(validatePreparedCall(prepared, 'command')).toStrictEqual(prepared);
  });

  it('preserves the structure of generated JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.stringify(validateJsonValue(value))).toBe(
          JSON.stringify(value),
        );
      }),
    );
  });

  it('preserves own __proto__ keys in JSON objects', () => {
    const value: unknown = JSON.parse('{"__proto__":{"value":1}}');

    expect(JSON.stringify(validateJsonValue(value))).toBe(
      '{"__proto__":{"value":1}}',
    );
  });

  it('rejects every generated negative output-token counter', () => {
    fc.assert(
      fc.property(fc.integer({ max: -1 }), (outputTokens) => {
        expect(() =>
          validateUsageReport({ totals: { outputTokens }, complete: false }),
        ).toThrow(DefinitionError);
      }),
    );
  });

  it('rejects a complete report when any required counter is absent', () => {
    const counters: ReadonlyArray<keyof Usage> = [
      'inputTokens',
      'outputTokens',
      'reasoningTokens',
      'cacheReadInputTokens',
      'cacheWriteInputTokens',
    ];
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    };

    fc.assert(
      fc.property(fc.constantFrom(...counters), (missing) => {
        expect(() =>
          validateUsageReport({
            totals: { ...totals, [missing]: undefined },
            complete: true,
          }),
        ).toThrow(DefinitionError);
      }),
    );
  });

  it('uses the latest generated cumulative input counter exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (first, increment) => {
          const next = first + increment;
          const merged = mergeUsageReports(
            { totals: { inputTokens: first }, complete: false },
            { totals: { inputTokens: next }, complete: false },
          );

          expect(merged.totals.inputTokens).toBe(next);
        },
      ),
    );
  });

  it('rejects generated credential values in replay endpoint URLs', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 32 }), (secret) => {
        expect(() =>
          validateModelRecovery({
            scope: {
              provider: 'provider',
              model: 'model',
              endpoint: `https://model.example/?api-key=${secret}`,
              principal: 'principal-1',
            },
            invalidates: [],
            format: 'provider/v1',
            data: null,
          }),
        ).toThrow(DefinitionError);
      }),
    );
  });

  it('rejects generated duplicate replay envelope identifiers', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 32 }), (id) => {
        expect(() =>
          validateTranscriptEntry({
            id: 'entry-1',
            role: 'model',
            parts: [],
            replay: [
              {
                id,
                scope: {
                  provider: 'provider',
                  model: 'model',
                  endpoint: 'endpoint',
                  principal: 'principal',
                },
                format: 'provider/v1',
                target: { kind: 'entry' },
                data: null,
              },
              {
                id,
                scope: {
                  provider: 'provider',
                  model: 'model',
                  endpoint: 'endpoint',
                  principal: 'principal',
                },
                format: 'provider/v1',
                target: { kind: 'entry' },
                data: null,
              },
            ],
          }),
        ).toThrow(DefinitionError);
      }),
    );
  });

  it('reports authority allow with independent structural definition errors', () => {
    let caught: unknown;
    try {
      validateDefinition({
        ...validDefinition,
        policy: {
          authority: [{ match: {}, outcome: 'allow' }],
          preferences: [],
          sourceStacks: [],
          approvalMode: 'default',
          fallback: 'deny',
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DefinitionError);
    if (!(caught instanceof DefinitionError))
      throw new Error('Expected definition failure');
    expect(
      caught.problems.some(
        (problem) => problem.path.join('.') === 'policy.authority.0.outcome',
      ),
    ).toBe(true);
    expect(
      caught.problems.some(
        (problem) => problem.path.join('.') === 'policy.authority.0.id',
      ),
    ).toBe(true);
    let missingFallback: unknown;
    try {
      validateDefinition({
        ...validDefinition,
        policy: {
          authority: [{ id: 'allow', match: {}, outcome: 'allow' }],
          preferences: [],
          sourceStacks: [],
          approvalMode: 'default',
        },
      });
    } catch (error) {
      missingFallback = error;
    }
    expect(missingFallback).toBeInstanceOf(DefinitionError);
    if (!(missingFallback instanceof DefinitionError))
      throw new Error('Expected definition failure');
    expect(
      missingFallback.problems.some(
        (problem) => problem.path.join('.') === 'policy.authority.0.outcome',
      ),
    ).toBe(true);
    expect(
      missingFallback.problems.some(
        (problem) => problem.path.join('.') === 'policy.fallback',
      ),
    ).toBe(true);
  });

  it('keeps measured usage when a later counter is explicitly undefined and enforces cache subsets', () => {
    const merged = mergeUsageReports(
      { totals: { inputTokens: 5 }, complete: false },
      { totals: { inputTokens: undefined }, complete: false },
    );
    expect(merged.totals.inputTokens).toBe(5);
    expect(() =>
      validateUsageReport({
        totals: {
          inputTokens: 1,
          cacheReadInputTokens: 1,
          cacheWriteInputTokens: 1,
        },
        complete: false,
      }),
    ).toThrow(DefinitionError);
  });

  it('validates credential-bearing URL components while preserving opaque identities', () => {
    for (const endpoint of [
      'https://alice@example.test',
      'https://example.test/?token=abc',
      'https://example.test/?key=abc',
      'https://example.test/?accessToken=abc',
      'https://example.test/#accessToken=abc',
      'https://example.test/?access-token=abc',
      'https://example.test/#ACCESS_TOKEN=abc',
      'https://example.test/#access_token=abc',
      'https://example.test/?client_secret=abc',
    ]) {
      expect(() =>
        validateModelRecovery({
          scope: { provider: 'p', model: 'm', endpoint, principal: 'opaque' },
          invalidates: [],
          format: 'v1',
          data: null,
        }),
      ).toThrow(DefinitionError);
    }
    expect(
      validateModelRecovery({
        scope: {
          provider: 'p',
          model: 'm',
          endpoint: 'https://example.test/path',
          principal: 'secretary-1',
          connection: 'token-opaque',
        },
        invalidates: [],
        format: 'v1',
        data: null,
      }).scope.principal,
    ).toBe('secretary-1');
  });

  it('rejects credential-bearing URLs after WHATWG whitespace normalization', () => {
    for (const endpoint of [
      ' https://user:secret@example.test',
      '\thttps://user:secret@example.test',
      '\nhttps://user:secret@example.test',
      'https://user:\nsecret@example.test',
      '\u0000https://user:secret@example.test\u0020',
    ]) {
      expect(() =>
        validateModelRecovery({
          scope: { provider: 'p', model: 'm', endpoint, principal: 'p1' },
          invalidates: [],
          format: 'v1',
          data: null,
        }),
      ).toThrow(DefinitionError);
    }
  });

  it('checks credential parameters across the full fragment and route query', () => {
    for (const endpoint of [
      'https://example.test/#access_token=abc?state=1',
      'https://example.test/#/callback?access_token=abc',
    ]) {
      expect(() =>
        validateModelRecovery({
          scope: { provider: 'p', model: 'm', endpoint, principal: 'p1' },
          invalidates: [],
          format: 'v1',
          data: null,
        }),
      ).toThrow(DefinitionError);
    }
  });

  it('returns DefinitionError for a definition array with a symbol key', () => {
    const tools = Array(1);
    Object.defineProperty(tools, Symbol('extra'), {
      enumerable: true,
      value: 1,
    });

    expect(() => validateDefinition({ ...validDefinition, tools })).toThrow(
      DefinitionError,
    );
  });

  it('accepts an empty non-command argument in validated shell facts', () => {
    const prepared: PreparedCall = {
      token: 'prepared-1',
      args: { command: "printf '%s' ''" },
      shell: {
        parsed: true,
        rawCommand: "printf '%s' ''",
        hasRedirection: false,
        policySplit: [{ text: "printf '%s' ''", hasRedirection: false }],
        segments: [
          {
            command: "printf '%s' ''",
            argv: ['printf', '%s', ''],
            hasRedirection: false,
          },
        ],
      },
    };
    expect(validatePreparedCall(prepared, 'command').shell?.parsed).toBe(true);
  });

  it('round-trips replay and accounting records through MemorySessionStore', async () => {
    const store = new MemorySessionStore();
    const records: JournalRecord[] = [
      {
        kind: 'entry',
        checkpoint: 'cp-1',
        entry: {
          id: 'entry-1',
          role: 'model',
          parts: [],
          replay: [
            {
              id: 'r1',
              scope: {
                provider: 'p',
                model: 'm',
                endpoint: 'https://example.test',
                principal: 'p1',
              },
              format: 'v1',
              target: { kind: 'entry' },
              data: { n: 1 },
            },
          ],
        },
      },
      {
        kind: 'attempt-budget',
        attempt: 'a1',
        phase: 'settled',
        reported: { totals: { inputTokens: 2 }, complete: false },
        charged: {
          inputTokens: 2,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        estimated: false,
      },
    ];
    const signal = new AbortController().signal;
    await store.append('session-1', records, signal);
    expect(await store.load('session-1', signal)).toStrictEqual(records);
  });
  it('rejects invalid budgets, compaction ratios, and output cap relationships', () => {
    for (const limits of [
      { ...validDefinition.limits, turnTokenBudget: 0 },
      { ...validDefinition.limits, turnCostBudget: 0 },
      { ...validDefinition.limits, turnTimeoutMs: 0 },
      { ...validDefinition.limits, decisionTimeoutMs: 0 },
    ])
      expect(() => validateDefinition({ ...validDefinition, limits })).toThrow(
        DefinitionError,
      );
    for (const compactAtRatio of [0, 1])
      expect(() =>
        validateDefinition({
          ...validDefinition,
          context: { ...validDefinition.context, compactAtRatio },
        }),
      ).toThrow(DefinitionError);
    expect(() =>
      validateDefinition({
        ...validDefinition,
        toolOutput: {
          ...validDefinition.toolOutput,
          maxStepResultBytes: validDefinition.toolOutput.maxResultBytes - 1,
        },
      }),
    ).toThrow(DefinitionError);
  });

  it('rejects full usage when cache counters exceed input tokens', () => {
    expect(() =>
      validateUsage({
        inputTokens: 1,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 0,
      }),
    ).toThrow(DefinitionError);
  });
});
