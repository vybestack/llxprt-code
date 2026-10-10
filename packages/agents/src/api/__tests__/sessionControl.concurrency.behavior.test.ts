/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 *
 * Concurrency / failure-atomicity / bounded-re-attach behavior for
 * SessionControl (issue #1604 code-review FINDINGS A1/A2/A3). These drive the
 * REAL SessionControl against a REAL on-disk recorded session (produced by the
 * REAL SessionRecordingService + SessionLockManager) and an HONEST fake client
 * whose HistoryService can be swapped for a throwing one — never mocks-were-
 * called theater. Every assertion is on real observable state: on-disk lock
 * files, the owner recording projection, actual JSONL content, and the number
 * of live 'contentAdded' subscribers on the real HistoryService.
 *
 * A1 (serialized state mutation): two concurrent resume() calls settle with the
 *     final recording/lock belonging to the LAST operation, no orphaned lock
 *     files, both promises settle.
 * A2 (atomic resume subscribe): when the post-restore subscribe throws, resume
 *     rejects without publishing an owner recording, and the adopted lock file
 *     is released (gone).
 * A3 (bounded re-attach): a startRecording whose HistoryService was unavailable
 *     leaves the integration unsubscribed; the NEXT operation re-attaches it so
 *     later content events reach the recording file.
 */

import { assertNotNull, errorMessage } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, spyOn } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  LocalMediaStore,
  replaySession,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { SessionControl } from '../control/sessionControl.js';
import { AgentSessionPersistence } from '../control/recordedHistoryPersistence.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionControlDeps } from '../control/sessionControl.js';

class IsolatedTestStorage extends Storage {
  constructor(private readonly projectTempDir: string) {
    super(projectTempDir);
  }

  override getProjectTempDir(): string {
    return this.projectTempDir;
  }
}

/** A single human text IContent turn (the neutral recorded shape). */
function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

/**
 * Minimal in-memory Config projection exposing ONLY the surface SessionControl
 * touches: a fixed project root, a storage whose getProjectChatsDir() drives
 * the chats-dir derivation, a workspace context, and persistence inputs.
 * Recording ownership is observable through the real SessionControl and JSONL.
 */
interface FakeConfig {
  readonly getSessionId: () => string;
  readonly adoptSessionId: (sessionId: string) => void;
  readonly getProjectRoot: () => string;
  readonly projectTempDir: string;
  readonly projectChatsDir: string;

  readonly getLocalMediaStore: () => LocalMediaStore;
  readonly getSessionRecordingQueueByteLimit: () => number;
  readonly persistence: AgentSessionPersistence;
  readonly getPersistenceChatsDir: () => string;
}

function buildFakeConfig(
  projectRoot: string,
  persistenceRoot = projectRoot,
  persistenceQueueBytes = 1024 * 1024,
  initialSessionId = 'fake-recording-id',
): FakeConfig {
  const mediaStore = new LocalMediaStore({
    rootDirectory: join(projectRoot, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const persistenceStorage = new IsolatedTestStorage(persistenceRoot);
  let sessionId = initialSessionId;
  return {
    getSessionId: () => sessionId,
    adoptSessionId: (next) => {
      sessionId = next;
    },
    getProjectRoot: () => projectRoot,
    projectTempDir: projectRoot,
    projectChatsDir: join(projectRoot, 'chats'),

    getLocalMediaStore: () => mediaStore,
    getSessionRecordingQueueByteLimit: () => 1024 * 1024,
    persistence: new AgentSessionPersistence(
      {
        projectRoot: persistenceStorage.getProjectRoot(),
        chatsDir: persistenceStorage.getProjectChatsDir(),
      },
      {
        mediaStore,
        maxQueueBytes: persistenceQueueBytes,
      },
    ),
    getPersistenceChatsDir: () =>
      join(persistenceStorage.getProjectTempDir(), 'chats'),
  };
}

/**
 * Honest fake client: exposes a swappable HistoryService and records history
 * replacement calls. getHistory() returns whatever seed was configured (as
 * Gemini-ish content the ContentConverters bridge accepts). This is a genuine
 * collaborator, not a call-spy assertion target.
 */
interface FakeClient {
  contract: AgentClientContract;
  setHistoryService: (hs: HistoryService | null) => void;
  replacementCount: () => number;
}

function buildFakeClient(seed: readonly IContent[] = []): FakeClient {
  let historyService: HistoryService | null = new HistoryService();
  let history = [...seed];
  let replacementCalls = 0;
  const contract = {
    getHistory: async () => [...history],
    getHistoryService: () => historyService,
    setHistory: async (nextHistory: IContent[]) => {
      history = [...nextHistory];
      replacementCalls += 1;
    },
    resetChat: async () => undefined,
    restoreHistory: async (nextHistory: IContent[]) => {
      history = [...nextHistory];
      replacementCalls += 1;
    },
  } as unknown as AgentClientContract;
  return {
    contract,
    setHistoryService: (hs) => {
      historyService = hs;
    },
    replacementCount: () => replacementCalls,
  };
}

function buildDeps(
  config: FakeConfig,
  client: AgentClientContract,
  sessionId: string,
  mediaStore: LocalMediaStore,
): SessionControlDeps {
  return {
    config: config as unknown as SessionControlDeps['config'],
    readRecordingQueueLimit: () => config.getSessionRecordingQueueByteLimit(),
    mediaStore,
    persistence: config.persistence,
    directories: () => [config.getProjectRoot()],
    sessionIdentityOwnership: 'config',
    sessionId: () => sessionId,
    resolveClient: () => client,
    getProvider: () => 'fake',
    getModel: () => 'fake-model',
  };
}

/** chats dir SessionControl derives: join(projectTempDir, 'chats'). */
function chatsDirOf(projectRoot: string): string {
  return join(projectRoot, 'chats');
}

/**
 * Records a REAL resumable session to disk for `sessionId`: materializes a JSONL
 * file via the real SessionRecordingService (seeded with one content event),
 * flushes, and disposes so the file is complete and unlocked (resumable).
 */
async function recordResumableSession(
  projectRoot: string,
  sessionId: string,
  seed: IContent,
  mediaStore?: LocalMediaStore,
): Promise<void> {
  const service = new SessionRecordingService({
    sessionId,
    projectHash: basename(projectRoot),
    chatsDir: chatsDirOf(projectRoot),
    workspaceDirs: [projectRoot],
    provider: 'fake',
    model: 'fake-model',
    ...(mediaStore === undefined ? {} : { mediaStore }),
  });
  service.recordContent(seed);
  await service.flush();
  await service.dispose();
}

/** Runs `fn` against a fresh isolated project-root temp dir, always cleaned up. */
async function withProjectRoot(
  fn: (projectRoot: string) => Promise<void>,
): Promise<void> {
  const projectRoot = mkdtempSync(join(tmpdir(), 'llxprt-sc-conc-'));
  try {
    await fn(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

/** Lists the on-disk .lock files remaining in the chats dir. */
function remainingLockFiles(projectRoot: string): string[] {
  try {
    return readdirSync(chatsDirOf(projectRoot)).filter((n) =>
      n.endsWith('.lock'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Asserts a settled result is fulfilled and returns its value (no conditional
 * expect): throws with the rejection reason otherwise so the test fails with a
 * useful message rather than a swallowed branch.
 */
function unwrapFulfilled<T>(outcome: PromiseSettledResult<T>): T {
  if (outcome.status !== 'fulfilled') {
    throw new Error(
      `expected fulfilled outcome, got rejected: ${String(outcome.reason)}`,
    );
  }
  return outcome.value;
}

describe('Agent session persistence ownership', () => {
  it('gives simultaneous same-label journals distinct paths when their timestamps match', async () => {
    await withProjectRoot(async (projectRoot) => {
      const timestamp = spyOn(Date.prototype, 'toISOString').mockReturnValue(
        '2026-09-27T00:00:00.000Z',
      );
      try {
        const storage = new IsolatedTestStorage(projectRoot);
        const first = new AgentSessionPersistence(
          {
            projectRoot: storage.getProjectRoot(),
            chatsDir: storage.getProjectChatsDir(),
          },
          {},
        );
        const second = new AgentSessionPersistence(
          {
            projectRoot: storage.getProjectRoot(),
            chatsDir: storage.getProjectChatsDir(),
          },
          {},
        );
        const [left, right] = await Promise.all([
          Promise.resolve().then(() => first.forRecording('same-label')),
          Promise.resolve().then(() => second.forRecording('same-label')),
        ]);
        expect(left.getSessionFilePath()).not.toBe(right.getSessionFilePath());
        first.close();
        second.close();
      } finally {
        timestamp.mockRestore();
      }
    });
  });

  it('keeps same-label simultaneous journals isolated and leaves the surviving owner usable', async () => {
    await withProjectRoot(async (projectRoot) => {
      const storage = new IsolatedTestStorage(projectRoot);
      const first = new AgentSessionPersistence(
        {
          projectRoot: storage.getProjectRoot(),
          chatsDir: storage.getProjectChatsDir(),
        },
        {
          maxQueueBytes: 4096,
        },
      );
      const second = new AgentSessionPersistence(
        {
          projectRoot: storage.getProjectRoot(),
          chatsDir: storage.getProjectChatsDir(),
        },
        {
          maxQueueBytes: 4096,
        },
      );
      const left = first.forRecording('same-label');
      const right = second.forRecording('same-label');
      await Promise.all([
        left.save([humanText('left journal')]),
        right.save([humanText('right journal')]),
      ]);
      expect(left.getSessionFilePath()).not.toBe(right.getSessionFilePath());
      expect(readFileSync(left.getSessionFilePath(), 'utf8')).toContain(
        'left journal',
      );
      expect(readFileSync(right.getSessionFilePath(), 'utf8')).toContain(
        'right journal',
      );
      first.close();
      expect(() => first.forRecording('same-label')).toThrow('closed');
      await right.save([humanText('right again')]);
      expect(
        JSON.parse(readFileSync(right.getSessionFilePath(), 'utf8')).generation,
      ).toBe(2);
      second.close();
    });
  });

  it('records through its injected owner even when Config has no persistence factory', async () => {
    await withProjectRoot(async (projectRoot) => {
      const config = buildFakeConfig(projectRoot);
      const client = buildFakeClient();
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          'owned-session',
          config.getLocalMediaStore(),
        ),
      );
      try {
        await control.setRecording({ enabled: true });
        client.contract.getHistoryService()?.add(humanText('owned agent turn'));
        await control.flushRecording();
        expect(readFileSync(control.getRecording().path!, 'utf8')).toContain(
          'owned agent turn',
        );
      } finally {
        await control.dispose();
      }
      expect(() => config.persistence.forRecording('owned-session')).toThrow(
        'closed',
      );
      expect(remainingLockFiles(projectRoot)).toStrictEqual([]);
    });
  });
});

describe('SessionControl concurrency + atomicity (issue #1604 A1/A2/A3) @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', () => {
  it('keeps same-label controllers bound to their own media stores after Config getters change', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'same-label';
      const firstRoot = join(projectRoot, 'first');
      const secondRoot = join(projectRoot, 'second');
      const firstConfig = buildFakeConfig(firstRoot);
      const secondConfig = buildFakeConfig(secondRoot);
      const firstStore = firstConfig.getLocalMediaStore();
      const secondStore = secondConfig.getLocalMediaStore();
      const firstRef = await firstStore.admit({
        bytes: new Uint8Array([10, 11, 12]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const secondRef = await secondStore.admit({
        bytes: new Uint8Array([20, 21, 22]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const first = new SessionControl(
        buildDeps(
          {
            ...firstConfig,
            getLocalMediaStore: () => {
              throw new Error('first Config getter used');
            },
          },
          buildFakeClient([
            { speaker: 'human', blocks: [firstRef] },
            humanText('first discarded'),
          ]).contract,
          sessionId,
          firstStore,
        ),
      );
      const second = new SessionControl(
        buildDeps(
          {
            ...secondConfig,
            getLocalMediaStore: () => {
              throw new Error('second Config getter used');
            },
          },
          buildFakeClient([
            { speaker: 'human', blocks: [secondRef] },
            humanText('second discarded'),
          ]).contract,
          sessionId,
          secondStore,
        ),
      );
      try {
        await first.setRecording({ enabled: true });
        await second.setRecording({ enabled: true });
        await first.createCheckpoint('first-media');
        await second.createCheckpoint('second-media');
        const firstPath = first.getRecording().path;
        const secondPath = second.getRecording().path;
        if (!firstPath || !secondPath)
          throw new Error('Missing recording path');
        expect(readFileSync(firstPath, 'utf8')).toContain(firstRef.contentId);
        expect(readFileSync(firstPath, 'utf8')).not.toContain(
          secondRef.contentId,
        );
        expect(readFileSync(secondPath, 'utf8')).toContain(secondRef.contentId);
        expect(readFileSync(secondPath, 'utf8')).not.toContain(
          firstRef.contentId,
        );
        const firstRestored = await first.restoreTurns(1);
        const secondRestored = await second.restoreTurns(1);
        expect(JSON.stringify(firstRestored.remainingHistory)).toContain(
          firstRef.contentId,
        );
        expect(JSON.stringify(firstRestored.remainingHistory)).not.toContain(
          secondRef.contentId,
        );
        expect(JSON.stringify(secondRestored.remainingHistory)).toContain(
          secondRef.contentId,
        );
        expect(JSON.stringify(secondRestored.remainingHistory)).not.toContain(
          firstRef.contentId,
        );
      } finally {
        await first.dispose();
        await second.dispose();
        await firstStore.close();
        await secondStore.close();
      }
    });
  });

  it('A1: serializes resume() racing stopRecording so the teardown cannot dispose the resource resume is adopting — the LAST-submitted op wins with a clean, consistent final state and no orphaned lock @requirement:REQ-010', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'concurrent-session-id';
      await recordResumableSession(
        projectRoot,
        sessionId,
        humanText('recorded turn alpha'),
      );

      const config = buildFakeConfig(
        projectRoot,
        projectRoot,
        1024 * 1024,
        sessionId,
      );
      const liveHistory = [humanText('live turn')];
      const client = buildFakeClient(liveHistory);
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          sessionId,
          config.getLocalMediaStore(),
        ),
      );

      // Fire resume() and setRecording({ enabled: false }) concurrently.
      // Without the op-chain mutex the stop could read/dispose the recording +
      // release the lock that resume is mid-way through adopting (use-after-free
      // / a "completed" stop that nonetheless leaves recording enabled, or an
      // orphaned lock file). With serialization the two run strictly in
      // submission order: resume FULLY adopts the resumed recording + lock, THEN
      // stop tears that exact resource down — a clean disabled end state.
      const resumePromise = control.resume('latest');
      const stopPromise = control.setRecording({ enabled: false });
      const [resumeOutcome, stopOutcome] = await Promise.allSettled([
        resumePromise,
        stopPromise,
      ]);

      // Both settle without a crossed-state crash.
      expect(stopOutcome.status).toBe('fulfilled');
      // resume genuinely ran and adopted the recorded history (it restored a
      // non-empty transcript through the client) — proving the stop did NOT
      // short-circuit or corrupt the in-flight resume. Unwrap via the settled
      // result's value without a conditional expect.
      const resumeValue = unwrapFulfilled(resumeOutcome);
      expect(resumeValue.length).toBeGreaterThanOrEqual(1);
      expect(client.replacementCount()).toBe(1);

      // LAST-submitted op wins: stop ran AFTER resume fully committed, so the
      // final state is cleanly DISABLED and the resumed lock is released.
      // A non-serialized interleaving would leave recording enabled or a lock.
      expect(control.getRecording().enabled).toBe(false);
      expect(control.getRecording().path).toBeUndefined();
      expect(remainingLockFiles(projectRoot)).toStrictEqual([]);

      // Dispose after an already-clean teardown is a safe no-op.
      await expect(control.dispose()).resolves.toBeUndefined();
    });
  });

  it('A1b: serializes two concurrent resume() calls for the same latest session — both settle, no orphaned lock, exactly one lock survives with the winning recording @requirement:REQ-010', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'concurrent-dual-resume';
      await recordResumableSession(
        projectRoot,
        sessionId,
        humanText('recorded turn omega'),
      );

      const config = buildFakeConfig(
        projectRoot,
        projectRoot,
        1024 * 1024,
        sessionId,
      );
      const client = buildFakeClient([humanText('live turn')]);
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          sessionId,
          config.getLocalMediaStore(),
        ),
      );

      // Two concurrent resume('latest') calls. The session lock is EXCLUSIVE, so
      // exactly one can hold it at a time. Serialization makes the first fully
      // adopt the lock, then the second observes it held (by this same process)
      // and rejects cleanly with "in use" — WITHOUT adopting or releasing the
      // first op's resources (no crossed state, no orphaned lock).
      const [first, second] = await Promise.allSettled([
        control.resume('latest'),
        control.resume('latest'),
      ]);

      // Both settle; exactly one succeeds and one rejects with the lock reason.
      const statuses = [first.status, second.status].sort();
      expect(statuses).toStrictEqual(['fulfilled', 'rejected']);
      const rejected = [first, second].find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect(
        ((rejected as PromiseRejectedResult).reason as Error).message,
      ).toMatch(/in use/i);

      // The winner's recording remains active and EXACTLY ONE lock survives.
      // The lock is named after the resolved session file, not the session ID.
      const winningPath = control.getRecording().path;
      if (typeof winningPath !== 'string')
        throw new Error('Winning recording has no file');
      expect(control.getRecording().enabled).toBe(true);
      expect(readFileSync(winningPath, 'utf8')).toContain(
        'recorded turn omega',
      );
      expect(remainingLockFiles(projectRoot)).toHaveLength(1);

      // Teardown releases the surviving lock without losing the recording.
      await control.dispose();
      expect(remainingLockFiles(projectRoot)).toStrictEqual([]);
      expect(readFileSync(winningPath, 'utf8')).toContain(
        'recorded turn omega',
      );
    });
  });

  it('A2: a post-restore subscribe failure rejects resume without adopting recording or leaking a lock @requirement:REQ-010', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'atomic-resume-session';
      const config = buildFakeConfig(projectRoot);
      const mediaStore = config.getLocalMediaStore();
      const mediaReference = await mediaStore.admit({
        bytes: new Uint8Array([4, 8, 15, 16, 23, 42]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      await recordResumableSession(
        projectRoot,
        sessionId,
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'recorded turn beta' },
            mediaReference,
          ],
        },
        mediaStore,
      );

      const liveHistory = [humanText('live turn')];
      const client = buildFakeClient(liveHistory);

      // A HistoryService whose 'on' throws so the post-restore integration
      // subscribe fails DURING resume (after the resumed recording + lock were
      // acquired). This models a real subscribe failure, not a mocked outcome.
      const throwingHistory = new HistoryService();
      const originalOn = throwingHistory.on.bind(throwingHistory);
      throwingHistory.on = ((
        event: string,
        listener: (...a: never[]) => void,
      ) => {
        if (event === 'contentAdded') {
          throw new Error('subscribe boom');
        }
        return originalOn(
          event as Parameters<typeof originalOn>[0],
          listener as Parameters<typeof originalOn>[1],
        );
      }) as HistoryService['on'];
      client.setHistoryService(throwingHistory);

      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          sessionId,
          config.getLocalMediaStore(),
        ),
      );

      // resume MUST reject with the subscribe failure (not silently half-enable).
      await expect(control.resume('latest')).rejects.toThrow('subscribe boom');

      expect(control.getRecording()).toMatchObject({ enabled: false });
      expect(control.getRecording().path).toBeUndefined();
      expect(await client.contract.getHistory()).toStrictEqual(liveHistory);
      expect(await mediaStore.hasReservations(mediaReference.contentId)).toBe(
        false,
      );

      // The adopted session lock was released: NO lock file remains on disk.
      expect(remainingLockFiles(projectRoot)).toStrictEqual([]);

      // Dispose is a clean no-op (nothing to release) — does not throw.
      await expect(control.dispose()).resolves.toBeUndefined();
    });
  });

  it('flushes pending recording and persistence before creating a checkpoint', async () => {
    await withProjectRoot(async (projectRoot) => {
      const persistenceRoot = join(projectRoot, 'failing-persistence');
      const config = buildFakeConfig(projectRoot, persistenceRoot);
      const client = buildFakeClient([humanText('checkpoint seed')]);
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          'checkpoint-persistence',
          config.getLocalMediaStore(),
        ),
      );
      await control.setRecording({ enabled: true });
      const persistenceChats = config.getPersistenceChatsDir();
      mkdirSync(join(persistenceChats, '..'), { recursive: true });
      writeFileSync(persistenceChats, 'not a directory');
      const historyService = client.contract.getHistoryService();
      assertNotNull(historyService, 'Expected history service');
      historyService.add(humanText('pending persistence generation'));

      try {
        await expect(control.createCheckpoint('must-flush')).rejects.toThrow(
          /persistence generation 1 failed/i,
        );
      } finally {
        rmSync(persistenceChats, { force: true });
        mkdirSync(persistenceChats, { recursive: true });
        await control.dispose();
      }
    });
  });

  it('reports both a live clear failure and recording resubscription failure', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'clear-dual-failure';
      const config = buildFakeConfig(projectRoot);
      const client = buildFakeClient([
        humanText('initial turn'),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] },
      ]);
      const liveHistory = new HistoryService();
      client.setHistoryService(liveHistory);
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          sessionId,
          config.getLocalMediaStore(),
        ),
      );
      await control.setRecording({ enabled: true });

      client.contract.resetChat = async () => {
        throw new Error('clear failed');
      };
      const originalOn = liveHistory.on.bind(liveHistory);
      liveHistory.on = ((
        event: string,
        listener: (...args: never[]) => void,
      ) => {
        if (event === 'contentAdded') {
          throw new Error('resubscribe failed');
        }
        return originalOn(
          event as Parameters<typeof originalOn>[0],
          listener as Parameters<typeof originalOn>[1],
        );
      }) as HistoryService['on'];

      let thrown: unknown;
      try {
        await control.clearHistory();
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AggregateError);
      expect(
        (thrown as AggregateError).errors.map((error) => errorMessage(error)),
      ).toStrictEqual(['clear failed', 'resubscribe failed']);
      await control.dispose();
    });
  });

  it('restores the original history when the cleared-history restore fails', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'clear-restore-rollback';
      const originalHistory: IContent[] = [
        humanText('initial turn'),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] },
        humanText('later turn'),
      ];
      const config = buildFakeConfig(projectRoot);
      const client = buildFakeClient(originalHistory);
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          sessionId,
          config.getLocalMediaStore(),
        ),
      );
      await control.setRecording({ enabled: true });
      const recordingPath = control.getRecording().path;
      if (typeof recordingPath !== 'string')
        throw new Error('Missing recording file');
      expect(recordingPath).toBeDefined();
      const restoreHistory = client.contract.restoreHistory.bind(
        client.contract,
      );
      let restoreAttempt = 0;
      client.contract.restoreHistory = async (history) => {
        restoreAttempt += 1;
        if (restoreAttempt === 1) throw new Error('remaining restore failed');
        await restoreHistory(history);
      };

      await expect(control.clearHistory()).rejects.toThrow(
        'remaining restore failed',
      );
      expect(await client.contract.getHistory()).toStrictEqual(originalHistory);
      expect(restoreAttempt).toBe(1);
      expect(client.replacementCount()).toBe(1);
      const replay = await replaySession(recordingPath, basename(projectRoot));
      if (replay.ok !== true) {
        throw new Error(`Expected replay success: ${replay.error}`);
      }
      expect(replay.history).toStrictEqual(originalHistory);
      await control.dispose();
    });
  });

  it('A3: an integration left unsubscribed (HistoryService unavailable at enable) is re-attached by the next operation, so later content events reach the recording @requirement:REQ-010', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'reattach-session';
      const config = buildFakeConfig(projectRoot);
      // Enable recording while the client has NO HistoryService: the integration
      // is committed but left unsubscribed (continuous recording dead).
      const client = buildFakeClient([humanText('seed turn')]);
      client.setHistoryService(null);
      const control = new SessionControl(
        buildDeps(
          config,
          client.contract,
          sessionId,
          config.getLocalMediaStore(),
        ),
      );

      await control.setRecording({ enabled: true });
      const path = control.getRecording().path;
      if (typeof path !== 'string') throw new Error('Missing recording file');
      assertNotNull(path, 'Recording did not materialize');

      // Now a HistoryService becomes available (as it would once the client's
      // chat materializes). No listener is attached yet (enable could not
      // subscribe), so the bounded-re-attach must wire it on the NEXT operation.
      const liveHistory = new HistoryService();
      expect(liveHistory.listenerCount('contentAdded')).toBe(0);
      client.setHistoryService(liveHistory);

      // Drive re-attach through resume of a nonexistent session: resume calls
      // ensureSubscribed() FIRST, re-attaching the ORIGINAL integration, and it
      // only replaces/disposes that integration after a successful lookup.
      // Therefore the expected lookup failure leaves the re-attached listener
      // available for direct observation below.
      const beforeCount = liveHistory.listenerCount('contentAdded');
      await expect(control.resume('does-not-exist-id')).rejects.toThrow(
        /Failed to resume session/,
      );

      // Re-attachment makes subsequent content durable in this owner's file.
      expect(liveHistory.listenerCount('contentAdded')).toBe(beforeCount + 1);
      liveHistory.add(humanText('turn after bounded reattachment'));
      expect(control.getRecording()).toMatchObject({ enabled: true, path });
      await control.setRecording({ enabled: false });
      expect(readFileSync(path, 'utf8')).toContain(
        'turn after bounded reattachment',
      );
      expect(liveHistory.listenerCount('contentAdded')).toBe(0);
      await control.dispose();
    });
  });
});
