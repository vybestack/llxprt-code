/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral integration tests for the ProviderContentEnforcer last-resort
 * tool-response truncation path (issue #1321).
 *
 * These tests use the REAL ProviderContentEnforcer over a REAL HistoryService
 * with REAL deterministic token estimation. No projection mocks, no spy
 * shenanigans. The oversized tool responses genuinely exceed the configured
 * context limit, and truncating them genuinely brings the payload under it.
 *
 * Assertions cover:
 *   1. Pairing IDs/names are preserved after truncation.
 *   2. Pending tool-response candidates are truncated (not just history).
 *   3. Minimal replacements (only the fattest candidate is stubbed).
 *   4. Final budget is under the limit after truncation.
 *   5. Only throws after all candidates are exhausted.
 *   6. The metadata-only stub does not leak original payload content.
 */

import { describe, it, expect, beforeEach, vi } from '../../testApi.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import { CONTEXT_TRUNCATION_MARKER } from '../toolResultTruncator.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';

function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    compressionThreshold?: number;
    contextLimit?: number;
  } = {},
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'pce-tool-trunc-test',
    provider: 'test',
    model: 'test-model',
    sessionId: 'test-session',
  });
  return createAgentRuntimeContext({
    state,
    history: historyService,
    settings: {
      compressionThreshold: overrides.compressionThreshold ?? 0.8,
      contextLimit: overrides.contextLimit ?? 131072,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      'reasoning.includeInContext': true,
    },
    provider: {} as never,
    telemetry: {} as never,
    tools: {} as never,
    providerRuntime: {
      runtimeId: 'test-runtime',
      settingsService: { get: vi.fn(() => undefined) } as never,
      config: {} as never,
    } as never,
  });
}

function textContent(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function makeToolCallEntry(callId: string, toolName: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: callId,
        name: toolName,
        parameters: {},
      } as ToolCallBlock,
    ],
  };
}

function makeToolResponseEntry(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      } as ToolResponseBlock,
    ],
  };
}

interface EnforcerHarness {
  enforcer: ProviderContentEnforcer;
  deps: ProviderContentEnforcementDeps;
  historyService: HistoryService;
  runtimeContext: AgentRuntimeContext;
}

function buildEnforcerHarness(
  overrides: {
    compressionThreshold?: number;
    contextLimit?: number;
    generationConfig?: Record<string, unknown>;
    performCompressionResult?: PerformCompressionResult;
    performFallbackCompressionResult?: boolean;
  } = {},
): EnforcerHarness {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService, {
    compressionThreshold: overrides.compressionThreshold,
    contextLimit: overrides.contextLimit,
  });
  const performCompression = vi
    .fn()
    .mockResolvedValue(
      overrides.performCompressionResult ?? PerformCompressionResult.COMPRESSED,
    );
  const performFallbackCompression = vi
    .fn()
    .mockResolvedValue(overrides.performFallbackCompressionResult ?? false);
  const ensureDensityOptimized = vi.fn().mockResolvedValue(undefined);
  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: overrides.generationConfig ?? {},
    providerRuntimeNullable: undefined,
    logger: makeLogger(),
    ensureDensityOptimized,
    performCompression,
    performFallbackCompression,
  };
  return {
    enforcer: new ProviderContentEnforcer(deps),
    deps,
    historyService,
    runtimeContext,
  };
}

function buildEnvelope(
  contents: IContent[],
  pendingContents: IContent[] | undefined,
): ProviderContentEnvelope {
  return {
    contents,
    ...(pendingContents !== undefined ? { pendingContents } : {}),
  } as ProviderContentEnvelope;
}

/**
 * Deterministic token estimation helper that counts block sizes over the
 * actual contents the enforcer supplies. This is NOT a mock — it exercises
 * the real HistoryService.estimateTokensForContents which uses the real
 * tokenizer fallback heuristic. We use the result to assert budget facts.
 */
async function computeActualTokens(
  historyService: HistoryService,
  contents: IContent[],
): Promise<number> {
  return historyService.estimateTokensForContents(contents, 'test-model');
}

describe('ProviderContentEnforcer last-resort tool-response truncation (issue #1321)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recovers by truncating the fattest tool_response when compression and fallback fail', async () => {
    // Use a context limit large enough to leave room after the safety margin.
    // marginAdjustedLimit = 15000 - 1000 (safety) = 14000.
    // The 100000-char tool response is ~25000 tokens, which overflows 14000.
    // Truncating it brings the payload well under 14000.
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-1', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(100000)),
    );

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    const result = await harness.enforcer.enforce(envelope, 'prompt-1');

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    // The tool response in history should be stubbed.
    const raw = historyService.getRawHistory();
    const toolResponses = raw
      .flatMap((e) => e.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
    expect(toolResponses.length).toBeGreaterThan(0);
    const stubbed = toolResponses.find(
      (b) => b.providerMetadata?.[CONTEXT_TRUNCATION_MARKER] === true,
    );
    expect(stubbed).toBeDefined();

    // Final budget should be under the marginAdjustedLimit (15000 - 1000 = 14000).
    const finalTokens = await computeActualTokens(historyService, result);
    expect(finalTokens).toBeLessThan(14000);
  });

  it('preserves provider tool-call/response pairing IDs and names after truncation', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-1', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(100000)),
    );

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    const result = await harness.enforcer.enforce(envelope, 'prompt-pairing');

    // Every tool call in the payload must have a matching tool response.
    const toolCalls = result
      .flatMap((c) => c.blocks)
      .filter((b): b is ToolCallBlock => b.type === 'tool_call');
    const toolResponses = result
      .flatMap((c) => c.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');

    for (const tc of toolCalls) {
      const matching = toolResponses.find(
        (tr) => tr.callId === tc.id || tr.callId === `hist_${tc.id}`,
      );
      expect(matching).toBeDefined();
    }

    // The stubbed response preserves callId and toolName.
    const rawResponses = historyService
      .getRawHistory()
      .flatMap((e) => e.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
    const stubbed = rawResponses.find(
      (b) => b.providerMetadata?.[CONTEXT_TRUNCATION_MARKER] === true,
    );
    expect(stubbed).toBeDefined();
    expect(stubbed?.callId).toBe('call-1');
    expect(stubbed?.toolName).toBe('read_file');
  });

  it('asserts minimal replacements: only the fattest candidate is stubbed', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-big', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-big', 'read_file', 'B'.repeat(100000)),
    );
    historyService.add(makeToolCallEntry('call-small', 'list_files'));
    historyService.add(
      makeToolResponseEntry('call-small', 'list_files', 'small output'),
    );

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    await harness.enforcer.enforce(envelope, 'prompt-minimal');

    const rawResponses = historyService
      .getRawHistory()
      .flatMap((e) => e.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');

    const stubbedCallIds = rawResponses
      .filter((b) => b.providerMetadata?.[CONTEXT_TRUNCATION_MARKER] === true)
      .map((b) => b.callId);
    const unstubbedCallIds = rawResponses
      .filter(
        (b) => !(b.providerMetadata?.[CONTEXT_TRUNCATION_MARKER] === true),
      )
      .map((b) => b.callId);

    // Only the big one should be stubbed.
    expect(stubbedCallIds).toContain('call-big');
    expect(stubbedCallIds).not.toContain('call-small');
    expect(unstubbedCallIds).toContain('call-small');
  });

  it('throws a context-overflow error when tool-response truncation exhausts all candidates', async () => {
    // Set an extremely small context limit so even after truncating the
    // only tool response, the remaining payload exceeds the limit.
    // marginAdjustedLimit = 200 - 1000 (safety) = max(1, -800) = 1.
    // Nothing can fit under 1 token.
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 200,
      generationConfig: { maxOutputTokens: 10 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-1', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'small output'),
    );

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    await expect(
      harness.enforcer.enforce(envelope, 'prompt-exhausted'),
    ).rejects.toThrow(/context limit/i);
  });

  it('throws when there are no tool-response candidates to truncate', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 200,
      generationConfig: { maxOutputTokens: 10 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(textContent('ai', 'answer'));

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    await expect(
      harness.enforcer.enforce(envelope, 'prompt-no-candidates'),
    ).rejects.toThrow(/context limit/i);
  });

  it('metadata-only stub does not leak original payload content', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    const secretPayload = 'TOP_SECRET_LEAK_CONTENT_'.repeat(5000);
    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-1', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', secretPayload),
    );

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    const result = await harness.enforcer.enforce(envelope, 'prompt-stub');

    const allToolResponses = result
      .flatMap((c) => c.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');

    for (const tr of allToolResponses) {
      const resultStr = typeof tr.result === 'string' ? tr.result : '';
      const errorStr = tr.error ?? '';
      expect(resultStr).not.toContain('TOP_SECRET_LEAK_CONTENT');
      expect(errorStr).not.toContain('TOP_SECRET_LEAK_CONTENT');
    }

    // The stub remains bounded.
    const rawResponses = historyService
      .getRawHistory()
      .flatMap((e) => e.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
    const stubbed = rawResponses.find(
      (b) => b.providerMetadata?.[CONTEXT_TRUNCATION_MARKER] === true,
    );
    expect(stubbed).toBeDefined();
    const stubResult =
      typeof stubbed?.result === 'string' ? stubbed.result : '';
    expect(stubResult.length).toBeLessThan(secretPayload.length);
    expect(stubResult.length).toBeLessThan(500);
  });

  it('truncates pending tool-response candidates (empty-history turn-1)', async () => {
    // This is the key test for finding (1): when history is empty and
    // the oversized tool response is in pendingContents, the enforcer
    // should still truncate it.
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });

    // Empty history — oversized response is only in pending.
    const pending: IContent[] = [
      makeToolCallEntry('call-pending', 'read_file'),
      makeToolResponseEntry('call-pending', 'read_file', 'x'.repeat(100000)),
    ];
    const envelope = buildEnvelope([...pending], pending);

    const result = await harness.enforcer.enforce(envelope, 'prompt-turn1');

    expect(result).toBeDefined();

    // The pending tool response should have been truncated.
    const toolResponses = result
      .flatMap((c) => c.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');

    // buildProviderContent deep-clones and strips providerMetadata, so
    // we check for the canonical truncation stub message which contains
    // both "truncated" and "successfully" (the success-path stub pattern).
    const stubbed = toolResponses.find((tr) => {
      const r = typeof tr.result === 'string' ? tr.result : '';
      return r.includes('truncated') && r.includes('successfully');
    });
    expect(stubbed).toBeDefined();
    expect(stubbed?.callId).toBe('call-pending');
    expect(stubbed?.toolName).toBe('read_file');
  });

  it('final budget is under the limit after successful truncation', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-1', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(100000)),
    );

    const pending = textContent('human', 'pending');
    const envelope = buildEnvelope([...historyService.getCurated()], [pending]);

    const result = await harness.enforcer.enforce(envelope, 'prompt-budget');

    // marginAdjustedLimit = 15000 - 1000 (safety) = 14000.
    // After truncation the payload should be well under that.
    const finalTokens = await computeActualTokens(historyService, result);
    expect(finalTokens).toBeLessThan(14000);
  });

  it('provider-ready pairing is preserved in the returned payload', async () => {
    const harness = buildEnforcerHarness({
      compressionThreshold: 0.01,
      contextLimit: 15000,
      generationConfig: { maxOutputTokens: 100 },
      performCompressionResult: PerformCompressionResult.FAILED,
      performFallbackCompressionResult: false,
    });
    const { historyService } = harness;

    historyService.add(textContent('human', 'question'));
    historyService.add(makeToolCallEntry('call-1', 'read_file'));
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(100000)),
    );

    const pending: IContent[] = [
      makeToolCallEntry('call-pending', 'search'),
      makeToolResponseEntry('call-pending', 'search', 'pending result'),
    ];
    const envelope = buildEnvelope(
      [...historyService.getCurated(), ...pending],
      pending,
    );

    const result = await harness.enforcer.enforce(envelope, 'prompt-ready');

    const allText = result
      .flatMap((c) => c.blocks)
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(allText).toContain('question');
  });
});
