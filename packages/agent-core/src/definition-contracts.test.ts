/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { MemorySessionStore } from './testing/fake-ports.js';
import {
  AfterModelEffectSchema,
  BeforeModelEffectSchema,
  DefinitionError,
  derivePolicySourceStack,
  normalizePolicyRegex,
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
      BeforeModelEffectSchema,
    );
    expect(result.effective.control.action).toBe('stop');
    expect(result.audit[0]?.status).toBe('process-error');
    expect(() =>
      validateHookEventResult(
        {
          effective: { control: { action: 'continue' }, producers: [] },
          audit: [{ provenance, status: 'success', output: () => undefined }],
        },
        BeforeModelEffectSchema,
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
    expect(
      validateAgentCommand({
        type: 'set-context',
        items: [
          {
            id: 'inline-image',
            source: 'user',
            trust: 'untrusted',
            lifetime: 'session',
            parts: [
              {
                kind: 'image',
                mediaType: 'image/png',
                data: new Uint8Array([1]),
              },
            ],
          },
        ],
      }),
    ).toHaveProperty('items.0.parts.0.data', new Uint8Array([1]));
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
        type: 'set-authority',
        rules: [invalidPatternRule],
      }),
    ).toThrow(DefinitionError);
    const invalidStack = derivePolicySourceStack('invalid-stack', [
      { name: 'invalid-stack', rules: [invalidPatternRule] },
    ]);
    expect(() =>
      validateAgentCommand({
        type: 'set-source-stacks',
        stacks: [invalidStack],
      }),
    ).toThrow(DefinitionError);
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
      disposition: { kind: 'effective' },
      changed: 'change-1',
      aggregate: 'aggregate-1',
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

  it('validates nested policies and accumulates policy semantics with structural errors', () => {
    const invalidRule: PolicyRule = {
      id: 'invalid-regex',
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
      outcome: 'deny',
      priority: 1,
      order: 0,
      provenance: {
        source: 'admin',
        sourceId: 'nested-policy',
        ruleIndex: 0,
        expansionIndex: 0,
      },
    };
    const invalidPolicy = {
      ...validDefinition.policy,
      preferences: [{ name: 'invalid', rules: [invalidRule] }],
    };
    let nestedError: unknown;
    try {
      validateDefinition({
        ...validDefinition,
        subagents: [
          {
            name: 'child',
            instructions: [],
            tools: [],
            policy: invalidPolicy,
            limits: validDefinition.limits,
          },
        ],
      });
    } catch (error) {
      nestedError = error;
    }
    expect(nestedError).toBeInstanceOf(DefinitionError);
    if (!(nestedError instanceof DefinitionError))
      throw new Error('Expected nested policy validation failure');
    expect(
      nestedError.problems.some((problem) =>
        problem.path
          .join('.')
          .includes('subagents.0.policy.preferences.0.rules.0'),
      ),
    ).toBe(true);

    let combinedError: unknown;
    try {
      validateDefinition({
        ...validDefinition,
        name: '',
        policy: invalidPolicy,
      });
    } catch (error) {
      combinedError = error;
    }
    expect(combinedError).toBeInstanceOf(DefinitionError);
    if (!(combinedError instanceof DefinitionError))
      throw new Error('Expected combined definition validation failure');
    expect(
      combinedError.problems.some(
        (problem) => problem.path.join('.') === 'name',
      ),
    ).toBe(true);
    expect(
      combinedError.problems.some((problem) =>
        problem.message.includes('sourceId=nested-policy'),
      ),
    ).toBe(true);
  });

  it('accepts native normalized effective regex sources and rejects unnormalized evidence', () => {
    const normalized = normalizePolicyRegex({
      path: 'directory-commandRegex',
      text: '/',
    });
    const rule: PolicyRule = {
      id: 'slash-command',
      match: { args: [{ serializedArgs: normalized }] },
      outcome: 'deny',
      priority: 1,
      order: 0,
      provenance: {
        source: 'admin',
        sourceId: 'slash-source',
        ruleIndex: 0,
        expansionIndex: 0,
      },
    };
    const definition = {
      ...validDefinition,
      policy: {
        ...validDefinition.policy,
        preferences: [{ name: 'slash', rules: [rule] }],
      },
    };
    expect(
      validateDefinition(definition).policy.preferences[0]?.rules[0]?.id,
    ).toBe('slash-command');
    expect(() =>
      validateDefinition({
        ...definition,
        policy: {
          ...definition.policy,
          preferences: [
            {
              name: 'slash',
              rules: [
                {
                  ...rule,
                  match: {
                    args: [
                      {
                        serializedArgs: {
                          ...normalized,
                          source: normalized.source.replaceAll('\\/', '/'),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(DefinitionError);
  });

  it('accepts optional command IDs on every closed variant and rejects unrelated keys', () => {
    const stack = derivePolicySourceStack('source', []);
    const commands = [
      { type: 'set-model', selection: validDefinition.model },
      { type: 'set-preferences', layers: [], approvalMode: 'default' },
      { type: 'set-authority', rules: [] },
      { type: 'set-source-stacks', stacks: [stack] },
      { type: 'set-limits', limits: validDefinition.limits },
      { type: 'set-mode', mode: 'normal' },
      { type: 'set-instructions', instructions: [] },
      { type: 'set-context', items: [] },
      { type: 'remove-context', ids: [] },
      { type: 'revoke-grant', grant: 'grant-1' },
      { type: 'compact' },
      { type: 'rewind', to: 'checkpoint-1' },
      { type: 'clear' },
    ];

    for (const [index, command] of commands.entries()) {
      const id = `cmd-${index + 1}`;
      expect(validateAgentCommand({ ...command, id })).toHaveProperty('id', id);
      expect(validateAgentCommand(command)).not.toHaveProperty('id');
    }
    expect(() =>
      validateAgentCommand({ id: 'cmd-invalid', type: 'clear', extra: true }),
    ).toThrow(DefinitionError);
  });

  it('round-trips effective and superseded hook-change dispositions', async () => {
    const provenance = {
      id: 'hook-1',
      event: 'after-model',
      source: 'configuration',
      order: 0,
    };
    const records: JournalRecord[] = [
      {
        kind: 'hook-change',
        attempt: 'attempt-1',
        frame: 'frame-1',
        provenance,
        point: 'after-model',
        audit: 'audit-superseded',
        disposition: { kind: 'superseded', by: 'hook-2' },
        changed: 'change-superseded',
        aggregate: 'aggregate-1',
        invalidatedReplay: [],
      },
      {
        kind: 'hook-change',
        attempt: 'attempt-1',
        frame: 'frame-1',
        provenance: { ...provenance, id: 'hook-2', order: 1 },
        point: 'after-model',
        audit: 'audit-effective',
        disposition: { kind: 'effective' },
        changed: 'change-effective',
        aggregate: 'aggregate-1',
        invalidatedReplay: [{ entry: 'entry-1', replay: 'replay-1' }],
      },
      {
        kind: 'hook-change',
        attempt: 'attempt-2',
        frame: 'frame-2',
        provenance,
        point: 'after-model',
        audit: 'audit-before-stop',
        disposition: { kind: 'retained-on-terminal', control: 'stop' },
        changed: 'change-terminal',
        aggregate: 'aggregate-2',
        invalidatedReplay: [],
      },
    ];
    const afterModel = validateHookEventResult(
      {
        effective: {
          control: { action: 'continue' },
          value: { replacement: { parts: [] } },
          producers: [
            {
              path: 'replacement',
              provenance: { ...provenance, id: 'hook-2', order: 1 },
            },
          ],
        },
        audit: [
          {
            provenance,
            status: 'success',
            output: { replacement: { parts: [{ text: 'superseded' }] } },
          },
          {
            provenance: { ...provenance, id: 'hook-2', order: 1 },
            status: 'success',
            output: { replacement: { parts: [] } },
          },
        ],
      },
      AfterModelEffectSchema,
    );
    expect(afterModel.effective.producers[0]?.provenance.id).toBe('hook-2');
    expect(afterModel.audit).toHaveLength(2);
    expect(
      records[0]?.kind === 'hook-change' && records[0].disposition,
    ).toStrictEqual({
      kind: 'superseded',
      by: 'hook-2',
    });
    expect(records[1]?.kind === 'hook-change' && records[1].audit).toBe(
      'audit-effective',
    );
    expect(
      records[1]?.kind === 'hook-change' && records[1].invalidatedReplay,
    ).toContainEqual({
      entry: 'entry-1',
      replay: 'replay-1',
    });
    const store = new MemorySessionStore();
    const signal = new AbortController().signal;
    await store.append('session-1', records, signal);
    expect(await store.load('session-1', signal)).toStrictEqual(records);
  });

  it('retains exact source-frame metadata, zero measured usage, and typed request selection fixtures', () => {
    const frame: HookModelResponse = {
      parts: [
        {
          value: { id: 'thinking-1', thinking: 'AB' },
          accumulation: 'replace',
          stream: { id: 'stream-1', status: 'complete' },
          hookFields: { format: 'provider/v1', data: { signature: 'opaque' } },
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
    const request = validateHookRequestPatch({
      boundary: { status: 'valid', boundary: { pendingMessageStartIndex: 1 } },
      model: { provider: 'provider', model: 'selected' },
      toolIds: ['tool/read'],
      toolChoice: { mode: 'required', allowedToolIds: ['tool/read'] },
    });
    expect(request.toolChoice?.mode).toBe('required');
    expect(validateHookModelResponse(frame)).toStrictEqual(frame);
    expect(() =>
      validateHookModelResponse({
        ...frame,
        parts: [
          { ...frame.parts[0], hookFields: { format: 'v1', data: () => 1 } },
        ],
      }),
    ).toThrow(DefinitionError);
  });
});
