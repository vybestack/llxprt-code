/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { TranscriptReader } from '@vybestack/llxprt-code-core/journal/transcript-reader.js';
import { chunkValue } from '@vybestack/llxprt-code-core/journal/chunk-row.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

async function readResponses(path: string) {
  const file = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(file, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 10 });
    const results = [];
    for (const entry of entries.filter((item) => item.attemptRef !== 0)) {
      const identity: unknown = JSON.parse(
        new TextDecoder().decode(await chunkValue(file, entry.attemptRef)),
      );
      results.push({
        status: entry.status,
        identity,
        content: decodeStoredRow(await reader.readRow(entry)),
      });
    }
    return results;
  } finally {
    await file.close();
  }
}

describe('production response arrival', () => {
  const root = sourceRootSetup();
  for (const retry of [false, true]) {
    for (const complete of [false, true]) {
      it(`admits prefetch once and retains distinct attempts (retry=${retry}, complete=${complete})`, async () => {
        const setup = await processorFixture(
          root(),
          'http://127.0.0.1:1/v1',
          false,
          0,
        );
        let attempts = 0;
        setup.provider.generateChatCompletion = async function* () {
          attempts++;
          if (retry && attempts === 1) return;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'prefetched prefix' }],
          };
          yield {
            speaker: 'ai',
            blocks: [],
            metadata: { finishReason: 'stop' },
          };
        };
        const recording = createSessionRecorder({
          sessionId: 'prefetch',
          projectHash: 'prefetch',
          chatsDir: root(),
          workspaceDirs: [],
          provider: 'test',
          model: 'gpt-5.6',
        });
        await setup.history.attachJournal(recording);
        const stream = await setup.processor.makeApiCallAndProcessStream(
          { message: 'test', config: {} },
          'submission',
          sourcePending,
        );
        try {
          await finishAndCheck(
            stream,
            complete,
            retry,
            recording.getFilePath(),
          );
          expect(await setup.history.countCuratedRows()).toBe(complete ? 2 : 1);
        } finally {
          await stream.return(undefined);
          await setup.history.dispose();
          await recording.dispose();
          await setup.config.dispose();
        }
      });
    }
  }
});

async function finishAndCheck(
  stream: AsyncGenerator<unknown>,
  complete: boolean,
  retry: boolean,
  path: string | null,
): Promise<void> {
  if (complete)
    for await (const _chunk of stream) {
      /* Drain through seal. */
    }
  else await stream.return(undefined);
  if (path === null) throw new Error('Missing journal');
  const responses = await readResponses(path);
  expect(responses).toHaveLength(retry ? 2 : 1);
  expect(responses.map((entry) => entry.status)).toStrictEqual(
    retry ? [3, complete ? 1 : 2] : [complete ? 1 : 2],
  );
  expect(responses[responses.length - 1].content.blocks).toStrictEqual([
    { type: 'text', text: 'prefetched prefix' },
  ]);
  expect(
    new Set(responses.map((entry) => JSON.stringify(entry.identity))).size,
  ).toBe(responses.length);
  for (const entry of responses)
    expect(entry.identity).toMatchObject({ submissionId: 'submission' });
}
