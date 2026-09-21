/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05b4 in-flight backpressure and cancellation (issue #854 criterion 3/5).
 *
 * Target contract: the provider consumes the history stream AT the transport,
 * so when the transport is slow the stream pull pauses (in-flight bound) and
 * an aborted request does not leak the materialized body.
 *
 * RED classification against current HEAD: the laziness/bound assertions fail
 * as a REAL BEHAVIOR GAP — BaseProvider.collectContents drains the whole
 * stream before the transport is touched, so the source is fully consumed
 * while the transport is still blocked. No implementation is fixed in this
 * session; the failures define the target.
 *
 * @plan:PLAN-20260917-ISSUE854.P05b4
 * @requirement:G6
 * @requirement:G2
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import { withRequestSignal } from '../utils/abortSignal.js';

const originalFetch = globalThis.fetch;

const ROW_COUNT = 40;

interface CountingSource {
  readonly stream: AsyncIterable<IContent>;
  readonly pullCount: () => number;
  readonly fullyDrained: () => boolean;
}

/**
 * One-shot counting source: the facade's provider-facing stream. pullCount
 * reports how many rows the consumer has PULLED so far.
 */
function countingSource(seedText: string): CountingSource {
  let pulled = 0;
  const rows: IContent[] = [];
  for (let index = 0; index < ROW_COUNT; index += 1) {
    rows.push({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `${seedText}-${index}` }],
    });
  }
  const stream: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        pulled += 1;
        yield row;
      }
    },
  };
  return {
    stream,
    pullCount: () => pulled,
    fullyDrained: () => pulled >= ROW_COUNT,
  };
}

interface ProviderHarness {
  readonly settings: SettingsService;
  readonly runtime: ReturnType<typeof createProviderRuntimeContext>;
}

function makeHarness(runtimeId: string): ProviderHarness {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'gpt-5.2');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId,
    config: createRuntimeConfigStub(settings),
  });
  setActiveProviderRuntimeContext(runtime);
  return { settings, runtime };
}

function sseSuccess(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content.delta","delta":"ok"}\n\n'),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.completed","response":{"id":"resp_bp","status":"completed"}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await Bun.sleep(5);
  }
  return condition();
}

describe('P05b4 transport backpressure and cancellation @plan:PLAN-20260917-ISSUE854.P05b4', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
    globalThis.fetch = originalFetch;
  });

  it('stream pull pauses while the transport is slow (source not fully drained before transport consumes)', async () => {
    const harness = makeHarness('p05b4-backpressure');
    const source = countingSource('bp');
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let fetchEntered = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetchEntered = true;
      await gate;
      return sseSuccess();
    };
    const invocation = createRuntimeInvocationContext({
      runtime: harness.runtime,
      settings: harness.settings,
      providerName: 'openai-responses',
      ephemeralsSnapshot: { 'prompt-caching': 'off' },
    });
    const options = createProviderCallOptions({
      providerName: 'openai-responses',
      settings: harness.settings,
      config: harness.runtime.config,
      runtime: harness.runtime,
      invocation,
      contents: source.stream,
    });
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const drained = (async () => {
      for await (const _chunk of provider.generateChatCompletion(options)) {
        // drain
      }
    })();
    const entered = await waitFor(() => fetchEntered, 2000);
    expect(entered).toBe(true);
    // TARGET CONTRACT: while the transport is blocked, only a bounded prefix
    // of the history stream has been pulled. Current behavior drains the
    // whole stream before the transport call, so pulled === ROW_COUNT here
    // and this assertion fails (the documented red).
    expect(source.fullyDrained()).toBe(false);
    expect(source.pullCount()).toBeLessThan(ROW_COUNT);
    releaseGate?.();
    await drained;
  });

  it('abort during a blocked transport surfaces the abort and does not leak the materialized rows', async () => {
    const harness = makeHarness('p05b4-abort');
    const source = countingSource('abort');
    const controller = new AbortController();
    const probes: Array<WeakRef<object>> = [];
    const probeStream: AsyncIterable<IContent> = {
      async *[Symbol.asyncIterator]() {
        for await (const row of source.stream) {
          probes.push(new WeakRef<object>(row));
          yield row;
        }
      },
    };
    let fetchEntered = false;
    let rejectFetch: ((reason: unknown) => void) | undefined;
    const fetchGate = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    });
    controller.signal.addEventListener(
      'abort',
      () => {
        rejectFetch?.(controller.signal.reason);
      },
      { once: true },
    );
    globalThis.fetch = async (): Promise<Response> => {
      fetchEntered = true;
      return fetchGate;
    };
    const invocation = createRuntimeInvocationContext({
      runtime: harness.runtime,
      settings: harness.settings,
      providerName: 'openai-responses',
      ephemeralsSnapshot: { 'prompt-caching': 'off' },
    });
    const baseOptions = createProviderCallOptions({
      providerName: 'openai-responses',
      settings: harness.settings,
      config: harness.runtime.config,
      runtime: harness.runtime,
      invocation,
      contents: probeStream,
    });
    const options = withRequestSignal(baseOptions, controller.signal);
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settled = provider
      .generateChatCompletion(options)
      .next()
      .then(
        () => 'completed' as const,
        (error: unknown) => error,
      );
    const entered = await waitFor(() => fetchEntered, 2000);
    expect(entered).toBe(true);
    controller.abort(new Error('test abort'));
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(Error);
    const abortError = outcome as Error;
    expect(
      abortError.name === 'AbortError' ||
        /abort/i.test(`${abortError.name}: ${abortError.message}`),
    ).toBe(true);
    // TARGET CONTRACT: an aborted request must not have consumed the whole
    // history stream, and the pulled rows must be collectible after GC.
    expect(source.fullyDrained()).toBe(false);
    await Bun.sleep(10);
    Bun.gc(true);
    const retained = probes.filter((probe) => probe.deref() !== undefined);
    expect(retained.length).toBe(0);
  });
});
