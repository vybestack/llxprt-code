/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { TurnProcessor } from './TurnProcessor.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { TranscriptReader } from '@vybestack/llxprt-code-core/journal/transcript-reader.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

const root = sourceRootSetup();

function directProcessor(
  setup: Awaited<ReturnType<typeof processorFixture>>,
): TurnProcessor {
  return new TurnProcessor(
    setup.runtime,
    setup.compression,
    () => setup.provider,
    (_source, metadata) => ({ ...setup.runtime.providerRuntime, metadata }),
    setup.generation,
    setup.history,
    setup.processor,
    () => setup.runtime.state.baseUrl,
  );
}

async function directResult(
  setup: Awaited<ReturnType<typeof processorFixture>>,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  const result = await directProcessor(setup).sendMessage(
    { message: 'Answer the history.', config: {} },
    'submission',
  );
  return (async function* () {
    yield result;
  })();
}

describe('production prompt submission barrier', () => {
  for (const mode of ['stream', 'direct'])
    it(`commits the ${mode} prompt before HTTP opens and reuses it across a transport retry`, async () => {
      const http = projectionEndpoint(true);
      const setup = await processorFixture(
        root(),
        `http://127.0.0.1:${http.server.port}/v1`,
        false,
        0,
      );
      const recording = createSessionRecorder({
        sessionId: 'prompt-barrier',
        projectHash: 'prompt-barrier',
        chatsDir: root(),
        workspaceDirs: [],
        provider: 'test',
        model: 'gpt-5.6',
      });
      await setup.history.attachJournal(recording);
      const started =
        mode === 'direct'
          ? directResult(setup)
          : setup.processor.makeApiCallAndProcessStream(
              { message: 'expanded', config: {} },
              'submission',
              sourcePending,
            );
      void started.catch(() => undefined);
      try {
        await http.arrived.wait;
        const path = recording.getFilePath();
        if (path === null) throw new Error('No committed prompt file');
        const file = await openJournalReadOnly(path);
        try {
          const transcript = new TranscriptReader(file, sha256KeyHash);
          const entries = await transcript.page({
            direction: 'forward',
            limit: 10,
          });
          const rows = entries.filter((entry) => entry.rowRef !== 0);
          expect(rows).toHaveLength(1);
          const content = decodeStoredRow(await transcript.readRow(rows[0]));
          expect(content.speaker).toBe('human');
          expect(content.blocks).toStrictEqual(sourcePending.blocks);
          expect(await setup.history.hasPromptSubmission('submission')).toBe(
            true,
          );
        } finally {
          await file.close();
        }
        http.readBody.release();
        http.respond.release();
        const stream = await started;
        for await (const _chunk of stream) {
          /* Complete both attempts. */
        }
        expect(http.bodies).toHaveLength(2);
        expect(http.bodies[0]).toStrictEqual(http.bodies[1]);
        expect(await setup.history.countCuratedRows()).toBe(2);
        expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
      } finally {
        http.readBody.release();
        http.respond.release();
        const stream = await started.catch(() => undefined);
        await stream?.return(undefined);
        await setup.history.dispose();
        await recording.dispose();
        await http.server.stop(true);
        await setup.config.dispose();
      }
    });
});
