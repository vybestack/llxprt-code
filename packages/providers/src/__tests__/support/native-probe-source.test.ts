/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import { journalSendFixture } from './journal-send-fixture.js';
import { NativeProbeSources } from './native-probe-source.js';
import { localWireHashSink } from './local-wire-hash-sink.js';
import { buildHistoryCallOptions, WIRE_ROUTES } from './wireBodyCapture.js';

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
  it('borrows the original capability and forwards aborted random access', async () => {
    const fixture = await journalSendFixture([
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
    ]);
    const sources = new NativeProbeSources(new Map([['fixture', fixture]]));
    try {
      const handle = sources.handle(
        { directory: 'fixture', count: 1 },
        undefined,
        undefined,
      );
      expect(handle.selection.native).toBe(fixture.selection.native);
      expect(handle.selection.count).toBe(1);
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
      const creates = await operationFileCreates(async () => {
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
      }, true);
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
