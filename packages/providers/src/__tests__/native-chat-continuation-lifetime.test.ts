/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ContinuationRowObserver } from './support/continuation-row-observer.js';
import { SemanticMediaPurgeSession } from '../../../agents/src/core/semanticMediaPurgeSession.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import {
  type HashedWireBody,
  localWireHashSink,
} from './support/local-wire-hash-sink.js';
import {
  WIRE_ROUTES,
  buildHistoryCallOptions,
  installFakeTransport,
  type CapturedWireRequest,
} from './support/wireBodyCapture.js';

const route = WIRE_ROUTES.find((value) => value.id === 'openai-chat-plain');
if (route === undefined) throw new Error('Missing plain Chat route');
function reply(second: boolean): Response {
  const delta = second
    ? { content: 'finished 雪' }
    : {
        tool_calls: [
          {
            index: 0,
            id: 'call_read',
            type: 'function',
            function: { name: 'read_file', arguments: '{"ratio":1.25}' },
          },
        ],
      };
  return new Response(
    `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function hasCause(error: unknown, cause: unknown): boolean {
  if (error === cause) return true;
  if (
    error instanceof AggregateError &&
    error.errors.some((nested: unknown) => hasCause(nested, cause))
  )
    return true;
  return (
    error instanceof Error &&
    error.cause !== undefined &&
    hasCause(error.cause, cause)
  );
}

function assertOutcome(
  mode: string,
  error: unknown,
  reason: unknown,
  failure: Error,
  output: IContent[],
  actual: readonly HashedWireBody[],
  expected: CapturedWireRequest[],
): void {
  if (mode === 'complete') {
    expect(error).toBeUndefined();
    expect(
      output
        .flatMap((row) => row.blocks)
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join(''),
    ).toBe('finished 雪');
    expect(actual).toHaveLength(2);
    for (const [index, body] of actual.entries()) {
      expect(body.bytes).toBe(expected[index].bytes.byteLength);
      expect(body.sha256).toBe(
        createHash('sha256').update(expected[index].bytes).digest('hex'),
      );
      expect(body.contentLength).toBe(String(body.bytes));
    }
  } else if (mode === 'abort') {
    expect(error).toBe(reason);
  } else if (mode === 'http-500') {
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 500 });
  } else {
    expect(hasCause(error, failure)).toBe(true);
  }
}

async function mutateHistory(
  history: HistoryService,
  mutation: string,
): Promise<void> {
  if (mutation === 'clear') await history.clear();
  else {
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: async () => undefined,
    });
    for (let index = 0; index < 40; index++) {
      const purge = await session.begin(false);
      if (purge === undefined) throw new Error('Missing semantic purge');
      await purge.complete({
        status: 'success',
        usage: undefined,
        retryHandoff: false,
      });
      await purge.finalize();
    }
  }
}

async function reclaimed(store: LocalMediaStore): Promise<number> {
  return (await store.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
    .objectsRemoved;
}

describe('native continuation second HTTP body ownership', () => {
  it.each(
    ['complete', 'abort', 'read-failure', 'http-500'].flatMap((mode) =>
      ['clear', 'purge'].map((mutation) => ({ mode, mutation })),
    ),
  )(
    'keeps the first pin and media through clear before the second blob read: $mode/$mutation',
    async ({ mode, mutation }) => {
      const parent = join(
        import.meta.dir,
        '../../../../tmp/p6/chat-continuation-runtime-run-bi/fixtures',
      );
      mkdirSync(parent, { recursive: true });
      const store = new LocalMediaStore({
        rootDirectory: mkdtempSync(join(parent, 'media-')),
        quotaBytes: 1024,
      });
      const reference = await store.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const rows: IContent[] = [
        ...Array.from(
          { length: 40 },
          (_, index): IContent => ({
            speaker: 'human',
            blocks: [
              { type: 'text', text: `${index}:`.padEnd(64 * 1024, 'x') },
              reference,
            ],
          }),
        ),
        {
          speaker: 'ai',
          blocks: [
            { type: 'thinking', thought: 'private' },
            { type: 'text', text: 'old answer' },
          ],
        },
      ];
      const input = {
        id: 'continuation-lifetime',
        description: mode,
        rows,
        systemInstruction: 'system',
        ephemerals: {
          streaming: 'enabled',
          'reasoning.includeInContext': true,
        },
      };
      const resolver = new RequestMediaResolver(store);
      const expected: CapturedWireRequest[] = [];
      let oraclePosts = 0;
      const restore = installFakeTransport(
        { ...route, respond: () => reply(oraclePosts++ > 0) },
        expected,
      );
      try {
        const provider = bindProviderMedia(
          route.createProvider(),
          resolver,
          1024,
        );
        for await (const chunk of provider.generateChatCompletion(
          buildHistoryCallOptions(route, input, 'rows', new SettingsService()),
        ))
          void chunk;
      } finally {
        restore();
      }
      expect(expected).toHaveLength(2);
      const history = new HistoryService({ backend: 'journal' });
      await history.registerMediaOwner(new HistoryMediaOwnership(store));
      await history.addBatch(rows);
      const ownership = new RowOwnership();
      const selection = await history.prepareCuratedForProviderSnapshot([], {
        ownership,
      });
      const observer = new ContinuationRowObserver(store);
      let posts = 0;
      const sink = await localWireHashSink({
        ...route,
        respond: () => {
          posts++;
          return posts === 2 && mode === 'http-500'
            ? Response.json(
                { error: { message: 'second refused' } },
                { status: 500 },
              )
            : reply(posts > 1);
        },
      });
      const entered = batchGate();
      const resume = batchGate();
      const read = store.readReserved.bind(store);
      let reads = 0;
      const failure = new Error('second blob failed');
      const paused = spyOn(store, 'readReserved').mockImplementation(
        async (ref) => {
          reads++;
          if (reads === 41) {
            entered.resolve();
            await resume.promise;
            if (mode === 'read-failure') throw failure;
          }
          return read(ref);
        },
      );
      const controller = new AbortController();
      const reason = { cancelled: 'second body', marker: Symbol('reason') };
      const output: IContent[] = [];
      const provider = bindProviderMedia(
        route.createProvider(),
        observer,
        1024,
      );
      const options = buildHistoryCallOptions(
        sink.route,
        input,
        'rows',
        new SettingsService(),
        selection,
      );
      const outcome = (async (): Promise<unknown> => {
        try {
          for await (const chunk of provider.generateChatCompletion({
            ...options,
            metadata: { ...options.metadata, abortSignal: controller.signal },
          }))
            output.push(chunk);
          return undefined;
        } catch (error: unknown) {
          return error;
        }
      })();
      try {
        await entered.promise;
        expect(sink.requests).toHaveLength(1);
        await mutateHistory(history, mutation);
        await history.waitForOwnershipSettlement();
        expect(history.length()).toBe(mutation === 'clear' ? 0 : 41);
        expect(await reclaimed(store)).toBe(0);
        expect(
          (await selection.readAt(0)).blocks.some(
            (block) => block.type === 'media',
          ),
        ).toBe(true);
        expect(ownership.snapshot().liveRows).toBeLessThanOrEqual(2);
        if (mode === 'abort') controller.abort(reason);
        resume.resolve();
        const error = await outcome;
        assertOutcome(
          mode,
          error,
          reason,
          failure,
          output,
          sink.requests,
          expected,
        );
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(await observer.sample()).toStrictEqual({
          rows: 0,
          textBytes: 0,
        });
        expect(observer.acquired).toBeGreaterThan(40);
        expect(observer.peakRows).toBeGreaterThan(0);
        expect(observer.accounting().materializedNormalizedBytes).toBe(0);
        expect(observer.accounting().reservedContentCount).toBe(0);
        expect(await reclaimed(store)).toBe(0);
        await selection.close();
        await history.waitForOwnershipSettlement();
        expect(await reclaimed(store)).toBe(1);
      } finally {
        resume.resolve();
        await outcome;
        paused.mockRestore();
        await selection.close();
        await sink.close();
        await history.dispose();
        await store.close();
      }
    },
  );
});
