/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @requirement:REQ-017
 *
 * Behavioral unit tests for the pure agentBootstrap helper functions. Each test
 * drives the REAL production function and asserts on its REAL return value /
 * state transition (no mock theater). The functions are re-exported through a
 * helper module so this consumer spec performs no deep import itself.
 *
 * Covers:
 * - resolveAuthType: the four key-bearing fields each force authMethod
 *   'provider'; apiKey/baseUrl pass through; bare/empty auth → all undefined.
 * - generateRuntimeId: fresh, unique, 'agent-'-prefixed ids.
 * - drainToResult: per-event-type accumulation (text concat, tool-call collect,
 *   done.reason, usage from done.finished AND from a usage event, error event),
 *   and that unrelated event types are ignored.
 * - buildAgentResult: error and usage are INDEPENDENT optional surfaces.
 * - buildProviderInfos / buildToolInfos: name/configured/source/server/enabled
 *   projection with mcp-vs-builtin discrimination.
 * - deriveDisplayCallbacks: undefined passthrough, selective field copying.
 * - wrapApprovalHandler: maps request fields, applies '' fallbacks for missing
 *   id/name, returns {outcome}.
 * - recordOwnership: default flags + sessionLocks default.
 */

import { describe, it, expect } from 'vitest';
import type {
  AgentEvent,
  AgentToolCall,
  ProviderInfo,
  ToolInfo,
} from '@vybestack/llxprt-code-agents';
import {
  resolveAuthType,
  generateRuntimeId,
  drainToResult,
  buildAgentResult,
  buildProviderInfos,
  buildToolInfos,
  deriveDisplayCallbacks,
  recordOwnership,
  AgentBootstrapError,
  runWrapSchedulerFactory,
  runWrapApprovalHandler,
  makeConfirmationRequest,
  toPartListUnion,
  ToolConfirmationOutcome,
} from './helpers/bootstrapProbe.js';

async function* fromEvents(
  events: readonly AgentEvent[],
): AsyncIterable<AgentEvent> {
  for (const e of events) {
    yield e;
  }
}

describe('Agent bootstrap helpers @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001 @requirement:REQ-003', () => {
  describe('resolveAuthType @requirement:REQ-001', () => {
    it('returns all-undefined when auth is undefined @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const r = resolveAuthType(undefined);
      expect(r.authMethod).toBeUndefined();
      expect(r.apiKey).toBeUndefined();
      expect(r.baseUrl).toBeUndefined();
    });

    it('returns authMethod undefined when auth carries only a baseUrl (no key material) @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const r = resolveAuthType({ baseUrl: 'https://api.example' });
      expect(r.authMethod).toBeUndefined();
      expect(r.baseUrl).toBe('https://api.example');
      expect(r.apiKey).toBeUndefined();
    });

    it("sets authMethod 'provider' and passes apiKey through when apiKey is present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001", () => {
      const r = resolveAuthType({ apiKey: 'sk-123' });
      expect(r.authMethod).toBe('provider');
      expect(r.apiKey).toBe('sk-123');
    });

    it("sets authMethod 'provider' when only apiKeyFile is present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001", () => {
      const r = resolveAuthType({ apiKeyFile: '/keys/openai' });
      expect(r.authMethod).toBe('provider');
      expect(r.apiKey).toBeUndefined();
    });

    it("sets authMethod 'provider' when only keyName is present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001", () => {
      const r = resolveAuthType({ keyName: 'work' });
      expect(r.authMethod).toBe('provider');
    });

    it("sets authMethod 'provider' when only perProvider is present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001", () => {
      const r = resolveAuthType({ perProvider: { openai: { apiKey: 'x' } } });
      expect(r.authMethod).toBe('provider');
    });

    it('passes baseUrl through alongside key material @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const r = resolveAuthType({
        apiKey: 'sk-9',
        baseUrl: 'https://proxy.example',
      });
      expect(r.authMethod).toBe('provider');
      expect(r.apiKey).toBe('sk-9');
      expect(r.baseUrl).toBe('https://proxy.example');
    });
  });

  describe('AgentBootstrapError @requirement:REQ-001', () => {
    it("carries the message and a name of 'AgentBootstrapError', and is an Error @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001", () => {
      const err = new AgentBootstrapError('cannot bootstrap');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AgentBootstrapError);
      expect(err.message).toBe('cannot bootstrap');
      expect(err.name).toBe('AgentBootstrapError');
    });
  });

  describe('wrapSchedulerFactory @requirement:REQ-016', () => {
    it('returns the REAL scheduler while invoking the caller factory with the session id and retaining its handle @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-016', () => {
      const r = runWrapSchedulerFactory({ sessionId: 'sess-42' });
      expect(r.returnedScheduler).toStrictEqual({ kind: 'real-scheduler' });
      expect(r.observedSessionId).toBe('sess-42');
      expect(r.retainedHandles).toHaveLength(1);
    });

    it('forwards interactiveMode to the caller factory when present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-016', () => {
      const r = runWrapSchedulerFactory({
        sessionId: 'sess-i',
        toolContextInteractiveMode: true,
      });
      expect(r.interactiveModeForwarded).toBe(true);
      expect(r.observedInteractiveMode).toBe(true);
    });

    it('omits interactiveMode from the caller factory context when undefined @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-016', () => {
      const r = runWrapSchedulerFactory({ sessionId: 'sess-n' });
      expect(r.interactiveModeForwarded).toBe(false);
      expect(r.observedInteractiveMode).toBeUndefined();
    });
  });

  describe('generateRuntimeId @requirement:REQ-001', () => {
    it("produces 'agent-'-prefixed, unique ids @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001", () => {
      const a = generateRuntimeId();
      const b = generateRuntimeId();
      expect(a.startsWith('agent-')).toBe(true);
      expect(b.startsWith('agent-')).toBe(true);
      expect(a).not.toBe(b);
      // the suffix after 'agent-' is a non-empty UUID-ish token
      expect(a.length).toBeGreaterThan('agent-'.length);
    });
  });

  describe('drainToResult @requirement:REQ-003', () => {
    it('concatenates text in order and collects tool-calls @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const call: AgentToolCall = { id: 'c1', name: 'read_file', args: {} };
      const drained = await drainToResult(
        fromEvents([
          { type: 'text', text: 'Hello ' },
          { type: 'tool-call', call },
          { type: 'text', text: 'World' },
          { type: 'done', reason: 'stop' },
        ]),
      );
      expect(drained.text).toBe('Hello World');
      expect(drained.toolCalls).toHaveLength(1);
      expect(drained.toolCalls[0]).toBe(call);
      expect(drained.finishReason).toBe('stop');
    });

    it('takes finishReason from the done event reason @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const drained = await drainToResult(
        fromEvents([{ type: 'done', reason: 'max-turns' }]),
      );
      expect(drained.finishReason).toBe('max-turns');
    });

    it('defaults finishReason to stop when no done event arrives @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const drained = await drainToResult(
        fromEvents([{ type: 'text', text: 'no done' }]),
      );
      expect(drained.finishReason).toBe('stop');
    });

    it('extracts usage from done.finished.usageMetadata @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const usageMeta = { totalTokenCount: 42 };
      const drained = await drainToResult(
        fromEvents([
          {
            type: 'done',
            reason: 'stop',
            finished: { usageMetadata: usageMeta },
          } as AgentEvent,
        ]),
      );
      expect(drained.usage).toStrictEqual(usageMeta);
    });

    it('leaves usage undefined when done.finished has no usageMetadata @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const drained = await drainToResult(
        fromEvents([{ type: 'done', reason: 'stop' }]),
      );
      expect(drained.usage).toBeUndefined();
    });

    it('extracts usage from a usage event @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const usageVal = { promptTokenCount: 10 };
      const drained = await drainToResult(
        fromEvents([
          { type: 'usage', usage: usageVal } as AgentEvent,
          { type: 'done', reason: 'stop' },
        ]),
      );
      expect(drained.usage).toStrictEqual(usageVal);
    });

    it('captures error from an error event @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const err = { message: 'boom' };
      const drained = await drainToResult(
        fromEvents([
          { type: 'error', error: err } as AgentEvent,
          { type: 'done', reason: 'error' },
        ]),
      );
      expect(drained.error).toStrictEqual(err);
      expect(drained.finishReason).toBe('error');
    });

    it('ignores unrelated event types (thinking/notice) without altering result @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', async () => {
      const drained = await drainToResult(
        fromEvents([
          { type: 'notice', message: 'fyi' },
          { type: 'retry' },
          { type: 'text', text: 'kept' },
          { type: 'done', reason: 'stop' },
        ]),
      );
      expect(drained.text).toBe('kept');
      expect(drained.toolCalls).toHaveLength(0);
      expect(drained.error).toBeUndefined();
      expect(drained.usage).toBeUndefined();
    });
  });

  describe('buildAgentResult @requirement:REQ-003', () => {
    it('omits error and usage keys entirely when both are undefined @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', () => {
      const result = buildAgentResult({
        text: 'hi',
        toolCalls: [],
        finishReason: 'stop',
        error: undefined,
        usage: undefined,
      });
      expect(result.text).toBe('hi');
      expect(result.finishReason).toBe('stop');
      expect('error' in result).toBe(false);
      expect('usage' in result).toBe(false);
    });

    it('carries error and usage INDEPENDENTLY when both are present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', () => {
      const result = buildAgentResult({
        text: '',
        toolCalls: [],
        finishReason: 'error',
        error: { code: 'provider_error', message: 'x' },
        usage: {
          promptTokens: 1,
          candidateTokens: 2,
          totalTokens: 3,
          cachedTokens: 0,
          contextWindowSize: 100,
          contextWindowUsed: 3,
          turnCount: 1,
        },
      });
      expect(result.error).toStrictEqual({
        code: 'provider_error',
        message: 'x',
      });
      expect(result.usage?.totalTokens).toBe(3);
    });

    it('includes only usage when error is undefined but usage is present @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-003', () => {
      const result = buildAgentResult({
        text: 'ok',
        toolCalls: [],
        finishReason: 'stop',
        error: undefined,
        usage: {
          promptTokens: 5,
          candidateTokens: 5,
          totalTokens: 10,
          cachedTokens: 0,
          contextWindowSize: 100,
          contextWindowUsed: 10,
          turnCount: 1,
        },
      });
      expect('error' in result).toBe(false);
      expect('usage' in result).toBe(true);
      expect(result.usage?.totalTokens).toBe(10);
    });
  });

  describe('buildProviderInfos @requirement:REQ-017', () => {
    it('projects each provider name and its configured flag from the set @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-017', () => {
      const infos: readonly ProviderInfo[] = buildProviderInfos(
        ['openai', 'gemini', 'anthropic'],
        new Set(['openai', 'anthropic']),
      );
      expect(infos.map((i) => i.name)).toStrictEqual([
        'openai',
        'gemini',
        'anthropic',
      ]);
      expect(infos.find((i) => i.name === 'openai')?.configured).toBe(true);
      expect(infos.find((i) => i.name === 'gemini')?.configured).toBe(false);
      expect(infos.find((i) => i.name === 'anthropic')?.configured).toBe(true);
    });

    it('returns an empty array for no providers @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-017', () => {
      expect(buildProviderInfos([], new Set())).toHaveLength(0);
    });
  });

  describe('buildToolInfos @requirement:REQ-017', () => {
    it('marks tools with a serverName as mcp + carries the server, others as builtin without server @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-017', () => {
      const infos: readonly ToolInfo[] = buildToolInfos(
        [{ name: 'read_file' }, { name: 'remote_query', serverName: 'db' }],
        new Set(['read_file']),
      );
      const builtin = infos.find((i) => i.name === 'read_file');
      const mcp = infos.find((i) => i.name === 'remote_query');

      expect(builtin?.source).toBe('builtin');
      expect('server' in (builtin as object)).toBe(false);
      expect(builtin?.enabled).toBe(true);

      expect(mcp?.source).toBe('mcp');
      expect(mcp?.server).toBe('db');
      expect(mcp?.enabled).toBe(false);
    });
  });

  describe('deriveDisplayCallbacks @requirement:REQ-001', () => {
    it('returns undefined when given undefined @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      expect(deriveDisplayCallbacks(undefined)).toBeUndefined();
    });

    it('copies only the provided callback fields @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const onEditorOpen = (): void => {};
      const cbs = deriveDisplayCallbacks({ onEditorOpen });
      expect(cbs).toBeDefined();
      expect(cbs?.onEditorOpen).toBe(onEditorOpen);
      expect(cbs?.onEditorClose).toBeUndefined();
      expect(cbs?.getPreferredEditor).toBeUndefined();
    });

    it('copies onEditorClose when provided and leaves the others unset @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const onEditorClose = (): void => {};
      const cbs = deriveDisplayCallbacks({ onEditorClose });
      expect(cbs?.onEditorClose).toBe(onEditorClose);
      expect(cbs?.onEditorOpen).toBeUndefined();
      expect(cbs?.getPreferredEditor).toBeUndefined();
    });

    it('does not even define the onEditorOpen/onEditorClose keys when those callbacks are absent @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      // Only getPreferredEditor supplied → the open/close keys must be ABSENT
      // (not present-with-undefined), so consumers can detect "not configured".
      const cbs = deriveDisplayCallbacks({ getPreferredEditor: () => 'nano' });
      expect(cbs).toBeDefined();
      const record = cbs as unknown as Record<string, unknown>;
      expect('onEditorOpen' in record).toBe(false);
      expect('onEditorClose' in record).toBe(false);
    });

    it('does not define getPreferredEditor key when that callback is absent @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const cbs = deriveDisplayCallbacks({ onEditorOpen: () => {} });
      const record = cbs as unknown as Record<string, unknown>;
      expect('getPreferredEditor' in record).toBe(false);
    });

    it('copies all three callbacks when all are provided @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const onEditorOpen = (): void => {};
      const onEditorClose = (): void => {};
      const cbs = deriveDisplayCallbacks({
        getPreferredEditor: () => 'emacs',
        onEditorOpen,
        onEditorClose,
      });
      expect(cbs?.onEditorOpen).toBe(onEditorOpen);
      expect(cbs?.onEditorClose).toBe(onEditorClose);
      expect(cbs?.getPreferredEditor?.()).toBe('emacs');
    });

    it('wraps getPreferredEditor so its value flows through @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      const cbs = deriveDisplayCallbacks({
        getPreferredEditor: () => 'vscode',
      });
      expect(cbs?.getPreferredEditor).toBeDefined();
      expect(cbs?.getPreferredEditor?.()).toBe('vscode');
    });
  });

  describe('toPartListUnion @requirement:REQ-001', () => {
    it('returns a string input unchanged @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      expect(toPartListUnion('hello world')).toBe('hello world');
    });

    it('extracts the text field from a structured input @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      expect(toPartListUnion({ text: 'structured body' })).toBe(
        'structured body',
      );
    });

    it('extracts text from a structured input that also carries a role @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
      expect(toPartListUnion({ text: 'with role', role: 'system' })).toBe(
        'with role',
      );
    });
  });

  describe('wrapApprovalHandler @requirement:REQ-006', () => {
    it('maps request fields onto the simple confirmation and returns {outcome} @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-006', async () => {
      const details = {
        type: 'info',
        title: 'Confirm read',
        prompt: 'Allow reading the file?',
      } as const;
      const { observed, result } = await runWrapApprovalHandler({
        request: makeConfirmationRequest({
          correlationId: 'corr-1',
          toolCall: { id: 'tc-1', name: 'read_file' },
          details,
        }),
        outcome: ToolConfirmationOutcome.ProceedOnce,
      });
      expect(observed.confirmationId).toBe('corr-1');
      expect(observed.toolCallId).toBe('tc-1');
      expect(observed.name).toBe('read_file');
      expect(observed.details).toStrictEqual(details);
      expect(result).toStrictEqual({
        outcome: ToolConfirmationOutcome.ProceedOnce,
      });
    });

    it("applies '' fallbacks when toolCall id and name are absent @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-006", async () => {
      const { observed } = await runWrapApprovalHandler({
        request: makeConfirmationRequest({
          correlationId: 'corr-2',
          toolCall: {},
        }),
        outcome: ToolConfirmationOutcome.Cancel,
      });
      expect(observed.toolCallId).toBe('');
      expect(observed.name).toBe('');
    });
  });

  describe('recordOwnership @requirement:REQ-016', () => {
    it('initialises disposal flags false and defaults sessionLocks to [] @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-016', () => {
      const runtimeHandle = { cleanup: (): void => {} };
      const loopHolder = {};
      const fakeConfig = {} as never;
      const fakeRuntimeState = {} as never;
      const record = recordOwnership({
        runtimeHandle,
        config: fakeConfig,
        messageBus: 'bus',
        loopHolder,
        runtimeState: fakeRuntimeState,
        injectedSchedulerHandles: [],
      });
      expect(record.disposed).toBe(false);
      expect(record.lspShutDown).toBe(false);
      expect(record.extensionsDisposed).toBe(false);
      expect(record.sessionLocksReleased).toBe(false);
      expect(record.sessionLocks).toStrictEqual([]);
      expect(record.runtimeHandle).toBe(runtimeHandle);
      expect(record.messageBus).toBe('bus');
    });

    it('retains a provided sessionLocks array verbatim @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-016', () => {
      const locks = [{ release: (): void => {} }];
      const record = recordOwnership({
        runtimeHandle: { cleanup: (): void => {} },
        config: {} as never,
        messageBus: undefined,
        loopHolder: {},
        runtimeState: {} as never,
        injectedSchedulerHandles: [],
        sessionLocks: locks,
      });
      expect(record.sessionLocks).toBe(locks);
    });
  });
});
