/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3507 (follow-up to #3499): load-balancer prompt-envelope estimation
 * parity. Integration wiring of REAL components end to end:
 *
 * - a REAL LoadBalancingProvider whose delegate implements a REAL
 *   projectPromptEnvelope whose estimate (contents tokens + serialized
 *   tool-schema tokens) CHANGES after contents reduction;
 * - the REAL enforcement machinery (real ChatSession CompressionHandler →
 *   real ProviderContentEnforcer → real TopDownTruncationStrategy over a
 *   real HistoryService) attached as the LB compression callback;
 * - the projection-aware seam estimator from
 *   preparePromptEnvelopeAfterEnforcement (issue #3507 AC2).
 *
 * Covered outcomes (conformance evidence for #2643/#2644):
 * - constant tool-schema overhead: the guard trips on the envelope estimate,
 *   the real callback reduces to the guard target, the LB re-check accepts,
 *   and the send succeeds;
 * - growing envelope-vs-contents gap: the callback satisfies its own target
 *   yet the LB's independent re-check fails safely — LoadBalancerContextLimit
 *   Error and NO oversize request reaches the delegate;
 * - AC2 parity: a session under the limit contents-only but over it once
 *   tool schemas are rendered is reduced by the ordinary pre-send ladder
 *   BEFORE the provider call, so the LB guard callback is never invoked.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  createChatSessionRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  LoadBalancerContextLimitError,
  LoadBalancingProvider,
  ProviderManager,
  type CompressionCallback,
  type ResolvedSubProfile,
} from '@vybestack/llxprt-code-providers';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import { computeMarginAdjustedLimit } from '../contextLimitPolicy.js';
import {
  buildMockContentGenerator,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { ChatSession } from '../../core/chatSession.js';
import { preparePromptEnvelopeAfterEnforcement } from '../../core/promptEnvelopeSendSeam.js';

const MODEL = 'test-model';
const HISTORY_MESSAGES = 14;
const MESSAGE_WORDS = 280;
// Session limit for the guard-callback cases: high enough that the attach-time
// pre-send enforce early-returns, isolating the LB guard path (mirrors the
// #3499 failure shape where pre-send enforcement passed and the guard tripped).
const GUARD_CASE_SESSION_LIMIT = 200_000;

interface GuardInfo {
  estimatedTokens: number;
  contextLimit: number;
}

function textContent(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function seedHistory(historyService: HistoryService): void {
  for (let i = 0; i < HISTORY_MESSAGES; i++) {
    historyService.add(
      textContent(
        i % 2 === 0 ? 'human' : 'ai',
        `entry ${String(i).padStart(2, '0')} ${'word '.repeat(MESSAGE_WORDS)}`,
      ),
    );
  }
}

function makePending(): IContent {
  return textContent(
    'human',
    `pending-marker ${'word '.repeat(MESSAGE_WORDS)}`,
  );
}

/**
 * A real tool schema big enough that its serialized form dominates the
 * contents-only/envelope gap (~4.6k chars ≈ 1.1k tokens).
 */
const TOOLSET: ProviderToolset = [
  {
    functionDeclarations: [
      {
        name: 'search',
        description: `tool-schema-payload ${'schema-text '.repeat(300)}`,
        parametersJsonSchema: { type: 'object', properties: {} },
      },
    ],
  },
];

function serializedToolTokens(tools: ProviderToolset | undefined): number {
  if (tools === undefined || tools.length === 0) return 0;
  return Math.ceil(JSON.stringify(tools).length / 4);
}

/** Tokenizer factory whose prompt estimation defers to the projection. */
const tokenizerFactory: RuntimeTokenizerFactory = {
  getTokenizer: () => undefined,
  estimatePrompt: (request) =>
    request.legacyEstimate().then((count) => ({
      count,
      method: 'exact',
      family: 'legacy-unregistered',
      estimatorVersion: 'test-estimate-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    })),
};

/**
 * Real config for the seam's prepareAtSendSeam estimation path: a genuine
 * Config shape (settings-aware, so the delegate's LoggingProviderWrapper
 * normalization works) whose tokenizer factory defers to the projection's
 * legacyEstimate.
 */
const seamConfig = createChatSessionRuntime({}).config;

interface DelegateTransport {
  payloads: IContent[][];
}

/**
 * A real delegate provider whose projection estimates the envelope the next
 * send transmits: contents tokens (measured with the real HistoryService
 * estimator) plus serialized tool-schema tokens. With `growGap`, the
 * tool-overhead grows twice as fast as contents shrink after the first
 * projection — the delegate protocol changing its framing after reduction.
 */
function createProjectingDelegate(options: {
  name: string;
  historyService: HistoryService;
  growGap?: boolean;
}): { provider: IProvider; transport: DelegateTransport } {
  const transport: DelegateTransport = { payloads: [] };
  let baselineContentsTokens: number | null = null;
  const provider: IProvider = {
    name: options.name,
    getModels: () => Promise.resolve([]),
    getDefaultModel: () => MODEL,
    async *generateChatCompletion(
      request: GenerateChatOptions | IContent[],
    ): AsyncGenerator<IContent> {
      transport.payloads.push(
        structuredClone(Array.isArray(request) ? request : request.contents),
      );
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    async projectPromptEnvelope(
      request: GenerateChatOptions,
    ): Promise<PromptEnvelopeProjection> {
      const contentsTokens =
        await options.historyService.estimateTokensForContents(
          request.contents,
          MODEL,
        );
      const toolTokens = serializedToolTokens(request.tools);
      baselineContentsTokens ??= contentsTokens;
      const gapGrowth =
        options.growGap === true
          ? 2 * Math.max(0, baselineContentsTokens - contentsTokens)
          : 0;
      const total = contentsTokens + toolTokens + gapGrowth;
      return {
        model: MODEL,
        protocol: 'openai-chat',
        method: 'chat/completions/v1',
        projectionRevision: 3,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: request.contents,
        legacyEstimate: () => Promise.resolve(total),
      };
    },
  };
  return { provider, transport };
}

function createResolvedSubProfile(providerName: string): ResolvedSubProfile {
  return {
    name: 'primary',
    providerName,
    model: MODEL,
    baseURL: 'https://lb-parity-delegate.example/api',
    authToken: 'test-token',
    authKeyfile: undefined,
    contextWindow: undefined,
    ephemeralSettings: {},
    modelParams: {},
  };
}

function createLoadBalancer(options: {
  contextLimit: number;
  delegate: IProvider;
}): LoadBalancingProvider {
  const settingsService = new SettingsService();
  const providerManager = new ProviderManager({
    settingsService,
    config: createRuntimeConfigStub(settingsService),
  });
  providerManager.setTokenizerFactory(tokenizerFactory);
  providerManager.registerProvider(options.delegate);
  return new LoadBalancingProvider(
    {
      profileName: 'lb-parity-test',
      strategy: 'round-robin',
      contextLimit: options.contextLimit,
      subProfiles: [createResolvedSubProfile(options.delegate.name)],
    },
    providerManager,
  );
}

interface GuardCallbackRecorder {
  guardCalls: GuardInfo[];
}

/**
 * Capture every callback the enforcement machinery attaches to the LB and
 * install a pass-through recorder instead: the LB keeps a working callback
 * (delegating to the real attached one) while guard invocations stay
 * observable.
 */
function recordGuardCallback(lb: LoadBalancingProvider): GuardCallbackRecorder {
  const recorder: GuardCallbackRecorder = { guardCalls: [] };
  const original = lb.setCompressionCallback.bind(lb);
  vi.spyOn(lb, 'setCompressionCallback').mockImplementation(
    (callback: CompressionCallback | null) => {
      if (callback === null) {
        original(null);
        return;
      }
      const inner = callback;
      original(async (contents, guard) => {
        if (guard !== undefined) {
          recorder.guardCalls.push(guard);
        }
        return inner(contents, guard);
      });
    },
  );
  return recorder;
}

async function consume(
  iterable: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * The #3499 session shape: real history, real ChatSession handler with the
 * real enforcement ladder, performCompression pinned to NOOP so the
 * truncation stage does the reduction deterministically.
 */
function createEnforcementSession(options: {
  historyService: HistoryService;
  contextLimit: number;
}): { handler: ChatSession['compressionHandler'] } {
  const runtimeContext = buildRuntimeContext(options.historyService, {
    contextLimit: options.contextLimit,
    compressionThreshold: 0.8,
  });
  const chat = new ChatSession(
    runtimeContext,
    buildMockContentGenerator(),
    {},
    [],
  );
  const handler = chat['compressionHandler'];
  vi.spyOn(handler, 'performCompression').mockImplementation(async () => {
    await Promise.resolve();
    return PerformCompressionResult.NOOP;
  });
  return { handler };
}

describe('LB guard projection parity through real pre-send enforcement (issue #3507)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constant tool-schema overhead: guard trips on the envelope estimate, the real callback reduces to the guard target, the re-check accepts, and the send succeeds', async () => {
    const historyService = new HistoryService();
    seedHistory(historyService);
    await historyService.waitForTokenUpdates();
    const pending = makePending();
    const contents = historyService.getCuratedForProvider([pending]);
    const contentsOnlyTokens = await historyService.estimateTokensForContents(
      contents,
      MODEL,
    );
    const toolTokens = serializedToolTokens(TOOLSET);
    const contextLimit = contentsOnlyTokens + toolTokens - 900;

    const delegate = createProjectingDelegate({
      name: 'constant-overhead-delegate',
      historyService,
    });
    const lb = createLoadBalancer({
      contextLimit,
      delegate: delegate.provider,
    });
    const recorder = recordGuardCallback(lb);
    const { handler } = createEnforcementSession({
      historyService,
      contextLimit: GUARD_CASE_SESSION_LIMIT,
    });

    await handler.enforceProviderContents(
      { contents, pendingContents: [pending] },
      'prompt-3507-constant',
      lb,
    );

    // Precondition: the envelope estimate (tools included) is over the LB
    // limit even though the reduction target below is reachable.
    const projection = await lb.projectPromptEnvelope({
      contents,
      tools: TOOLSET,
      config: seamConfig,
    });
    expect(projection).toBeDefined();
    const envelopeTokens = await projection!.legacyEstimate();
    expect(envelopeTokens).toBe(contentsOnlyTokens + toolTokens);
    expect(envelopeTokens).toBeGreaterThan(contextLimit);

    const chunks = await consume(
      lb.generateChatCompletion({ contents, tools: TOOLSET }),
    );

    // The guard handed its real estimate and limit to the real callback.
    expect(recorder.guardCalls).toStrictEqual([
      { estimatedTokens: envelopeTokens, contextLimit },
    ]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(delegate.transport.payloads).toHaveLength(1);
    const sentTokens = await historyService.estimateTokensForContents(
      delegate.transport.payloads[0],
      MODEL,
    );
    // Reduced to the guard target: contents fit contextLimit minus the
    // constant tool overhead, and strictly less than the original payload.
    expect(sentTokens).toBeLessThanOrEqual(contextLimit - toolTokens);
    expect(sentTokens).toBeLessThan(contentsOnlyTokens);
  });

  it('growing envelope-vs-contents gap: the callback satisfies its own target but the LB re-check fails safely — LoadBalancerContextLimitError and no oversize request reaches the delegate', async () => {
    const historyService = new HistoryService();
    seedHistory(historyService);
    await historyService.waitForTokenUpdates();
    const pending = makePending();
    const contents = historyService.getCuratedForProvider([pending]);
    const contentsOnlyTokens = await historyService.estimateTokensForContents(
      contents,
      MODEL,
    );
    const toolTokens = serializedToolTokens(TOOLSET);
    const contextLimit = contentsOnlyTokens + toolTokens - 900;

    const delegate = createProjectingDelegate({
      name: 'growing-gap-delegate',
      historyService,
      growGap: true,
    });
    const lb = createLoadBalancer({
      contextLimit,
      delegate: delegate.provider,
    });
    const recorder = recordGuardCallback(lb);
    const historyTokensBefore = historyService.getTotalTokens();
    const { handler } = createEnforcementSession({
      historyService,
      contextLimit: GUARD_CASE_SESSION_LIMIT,
    });

    await handler.enforceProviderContents(
      { contents, pendingContents: [pending] },
      'prompt-3507-growing-gap',
      lb,
    );

    let thrown: unknown = undefined;
    const chunks: IContent[] = [];
    try {
      for await (const chunk of lb.generateChatCompletion({
        contents,
        tools: TOOLSET,
      })) {
        chunks.push(chunk);
      }
    } catch (error: unknown) {
      thrown = error;
    }

    // The real callback ran and reduced history to satisfy its internal
    // target (guard facts consumed, history shrank)...
    expect(recorder.guardCalls).toHaveLength(1);
    expect(recorder.guardCalls[0]?.contextLimit).toBe(contextLimit);
    expect(historyService.getTotalTokens()).toBeLessThan(historyTokensBefore);
    // ...yet the delegate's post-reduction envelope estimate grew past the
    // limit, so the LB re-check pins the fail-safe outcome: the structured
    // context-limit error, zero chunks, and the oversize payload never sent.
    expect(thrown).toBeInstanceOf(LoadBalancerContextLimitError);
    expect(chunks).toHaveLength(0);
    expect(delegate.transport.payloads).toHaveLength(0);
  });

  it('AC2 parity: contents-only under the limit but envelope over it — the seam estimator reduces BEFORE the provider call and the LB guard callback is never invoked', async () => {
    const historyService = new HistoryService();
    seedHistory(historyService);
    await historyService.waitForTokenUpdates();
    const pending = makePending();
    const contents = historyService.getCuratedForProvider([pending]);
    const contentsOnlyTokens = await historyService.estimateTokensForContents(
      contents,
      MODEL,
    );
    const toolTokens = serializedToolTokens(TOOLSET);
    // Session limit mirrors production (the LB's effective context limit):
    // contents-only sits under the enforcement threshold while the envelope
    // (tool schemas rendered) is over it.
    const contextLimit = contentsOnlyTokens + toolTokens + 600;
    const marginAdjustedLimit = computeMarginAdjustedLimit(contextLimit);
    expect(contentsOnlyTokens).toBeLessThanOrEqual(marginAdjustedLimit);
    expect(contentsOnlyTokens + toolTokens).toBeGreaterThan(
      marginAdjustedLimit,
    );

    const delegate = createProjectingDelegate({
      name: 'parity-delegate',
      historyService,
    });
    const lb = createLoadBalancer({
      contextLimit,
      delegate: delegate.provider,
    });
    const recorder = recordGuardCallback(lb);
    const { handler } = createEnforcementSession({
      historyService,
      contextLimit,
    });

    const { contents: reduced } = await preparePromptEnvelopeAfterEnforcement({
      provider: lb as unknown as Parameters<
        typeof preparePromptEnvelopeAfterEnforcement
      >[0]['provider'],
      contents,
      buildOptions: (candidate) => ({
        contents: candidate,
        tools: TOOLSET,
        config: seamConfig,
      }),
      enforce: (candidate, estimate) =>
        handler.enforceProviderContents(
          { contents: candidate, pendingContents: [pending] },
          'prompt-3507-parity',
          lb,
          estimate,
        ),
      fallbackEstimate: (candidate) =>
        historyService.estimateTokensForContents(candidate, MODEL),
    });

    const reducedTokens = await historyService.estimateTokensForContents(
      reduced,
      MODEL,
    );
    expect(reducedTokens).toBeLessThan(contentsOnlyTokens);

    const chunks = await consume(
      lb.generateChatCompletion({ contents: reduced, tools: TOOLSET }),
    );

    // The ordinary pre-send ladder already brought the envelope under the
    // limit, so the guard never needed its callback, and the reduced payload
    // is what reached the delegate.
    expect(recorder.guardCalls).toHaveLength(0);
    expect(chunks.length).toBeGreaterThan(0);
    expect(delegate.transport.payloads).toHaveLength(1);
    const sentTokens = await historyService.estimateTokensForContents(
      delegate.transport.payloads[0],
      MODEL,
    );
    expect(sentTokens).toBe(reducedTokens);
  });
});
