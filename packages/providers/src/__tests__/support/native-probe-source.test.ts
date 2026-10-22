/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import { journalSendFixture } from './journal-send-fixture.js';
import { NativeProbeSources } from './native-probe-source.js';
import { observeNativeRoute } from './native-route-observer.js';
import { localWireHashSink } from './local-wire-hash-sink.js';
import { isolatedWireHashSink } from './isolated-wire-hash-sink.js';
import type { HistoryCase } from './wireBodyHistories.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './wireBodyCapture.js';

const history = {
  id: 'native-probe-forwarding',
  description: 'probe preserves the actual journal capability',
  rows: [],
};

function plainRoute(): (typeof WIRE_ROUTES)[number] {
  const route = WIRE_ROUTES.find(
    (candidate) => candidate.id === 'openai-chat-plain',
  );
  if (route === undefined) throw new Error('Missing plain Chat route');
  return route;
}

describe('native send probe capability forwarding', () => {
  it('reports incremental socket chunks without changing the independent converter body', async () => {
    const shape: HistoryCase = {
      ...history,
      rows: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'socket 雪' }] },
      ],
    };
    const expected = recordOf(
      await sendThroughRoute(plainRoute(), shape, 'rows'),
    );
    const fixture = await journalSendFixture(shape.rows);
    const sources = new NativeProbeSources(new Map([['fixture', fixture]]));
    const sink = await isolatedWireHashSink(plainRoute(), async () => {});
    const observed = observeNativeRoute();
    try {
      const handle = sources.handle(
        { directory: 'fixture', count: 1 },
        undefined,
        undefined,
      );
      const options = buildHistoryCallOptions(
        sink.route,
        shape,
        'rows',
        new SettingsService(),
        handle.selection,
      );
      for await (const chunk of sink.route
        .createProvider()
        .generateChatCompletion(options))
        void chunk;
      observed.requireSend(false);
      const body = await sink.body();
      expect(body.bytes).toBe(expected.length);
      expect(body.sha256).toBe(expected.sha256);
      expect(body.contentLength).toBe(String(expected.length));
      expect(body.chunks).toBeGreaterThan(0);
      expect(body.entries).toBe(1);
    } finally {
      observed.restore();
      await sink.close();
      await sources.close();
    }
  });

  it('rejects a dropped capability at the native route assertion', async () => {
    const prior = process.env.ISSUE854_DROP_NATIVE_CAPABILITY;
    const fixture = await journalSendFixture([
      { speaker: 'human', blocks: [{ type: 'text', text: 'route loss' }] },
    ]);
    const sources = new NativeProbeSources(new Map([['fixture', fixture]]));
    const sink = await localWireHashSink(plainRoute());
    const observed = observeNativeRoute();
    try {
      process.env.ISSUE854_DROP_NATIVE_CAPABILITY = '1';
      const handle = sources.handle(
        { directory: 'fixture', count: 1 },
        undefined,
        undefined,
      );
      const options = buildHistoryCallOptions(
        sink.route,
        history,
        'rows',
        new SettingsService(),
        handle.selection,
      );
      for await (const chunk of sink.route
        .createProvider()
        .generateChatCompletion(options))
        void chunk;
      expect(() => observed.requireSend(false)).toThrow(
        'Native route assertion failed',
      );
      expect(observed.counts()).toMatchObject({
        streams: 0,
        estimates: 0,
        spools: 1,
      });
    } finally {
      if (prior === undefined)
        delete process.env.ISSUE854_DROP_NATIVE_CAPABILITY;
      else process.env.ISSUE854_DROP_NATIVE_CAPABILITY = prior;
      observed.restore();
      await sink.close();
      await sources.close();
    }
  });

  it('borrows the original capability and forwards aborted random access', async () => {
    const fixture = await journalSendFixture([
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
    ]);
    const sources = new NativeProbeSources(new Map([['fixture', fixture]]));
    try {
      const handle = sources.handle(
        { directory: 'fixture', count: 9000 },
        undefined,
        undefined,
      );
      expect(handle.selection.native).toBe(fixture.selection.native);
      expect(handle.selection.count).toBe(1);
      expect(handle.selection.pending).toBe(fixture.selection.pending);
      expect(handle.selection.isPending(0)).toBe(false);
      const abort = new AbortController();
      const reason = new Error('read aborted');
      abort.abort(reason);
      await expect(handle.selection.readAt(0, abort.signal)).rejects.toBe(
        reason,
      );
      await handle.selection.close();
      expect((await fixture.selection.readAt(0)).speaker).toBe('human');
    } finally {
      await sources.close();
    }
  });

  it('prepares, estimates and sends through the wrapped native route without any file creation', async () => {
    const fixture = await journalSendFixture([
      { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ]);
    const sources = new NativeProbeSources(new Map([['fixture', fixture]]));
    const sink = await localWireHashSink(plainRoute());
    try {
      const handle = sources.handle(
        { directory: 'fixture', count: 2 },
        undefined,
        undefined,
      );
      const provider = sink.route.createProvider();
      const options = buildHistoryCallOptions(
        sink.route,
        { ...history, rows: [] },
        'rows',
        new SettingsService(),
        handle.selection,
      );
      const factory = createRuntimeTokenizerFactory();
      await factory.prepareTokenizer?.(provider.name, sink.route.model);
      let count = 0;
      const observed = observeNativeRoute();
      let creates: Awaited<ReturnType<typeof operationFileCreates>>;
      try {
        creates = await operationFileCreates(async () => {
          const projection = await provider.projectPromptEnvelope?.(options);
          if (projection === undefined)
            throw new Error('Missing native projection');
          const estimated = await estimatePromptEnvelope(
            provider.name,
            projection,
            factory,
          );
          count = estimated.estimatedPromptTokens;
          for await (const chunk of provider.generateChatCompletion({
            ...options,
            promptEnvelopeTransportToken: projection.transportToken,
          }))
            void chunk;
          observed.requireSend(true);
        }, true);
        expect(observed.counts()).toStrictEqual({
          streams: 1,
          estimates: 1,
          spools: 0,
          estimatorFiles: 0,
          tokens: count,
        });
      } finally {
        observed.restore();
      }
      expect(creates).toStrictEqual({ files: [], directories: [] });
      expect(count).toBeGreaterThan(0);
      expect(sink.requests).toHaveLength(1);
      expect(sink.requests[0].contentLength).toBe(
        String(sink.requests[0].bytes),
      );
    } finally {
      await sink.close();
      await sources.close();
    }
  });
});
