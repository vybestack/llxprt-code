import { chatSessionPorts } from './chatSessionPorts.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { TranscriptReader } from '@vybestack/llxprt-code-core/journal/transcript-reader.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { processorFixture } from './__tests__/support/streamprocessor-source-fixture.js';
import { TurnProcessor } from './TurnProcessor.js';
import { responseTransportAttempts } from './response-transport-source.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

const raw =
  'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"reused","call_id":"abandoned","name":"lookup","arguments":"{\\"lost\\":"}}\n\n';
const complete =
  'data: {"type":"response.output_text.delta","delta":"recovered"}\n\ndata: {"type":"response.completed","response":{"id":"success","status":"completed","output":[]}}\n\n';
const root = sourceRootSetup();

describe('agent transport recording wiring', () => {
  it.each([false, true])(
    'keeps internal HTTP retries isolated through the product send (direct=%s)',
    async (direct) => {
      const setup = await processorFixture(
        root(),
        'https://attempt.invalid/v1',
        false,
        0,
      );
      setup.settings.set('retries', 2);
      const recording = createSessionRecorder({
        sessionId: 'attempt',
        projectHash: 'attempt',
        chatsDir: root(),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      await setup.history.attachJournal(recording);
      const saved = globalThis.fetch;
      let sends = 0;
      const activeIds: bigint[] = [];
      globalThis.fetch = Object.assign(
        async (): Promise<Response> => {
          sends++;
          const path = recording.getFilePath();
          if (path === null) throw new Error('Missing recording');
          const file = await openJournalReadOnly(path);
          try {
            const reader = new TranscriptReader(file, sha256KeyHash);
            const active = (
              await reader.page({ direction: 'forward', limit: 20 })
            ).filter((entry) => entry.attemptRef !== 0 && entry.status === 0);
            expect(active).toHaveLength(1);
            activeIds.push(active[0].transcriptId);
            expect(new Set(activeIds).size).toBe(sends);
          } finally {
            await file.close();
          }
          if (sends === 1)
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(raw));
                },
                pull(controller) {
                  controller.error(new TypeError('fetch failed'));
                },
              }),
            );
          return new Response(complete, {
            headers: { 'content-type': 'text/event-stream' },
          });
        },
        { preconnect: saved.preconnect },
      );
      try {
        if (direct) {
          const processor = new TurnProcessor(
            chatSessionPorts(setup.runtime).turn,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            setup.compression,
            () => setup.provider,
            (_source, metadata) => ({
              ...setup.runtime.providerRuntime,
              metadata,
            }),
            setup.generation,
            setup.history,
            setup.processor,
            () => setup.runtime.state.baseUrl,
          );
          const receipt = await processor.sendMessage(
            { message: 'question' },
            'attempt-test',
          );
          if (receipt.status !== 'published')
            throw new Error('Direct response was not published');
        } else {
          const stream = await setup.processor.makeApiCallAndProcessStream(
            { message: 'question' },
            'attempt-test',
            { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
          );
          for await (const _chunk of stream) {
            /* Product stream owns publication. */
          }
        }
        expect(sends).toBe(2);
        expect(new Set(activeIds).size).toBe(2);
        const rows = await Array.fromAsync(setup.history.streamRawHistory());
        expect(
          rows
            .filter((row) => row.speaker === 'ai')
            .flatMap((row) => row.blocks),
        ).toStrictEqual([{ type: 'text', text: 'recovered' }]);
      } finally {
        globalThis.fetch = saved;
        await setup.history.dispose();
        await recording.dispose();
        await setup.config.dispose();
      }
    },
  );
  it('uses the durable first identity and supersedes empty attempts before new output', async () => {
    const history = new HistoryService();
    const arrival = await history.openResponseArrival({
      id: 'first',
      submissionId: 'prompt',
    });
    const begin = responseTransportAttempts(arrival);
    try {
      await begin('wrapper');
      const first = arrival.identity;
      await begin();
      expect([arrival.identity.attemptId, first.attemptId]).toStrictEqual([
        'first',
        'first',
      ]);
      expect(
        new Set([arrival.identity.transcriptId, first.transcriptId]).size,
      ).toBe(1);
      await begin();
      const second = arrival.identity;
      expect(second.attemptId).not.toBe(first.attemptId);
      expect(second.transcriptId).not.toBe(first.transcriptId);
      await arrival.appendToolArguments({
        attemptId: 'provider-output-epoch',
        sourceId: 'same',
        id: 'call',
        name: 'lookup',
        arguments: '{}',
        complete: true,
      });
      expect(new Set([arrival.identity.attemptId, second.attemptId]).size).toBe(
        1,
      );
      expect(
        new Set([arrival.identity.transcriptId, second.transcriptId]).size,
      ).toBe(1);
      await arrival.seal({});
      expect(
        (await Array.fromAsync(history.streamRawHistory())).flatMap(
          (row) => row.blocks,
        ),
      ).toStrictEqual([
        { type: 'tool_call', id: 'call', name: 'lookup', parameters: {} },
      ]);
    } finally {
      await arrival.interrupt('cancelled');
      await history.dispose();
    }
  });
});
