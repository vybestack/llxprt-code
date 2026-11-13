/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { MemorySessionStore } from './testing/fake-ports.js';
import {
  DefinitionError,
  derivePolicySourceStack,
  validateAgentCommand,
  validateDefinition,
  validateHookEventResult,
  validateHookModelResponse,
  validateHookRequestPatch,
  validateImportNotice,
  validateImportedHistoryRecord,
  validateModelToolChoice,
  validateStoreError,
  validateToolDescriptor,
  type HookModelResponse,
  type ImportNotice,
  type JournalRecord,
  type ModelToolChoice,
  type PolicyLayer,
  type PolicyRule,
  type ToolDescriptor,
} from '../index.js';
import { validDefinition } from '../type-fixtures/definition-fixtures.js';

describe('P01a agent-core contracts', () => {
  it('compiles every serialized policy regex and reports provenance for every invalid pattern', () => {
    const policyRule = (
      id: string,
      source: string,
      ruleIndex: number,
    ): PolicyRule => ({
      id,
      match: {
        args: [
          {
            serializedArgs: {
              flavor: 'ecmascript',
              source,
              flags: '',
              input: { path: 'direct', source, flags: '' },
            },
          },
        ],
      },
      outcome: 'deny',
      priority: 1,
      order: ruleIndex,
      provenance: {
        source: 'admin',
        sourceId: `source-${id}`,
        ruleIndex,
        expansionIndex: 0,
      },
    });
    let caught: unknown;
    try {
      validateDefinition({
        ...validDefinition,
        policy: {
          ...validDefinition.policy,
          preferences: [
            {
              name: 'rules',
              rules: [
                policyRule('invalid-one', '[', 4),
                policyRule('invalid-two', '(', 7),
              ],
            },
          ],
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DefinitionError);
    if (!(caught instanceof DefinitionError))
      throw new Error('Expected invalid regex definitions');
    expect(caught.problems).toHaveLength(2);
    expect(caught.problems.map((problem) => problem.message)).toStrictEqual([
      expect.stringContaining('sourceId=source-invalid-one ruleIndex=4'),
      expect.stringContaining('sourceId=source-invalid-two ruleIndex=7'),
    ]);
  });

  it('validates pinned policy identity as a closed descriptor value', () => {
    const descriptor: ToolDescriptor = {
      id: 'mcp:literal*name',
      description: 'tool',
      inputSchema: {},
      policyIdentity: { name: 'literal*name', server: 'mcp' },
      effects: ['read'],
      concurrency: 'parallel',
    };
    expect(validateToolDescriptor(descriptor).policyIdentity).toStrictEqual({
      name: 'literal*name',
      server: 'mcp',
    });
    for (const policyIdentity of [
      undefined,
      { name: '' },
      { name: 'tool', server: 2 },
    ]) {
      expect(() =>
        validateToolDescriptor({ ...descriptor, policyIdentity }),
      ).toThrow(DefinitionError);
    }
  });

  it('validates hook response metadata without treating hook fields as replay data', () => {
    const response: HookModelResponse = {
      parts: [
        {
          value: { id: 'part-1', thinking: 'snapshot' },
          accumulation: 'replace',
          stream: { id: 'thinking-1', status: 'complete' },
          hookFields: { format: 'host/v1', data: { signature: 'opaque' } },
        },
      ],
      finishReason: 'stop',
      rawStopReason: 'end_turn',
      declaredUsage: {
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
        complete: true,
      },
    };
    expect(validateHookModelResponse(response)).toStrictEqual(response);
    expect(() =>
      validateHookModelResponse({
        ...response,
        parts: [
          {
            ...response.parts[0],
            hookFields: { format: 'host/v1', data: () => undefined },
          },
        ],
      }),
    ).toThrow(DefinitionError);
  });

  it('retains import notice guidance in a closed value type', () => {
    const notice: ImportNotice = {
      code: 'indeterminate-effect',
      sourceSequence: 12,
      call: 'call-1',
      message: 'The old recording cannot prove whether this call completed.',
    };
    expect(validateImportNotice(notice)).toStrictEqual(notice);
    expect(() =>
      validateImportNotice({ ...notice, code: 'grant-restored' }),
    ).toThrow(DefinitionError);
  });
  it('validates exact request boundaries and all model tool-choice modes', () => {
    expect(
      validateHookRequestPatch({
        boundary: { status: 'absent' },
        toolChoice: { mode: 'none', allowedToolIds: [] },
      }).boundary.status,
    ).toBe('absent');
    expect(
      validateHookRequestPatch({
        boundary: {
          status: 'valid',
          boundary: { pendingMessageStartIndex: 2, pendingMessageCount: 1 },
        },
        messages: [],
        toolIds: ['tool/read'],
      }).toolIds,
    ).toStrictEqual(['tool/read']);
    expect(() =>
      validateHookRequestPatch({
        boundary: { status: 'absent' },
        tools: [{ id: 'tool/widen' }],
      }),
    ).toThrow(DefinitionError);
    expect(() =>
      validateHookRequestPatch({
        boundary: {
          status: 'valid',
          boundary: { pendingMessageStartIndex: -1 },
        },
      }),
    ).toThrow(DefinitionError);
    expect(
      validateHookRequestPatch({
        boundary: { status: 'malformed', onInvalidBoundary: 'throw' },
      }).boundary.status,
    ).toBe('malformed');
    const modes: ReadonlyArray<ModelToolChoice['mode']> = [
      'auto',
      'required',
      'none',
    ];
    for (const mode of modes)
      expect(validateModelToolChoice({ mode }).mode).toBe(mode);
    expect(() =>
      validateModelToolChoice({ mode: 'required', unexpected: true }),
    ).toThrow(DefinitionError);
  });

  it('validates effective hook output separately from ordered audit', () => {
    const provenance = {
      id: 'hook',
      event: 'before-model',
      source: 'config',
      order: 0,
    };
    const result = validateHookEventResult(
      {
        effective: {
          control: { action: 'stop', reason: 'complete' },
          value: { request: { boundary: { status: 'absent' } } },
          producers: [{ path: 'control', provenance }],
        },
        audit: [
          {
            provenance,
            status: 'process-error',
            output: { denied: true },
            diagnostic: 'exit status 2',
          },
        ],
      },
      z.unknown(),
    );
    expect(result.effective.control.action).toBe('stop');
    expect(result.audit[0]?.status).toBe('process-error');
    expect(() =>
      validateHookEventResult(
        {
          effective: { control: { action: 'continue' }, producers: [] },
          audit: [{ provenance, status: 'success', output: () => undefined }],
        },
        z.unknown(),
      ),
    ).toThrow(DefinitionError);
  });

  it('validates atomic policy commands and imported history records', () => {
    const rule: PolicyRule = {
      id: 'deny-file',

      match: { tools: ['read'] },
      outcome: 'deny',
      priority: 3,
      order: 0,
      provenance: {
        source: 'admin',
        sourceId: 'admin',
        ruleIndex: 0,
        expansionIndex: 0,
      },
    };
    const sourcePreferences: readonly PolicyLayer[] = [
      { name: 'admin', rules: [rule] },
    ];
    const stack = derivePolicySourceStack('admin', sourcePreferences);
    expect(
      validateAgentCommand({ type: 'set-source-stacks', stacks: [stack] }).type,
    ).toBe('set-source-stacks');
    const invalidPatternRule: PolicyRule = {
      ...rule,
      match: {
        args: [
          {
            serializedArgs: {
              flavor: 'ecmascript',
              source: '[',
              flags: '',
              input: { path: 'direct', source: '[', flags: '' },
            },
          },
        ],
      },
      provenance: { ...rule.provenance, sourceId: 'invalid-command-source' },
    };
    let commandError: unknown;
    try {
      validateAgentCommand({
        type: 'set-preferences',
        layers: [{ name: 'invalid', rules: [invalidPatternRule] }],
        approvalMode: 'default',
      });
    } catch (error) {
      commandError = error;
    }
    expect(commandError).toBeInstanceOf(DefinitionError);
    if (!(commandError instanceof DefinitionError))
      throw new Error('Expected command regex validation failure');
    expect(commandError.problems[0]?.message).toContain(
      'sourceId=invalid-command-source',
    );
    expect(() =>
      validateAgentCommand({
        type: 'set-source-stacks',
        stacks: [{ ...stack, restrictions: [] }],
      }),
    ).toThrow(DefinitionError);
    expect(
      validateAgentCommand({
        type: 'set-preferences',
        layers: [],
        approvalMode: 'yolo',
      }),
    ).toStrictEqual({
      type: 'set-preferences',
      layers: [],
      approvalMode: 'yolo',
    });
    const imported: Extract<JournalRecord, { kind: 'imported-history' }> = {
      kind: 'imported-history',
      sourceDigest: 'sha256:record',
      format: 'legacy/v1',
      notices: [
        { code: 'grants-dropped', message: 'Old grants were discarded.' },
      ],
    };
    expect(validateImportedHistoryRecord(imported)).toStrictEqual(imported);
    expect(
      validateStoreError({
        kind: 'import-required',
        message: 'Run llxprt sessions import <old-file>.',
      }).kind,
    ).toBe('import-required');
  });

  it('round-trips after-model replacement with every invalidated replay identifier', async () => {
    const record: JournalRecord = {
      kind: 'hook-change',
      attempt: 'attempt-1',
      frame: 'frame-1',
      provenance: {
        id: 'hook-1',
        event: 'after-model',
        source: 'configuration',
        order: 0,
      },
      point: 'after-model',
      audit: 'audit-1',
      invalidatedReplay: [
        { entry: 'entry-1', replay: 'replay-1' },
        { entry: 'entry-2', replay: 'replay-2' },
      ],
    };
    const store = new MemorySessionStore();
    const signal = new AbortController().signal;

    await store.append('session-1', [record], signal);
    expect(await store.load('session-1', signal)).toStrictEqual([record]);
    expect(record.invalidatedReplay).toHaveLength(2);
  });
});
