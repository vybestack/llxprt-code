/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral boundary tests for issue #3473 remediation finding F2: raw
 * token-delta timing must travel to the AttemptRecorder without ever
 * affecting consumer-visible output or retry / empty-stream / timeout /
 * load-balancer content semantics.
 *
 * The raw stream under every fake provider here is the REAL production
 * processStreamingResponse output, and the raw-timing notifier is wired from
 * GenerateChatOptions metadata exactly the way the production provider wires
 * it. The retry and load-balancer layers are the real production classes.
 */

import { describe, it, expect } from 'bun:test';
import OpenAI from 'openai';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { ToolCallPipeline } from '../openai/ToolCallPipeline.js';
import {
  processStreamingResponse,
  type StreamProcessorDeps,
} from '../openai/OpenAIStreamProcessor.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { ProviderManager } from '../ProviderManager.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import { AttemptRecorder } from '../logging/attemptRecorder.js';
import {
  ATTEMPT_LIFECYCLE_KEY,
  resolveRawTokenDeltaNotifier,
  type AttemptLifecycleObserver,
} from '../logging/attemptLifecycle.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WireDelta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string;
};

type WireFinishReason =
  OpenAI.Chat.Completions.ChatCompletionChunk.Choice['finish_reason'];

function makeChunk(
  delta: WireDelta,
  finishReason: WireFinishReason,
  usage?: OpenAI.Chat.Completions.ChatCompletionChunk['usage'],
): OpenAI.Chat.Completions.ChatCompletionChunk {
  const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
    id: 'chunk-test',
    object: 'chat.completion.chunk',
    created: 1000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
  if (usage !== undefined) {
    chunk.usage = usage;
  }
  return chunk;
}

function serverError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

interface RawStreamPlan {
  readonly chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[];
  readonly firstDelayMs?: number;
  readonly interDelayMs?: number;
  readonly errorAfter?: Error;
}

/**
 * Wire the raw-timing notifier with the production resolver from
 * GenerateChatOptions metadata, exactly the way the production provider
 * wires it, so the boundary tests track the real wiring contract.
 */
function makeDeps(
  onRawTokenDelta: (() => void) | undefined,
): StreamProcessorDeps {
  return {
    toolCallPipeline: new ToolCallPipeline(),
    textToolParser: new GemmaToolCallParser(),
    logger: new DebugLogger('llxprt:test:raw-timing-transport'),
    getBaseURL: () => undefined,
    onRawTokenDelta,
  };
}

async function* rawPlanIterator(
  plan: RawStreamPlan,
): AsyncGenerator<
  OpenAI.Chat.Completions.ChatCompletionChunk,
  void,
  undefined
> {
  let first = true;
  for (const chunk of plan.chunks) {
    await sleep(first ? (plan.firstDelayMs ?? 5) : (plan.interDelayMs ?? 5));
    first = false;
    yield chunk;
  }
  if (plan.errorAfter !== undefined) {
    throw plan.errorAfter;
  }
}

/**
 * Minimal provider fake whose stream is the real production
 * processStreamingResponse output over a synthetic raw chunk plan.
 */
function makeRawTimingProvider(
  name: string,
  plans: readonly RawStreamPlan[],
): IProvider & { callCount(): number } {
  let calls = 0;
  const provider: IProvider = {
    name,
    getModels: async () => [],
    getDefaultModel: () => 'test-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({ content: [] }),
    generateChatCompletion(
      contentOrOptions: GenerateChatOptions | IContent[],
    ): AsyncGenerator<IContent, void, unknown> {
      calls++;
      if (calls > plans.length) {
        // Over-retry is a regression: fail loudly instead of replaying the
        // last plan and letting the test pass on a stale stream.
        throw new Error(
          `raw-timing fake provider '${name}' called ${calls} time(s) but only ${plans.length} plan(s) exist`,
        );
      }
      const options: GenerateChatOptions = Array.isArray(contentOrOptions)
        ? { contents: contentOrOptions }
        : contentOrOptions;
      const plan = plans[calls - 1];
      return processStreamingResponse(
        rawPlanIterator(plan),
        'test-model',
        'openai',
        undefined,
        { model: 'test-model', messages: [], stream: true },
        [],
        new OpenAI({ apiKey: 'test-api-key' }),
        undefined,
        undefined,
        makeDeps(resolveRawTokenDeltaNotifier(options.metadata)),
        async function* () {
          yield* [];
        },
      );
    },
  };
  return Object.assign(provider, { callCount: () => calls });
}

function makeRecorder(): AttemptRecorder {
  return new AttemptRecorder({
    providerName: 'raw-timing-transport',
    defaultModelName: 'test-model',
    config: undefined,
    logicalRequestId: 'req-3473-transport',
    wrapperOwned: false,
  });
}

function makeRetryOptions(recorder: AttemptRecorder): GenerateChatOptions {
  return {
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'test' }],
      },
    ],
    metadata: { [ATTEMPT_LIFECYCLE_KEY]: recorder },
  };
}

function makeReasoningChunks(
  count: number,
): OpenAI.Chat.Completions.ChatCompletionChunk[] {
  const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push(makeChunk({ reasoning_content: `thinking step ${i}` }, null));
  }
  return chunks;
}

function makeUnterminatedToolFragmentChunks(
  count: number,
): OpenAI.Chat.Completions.ChatCompletionChunk[] {
  const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push(
      makeChunk(
        {
          tool_calls: [
            {
              index: 0,
              id: 'call_0',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"SF',
              },
            },
          ],
        },
        null,
      ),
    );
  }
  return chunks;
}

function makeFinishChunk(
  outputTokens: number,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return makeChunk({}, 'stop', {
    prompt_tokens: 50,
    completion_tokens: outputTokens,
    total_tokens: 50 + outputTokens,
  });
}

async function collectResults(
  iterator: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const results: IContent[] = [];
  for await (const chunk of iterator) {
    results.push(chunk);
  }
  return results;
}

function collectText(chunks: readonly IContent[]): string {
  let out = '';
  for (const chunk of chunks) {
    for (const block of chunk.blocks) {
      if (block.type === 'text' && 'text' in block) {
        out += block.text;
      }
    }
  }
  return out;
}

function hasNoVisiblePayload(chunk: IContent): boolean {
  return (
    chunk.blocks.length === 0 &&
    chunk.metadata?.usage === undefined &&
    chunk.metadata?.finishReason === undefined &&
    chunk.metadata?.stopReason === undefined
  );
}

function makeFailoverConfig(): LoadBalancingProviderConfig {
  return {
    profileName: 'raw-timing-lb',
    strategy: 'failover',
    subProfiles: [
      {
        name: 'sub1',
        providerName: 'lb-raw-failing',
        modelId: 'm1',
        baseURL: 'https://api.test.com',
        authToken: 'tok1',
      },
      {
        name: 'sub2',
        providerName: 'lb-raw-ok',
        modelId: 'm2',
        baseURL: 'https://api.test.com',
        authToken: 'tok2',
      },
    ],
  };
}

describe('issue #3473 F2: raw timing transport at retry and LB boundaries', () => {
  it('R1: error after raw reasoning deltas is still retried', async () => {
    const provider = makeRawTimingProvider('raw-openai-retry', [
      {
        chunks: makeReasoningChunks(3),
        errorAfter: serverError(500, 'server exploded mid-stream'),
      },
      {
        chunks: [
          makeChunk({ content: 'recovered output' }, null),
          makeFinishChunk(30),
        ],
      },
    ]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 1,
      maxDelayMs: 1,
    });

    const results = await collectResults(
      orchestrator.generateChatCompletion(makeRetryOptions(makeRecorder())),
    );

    // Pre-remediation the timing markers suppressed the retry: the first
    // attempt was treated as "output already yielded" and the 500 propagated.
    expect(provider.callCount()).toBe(2);
    expect(collectText(results)).toContain('recovered output');
    // No bare non-visible chunks reach the consumer.
    expect(results.filter(hasNoVisiblePayload)).toHaveLength(0);
  });

  it('R2a: a stream that yields no chunks at all still triggers empty-stream handling', async () => {
    // Guard for the F2 "bypass empty-stream handling" claim: a zero-output
    // stream must keep producedContent=false so the budget check throws.
    // Empirically, every marker-firing site (reasoning, buffered text,
    // tool-call fragments) has a guaranteed visible terminal emission on
    // completing streams, so a completing "marker-only empty stream" is not
    // reachable in the classic openai path; this guard pins the empty-stream
    // boundary that raw-timing transport must never disturb.
    const provider = makeRawTimingProvider('raw-openai-empty', [
      { chunks: [] },
    ]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 1,
      initialDelayMs: 1,
    });

    await expect(
      collectResults(
        orchestrator.generateChatCompletion(makeRetryOptions(makeRecorder())),
      ),
    ).rejects.toThrow(/no content/);
  });

  it('R2b: fragment-only stream with no finish chunk still yields its terminal tool-call chunk', async () => {
    // Guard: unterminated tool-call fragments normalize to a terminal
    // tool_call block, so the stream counts as produced content (no
    // empty-stream misfire) with or without raw-timing transport.
    const provider = makeRawTimingProvider('raw-openai-fragments', [
      { chunks: makeUnterminatedToolFragmentChunks(2) },
    ]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 1,
      initialDelayMs: 1,
    });

    const results = await collectResults(
      orchestrator.generateChatCompletion(makeRetryOptions(makeRecorder())),
    );

    const toolCallChunks = results.filter((chunk) =>
      chunk.blocks.some((block) => block.type === 'tool_call'),
    );
    expect(toolCallChunks).toHaveLength(1);
    expect(results.filter(hasNoVisiblePayload)).toHaveLength(0);
  });

  it('R3: first-visible-chunk timeout fires when only raw reasoning deltas arrive early', async () => {
    const provider = makeRawTimingProvider('raw-openai-timeout', [
      {
        chunks: [
          ...makeReasoningChunks(1),
          makeChunk({ content: 'late visible output' }, 'stop', {
            prompt_tokens: 50,
            completion_tokens: 20,
            total_tokens: 70,
          }),
        ],
        firstDelayMs: 1,
        interDelayMs: 150,
      },
    ]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 1,
      initialDelayMs: 1,
      streamingTimeoutMs: 40,
    });

    // Pre-remediation the early timing marker satisfied the first-chunk
    // race and the 150ms wait for the first visible chunk never timed out.
    await expect(
      collectResults(
        orchestrator.generateChatCompletion(makeRetryOptions(makeRecorder())),
      ),
    ).rejects.toThrow(/Stream timeout/);
  });

  it('L1: load-balancer failover is not suppressed by raw-timing transport (unwrapped delegate composition)', async () => {
    const failing = makeRawTimingProvider('lb-raw-failing', [
      {
        chunks: makeReasoningChunks(2),
        errorAfter: serverError(500, 'backend exploded mid-stream'),
      },
    ]);
    const ok = makeRawTimingProvider('lb-raw-ok', [
      {
        chunks: [
          makeChunk({ content: 'backup ok' }, null),
          makeFinishChunk(25),
        ],
      },
    ]);
    const settingsService = new SettingsService();
    const providerManager = new ProviderManager({ settingsService });
    providerManager.registerProvider(failing);
    providerManager.registerProvider(ok);
    const lb = new LoadBalancingProvider(makeFailoverConfig(), providerManager);

    let rawDeltas = 0;
    const observer: AttemptLifecycleObserver = {
      onAttemptStart: () => {},
      onAttemptEnd: () => {},
      onRawTokenDelta: () => {
        rawDeltas++;
      },
    };

    // Pre-remediation, in the config-less composition (no logging wrapper
    // between the LB and its RetryOrchestrator delegates) the timing marker
    // counted as yielded backend output, forcing immediate-throw instead of
    // failover, and leaked to the consumer as a bare chunk.
    const results = await collectResults(
      lb.generateChatCompletion({
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'test' }],
          },
        ],
        metadata: { [ATTEMPT_LIFECYCLE_KEY]: observer },
      }),
    );

    // The raw-timing transport actually executed through the LB boundary:
    // the failing backend fired two reasoning deltas before its error and
    // the healthy backend fired one content delta; the empty finish delta
    // fires nothing.
    expect(rawDeltas).toBe(3);
    expect(collectText(results)).toContain('backup ok');
    expect(results.filter(hasNoVisiblePayload)).toHaveLength(0);
  });

  it('L2: load-balancer failover stays intact through the ProviderManager config composition', async () => {
    // Composition guard: ProviderManager constructed with a config wraps
    // delegates in a LoggingProviderWrapper; failover must still reach the
    // healthy backend with raw-timing transport active inside the fake
    // providers. The raw-callback execution assertion lives in L1, which
    // drives the observer explicitly through the LB metadata channel.
    const failing = makeRawTimingProvider('lb-raw-failing', [
      {
        chunks: makeReasoningChunks(2),
        errorAfter: serverError(500, 'backend exploded mid-stream'),
      },
    ]);
    const ok = makeRawTimingProvider('lb-raw-ok', [
      {
        chunks: [
          makeChunk({ content: 'backup ok' }, null),
          makeFinishChunk(25),
        ],
      },
    ]);
    const settingsService = new SettingsService();
    const config: Config = createRuntimeConfigStub(settingsService);
    const providerManager = new ProviderManager({ settingsService, config });
    providerManager.registerProvider(failing);
    providerManager.registerProvider(ok);
    const lb = new LoadBalancingProvider(makeFailoverConfig(), providerManager);

    const results = await collectResults(
      lb.generateChatCompletion({
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'test' }],
          },
        ],
      }),
    );

    expect(collectText(results)).toContain('backup ok');
    expect(results.filter(hasNoVisiblePayload)).toHaveLength(0);
  });
});
