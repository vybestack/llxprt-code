/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 3 (R1): a compression that committed and was
 * journaled is never rolled back by a later failure. The session journal
 * records `compressed` from the history's `compressionEnded` event; once it
 * fired, the compressed history is the state a resume replays, so the live
 * history must keep it and the request must continue from it.
 *
 * Real LocalMediaStore, HistoryService, ProviderContentEnforcer, production
 * send seam, AnthropicProvider projection, RecordingIntegration and
 * JournalRecordingService writing JSONL, replayed by the real ReplayEngine.
 * Only HTTP is stubbed. The compression callback stands in for
 * CompressionHandler.performCompression: it applies the rewrite and ends the
 * compression exactly as that method does, then fails in a later step.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingIntegration } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { resumeSession } from '@vybestack/llxprt-code-core/recording/resumeSession.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { aiTurn, collectText, rejection } from './image-retirement-harness.js';
import {
  historyTexts,
  textTurn,
  useReliefConversation,
} from './media-relief-fixtures.js';

const SUMMARY = 'COMMITTED AND JOURNALED COMPRESSION SUMMARY';
const PARTIAL = 'UNCOMMITTED PARTIAL REWRITE';
const LATER_FAILURE = 'token settlement failed after the compression committed';
const PROJECT_HASH = 'project-hash-issue4000-committed';

/** Applies the compression and ends it with its summary, as the handler does. */
async function commitCompression(
  history: HistoryService,
  summary: IContent,
): Promise<void> {
  history.startCompression();
  try {
    await history.replaceAll([summary]);
  } finally {
    history.endCompression(summary, 6);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

describe('a committed compression survives a later failure (issue #4000 CodeRabbit round 3 R1)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr3-r1-');
  let journalDirectory = '';
  let recording: JournalRecordingService | undefined;
  let integration: RecordingIntegration | undefined;

  beforeEach(async () => {
    journalDirectory = await mkdtemp(join(tmpdir(), 'llxprt-issue4000-r1-j-'));
  });
  afterEach(async () => {
    await integration?.dispose();
    await recording?.dispose();
    integration = undefined;
    recording = undefined;
    await rm(journalDirectory, { recursive: true, force: true });
  });

  /** Subscribes a real journal to the session's history before it is seeded. */
  async function journalHistory(
    history: HistoryService,
  ): Promise<JournalRecordingService> {
    const service = JournalRecordingService.create({
      sessionId: 'issue4000-committed-0001',
      projectHash: PROJECT_HASH,
      chatsDir: journalDirectory,
      workspaceDirs: ['/workspace/project'],
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    });
    const subscriber = new RecordingIntegration(service);
    await subscriber.subscribeToJournal(history);
    recording = service;
    integration = subscriber;
    return service;
  }

  /** What a resume would restore: the journal replayed from disk. */
  async function resumedTexts(
    service: JournalRecordingService,
    mediaStore: LocalMediaStore,
  ): Promise<{ texts: string[]; ok: boolean }> {
    await integration?.flushAtTurnBoundary();
    await integration?.dispose();
    await service.dispose();
    const replay = await resumeSession({
      continueRef: 'issue4000-committed-0001',
      projectHash: PROJECT_HASH,
      chatsDir: journalDirectory,
      currentProvider: 'anthropic',
      currentModel: 'claude-sonnet-4',
      workspaceDirs: ['/workspace/project'],
      mediaStore,
    });
    if (!replay.ok) throw new Error(replay.error);
    const texts: string[] = [];
    try {
      for await (const row of replay.boot.streamRows())
        texts.push(
          ...row.blocks.flatMap((block) =>
            block.type === 'text' ? [block.text] : [],
          ),
        );
      return { ok: true, texts };
    } finally {
      await replay.boot.close();
      await replay.recording.dispose();
    }
  }

  it('keeps the compressed history, the journal agrees, and the request continues from it', async () => {
    const session = conversation.session();
    const journal = await journalHistory(session.history);
    await conversation.seedImages(3);
    conversation.seedBigText();
    session.useCompression(async (history) => {
      await commitCompression(history, aiTurn(SUMMARY));
      throw new Error(LATER_FAILURE);
    });

    await session.send([textTurn('next question')]);

    const resumed = await resumedTexts(journal, session.store);
    expect({
      live: await historyTexts(session.history),
      resumed,
      sent: session.sent.length,
      sentSummary: collectText(session.lastBody(), []).includes(SUMMARY),
    }).toStrictEqual({
      live: [SUMMARY],
      resumed: { ok: true, texts: [SUMMARY] },
      sent: 1,
      sentSummary: true,
    });
  });

  it('still rolls back a rewrite whose compression never ended', async () => {
    const session = conversation.session();
    const journal = await journalHistory(session.history);
    await conversation.seedImages(3);
    conversation.seedBigText();
    const before = await historyTexts(session.history);
    session.useCompression(async (history) => {
      history.startCompression();
      await history.replaceAll([aiTurn(PARTIAL)]);
      history.endCompression();
      throw new Error('anchor update failed before the compression ended');
    });

    const error = await rejection(session.send([textTurn('next question')]));

    const resumed = await resumedTexts(journal, session.store);
    expect({
      contextOverflow: errorName(error),
      live: await historyTexts(session.history),
      resumedMatchesLive: resumed.texts.join('|') === before.join('|'),
      sent: session.sent.length,
    }).toStrictEqual({
      contextOverflow: 'ContextOverflowError',
      live: before,
      resumedMatchesLive: true,
      sent: 0,
    });
  });

  it('propagates a cancellation that arrives after the commit without undoing it', async () => {
    const session = conversation.session();
    const journal = await journalHistory(session.history);
    await conversation.seedImages(3);
    conversation.seedBigText();
    session.useCompression(async (history) => {
      await commitCompression(history, aiTurn(SUMMARY));
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    });

    const error = await rejection(session.send([textTurn('next question')]));

    const resumed = await resumedTexts(journal, session.store);
    expect({
      name: errorName(error),
      live: await historyTexts(session.history),
      resumed: resumed.texts,
      sent: session.sent.length,
    }).toStrictEqual({
      name: 'AbortError',
      live: [SUMMARY],
      resumed: [SUMMARY],
      sent: 0,
    });
  });
});
