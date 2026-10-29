/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { requireJournalRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

const root = sourceRootSetup();

async function faultFixture(failFlush: boolean) {
  const http = projectionEndpoint(false);
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    false,
    0,
  );
  const seams = testJournalSeams({}, 1, false);
  let fail = false;
  const recording = createSessionRecorder({
    sessionId: 'prompt-fault',
    projectHash: 'prompt-fault',
    chatsDir: root(),
    workspaceDirs: [],
    provider: 'test',
    model: 'gpt-5.6',
    journal: {
      journal: {
        ...seams.dependencies,
        flush: (fd) => {
          if (fail) throw new Error('prompt disk unavailable');
          return seams.dependencies.flush(fd);
        },
      },
    },
  });
  await setup.history.attachJournal(recording);
  await requireJournalRecorder(recording).session();
  await setup.history.waitForCommit();
  fail = failFlush;
  http.readBody.release();
  http.respond.release();
  return {
    ...setup,
    http,
    close: async (): Promise<void> => {
      await Promise.allSettled([setup.history.dispose(), recording.dispose()]);
      await http.server.stop(true);
      await setup.config.dispose();
    },
  };
}

function failureMessages(error: unknown): string {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.map(failureMessages)].join(' | ');
  return error instanceof Error ? error.message : String(error);
}

describe('production prompt barrier failures', () => {
  it('does not open HTTP when the prompt cannot be flushed', async () => {
    const fixture = await faultFixture(true);
    try {
      const error: unknown = await fixture.processor
        .makeApiCallAndProcessStream(
          { message: 'expanded', config: {} },
          'flush-failure',
          sourcePending,
        )
        .then(
          () => undefined,
          (failure: unknown) => failure,
        );
      expect(failureMessages(error)).toContain('prompt disk unavailable');
      expect(fixture.http.bodies).toHaveLength(0);
      expect(fixture.provider.tokens).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it('aborts invalid injected rows before opening HTTP without publishing a partial prompt', async () => {
    const fixture = await faultFixture(false);
    try {
      await expect(
        fixture.processor.makeApiCallAndProcessStream(
          { message: 'expanded', config: {} },
          'invalid-injection',
          [sourcePending, { speaker: 'human', blocks: [] }],
        ),
      ).rejects.toThrow('content has no blocks');
      expect(fixture.http.bodies).toHaveLength(0);
      expect(
        await fixture.history.hasPromptSubmission('invalid-injection'),
      ).toBe(false);
      expect(await fixture.history.countCuratedRows()).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  it('keeps the committed prompt when a preloaded stream is cancelled before processing', async () => {
    const fixture = await faultFixture(false);
    try {
      const stream = await fixture.processor.makeApiCallAndProcessStream(
        { message: 'expanded', config: {} },
        'cancelled',
        sourcePending,
      );
      await stream.return(undefined);
      expect(await fixture.history.hasPromptSubmission('cancelled')).toBe(true);
      expect(await fixture.history.countCuratedRows()).toBe(1);
      expect(fixture.http.bodies).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });
});
