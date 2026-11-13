/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036 review round 1 (H4): the durable journal append is the commit
 * point of a refusal rewrite. Until it succeeds the persisted session file
 * stays reversible, so a journal that cannot take the record leaves live
 * history, the persisted session and the journal all on the previous history.
 * A failure after the commit point is cleanup and must not undo the rewrite.
 *
 * Everything is real (history, recording, persistence, files); the faults are
 * injected at the filesystem: the journal path becomes a directory, and a
 * persistence finalizer fails after the journal has the record.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import {
  SessionPersistenceService,
  type PreparedPersistenceSave,
} from '../storage/SessionPersistenceService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import type { RefusalRewritePayload } from './types.js';

const SESSION_ID = 'journal-commit-session-0001';
const ORIGINAL = 'The agent kills surviving mutants in src/a.ts';
const REWRITTEN = 'The agent terminates surviving mutants in src/a.ts';

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

/**
 * A persistence service whose finalizer fails after really finalizing, and
 * whose publication can be held open and then made to fail.
 */
class FailingFinalizerPersistence extends SessionPersistenceService {
  failFinalize = false;
  /** Held open until released, so other writes can run during publication. */
  publishGate: Promise<void> | undefined;
  failPublish = false;
  persistenceRollbacks = 0;

  override async prepareSave(
    history: readonly IContent[],
  ): Promise<PreparedPersistenceSave> {
    const prepared = await super.prepareSave(history);
    return {
      publish: async () => {
        await this.publishGate;
        if (this.failPublish) throw new Error('persistence publish failed');
        await prepared.publish();
      },
      rollback: async () => {
        this.persistenceRollbacks += 1;
        await prepared.rollback();
      },
      finalize: async () => {
        await prepared.finalize();
        if (this.failFinalize) {
          throw new Error('media commit failed after the journal append');
        }
      },
    };
  }
}

describe('journal append is the commit point of a refusal rewrite (issue #4036)', () => {
  let tempDir: string;
  let recording: SessionRecordingService;
  let persistence: FailingFinalizerPersistence;
  let integration: RecordingIntegration;
  let history: HistoryService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-commit-'));
    const storage = new Storage(tempDir);
    const chatsDir = storage.getProjectChatsDir();
    await fs.mkdir(chatsDir, { recursive: true });
    recording = new SessionRecordingService({
      sessionId: SESSION_ID,
      projectHash: 'project-hash-journal-commit',
      chatsDir,
      workspaceDirs: [tempDir],
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
    persistence = new FailingFinalizerPersistence(
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
    // A recorder whose journal broke reports that failure once more on close.
    await integration.dispose().catch(() => undefined);
    await recording.dispose().catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function payloadFor(next: readonly IContent[]): RefusalRewritePayload {
    return {
      operationId: 'op-journal-commit',
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

  function rewriteSummary(): Promise<string> {
    return history.replaceIfUnchanged({
      expected: history.getAll(),
      rewrite: (current) =>
        current.map((entry) => ({
          ...entry,
          blocks: [{ type: 'text', text: REWRITTEN }],
        })),
      prepareEffect: (next) =>
        integration.prepareRefusalRewrite(payloadFor(next)),
    });
  }

  async function persistedTexts(): Promise<string[]> {
    const raw = await fs.readFile(persistence.getSessionFilePath(), 'utf8');
    const session = JSON.parse(raw) as { history: IContent[] };
    return textsOf(session.history);
  }

  function journalPath(): string {
    const journal = recording.getFilePath();
    if (journal === null) throw new Error('Recording journal missing');
    return journal;
  }

  async function journalTypes(): Promise<string[]> {
    return (await fs.readFile(journalPath(), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { type: string }).type);
  }

  /** The journal is unwritable until the returned function restores it. */
  async function breakJournal(): Promise<() => Promise<void>> {
    const journal = journalPath();
    const aside = `${journal}.aside`;
    await fs.rename(journal, aside);
    await fs.mkdir(journal);
    return async () => {
      await fs.rmdir(journal);
      await fs.rename(aside, journal);
    };
  }

  it('leaves live, persisted and journaled history on the original when the journal cannot take the record', async () => {
    const restoreJournal = await breakJournal();

    const failure = await rewriteSummary().then(
      () => undefined,
      (error: unknown) => error,
    );
    await restoreJournal();

    expect({
      failed: failure instanceof Error,
      live: textsOf(history.getAll()),
      persisted: await persistedTexts(),
      rewriteRecords: (await journalTypes()).filter(
        (type) => type === 'refusal_rewrite',
      ),
    }).toStrictEqual({
      failed: true,
      live: [ORIGINAL],
      persisted: [ORIGINAL],
      rewriteRecords: [],
    });
  });

  it('keeps the rewrite out of the journal when another write drains while persistence publishes and then fails', async () => {
    let release: () => void = () => undefined;
    persistence.publishGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    persistence.failPublish = true;

    const rewriting = rewriteSummary().then(
      () => undefined,
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    recording.recordSessionEvent('info', 'written while the rewrite commits');
    await recording.flush();
    release();
    const failure = await rewriting;
    await integration.flushAtTurnBoundary();

    expect({
      failed: failure instanceof Error,
      live: textsOf(history.getAll()),
      journal: await journalTypes(),
    }).toStrictEqual({
      failed: true,
      live: [ORIGINAL],
      journal: ['session_start', 'content', 'session_event'],
    });
  });

  it('still rolls back the persisted snapshot when the journal cleanup fails', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-fresh-'));
    try {
      const storage = new Storage(freshDir);
      const chatsDir = storage.getProjectChatsDir();
      await fs.mkdir(chatsDir, { recursive: true });
      const freshRecording = new SessionRecordingService({
        sessionId: 'journal-fresh-session-0001',
        projectHash: 'project-hash-journal-fresh',
        chatsDir,
        workspaceDirs: [freshDir],
        provider: 'anthropic',
        model: 'claude-opus-5-5',
      });
      const freshPersistence = new FailingFinalizerPersistence(
        { projectRoot: storage.getProjectRoot(), chatsDir },
        'journal-fresh-session-0001',
      );
      const freshIntegration = new RecordingIntegration(
        freshRecording,
        freshPersistence,
      );
      // Content that existed before recording attached is never journaled, so
      // the rewrite is the first record and creates the journal file.
      const freshHistory = new HistoryService();
      freshHistory.add(summary(ORIGINAL));
      freshIntegration.subscribeToHistory(freshHistory);
      let release: () => void = () => undefined;
      freshPersistence.publishGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      freshPersistence.failPublish = true;

      const rewriting = freshHistory
        .replaceIfUnchanged({
          expected: freshHistory.getAll(),
          rewrite: (current) =>
            current.map((entry) => ({
              ...entry,
              blocks: [{ type: 'text', text: REWRITTEN }],
            })),
          prepareEffect: (next) =>
            freshIntegration.prepareRefusalRewrite(payloadFor(next)),
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const journal = freshRecording.getFilePath();
      if (journal === null) throw new Error('Recording journal missing');
      await fs.rm(journal);
      release();
      const failure = await rewriting;

      expect({
        failed: failure instanceof Error,
        persistenceRollbacks: freshPersistence.persistenceRollbacks,
        live: textsOf(freshHistory.getAll()),
      }).toStrictEqual({
        failed: true,
        persistenceRollbacks: 1,
        live: [ORIGINAL],
      });
      await freshIntegration.dispose().catch(() => undefined);
      await freshRecording.dispose().catch(() => undefined);
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('applies the rewrite everywhere when the journal append succeeds', async () => {
    const outcome = await rewriteSummary();
    await integration.flushAtTurnBoundary();

    expect({
      outcome,
      live: textsOf(history.getAll()),
      persisted: await persistedTexts(),
      rewriteRecords: (await journalTypes()).filter(
        (type) => type === 'refusal_rewrite',
      ),
    }).toStrictEqual({
      outcome: 'applied',
      live: [REWRITTEN],
      persisted: [REWRITTEN],
      rewriteRecords: ['refusal_rewrite'],
    });
  });

  it('keeps the rewrite when only cleanup fails after the journal append', async () => {
    persistence.failFinalize = true;

    const outcome = await rewriteSummary();
    persistence.failFinalize = false;
    await integration.flushAtTurnBoundary();

    expect({
      outcome,
      live: textsOf(history.getAll()),
      persisted: await persistedTexts(),
      rewriteRecords: (await journalTypes()).filter(
        (type) => type === 'refusal_rewrite',
      ),
    }).toStrictEqual({
      outcome: 'applied',
      live: [REWRITTEN],
      persisted: [REWRITTEN],
      rewriteRecords: ['refusal_rewrite'],
    });
  });
});
