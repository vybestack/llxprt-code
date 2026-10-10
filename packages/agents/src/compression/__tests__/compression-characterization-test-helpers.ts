/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  RuntimePromptEstimateRequest,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';
import { buildHandlerHarness } from './support/handler-harness.js';
export function toStream(rows: readonly IContent[]): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row;
      }
    },
  };
}

export function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    compressionThreshold?: number;
    contextLimit?: number;
  } = {},
): AgentRuntimeContext {
  const state = createAgentRuntimeState({
    runtimeId: 'p26-comp-test',
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

export function textContent(
  speaker: IContent['speaker'],
  text: string,
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export interface CharacterizationHarness {
  historyService: HistoryService;
  performCompression: ReturnType<
    typeof buildHandlerHarness
  >['performCompression'];
  /**
   * Drives the handler's source ladder over the pending-aware snapshot of the
   * history plus `pending`, measuring candidates with `estimateRows` (default:
   * the history service's own estimator).
   */
  enforce: (
    pending: IContent[],
    promptId: string,
    options?: {
      provider?: RuntimeProvider;
      estimateRows?: (rows: IContent[]) => Promise<number>;
      pendingRecoverable?: boolean;
    },
  ) => Promise<IContent[]>;
}

export function buildCharacterizationHarness(
  overrides: {
    compressionThreshold?: number;
    contextLimit?: number;
    generationConfig?: Record<string, unknown>;
    performCompressionResult?: PerformCompressionResult;
  } = {},
): CharacterizationHarness {
  const historyService = new HistoryService();
  const runtimeContext = buildRuntimeContext(historyService, {
    compressionThreshold: overrides.compressionThreshold,
    contextLimit: overrides.contextLimit,
  });
  const harness = buildHandlerHarness(historyService, runtimeContext, {
    generationConfig: overrides.generationConfig,
  });
  harness.performCompression.mockResolvedValue(
    overrides.performCompressionResult ?? PerformCompressionResult.COMPRESSED,
  );
  return {
    historyService,
    performCompression: harness.performCompression,
    enforce: (pending, promptId, options = {}) =>
      enforceProviderSourceForTest(
        harness.handler,
        historyService,
        pending,
        promptId,
        options.provider,
        options.estimateRows,
        options.pendingRecoverable,
      ),
  };
}

export function createPromptTokenizerFactory(): RuntimeTokenizerFactory {
  return {
    getTokenizer: () => undefined,
    estimatePrompt: async (request: RuntimePromptEstimateRequest) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'stateful-enforcement-fixture',
      estimatorVersion: '1',
      assetRevision: 'fixture',
      projectionRevision: request.projectionRevision,
    }),
  };
}

export function amplifiedProjectionLength(
  request: RuntimePromptEstimateRequest,
): number {
  const projection = request.finalizedProjection;
  if (
    typeof projection !== 'object' ||
    projection === null ||
    !('promptText' in projection) ||
    typeof projection.promptText !== 'string'
  ) {
    throw new Error('Expected finalized prompt text');
  }
  return projection.promptText.length * 4;
}

export function createAmplifyingPromptTokenizerFactory(): RuntimeTokenizerFactory {
  return {
    getTokenizer: () => undefined,
    estimatePrompt: async (request) => ({
      count: amplifiedProjectionLength(request),
      method: 'exact',
      family: 'amplified-stateful-fixture',
      estimatorVersion: '1',
      assetRevision: 'fixture',
      projectionRevision: request.projectionRevision,
    }),
  };
}

export type StatefulPromptEstimate = PromptEnvelopeEstimate & {
  readonly incrementalTokens: number;
  readonly transmittedTokens: number;
  readonly retainedBaselineTokens: number;
};

export function recordPreparedEstimate(
  prepared: { readonly estimate: PromptEnvelopeEstimate | null },
  estimates: PromptEnvelopeEstimate[],
): number {
  if (prepared.estimate === null) {
    throw new Error('Responses projection did not produce an estimate');
  }
  estimates.push(prepared.estimate);
  return prepared.estimate.estimatedPromptTokens;
}

export function requireStatefulEstimate(
  estimates: readonly PromptEnvelopeEstimate[],
): StatefulPromptEstimate {
  const estimate = estimates.find(
    (candidate) => candidate.statefulParentUsed === true,
  );
  if (estimate === undefined) {
    throw new Error('Expected a stateful Responses estimate');
  }
  const { incrementalTokens, transmittedTokens, retainedBaselineTokens } =
    estimate;
  if (
    incrementalTokens === undefined ||
    transmittedTokens === undefined ||
    retainedBaselineTokens === undefined
  ) {
    throw new Error('Expected complete stateful Responses accounting');
  }
  return {
    ...estimate,
    incrementalTokens,
    transmittedTokens,
    retainedBaselineTokens,
  };
}

export function requireLastEstimate(
  estimates: readonly PromptEnvelopeEstimate[],
): PromptEnvelopeEstimate {
  return estimates[estimates.length - 1];
}

export function requireContextOverflow(error: unknown): ContextOverflowError {
  if (!(error instanceof ContextOverflowError)) {
    throw new Error('Expected structured local context overflow');
  }
  return error;
}
