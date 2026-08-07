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
 * files, the Config-installed recording service identity, and the number of
 * live 'contentAdded' subscribers on the real HistoryService.
 *
 * A1 (serialized state mutation): two concurrent resume() calls settle with the
 *     final recording/lock belonging to the LAST operation, no orphaned lock
 *     files, both promises settle.
 * A2 (atomic resume subscribe): when the post-restore subscribe throws, resume
 *     rejects, Config is NOT left pointing at the resumed service, and the
 *     adopted lock file is released (gone).
 * A3 (bounded re-attach): a startRecording whose HistoryService was unavailable
 *     leaves the integration unsubscribed; the NEXT operation re-attaches it so
 *     later content events reach the recording file.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  replaySession,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { SessionControl } from '../control/sessionControl.js';
import type { SessionControlDeps } from '../control/sessionControl.js';

/** Alias for the recording-service type used in the FakeConfig projection. */
type SessionRecordingServiceType = SessionRecordingService;

/** A single human text IContent turn (the neutral recorded shape). */
function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

/**
 * Minimal in-memory Config projection exposing ONLY the surface SessionControl
 * touches: a fixed project root, a storage whose getProjectChatsDir() drives
 * the chats-dir derivation, a workspace context, and the recording-service
 * get/set pair. The installed recording service is observable so A2 can assert
 * Config was not left pointing at a half-installed resumed service.
 */
interface FakeConfig {
  readonly getProjectRoot: () => string;
  readonly storage: {
    readonly getProjectTempDir: () => string;
    readonly getProjectChatsDir: () => string;
  };
  readonly getWorkspaceContext: () => {
    readonly getDirectories: () => readonly string[];
  };
  setSessionRecordingService: (
    service: SessionRecordingServiceType | undefined,
  ) => void;
  getSessionRecordingService: () => SessionRecordingServiceType | undefined;
}

function buildFakeConfig(projectRoot: string): FakeConfig {
  let installed: SessionRecordingServiceType | undefined;
  return {
    getProjectRoot: () => projectRoot,
    storage: {
      getProjectTempDir: () => projectRoot,
      getProjectChatsDir: () => join(projectRoot, 'chats'),
    },
    getWorkspaceContext: () => ({ getDirectories: () => [projectRoot] }),
    setSessionRecordingService: (service) => {
      installed = service;
    },
    getSessionRecordingService: () => installed,
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
): SessionControlDeps {
  return {
    config: config as unknown as SessionControlDeps['config'],
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
): Promise<void> {
  const service = new SessionRecordingService({
    sessionId,
    projectHash: basename(projectRoot),
    chatsDir: chatsDirOf(projectRoot),
    workspaceDirs: [projectRoot],
    provider: 'fake',
    model: 'fake-model',
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

describe('SessionControl concurrency + atomicity (issue #1604 A1/A2/A3) @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', () => {
  it('A1: serializes resume() racing stopRecording so the teardown cannot dispose the resource resume is adopting — the LAST-submitted op wins with a clean, consistent final state and no orphaned lock @requirement:REQ-010', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'concurrent-session-id';
      await recordResumableSession(
        projectRoot,
        sessionId,
        humanText('recorded turn alpha'),
      );

      const config = buildFakeConfig(projectRoot);
      const liveHistory = [humanText('live turn')];
      const client = buildFakeClient(liveHistory);
      const control = new SessionControl(
        buildDeps(config, client.contract, sessionId),
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
      // final state is cleanly DISABLED — recording off, Config cleared, and the
      // resumed lock released (no orphaned lock file). A non-serialized
      // interleaving would leave recording enabled or a dangling lock here.
      expect(control.getRecording().enabled).toBe(false);
      expect(config.getSessionRecordingService()).toBeUndefined();
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

      const config = buildFakeConfig(projectRoot);
      const client = buildFakeClient([humanText('live turn')]);
      const control = new SessionControl(
        buildDeps(config, client.contract, sessionId),
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

      // The winner's recording is active + Config-installed, and EXACTLY ONE
      // lock file survives (the rejected op did not orphan a second lock nor
      // release the winner's). The lock is named after the resolved session
      // FILE (core locks the target file), so assert the COUNT, not the name.
      expect(control.getRecording().enabled).toBe(true);
      expect(config.getSessionRecordingService()?.isActive()).toBe(true);
      expect(remainingLockFiles(projectRoot)).toHaveLength(1);

      // Teardown releases the surviving lock (no leak past dispose).
      await control.dispose();
      expect(remainingLockFiles(projectRoot)).toStrictEqual([]);
    });
  });

  it('A2: a post-restore subscribe failure rejects resume, leaves Config NOT pointing at the resumed service, and releases the adopted lock file @requirement:REQ-010', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'atomic-resume-session';
      await recordResumableSession(
        projectRoot,
        sessionId,
        humanText('recorded turn beta'),
      );

      const config = buildFakeConfig(projectRoot);
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
        buildDeps(config, client.contract, sessionId),
      );

      // resume MUST reject with the subscribe failure (not silently half-enable).
      await expect(control.resume('latest')).rejects.toThrow('subscribe boom');

      expect(config.getSessionRecordingService()).toBeUndefined();
      expect(control.getRecording().enabled).toBe(false);
      expect(await client.contract.getHistory()).toStrictEqual(liveHistory);

      // The adopted session lock was released: NO lock file remains on disk.
      expect(remainingLockFiles(projectRoot)).toStrictEqual([]);

      // Dispose is a clean no-op (nothing to release) — does not throw.
      await expect(control.dispose()).resolves.toBeUndefined();
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
        buildDeps(config, client.contract, sessionId),
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
        (thrown as AggregateError).errors.map((error) =>
          error instanceof Error ? error.message : String(error),
        ),
      ).toStrictEqual(['clear failed', 'resubscribe failed']);
      await control.dispose();
    });
  });

  it('restores the original history when the cleared-history restore fails', async () => {
    await withProjectRoot(async (projectRoot) => {
      const sessionId = 'clear-restore-rollback';
      const originalHistory = [
        humanText('initial turn'),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] },
        humanText('later turn'),
      ];
      const config = buildFakeConfig(projectRoot);
      const client = buildFakeClient(originalHistory);
      const control = new SessionControl(
        buildDeps(config, client.contract, sessionId),
      );
      await control.setRecording({ enabled: true });
      const recordingPath = control.getRecording().path;
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
      const replay = await replaySession(recordingPath!, basename(projectRoot));
      if (!replay.ok) {
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
        buildDeps(config, client.contract, sessionId),
      );

      await control.setRecording({ enabled: true });
      const recording = config.getSessionRecordingService();
      expect(recording).toBeDefined();

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

      // The previously-dead integration is now subscribed to the live history:
      // exactly one 'contentAdded' listener was attached by the re-attach.
      expect(liveHistory.listenerCount('contentAdded')).toBe(beforeCount + 1);

      await control.dispose();
      // Dispose unsubscribed the re-attached integration (no leaked listener).
      expect(liveHistory.listenerCount('contentAdded')).toBe(0);
    });
  });
});
