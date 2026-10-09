/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { captureBodyAttempt } from '../lib/body-evidence-writer.js';
import { randomUUID } from 'node:crypto';
import { SettingsService } from '../../packages/settings/src/settings/SettingsService.js';
import { createProviderRuntimeContext } from '../../packages/core/src/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../packages/core/src/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { OpenAIResponsesProvider } from '../../packages/providers/src/openai-responses/OpenAIResponsesProvider.js';
import { AnthropicProvider } from '../../packages/providers/src/anthropic/AnthropicProvider.js';
import { GeminiProvider } from '../../plugins/google-gemini/src/gemini/GeminiProvider.js';
import { RetryOrchestrator } from '../../packages/providers/src/RetryOrchestrator.js';
import { CompressionHandler } from '../../packages/agents/src/compression/CompressionHandler.js';
import { OneShotStrategy } from '../../packages/agents/src/compression/OneShotStrategy.js';
import { buildCompressionMetadata } from '../../packages/agents/src/compression/compressionContextBuilder.js';
import { buildCompressionSystemInstruction } from '../../packages/agents/src/compression/compressionSystemPrompt.js';
import { buildRuntimeContext } from '../../packages/agents/src/core/__tests__/chatSession-density-helpers.js';
import { oneshotRow } from '../../packages/agents/src/compression/__tests__/oneshot-disk-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type { IProvider } from '../../packages/providers/src/IProvider.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { invalidateResponsesStatefulChain } from '../../packages/core/src/services/history/IContent.js';
import { annotateCompressionSpan } from '../../packages/core/src/services/history/historyChronology.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { providerPendingFixture } from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import type { CompressionProviderResult } from '../../packages/core/src/core/compression/types.js';
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';

function networkResponse(provider: string, streaming: boolean): Response {
  const text = '<state_snapshot>kept details</state_snapshot>';
  if (provider === 'openai-responses')
    return new Response(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'summary-fixture', status: 'completed', usage: { input_tokens: 71, output_tokens: 9, total_tokens: 80 } } })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
  const body =
    provider === 'anthropic'
      ? {
          id: 'summary-fixture',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 71, output_tokens: 9 },
        }
      : {
          candidates: [
            {
              content: { role: 'model', parts: [{ text }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 71,
            candidatesTokenCount: 9,
            totalTokenCount: 80,
          },
        };
  if (provider === 'gemini' && streaming)
    return new Response(
      `data: ${JSON.stringify(body)}

`,
      { headers: { 'content-type': 'text/event-stream' } },
    );
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
function providerInstance(name: string): IProvider {
  if (name === 'anthropic') return new AnthropicProvider('test-key');
  if (name === 'gemini') return new GeminiProvider('test-key');
  return new OpenAIResponsesProvider('test-key', 'https://api.openai.com/v1');
}

function summaryModel(name: string): string {
  if (name === 'anthropic') return 'claude-opus-5';
  if (name === 'gemini') return 'gemini-2.5-flash';
  return 'gpt-5.2';
}
function summaryRuntime(
  name: string,
  caching: boolean,
): CompressionProviderResult {
  const settings = new SettingsService();
  settings.set('auth-key', 'test-key');
  settings.set('prompt-caching', caching ? 'on' : 'off');
  settings.setProviderSetting(name, 'model', summaryModel(name));
  settings.setProviderSetting(name, 'streaming', 'disabled');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'summary-body',
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: name,
    ephemeralsSnapshot: {
      'prompt-caching': caching ? 'on' : 'off',
      streaming: 'disabled',
      retries: 2,
      retrywait: 1,
    },
  });
  const provider = new RetryOrchestrator(providerInstance(name), {
    maxAttempts: 2,
    initialDelayMs: 1,
    maxDelayMs: 1,
  });
  const options = createProviderCallOptions({
    providerName: name,
    settings,
    config: runtime.config,
    runtime,
    invocation,
    contents: { async *[Symbol.asyncIterator]() {} },
  });
  return { provider, runtime, invocation, resolved: options.resolved };
}

async function publicationBodies(
  history: HistoryService,
  size: number,
  name: string,
  caching: boolean,
  candidate: readonly IContent[],
  top: number,
): Promise<{ afterActual: string; afterExpected: string }> {
  const raw = Array.from({ length: size }, (_, index) => oneshotRow(index));
  const annotated = annotateCompressionSpan(raw, candidate).map(
    (row, index) => {
      const metadata = { ...row.metadata };
      delete metadata.cacheAnchor;
      if (index === top - 1) metadata.cacheAnchor = true;
      return { ...row, metadata };
    },
  );
  const logger = new DebugLogger('test:real-summary-publication');
  const pending = providerPendingFixture();
  const actual = await recomposeFixture(history, pending);
  const expected = buildProviderContent(
    buildCuratedHistory(
      logger,
      invalidateResponsesStatefulChain(annotated),
      false,
    ),
    pending,
    logger,
  );
  return {
    afterActual: await captureCuratedBody(name, actual, caching, true, true),
    afterExpected: await captureCuratedBody(name, expected, caching),
  };
}

async function summaryPreparation(
  history: HistoryService,
  name: string,
  caching: boolean,
): Promise<{
  context: ReturnType<typeof buildRuntimeContext>;
  metadata: Awaited<ReturnType<typeof buildCompressionMetadata>>;
  resolved: CompressionProviderResult;
  logger: DebugLogger;
}> {
  const resolved = summaryRuntime(name, caching);

  const context = buildRuntimeContext(history, {
    compressionStrategy: 'one-shot',
  });
  await buildCompressionSystemInstruction('test-model', {
    provider: name,
    interactionMode: 'non-interactive',
  });
  const logger = new DebugLogger('test:invoked-summary-bytes');
  const metadata = await buildCompressionMetadata(
    'oracle',
    context,
    history,
    async () => resolved,
    async () => 'finish the experiment',
    () => '/fixture/session.jsonl',
    logger,
  );
  return { context, metadata, resolved, logger };
}

export async function invokedSummaryBodies(
  history: HistoryService,
  size: number,
  name: string,
  caching: boolean,
): Promise<{
  actual: string;
  expected: string;
  attempts: number;
  afterActual: string;
  afterExpected: string;
}> {
  const { context, metadata, resolved, logger } = await summaryPreparation(
    history,
    name,
    caching,
  );
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  const captureId = randomUUID();
  let actualLane = false;
  globalThis.fetch = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (init?.body === undefined)
      throw new Error('Missing actual summary BODY');
    await captureBodyAttempt(bodies, init.body, name, captureId);
    if (actualLane && bodies.length === 2) throw new TypeError('fetch failed');
    const url = _input instanceof Request ? _input.url : String(_input);
    return networkResponse(name, url.includes('streamGenerateContent'));
  };
  try {
    const oracle = await new OneShotStrategy().compress({
      ...metadata,
      history: buildCuratedHistory(
        logger,
        Array.from({ length: size }, (_, index) => oneshotRow(index)),
        false,
      ),
    });
    if (oracle.kind !== 'applied' || bodies.length !== 1)
      throw new Error('Expected a single independent oracle summary call');
    actualLane = true;
    const handler = new CompressionHandler(
      context,
      history,
      {},
      async () => resolved,
      async () => {},
    );
    handler.setActiveTodosProvider(async () => 'finish the experiment');
    handler.setTranscriptPathProvider(() => '/fixture/session.jsonl');
    const outcome = await handler.performCompression('actual');
    if (outcome !== PerformCompressionResult.COMPRESSED)
      throw new Error('Real provider summary did not publish history');
    if (Number(bodies.length) !== 3 || bodies[1] !== bodies[2])
      throw new Error('Summary retry did not preserve exact BODY bytes');
    const publication = await publicationBodies(
      history,
      size,
      name,
      caching,
      oracle.newHistory,
      oracle.metadata.topPreserved ?? 0,
    );
    return {
      actual: bodies[2],
      expected: bodies[0],
      attempts: bodies.length - 1,
      ...publication,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
