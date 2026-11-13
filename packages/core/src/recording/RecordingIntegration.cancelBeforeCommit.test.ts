/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036 review round 2 (M6): a refusal rewrite that is cancelled before
 * the journal append must not commit, however far its preparation or
 * publication got. Live history, the persisted session and the journal all
 * stay on the original, and the caller sees the abort. A cancel that arrives
 * after the journal append cannot undo the committed rewrite.
 *
 * Everything is real (history, recording, persistence, files). The only
 * stand-in is a gate around the effect the integration prepares, which holds
 * one step open so a cancel can land inside it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  HistoryService,
  type PreparedHistoryBatchEffect,
} from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import type { RefusalRewritePayload } from './types.js';

const SESSION_ID = 'cancel-before-commit-session-01';
const ORIGINAL = 'The agent kills surviving mutants in src/a.ts';
const REWRITTEN = 'The agent terminates surviving mutants in src/a.ts';

type Step = 'prepare' | 'publish' | 'finalize';

function summary(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true },
  };
}

function textsOf(history: readonly IContent[]): string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    ),
  );
}

describe('cancelling a refusal rewrite before the journal append (issue #4036)', () => {
  let tempDir: string;
  let recording: SessionRecordingService;
  let persistence: SessionPersistenceService;
  let integration: RecordingIntegration;
  let history: HistoryService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cancel-commit-'));
    const storage = new Storage(tempDir);
    const chatsDir = storage.getProjectChatsDir();
    await fs.mkdir(chatsDir, { recursive: true });
    recording = new SessionRecordingService({
      sessionId: SESSION_ID,
      projectHash: 'project-hash-cancel-commit',
      chatsDir,
      workspaceDirs: [tempDir],
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
    persistence = new SessionPersistenceService(
      { projectRoot: storage.getProjectRoot(), chatsDir },
      SESSION_ID,
    );
    integration = new RecordingIntegration(recording, persistence);
    history = new HistoryService();
    integration.subscribeToHistory(history);
    history.add(summary(ORIGINAL));
    await integration.flushAtTurnBoundary();
  });

  afterEach(async () => {
    await integration.dispose().catch(() => undefined);
    await recording.dispose().catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function payloadFor(next: readonly IContent[]): RefusalRewritePayload {
    return {
      operationId: 'op-cancel-commit',
      time: '2026-11-12T10:00:00.000Z',
      promptId: 'prompt-1',
      attemptIndex: 1,
      reviewer: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      explanation: 'Plain wording for a mutation-testing summary.',
      changes: [
        {
          id: 'c1.0',
          role: 'human',
          kind: 'summary',
          originalText: ORIGINAL,
          newText: REWRITTEN,
        },
      ],
      resultingHistory: next,
    };
  }

  /**
   * Rewrites the summary through the real integration and cancels inside the
   * named step: the cancel lands once that step's real work is done, while the
   * step is still open, so the commit has not yet moved past it.
   */
  function rewriteCancelledDuring(step: Step): {
    readonly result: Promise<string>;
  } {
    const controller = new AbortController();
    const result = history.replaceIfUnchanged({
      expected: history.getAll(),
      signal: controller.signal,
      rewrite: (current) =>
        current.map((entry) => ({
          ...entry,
          blocks: [{ type: 'text', text: REWRITTEN }],
        })),
      prepareEffect: async (next) => {
        const real = await integration.prepareRefusalRewrite(payloadFor(next));
        const cancelAfter = async (): Promise<void> => {
          controller.abort();
          await Promise.resolve();
        };
        if (step === 'prepare') await cancelAfter();
        return withCancelAfter(real, step, cancelAfter);
      },
    });
    return { result };
  }

  function withCancelAfter(
    real: PreparedHistoryBatchEffect,
    step: Step,
    cancelAfter: () => Promise<void>,
  ): PreparedHistoryBatchEffect {
    return {
      publish: async () => {
        await real.publish();
        if (step === 'publish') await cancelAfter();
      },
      rollback: () => real.rollback(),
      finalize: async () => {
        await real.finalize?.();
        if (step === 'finalize') await cancelAfter();
      },
      settle: () => real.settle?.(),
    };
  }

  async function persistedTexts(): Promise<string[]> {
    const raw = await fs.readFile(persistence.getSessionFilePath(), 'utf8');
    const session = JSON.parse(raw) as { history: IContent[] };
    return textsOf(session.history);
  }

  async function rewriteRecords(): Promise<string[]> {
    const journal = recording.getFilePath();
    if (journal === null) throw new Error('Recording journal missing');
    return (await fs.readFile(journal, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { type: string }).type)
      .filter((type) => type === 'refusal_rewrite');
  }

  async function settledState(result: Promise<string>): Promise<unknown> {
    const outcome = await result.then(
      (value) => value,
      (error: unknown) =>
        error instanceof Error ? `rejected:${error.name}` : 'rejected',
    );
    await integration.flushAtTurnBoundary();
    return {
      outcome,
      live: textsOf(history.getAll()),
      persisted: await persistedTexts(),
      rewriteRecords: await rewriteRecords(),
    };
  }

  const untouched = {
    outcome: 'rejected:AbortError',
    live: [ORIGINAL],
    persisted: [ORIGINAL],
    rewriteRecords: [],
  };

  it('leaves live, persisted and journaled history unchanged when cancelled while the rewrite is being prepared', async () => {
    const { result } = rewriteCancelledDuring('prepare');

    expect(await settledState(result)).toStrictEqual(untouched);
  });

  it('leaves live, persisted and journaled history unchanged when cancelled while the rewrite is being published', async () => {
    const { result } = rewriteCancelledDuring('publish');

    expect(await settledState(result)).toStrictEqual(untouched);
  });

  it('keeps the rewrite everywhere when the cancel arrives after the journal append', async () => {
    const { result } = rewriteCancelledDuring('finalize');

    expect(await settledState(result)).toStrictEqual({
      outcome: 'applied',
      live: [REWRITTEN],
      persisted: [REWRITTEN],
      rewriteRecords: ['refusal_rewrite'],
    });
  });
});
