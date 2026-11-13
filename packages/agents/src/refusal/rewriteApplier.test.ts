/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: a reviewed rewrite and its journal record commit together or
 * not at all. The history is real; the journal is the external boundary, so a
 * small stand-in plays the part of a journal that can refuse a record.
 */

import { describe, expect, it } from 'bun:test';
import type { RefusalRewritePayload } from '@vybestack/llxprt-code-core';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RefusalAttempt } from './refusalTypes.js';
import { buildReviewWindow } from './reviewWindow.js';
import { applyReviewedRewrite } from './rewriteApplier.js';

const ATTEMPT: RefusalAttempt = {
  finishReason: 'refusal',
  turnId: 'turn-1',
  promptId: 'prompt-1',
  attemptIndex: 2,
  provider: 'anthropic',
  model: 'claude-opus-5-5',
};

const REVIEWER = { profile: 'sonnet', provider: 'anthropic', model: 'sonnet' };

function summary(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true },
  };
}

class Journal {
  readonly published: RefusalRewritePayload[] = [];
  readonly rolledBack: RefusalRewritePayload[] = [];
  /** Runs inside the asynchronous preparation, before it resolves. */
  onPrepare: (() => Promise<void>) | undefined;
  constructor(private readonly failToPublish = false) {}

  execution(): AgentChatRecordingExecution {
    return {
      historyOrigin: {},
      hookOwner: { sessionId: () => 's', transcriptPath: () => undefined },
      transcriptPath: () => undefined,
      persistSemanticMediaPurge: () => Promise.resolve(),
      prepareRefusalRewrite: async (payload) => {
        await this.onPrepare?.();
        return {
          publish: () => {
            if (this.failToPublish) throw new Error('journal is unwritable');
            this.published.push(payload);
          },
          rollback: () => {
            this.rolledBack.push(payload);
          },
        };
      },
    };
  }
}

async function scenario() {
  const history = new HistoryService();
  await history.addBatch([
    summary('kills 3 mutants in src/a.ts'),
    { speaker: 'human', blocks: [{ type: 'text', text: 'keep going' }] },
  ]);
  const window = buildReviewWindow(history.getAll());
  const rewrites = [
    { id: window.entries[0].id, newText: 'terminates 3 mutants in src/a.ts' },
  ];
  return { history, window, rewrites };
}

function request(
  s: Awaited<ReturnType<typeof scenario>>,
  execution: AgentChatRecordingExecution | undefined,
) {
  return {
    history: s.history,
    window: s.window,
    rewrites: s.rewrites,
    execution,
    attempt: ATTEMPT,
    reviewer: REVIEWER,
    explanation: 'plain wording',
    operationId: 'op-9',
    now: new Date('2026-11-12T10:00:00.000Z'),
  };
}

function texts(history: HistoryService): string[] {
  return history
    .getAll()
    .flatMap((c) =>
      c.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])),
    );
}

describe('applying a reviewed rewrite', () => {
  it('commits the history and journals the original, the new text and the parent attempt', async () => {
    const s = await scenario();
    const journal = new Journal();

    const result = await applyReviewedRewrite(request(s, journal.execution()));

    const [record] = journal.published;
    expect({
      kind: result.kind,
      live: texts(s.history),
      parent: [record.promptId, record.attemptIndex, record.operationId],
      reviewer: record.reviewer,
      change: record.changes,
      snapshot: record.resultingHistory.map((c) => c.blocks[0]),
    }).toStrictEqual({
      kind: 'applied',
      live: ['terminates 3 mutants in src/a.ts', 'keep going'],
      parent: ['prompt-1', 2, 'op-9'],
      reviewer: REVIEWER,
      change: [
        {
          id: s.window.entries[0].id,
          role: 'human',
          kind: 'summary',
          originalText: 'kills 3 mutants in src/a.ts',
          newText: 'terminates 3 mutants in src/a.ts',
        },
      ],
      snapshot: [
        { type: 'text', text: 'terminates 3 mutants in src/a.ts' },
        { type: 'text', text: 'keep going' },
      ],
    });
  });

  it('rolls the live rewrite back when the journal cannot take the record', async () => {
    const s = await scenario();
    const journal = new Journal(true);

    const result = await applyReviewedRewrite(request(s, journal.execution()));

    expect({
      kind: result.kind,
      detail: result.kind === 'commit-failed' ? result.detail : '',
      live: texts(s.history),
      rolledBack: journal.rolledBack.length,
    }).toStrictEqual({
      kind: 'commit-failed',
      detail: 'journal is unwritable',
      live: ['kills 3 mutants in src/a.ts', 'keep going'],
      rolledBack: 1,
    });
  });

  it('discards the rewrite when the history changed after it was reviewed', async () => {
    const s = await scenario();
    const journal = new Journal();
    await s.history.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: 'late arrival' }] },
    ]);

    const result = await applyReviewedRewrite(request(s, journal.execution()));

    expect({
      kind: result.kind,
      live: texts(s.history),
      published: journal.published.length,
    }).toStrictEqual({
      kind: 'history-changed',
      live: ['kills 3 mutants in src/a.ts', 'keep going', 'late arrival'],
      published: 0,
    });
  });

  it('rewrites a host that keeps no journal', async () => {
    const s = await scenario();

    const result = await applyReviewedRewrite(request(s, undefined));

    expect({ kind: result.kind, live: texts(s.history) }).toStrictEqual({
      kind: 'applied',
      live: ['terminates 3 mutants in src/a.ts', 'keep going'],
    });
  });

  it('stops at the abort and writes nothing when the request is cancelled while the journal record is being prepared', async () => {
    const s = await scenario();
    const journal = new Journal();
    const controller = new AbortController();
    let releasePrepare: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    journal.onPrepare = async () => {
      controller.abort();
      await released;
    };

    const pending = applyReviewedRewrite({
      ...request(s, journal.execution()),
      signal: controller.signal,
    }).then(
      (result) => result.kind,
      (error: unknown) =>
        error instanceof Error ? `rejected:${error.name}` : 'rejected',
    );
    releasePrepare();

    expect({
      result: await pending,
      live: texts(s.history),
      published: journal.published.length,
      rolledBack: journal.rolledBack.length,
    }).toStrictEqual({
      result: 'rejected:AbortError',
      live: ['kills 3 mutants in src/a.ts', 'keep going'],
      published: 0,
      rolledBack: 1,
    });
  });
});
