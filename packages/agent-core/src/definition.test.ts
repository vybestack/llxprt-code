/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  DefinitionError,
  mergeUsageReports,
  validateAdapterFormat,
  validateDefinition,
  validateJsonValue,
  validateModelRecovery,
  validatePreparedCall,
  validateTranscriptEntry,
  validateUsageReport,
  type AfterTurnView,
  type AgentDefinition,
  type PreparedCall,
  type Usage,
  type UsageReport,
} from '../index.js';
const packageDirectory = dirname(
  fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
);
const invalidTypeFixturePath = fileURLToPath(
  new URL('../type-fixtures/invalid-contract.ts', import.meta.url),
);

const validDefinition: AgentDefinition = {
  name: 'assistant',
  instructions: [],
  model: {
    primary: { ref: { provider: 'local', model: 'test' }, parameters: {} },
    fallbacks: [],
    fallbackOn: [],
  },
  tools: [],
  policy: { authority: [], preferences: [], fallback: 'deny' },
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

describe('validateDefinition', () => {
  it('accepts a complete definition without filling in defaults', () => {
    const parsed = validateDefinition(validDefinition);
    expect(parsed).toStrictEqual(validDefinition);
  });

  it('reports every malformed or missing definition field together', () => {
    const invalid = {
      ...validDefinition,
      name: '',
      model: undefined,
      limits: { maxStepsPerTurn: -1, maxParallelChildren: 0, hidden: true },
      context: { ...validDefinition.context, compactAtRatio: 1.2 },
      hostOnly: () => 'not data',
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
    expect(captured.problems.length).toBeGreaterThanOrEqual(6);
    expect(captured.problems.map((problem) => problem.path[0])).toContain(
      'model',
    );
    expect(
      captured.problems.some((problem) => problem.message.includes('hostOnly')),
    ).toBe(true);
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
        command: 'echo ok',
        segments: [
          { command: 'echo ok', argv: ['echo', 'ok'], hasRedirection: false },
        ],
      },
    };

    expect(validatePreparedCall(prepared, 'command')).toStrictEqual(prepared);
  });

  it('keeps after-turn continuation input to a plain read-only result view', () => {
    const view: AfterTurnView = {
      result: {
        outcome: 'done',
        finalText: 'finished',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        checkpoint: 'checkpoint-1',
        droppedSteers: 0,
      },
      continuationPass: 0,
      thinkingOnly: false,
      tools: [],
    };

    expect(Object.keys(view)).toStrictEqual([
      'result',
      'continuationPass',
      'thinkingOnly',
      'tools',
    ]);
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

  it(
    'rejects the negative public-contract compilation fixture',
    { timeout: 30_000 },
    () => {
      const configPath = fileURLToPath(
        new URL('../tsconfig.json', import.meta.url),
      );
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        packageDirectory,
      );
      const program = ts.createProgram({
        rootNames: [invalidTypeFixturePath],
        options: { ...parsed.options, noEmit: true },
        projectReferences: parsed.projectReferences,
      });
      const codes = ts
        .getPreEmitDiagnostics(program)
        .filter(
          (diagnostic) => diagnostic.file?.fileName === invalidTypeFixturePath,
        )
        .map((diagnostic) => diagnostic.code);

      expect(codes).toContain(2353);
      expect(codes).toContain(2322);
    },
  );
});
