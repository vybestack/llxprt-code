/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05b4 request rows, request cleanup (issue #854 criterion 3/5), rewritten for C2.
 *
 * Caller-owned generated history is seeded once into a journal pin. Providers
 * send directly from that pin without request scratch files. The census bounds
 * live rows during seeding, and the transport assertions check streamed bytes,
 * declared length, cancellation and complete cleanup.
 *
 * @plan:PLAN-20260917-ISSUE854.P05b4
 * @requirement:G6
 * @requirement:G2
 */

import { gcAndSweep } from 'bun:jsc';
import { readdirSync } from 'node:fs';
import { collectedWithin } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import { withRequestSignal } from '../utils/abortSignal.js';
import {
  journalSendFixture,
  type JournalSendFixture,
} from './support/journal-send-fixture.js';

const originalFetch = globalThis.fetch;

const ROW_COUNT = 40;
/** Rows allowed alive at once while the request rows are read. */
const LIVE_ROW_BOUND = 2;

function streamCallOptions(
  init: ProviderCallOptionsInit & { contents: AsyncIterable<IContent> },
): GenerateChatOptions {
  return { ...createProviderCallOptions(init), contents: init.contents };
}

interface CountingSource {
  readonly stream: AsyncIterable<IContent>;
  readonly pullCount: () => number;
  /** The most rows from earlier pulls found alive when a later pull began. */
  readonly peakLive: () => number;
  /** Weak references to every row the source ever produced. */
  readonly rows: () => ReadonlyArray<WeakRef<object>>;
}

async function collectGarbage(): Promise<void> {
  await sleep(0);
  gcAndSweep();
}

/**
 * One-shot source that builds each row when it is pulled and keeps only weak
 * references, so a row stays alive only while a consumer holds it. At each
 * pull it counts the earlier rows that are still alive; `retain` turns it into
 * a control that keeps every row, which the census must report.
 */
function countingSource(seedText: string, retain = false): CountingSource {
  let pulled = 0;
  let peakLive = 0;
  const refs: Array<WeakRef<object>> = [];
  const retained: IContent[] = [];
  const makeRow = (index: number): IContent => {
    const row: IContent = {
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `${seedText}-${index}` }],
    };
    refs.push(new WeakRef<object>(row));
    if (retain) retained.push(row);
    return row;
  };
  const stream: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < ROW_COUNT; index += 1) {
        await collectGarbage();
        peakLive = Math.max(
          peakLive,
          refs.filter((ref) => ref.deref() !== undefined).length,
        );
        pulled += 1;
        yield makeRow(index);
      }
    },
  };
  return {
    stream,
    pullCount: () => pulled,
    peakLive: () => peakLive,
    rows: () => refs,
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
    await sleep(5);
  }
  return condition();
}

async function countRetainedAfterGc(
  probes: ReadonlyArray<WeakRef<object>>,
): Promise<number> {
  await Promise.all(probes.map((probe) => collectedWithin(probe)));
  return probes.filter((probe) => probe.deref() !== undefined).length;
}

const fixtures: JournalSendFixture[] = [];
async function cleanup(): Promise<void> {
  globalThis.fetch = originalFetch;
  for (const fixture of fixtures.splice(0)) await fixture.close();
}

/** Scratch entries this request creates: staged rows and prompt segment files. */
function requestScratchEntries(): string[] {
  return readdirSync(getScratchRoot())
    .filter(
      (name) =>
        name.startsWith('provider-normalization-') ||
        name.startsWith('responses-prompt-keys-'),
    )
    .sort();
}

function invocationFor(harness: ProviderHarness) {
  return createRuntimeInvocationContext({
    runtimeId: harness.runtime.runtimeId,
    runtimeMetadata: harness.runtime.metadata,
    providerName: 'openai-responses',
    ephemeralsSnapshot: { 'prompt-caching': 'off' },
  });
}

function newProvider(): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider(
    'test-api-key',
    'https://api.openai.com/v1',
  );
}

describe('P05b4 request rows stream from native journal pins @plan:PLAN-20260917-ISSUE854.P05b4', () => {
  afterEach(cleanup);

  it('the census reports a source that retains its rows', async () => {
    const control = countingSource('control', true);
    for await (const row of control.stream) void row;
    expect(control.pullCount()).toBe(ROW_COUNT);
    expect(control.peakLive()).toBe(ROW_COUNT - 1);
    const dropping = countingSource('dropping');
    for await (const row of dropping.stream) void row;
    expect(dropping.peakLive()).toBeLessThanOrEqual(LIVE_ROW_BOUND);
  });

  it('seeds every row once with bounded live rows, then serves streamed bytes without scratch files', async () => {
    const harness = makeHarness('p05b4-backpressure');
    const source = countingSource('bp');
    const fixture = await journalSendFixture(source.stream);
    fixtures.push(fixture);
    const scratchBefore = requestScratchEntries();
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const atFetch: {
      pulled?: number;
      scratch?: string[];
      streamed?: boolean;
      contentLength?: string | null;
      bodyBytes?: number;
    } = {};
    globalThis.fetch = Object.assign(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ): Promise<Response> => {
        // No body byte has been read yet.
        atFetch.pulled = source.pullCount();
        atFetch.scratch = requestScratchEntries();
        atFetch.streamed = init?.body instanceof ReadableStream;
        atFetch.contentLength = new Headers(init?.headers).get(
          'content-length',
        );
        await gate;
        atFetch.bodyBytes = (
          await new Response(init?.body).arrayBuffer()
        ).byteLength;
        return sseSuccess();
      },
      { preconnect: originalFetch.preconnect },
    );
    const baseOptions = streamCallOptions({
      providerName: 'openai-responses',
      settings: harness.settings,
      config: harness.runtime.config,
      runtime: harness.runtime,
      invocation: invocationFor(harness),
      contents: source.stream,
    });
    const options = {
      ...baseOptions,
      requestRows: fixture.selection,
      contentCount: fixture.selection.count,
    };
    const drained = (async () => {
      for await (const _chunk of newProvider().generateChatCompletion(
        options,
      )) {
        // drain
      }
    })();
    const entered = await waitFor(() => atFetch.pulled !== undefined, 5000);
    expect(entered).toBe(true);
    expect(atFetch.pulled).toBe(ROW_COUNT);
    expect(source.peakLive()).toBeLessThanOrEqual(LIVE_ROW_BOUND);
    expect(atFetch.streamed).toBe(true);
    expect(atFetch.scratch).toStrictEqual(scratchBefore);
    expect(
      atFetch.scratch?.some((name) =>
        name.startsWith('responses-prompt-keys-'),
      ),
    ).toBe(false);
    releaseGate?.();
    await drained;
    const { bodyBytes } = atFetch;
    if (bodyBytes === undefined) throw new Error('Expected the sent body size');
    expect(bodyBytes).toBeGreaterThan(0);
    expect(Number(atFetch.contentLength)).toBe(bodyBytes);
    expect(requestScratchEntries()).toStrictEqual(scratchBefore);
  });
});

describe('P05b4 aborted transport and released rows @plan:PLAN-20260917-ISSUE854.P05b4', () => {
  afterEach(cleanup);

  it('abort during a blocked transport surfaces the abort, keeps no row alive and removes the scratch files', async () => {
    const harness = makeHarness('p05b4-abort');
    const source = countingSource('abort');
    const fixture = await journalSendFixture(source.stream);
    fixtures.push(fixture);
    const scratchBefore = requestScratchEntries();
    const controller = new AbortController();
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
    globalThis.fetch = Object.assign(
      async (): Promise<Response> => {
        fetchEntered = true;
        return fetchGate;
      },
      { preconnect: originalFetch.preconnect },
    );
    const baseOptions = streamCallOptions({
      providerName: 'openai-responses',
      settings: harness.settings,
      config: harness.runtime.config,
      runtime: harness.runtime,
      invocation: invocationFor(harness),
      contents: source.stream,
    });
    const options = withRequestSignal(
      {
        ...baseOptions,
        requestRows: fixture.selection,
        contentCount: fixture.selection.count,
      },
      controller.signal,
    );
    const settled = newProvider()
      .generateChatCompletion(options)
      .next()
      .then(
        () => 'completed',
        (error: unknown) => error,
      );
    const entered = await waitFor(() => fetchEntered, 5000);
    expect(entered).toBe(true);
    controller.abort(new Error('test abort'));
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(Error);
    if (!(outcome instanceof Error))
      throw new Error('Expected cancellation error');
    const abortError = outcome;
    expect(
      abortError.name === 'AbortError' ||
        /abort/i.test(`${abortError.name}: ${abortError.message}`),
    ).toBe(true);
    // Every row was read before the request started, and none stays alive.
    expect(source.pullCount()).toBe(ROW_COUNT);
    expect(source.peakLive()).toBeLessThanOrEqual(LIVE_ROW_BOUND);
    await sleep(10);
    expect(await countRetainedAfterGc(source.rows())).toBe(0);
    expect(requestScratchEntries()).toStrictEqual(scratchBefore);
  });
});
