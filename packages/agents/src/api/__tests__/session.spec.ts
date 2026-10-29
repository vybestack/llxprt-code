import { capturedAgentClient } from './helpers/agent-client-observation.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 *
 * Session control surface behavior (REQ-010). These tests drive the REAL
 * public agent.session surface wired onto the core session/recording
 * machinery (Logger checkpoints, SessionRecordingService, resumeSession) and
 * assert real observable state / round-trips — never a not-implemented signal.
 *
 * Covers:
 * - Recording-native checkpoint creation/listing and self-contained forks.
 * - Checkpoint continuation preserves source history while installing the
 *   branch history in the child recording.
 * - Recording reflection: setRecording(enabled:true) activates a recording
 *   with a defined path; setRecording(enabled:false) deactivates it.
 * - resume(target): the no-session path throws a clear, typed (non
 *   not-implemented) error.
 *
 * TEST HYGIENE: checkpoints/recordings write under the core storage temp dir
 * keyed by a sha256 of the working directory (see @vybestack/llxprt-code-storage
 * Storage.getProjectTempDir). Every test uses a fresh, isolated working dir and
 * removes BOTH that dir AND its derived storage temp dir in `finally`, so the
 * suite leaves no stray artifacts under the repo or the shared global temp dir.
 */

import type {
  Agent,
  AgentHistoryItem,
  AgentMessage,
  CheckpointInfo,
} from '@vybestack/llxprt-code-agents';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent, drain, isDoneEvent } from './helpers/agentHarness.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import {
  nativeRows,
  readJournalCheckpoints,
  readJournalFileFacts,
  requireRecordingPath,
  rowTexts,
  withNativeRecordingFixture,
} from './helpers/native-session-fixture.js';

/** Builds a public AgentMessage (Content) with role + a single text part. */
function textMessage(role: 'user' | 'model', text: string): AgentMessage {
  return {
    speaker: role === 'user' ? 'human' : 'ai',
    blocks: [{ type: 'text', text }],
  };
}

function messageText(msg: AgentMessage | AgentHistoryItem): string {
  return msg.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

/**
 * Derives the core storage temp dir for a working directory, mirroring
 * @vybestack/llxprt-code-storage Storage.getProjectTempDir
 * (`<globalLogDir>/tmp/<sha256(workingDir)>`). Used only for test cleanup so
 * checkpoint/recording artifacts never accumulate in the shared global temp.
 *
 * Storage resolves the global log dir via LLXPRT_LOG_HOME, then
 * LLXPRT_CONFIG_HOME, then the platform default. The test setup file
 * (test-setup-storage-isolation.ts) calls isolateStorageRoots() which sets all
 * of these to subdirectories under a unique temp root, so cleanup always
 * targets the isolated tree — never the real user home.
 */
function storageTempDirFor(workingDir: string): string {
  const hash = createHash('sha256').update(workingDir).digest('hex');
  const logHome =
    process.env.LLXPRT_LOG_HOME ??
    process.env.LLXPRT_CONFIG_HOME ??
    join(homedir(), '.llxprt');
  return join(logHome, 'tmp', hash);
}

/**
 * Runs a scenario against a real Agent built over an isolated working dir, then
 * disposes the agent and removes both the working dir and its derived storage
 * temp dir. Guarantees no stray checkpoint/recording artifacts survive.
 */
async function withIsolatedAgent<T>(
  fixture: string,
  fn: (agent: Agent, workingDir: string) => Promise<T>,
): Promise<T> {
  return (async () => {
    const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-session-spec-'));
    const { agent, cleanup } = await buildAgent(fixture, { workingDir });
    try {
      return await fn(agent, workingDir);
    } finally {
      await cleanup();
      rmSync(workingDir, { recursive: true, force: true });
      rmSync(storageTempDirFor(workingDir), { recursive: true, force: true });
    }
  })();
}

const observeCreatesAndListsRecordingNativeCheckpointsWithoutLegacyCheckpointFiles =
  async () =>
    withIsolatedAgent('plain-text.jsonl', async (agent, workingDir) => {
      const seeded = [
        textMessage('user', 'remember the magic word: quokka'),
        textMessage('model', 'got it, the magic word is quokka'),
      ];
      await agent.setHistory(seeded);

      const checkpoint: CheckpointInfo =
        await agent.session.createCheckpoint('milestone-1');

      const listed = await agent.session.listCheckpoints();
      const recordingCheckpoints = await readJournalCheckpoints(
        agent.session.getRecording().path ?? '',
      );
      const legacyCheckpointDirExists = existsSync(
        join(storageTempDirFor(workingDir), 'checkpoints'),
      );

      return {
        checkpoint,
        listed,
        recordingCheckpoints,
        legacyCheckpointDirExists,
      };
    });

const observeForksFromACheckpointIntoASelfContainedChildWhilePreservingResume =
  async () =>
    withIsolatedAgent('plain-text.jsonl', async (agent) => {
      await agent.setHistory([
        textMessage('user', 'branch source'),
        textMessage('model', 'source reply'),
      ]);
      const checkpoint = await agent.session.createCheckpoint('branch-point');
      const parentPath = agent.session.getRecording().path ?? '';
      await agent.restoreHistory([textMessage('user', 'source-only tail')]);

      const child = await agent.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      const childHistory = (await collectAgentHistory(agent)).map(messageText);
      const parentRaw = readFileSync(parentPath, 'utf8');

      return { child, checkpoint, childHistory, parentRaw };
    });

const observeDurablyClearsRecordedHistoryWithoutReRecordingRestoredEntries =
  async () =>
    withIsolatedAgent('plain-text.jsonl', async (agent) => {
      const history = [
        textMessage('user', 'initial question'),
        textMessage('model', 'initial answer'),
        textMessage('user', 'later question'),
        textMessage('model', 'later answer'),
      ];
      await agent.setHistory(history);
      await agent.session.setRecording({ enabled: true });
      const recordingPath = agent.session.getRecording().path ?? '';
      const before = readFileSync(recordingPath);
      await agent.resetChat();
      const historyAfterReset = (await collectAgentHistory(agent)).map(
        messageText,
      );
      const after = readFileSync(recordingPath);
      await agent.session.setRecording({ enabled: false });
      expect(readFileSync(recordingPath)).toStrictEqual(after);
      expect(after.subarray(0, before.length)).toStrictEqual(before);
      const persisted = rowTexts(await nativeRows(recordingPath));
      await agent.session.resume('latest');
      const historyAfterResume = (await collectAgentHistory(agent)).map(
        messageText,
      );

      return { persisted, historyAfterReset, historyAfterResume };
    });

const observeResetsAnAlreadyEmptyChatWhileRecordingIsEnabled = async () =>
  withIsolatedAgent('plain-text.jsonl', async (agent) => {
    await agent.setHistory([textMessage('user', 'stale previous history')]);
    await agent.session.setRecording({ enabled: true });
    const recordingPath = agent.session.getRecording().path ?? '';
    await agent.setHistory([]);
    const bytesBeforeReset = readFileSync(recordingPath, 'utf8');

    await agent.resetChat();
    const historyAfterFirstReset = await collectAgentHistory(agent);
    const bytesAfterFirstReset = readFileSync(recordingPath, 'utf8');
    await agent.resetChat();
    await agent.session.setRecording({ enabled: false });
    const bytesAfterSecondReset = readFileSync(recordingPath, 'utf8');

    return {
      bytesBeforeReset,
      bytesAfterFirstReset,
      bytesAfterSecondReset,
      historyAfterFirstReset,
    };
  });

const observeSetRecordingEnabledTrueActivatesARecordingWithADefinedPathSetRecordingEnabled =
  async () =>
    withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // No recording before activation.
      const before = agent.session.getRecording();

      // Seed a turn so the activated recording materializes a file.
      await agent.setHistory([textMessage('user', 'recorded turn')]);
      await agent.session.setRecording({ enabled: true });

      const active = agent.session.getRecording();
      const activePathLength = active.path?.length ?? 0;

      await agent.session.setRecording({ enabled: false });
      const stopped = agent.session.getRecording();

      return { before, active, activePathLength, stopped };
    });

const observeResumeTargetWithNoSavedSessionsThrowsAClearNonNotImplemented =
  async () =>
    withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // The isolated working dir has no recorded sessions, so resume must fail
      // with a clear typed error sourced from the core resume machinery — never
      // a not-implemented signal.
      let caught: unknown;
      try {
        await agent.session.resume('latest');
      } catch (e: unknown) {
        caught = e;
      }

      const message = caught instanceof Error ? caught.message : '';

      return { caught, message };
    });

const observeMaterializedRecording = async () =>
  withIsolatedAgent('plain-text.jsonl', async (agent) => {
    // Seed a known history, then enable recording. startRecording snapshots
    // the live history into the SessionRecordingService and flushes, so the
    // file on disk is a genuine JSONL session — not a hollow placeholder.
    const seeded = [
      textMessage('user', 'persist this sentinel: capybara'),
      textMessage('model', 'recorded the sentinel: capybara'),
    ];
    await agent.setHistory(seeded);
    await agent.session.setRecording({ enabled: true });

    const recording = agent.session.getRecording();
    const recordingPath = recording.path ?? '';

    const rows = await nativeRows(recordingPath);
    const facts = await readJournalFileFacts(recordingPath);
    await agent.session.setRecording({ enabled: false });
    return { recording, recordingPath, rows, facts };
  });

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: recording checkpoints', () => {
  it('creates and lists recording-native checkpoints without legacy checkpoint files @plan:2026-07-28-issue-2625', async () => {
    const {
      checkpoint,
      listed,
      recordingCheckpoints,
      legacyCheckpointDirExists,
    } =
      await observeCreatesAndListsRecordingNativeCheckpointsWithoutLegacyCheckpointFiles();
    expect(checkpoint.name).toBe('milestone-1');
    expect(checkpoint.sessionId.length).toBeGreaterThan(0);
    expect(checkpoint.sequence).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(checkpoint.createdAt))).toBe(false);
    expect(listed).toContainEqual(checkpoint);
    expect(recordingCheckpoints).toContainEqual(
      expect.objectContaining({
        checkpointId: checkpoint.checkpointId,
        name: checkpoint.name,
      }),
    );
    expect(legacyCheckpointDirExists).toBe(false);
  });

  it('forks from a checkpoint into a self-contained child while preserving resume history @plan:2026-07-28-issue-2625', async () => {
    const { child, checkpoint, childHistory, parentRaw } =
      await observeForksFromACheckpointIntoASelfContainedChildWhilePreservingResume();
    expect(child.id).not.toBe(checkpoint.sessionId);
    expect(child.parentSessionId).toBe(checkpoint.sessionId);
    expect(child.checkpointId).toBe(checkpoint.checkpointId);
    expect(child.checkpointName).toBe('branch-point');
    expect(childHistory).toStrictEqual(['branch source', 'source reply']);
    expect(parentRaw).toContain('source-only tail');
  });
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: recorded history reset', () => {
  it('durably clears recorded history without re-recording restored entries @plan:2026-07-28-issue-2625', async () => {
    const { persisted, historyAfterReset, historyAfterResume } =
      await observeDurablyClearsRecordedHistoryWithoutReRecordingRestoredEntries();
    expect(historyAfterReset).toStrictEqual([
      'initial question',
      'initial answer',
    ]);
    expect(persisted).toStrictEqual(['initial question', 'initial answer']);
    expect(historyAfterResume).toStrictEqual([
      'initial question',
      'initial answer',
    ]);
  });

  it('keeps the cleared prefix when the next turn starts', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      await agent.setHistory([
        textMessage('user', 'initial question'),
        textMessage('model', 'initial answer'),
        textMessage('user', 'discarded question'),
      ]);
      await agent.session.setRecording({ enabled: true });
      await agent.resetChat();
      const path = agent.session.getRecording().path ?? '';
      const afterClear = readFileSync(path, 'utf8');

      const events = await drain(agent.stream('continued question'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);
      expect((await collectAgentHistory(agent)).map(messageText)).toContain(
        'initial question',
      );
      expect((await collectAgentHistory(agent)).map(messageText)).not.toContain(
        'discarded question',
      );
      const afterTurn = readFileSync(path, 'utf8');
      expect(afterTurn.startsWith(afterClear)).toBe(true);
      expect(rowTexts(await nativeRows(path))).not.toContain(
        'discarded question',
      );
    });
  });

  it('resets an already-empty chat while recording is enabled', async () => {
    const {
      bytesBeforeReset,
      bytesAfterFirstReset,
      bytesAfterSecondReset,
      historyAfterFirstReset,
    } = await observeResetsAnAlreadyEmptyChatWhileRecordingIsEnabled();
    expect(historyAfterFirstReset).toStrictEqual([]);
    expect(bytesAfterFirstReset).toBe(bytesBeforeReset);
    expect(bytesAfterSecondReset).toBe(bytesBeforeReset);
  });
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: recording activation and missing sessions', () => {
  it('setRecording(enabled:true) activates a recording with a defined path; setRecording(enabled:false) deactivates it @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    const { before, active, activePathLength, stopped } =
      await observeSetRecordingEnabledTrueActivatesARecordingWithADefinedPathSetRecordingEnabled();
    expect(before.enabled).toBe(false);
    expect(active.enabled).toBe(true);
    expect(typeof active.path).toBe('string');
    expect(activePathLength).toBeGreaterThan(0);
    expect(active.format).toBe('journal');
    expect(stopped.enabled).toBe(false);
  });

  it('resume(target) with no saved sessions throws a clear, non not-implemented error @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    const { caught, message } =
      await observeResumeTargetWithNoSavedSessionsThrowsAClearNonNotImplemented();
    expect(caught).toBeInstanceOf(Error);
    expect(message).not.toMatch(/NotYetImplemented/i);
    expect(message.toLowerCase()).toContain('session');
  });

  it('setRecording(enabled:true) materializes a real journal session file containing the seeded content @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    const observation = await observeMaterializedRecording();
    expect(observation.recording.enabled).toBe(true);
    expect(typeof observation.recording.path).toBe('string');
    expect(observation.recordingPath.length).toBeGreaterThan(0);
    expect(observation.facts?.rows).toBe(2);
    expect(rowTexts(observation.rows)).toStrictEqual([
      'persist this sentinel: capybara',
      'recorded the sentinel: capybara',
    ]);
  });
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: latest history restoration', () => {
  it('resume("latest") restores the live history from a previously recorded session on disk @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // Record a real session to disk via the SAME machinery: seed history,
      // enable recording (materializes + flushes the JSONL session file), then
      // disable recording (flushes + disposes the service and releases its
      // lock so the file becomes resumable).
      const seeded = [
        textMessage('user', 'resume sentinel: pangolin'),
        textMessage('model', 'acknowledged sentinel: pangolin'),
      ];
      await agent.setHistory(seeded);
      await agent.session.setRecording({ enabled: true });
      await agent.session.setRecording({ enabled: false });

      // Mutate the live history away from what was recorded so the restore is
      // observable rather than vacuous.
      await agent.setHistory([textMessage('user', 'unrelated current turn')]);
      const mutated = (await collectAgentHistory(agent)).map(messageText);
      expect(mutated).toContain('unrelated current turn');
      expect(mutated).not.toContain('resume sentinel: pangolin');

      // Resume the latest recorded session: the reconstructed history flows
      // through the same client restore path getHistory observes.
      await agent.session.resume('latest');
      const restored = (await collectAgentHistory(agent)).map(messageText);
      expect(restored).toContain('resume sentinel: pangolin');
      expect(restored).toContain('acknowledged sentinel: pangolin');
      expect(restored).not.toContain('unrelated current turn');

      // The resumed recording is active and installed as the live recording.
      const afterResume = agent.session.getRecording();
      expect(afterResume.enabled).toBe(true);
    });
  });
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: checkpoint and session lifecycle', () => {
  it('exposes checkpoint rename/delete, session naming/listing, and safe deletion through the public API', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      await agent.setHistory([
        textMessage('user', 'lifecycle source'),
        textMessage('model', 'lifecycle reply'),
      ]);
      const checkpoint = await agent.session.createCheckpoint('before-rename');
      const activePath = agent.session.getRecording().path;

      await expect(
        agent.session.deleteSession(checkpoint.sessionId),
      ).rejects.toThrow('Cannot delete the active session');
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path: activePath,
      });
      expect(await agent.session.listCheckpoints()).toContainEqual(checkpoint);

      await agent.session.renameCheckpoint(
        checkpoint.checkpointId,
        'after-rename',
      );
      expect(await agent.session.listCheckpoints()).toContainEqual(
        expect.objectContaining({
          checkpointId: checkpoint.checkpointId,
          name: 'after-rename',
        }),
      );
      await agent.session.nameCurrentSession('named-session');
      expect(await agent.session.listSessions()).toContainEqual(
        expect.objectContaining({
          id: checkpoint.sessionId,
          name: 'named-session',
        }),
      );

      await agent.session.deleteCheckpoint(checkpoint.checkpointId);
      expect(await agent.session.listCheckpoints()).not.toContainEqual(
        expect.objectContaining({ checkpointId: checkpoint.checkpointId }),
      );
      await agent.session.setRecording({ enabled: false });
      await agent.session.deleteSession(checkpoint.sessionId);
      expect(await agent.session.listSessions()).not.toContainEqual(
        expect.objectContaining({ id: checkpoint.sessionId }),
      );
    });
  });
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: named history restoration', () => {
  it('resumes a named session by explicit public API reference', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      const seeded = [
        textMessage('user', 'explicit resume source'),
        textMessage('model', 'explicit resume reply'),
      ];
      await agent.setHistory(seeded);
      await agent.session.setRecording({ enabled: true });
      await agent.session.nameCurrentSession('explicit-resume');
      const session = (await agent.session.listSessions()).find(
        (candidate) => candidate.name === 'explicit-resume',
      );
      expect(session).toBeDefined();
      await agent.session.setRecording({ enabled: false });
      await agent.setHistory([textMessage('user', 'replacement live history')]);

      const resumed = await agent.session.resumeSession('explicit-resume');

      expect(resumed).toMatchObject({
        id: session?.id,
        name: 'explicit-resume',
      });
      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        ['explicit resume source', 'explicit resume reply'],
      );
      expect(agent.session.getRecording().enabled).toBe(true);
    });
  });
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: resume publication before startup', () => {
  for (const target of ['latest', 'named'] as const) {
    it(`publishes ${target} resume to getHistory before chat startup and carries it into the next turn`, async () => {
      await withIsolatedAgent('plain-text.jsonl', async (agent) => {
        await agent.setHistory([
          textMessage('user', 'selected prefix question'),
          textMessage('model', 'selected prefix answer'),
        ]);
        await agent.session.setRecording({ enabled: true });
        if (target === 'named') {
          await agent.session.nameCurrentSession('selected-session');
        }
        const path = agent.session.getRecording().path ?? '';
        await agent.session.setRecording({ enabled: false });
        const originalBytes = readFileSync(path, 'utf8');

        await agent.setHistory([
          textMessage('user', 'discarded current question'),
        ]);
        if (target === 'latest') {
          await agent.session.resume('latest');
        } else {
          await agent.session.resumeSession('selected-session');
        }

        expect(
          (await collectAgentHistory(agent)).map(messageText),
        ).toStrictEqual(['selected prefix question', 'selected prefix answer']);
        const events = await drain(agent.stream('continuation question'));
        expect(events.filter(isDoneEvent)).toHaveLength(1);
        const texts = (await collectAgentHistory(agent)).map(messageText);
        expect(texts).toContain('selected prefix question');
        expect(texts).toContain('continuation question');
        expect(texts).not.toContain('discarded current question');
        const resumedBytes = readFileSync(path, 'utf8');
        expect(resumedBytes.startsWith(originalBytes)).toBe(true);
        expect(resumedBytes).toContain('continuation question');
      });
    });
  }
});

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: failed adoption recovery', () => {
  it('keeps the deferred live history and next turn after a failed journal adoption', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      await agent.setHistory([
        textMessage('user', 'recorded origin'),
        textMessage('model', 'recorded response'),
      ]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.setRecording({ enabled: false });
      const live = [textMessage('user', 'live deferred origin')];
      await agent.setHistory(live);

      const history = capturedAgentClient(agent).getHistoryService();
      if (history === null) throw new Error('Expected live history service');
      let failOnce = true;
      const interruptAdoption = (): void => {
        if (failOnce) {
          failOnce = false;
          throw new Error('adoption publication interrupted');
        }
      };
      history.on('tokensUpdated', interruptAdoption);
      try {
        await expect(agent.session.resume('latest')).rejects.toThrow(
          'adoption publication interrupted',
        );
      } finally {
        history.off('tokensUpdated', interruptAdoption);
      }

      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        ['live deferred origin'],
      );
      expect(agent.session.getRecording().enabled).toBe(false);
      const events = await drain(agent.stream('live continuation'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);
      const texts = (await collectAgentHistory(agent)).map(messageText);
      expect(texts).toContain('live deferred origin');
      expect(texts).toContain('live continuation');
      expect(texts).not.toContain('recorded origin');
    });
  });
});

describe('native public session controls', () => {
  it('creates durable checkpoint facts and forks a self-contained child without changing the parent', async () => {
    await withNativeRecordingFixture(async ({ agent, config }) => {
      await agent.setHistory([
        textMessage('user', 'branch source'),
        textMessage('model', 'source reply'),
      ]);
      const checkpoint = await agent.session.createCheckpoint('branch-point');
      const parentPath = requireRecordingPath(
        agent.session.getRecording().path,
      );
      expect(existsSync(join(config.projectTempDir, 'checkpoints'))).toBe(
        false,
      );
      expect(await agent.session.listCheckpoints()).toContainEqual(checkpoint);
      expect(await readJournalCheckpoints(parentPath)).toContainEqual(
        expect.objectContaining({
          checkpointId: checkpoint.checkpointId,
          name: checkpoint.name,
          sequence: checkpoint.sequence,
          createdAtMs: Date.parse(checkpoint.createdAt),
        }),
      );
      expect((await readJournalFileFacts(parentPath))?.facts.sessionId).toBe(
        checkpoint.sessionId,
      );
      await agent.restoreHistory([textMessage('user', 'source-only tail')]);
      await agent.session.flushRecording();
      const parentBefore = readFileSync(parentPath);
      const child = await agent.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      const childPath = requireRecordingPath(agent.session.getRecording().path);
      expect(child).toMatchObject({
        parentSessionId: checkpoint.sessionId,
        checkpointId: checkpoint.checkpointId,
        checkpointName: 'branch-point',
      });
      expect(child.id).not.toBe(checkpoint.sessionId);
      expect(childPath).not.toBe(parentPath);
      expect(rowTexts(await nativeRows(childPath))).toStrictEqual([
        'branch source',
        'source reply',
      ]);
      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        ['branch source', 'source reply'],
      );
      await agent.session.setRecording({ enabled: false });
      await agent.session.resume(child.id);
      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        ['branch source', 'source reply'],
      );
      expect(Buffer.compare(readFileSync(parentPath), parentBefore)).toBe(0);
      expect(rowTexts(await nativeRows(parentPath))).toContain(
        'source-only tail',
      );
    });
  }, 30000);

  it('durably clears a suffix, continues a turn and resumes only the kept prefix', async () => {
    await withNativeRecordingFixture(async ({ agent }) => {
      await agent.setHistory([
        textMessage('user', 'initial question'),
        textMessage('model', 'initial answer'),
        textMessage('user', 'discarded question'),
        textMessage('model', 'discarded answer'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      await agent.resetChat();
      expect(rowTexts(await nativeRows(path))).toStrictEqual([
        'initial question',
        'initial answer',
      ]);
      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        ['initial question', 'initial answer'],
      );
      const events = await drain(agent.stream('continued question'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);
      await agent.session.flushRecording();
      const disk = rowTexts(await nativeRows(path));
      expect(disk).toContain('continued question');
      expect(disk).not.toContain('discarded question');
      await agent.session.setRecording({ enabled: false });
      await agent.session.resume('latest');
      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        disk,
      );
    });
  }, 30000);

  it('keeps repeated empty resets durable without writing another group', async () => {
    await withNativeRecordingFixture(async ({ agent }) => {
      await agent.setHistory([textMessage('user', 'stale previous history')]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      await agent.setHistory([]);
      await agent.session.flushRecording();
      const before = readFileSync(path);
      await agent.resetChat();
      await agent.resetChat();
      await agent.session.setRecording({ enabled: false });
      expect(await nativeRows(path)).toStrictEqual([]);
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
      expect(Buffer.compare(readFileSync(path), before)).toBe(0);
    });
  }, 30000);

  it('activates a materialized journal and rejects missing resume targets', async () => {
    await withNativeRecordingFixture(async ({ agent }) => {
      expect(agent.session.getRecording().enabled).toBe(false);
      const missing = await agent.session.resume('latest').then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(missing).toBeInstanceOf(Error);
      const message = missing instanceof Error ? missing.message : '';
      expect(message).toMatch(/session/i);
      expect(message).not.toMatch(/NotYetImplemented/i);
      await agent.setHistory([
        textMessage('user', 'persist this sentinel: capybara'),
        textMessage('model', 'recorded the sentinel: capybara'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const state = agent.session.getRecording();
      expect(state).toMatchObject({ enabled: true, format: 'journal' });
      const path = requireRecordingPath(state.path);
      expect(rowTexts(await nativeRows(path))).toStrictEqual([
        'persist this sentinel: capybara',
        'recorded the sentinel: capybara',
      ]);
      expect((await readJournalFileFacts(path))?.rows).toBe(2);
      await agent.session.setRecording({ enabled: false });
      expect(agent.session.getRecording().enabled).toBe(false);
    });
  }, 30000);

  it('renames and deletes checkpoints, names sessions and refuses deletion of the active session', async () => {
    await withNativeRecordingFixture(async ({ agent }) => {
      await agent.setHistory([
        textMessage('user', 'lifecycle source'),
        textMessage('model', 'lifecycle reply'),
      ]);
      const checkpoint = await agent.session.createCheckpoint('before-rename');
      const path = requireRecordingPath(agent.session.getRecording().path);
      await expect(
        agent.session.deleteSession(checkpoint.sessionId),
      ).rejects.toThrow('Cannot delete the active session');
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      expect(await agent.session.listCheckpoints()).toContainEqual(checkpoint);
      await agent.session.renameCheckpoint(
        checkpoint.checkpointId,
        'after-rename',
      );
      expect(await readJournalCheckpoints(path)).toContainEqual(
        expect.objectContaining({
          checkpointId: checkpoint.checkpointId,
          name: 'after-rename',
        }),
      );
      await agent.session.nameCurrentSession('named-session');
      expect(await agent.session.listSessions()).toContainEqual(
        expect.objectContaining({
          id: checkpoint.sessionId,
          name: 'named-session',
        }),
      );
      await agent.session.deleteCheckpoint(checkpoint.checkpointId);
      expect(await agent.session.listCheckpoints()).toStrictEqual([]);
      await agent.session.setRecording({ enabled: false });
      await agent.session.deleteSession(checkpoint.sessionId);
      expect(await agent.session.listSessions()).toStrictEqual([]);
    });
  }, 30000);

  for (const target of ['latest', 'named'] as const) {
    it(`publishes ${target} adopted identity before startup and preserves it through a later turn and detached stop`, async () => {
      await withNativeRecordingFixture(async ({ agent, config }) => {
        await agent.setHistory([
          textMessage('user', 'selected prefix question'),
          textMessage('model', 'selected prefix answer'),
        ]);
        await agent.session.setRecording({ enabled: true });
        await agent.session.nameCurrentSession('selected-session');
        const path = requireRecordingPath(agent.session.getRecording().path);
        const before = await readJournalFileFacts(path);
        await agent.session.setRecording({ enabled: false });
        await agent.setHistory([
          textMessage('user', 'discarded current question'),
        ]);
        const selected =
          target === 'latest'
            ? await agent.session
                .resume('latest')
                .then(async () =>
                  (await agent.session.listSessions()).find(
                    (session) => session.id === before?.facts.sessionId,
                  ),
                )
            : await agent.session.resumeSession('selected-session');
        expect(selected).toMatchObject({
          id: before?.facts.sessionId,
          name: 'selected-session',
        });
        expect(agent.session.getRecording()).toMatchObject({
          enabled: true,
          path,
        });
        expect(config.getSessionId()).toBeUndefined();
        expect(
          (await collectAgentHistory(agent)).map(messageText),
        ).toStrictEqual(['selected prefix question', 'selected prefix answer']);
        const events = await drain(agent.stream('continuation question'));
        expect(events.filter(isDoneEvent)).toHaveLength(1);
        await agent.session.flushRecording();
        const persisted = rowTexts(await nativeRows(path));
        expect(persisted).toContain('continuation question');
        expect(persisted).not.toContain('discarded current question');
        const after = await readJournalFileFacts(path);
        expect(after?.facts.sessionId).toBe(before?.facts.sessionId);
        expect(after?.facts.start).toStrictEqual(before?.facts.start);
        expect(after?.facts.name).toBe('selected-session');
        await agent.session.setRecording({ enabled: false });
        const closed = readFileSync(path);
        await agent.restoreHistory([textMessage('user', 'detached-only row')]);
        expect((await collectAgentHistory(agent)).map(messageText)).toContain(
          'detached-only row',
        );
        const detachedEvents = await drain(agent.stream('detached next turn'));
        expect(detachedEvents.filter(isDoneEvent)).toStrictEqual([
          { type: 'done', reason: 'stop' },
        ]);
        expect((await collectAgentHistory(agent)).map(messageText)).toContain(
          'detached next turn',
        );
        expect(Buffer.compare(readFileSync(path), closed)).toBe(0);
        expect(rowTexts(await nativeRows(path))).toStrictEqual([
          'selected prefix question',
          'selected prefix answer',
          'continuation question',
          'turn one reply',
        ]);
      });
    }, 30000);
  }

  it('rolls back failed adoption publication and carries the deferred live history into the next turn', async () => {
    await withNativeRecordingFixture(async ({ agent, chatsDir, clientFor }) => {
      await agent.setHistory([
        textMessage('user', 'recorded origin'),
        textMessage('model', 'recorded response'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      await agent.session.setRecording({ enabled: false });
      const before = readFileSync(path);
      await agent.setHistory([textMessage('user', 'live deferred origin')]);
      const history = clientFor(agent).getHistoryService();
      if (history === null) throw new Error('Expected live history service');
      const failure = new Error('adoption publication interrupted');
      const interrupt = (): void => {
        throw failure;
      };
      history.once('tokensUpdated', interrupt);
      try {
        await expect(agent.session.resume('latest')).rejects.toThrow(
          'adoption publication interrupted',
        );
      } finally {
        history.off('tokensUpdated', interrupt);
      }
      expect(agent.session.getRecording().enabled).toBe(false);
      expect((await collectAgentHistory(agent)).map(messageText)).toStrictEqual(
        ['live deferred origin'],
      );
      expect(Buffer.compare(readFileSync(path), before)).toBe(0);
      const { readdir } = await import('node:fs/promises');
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual([]);
      const events = await drain(agent.stream('live continuation'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);
      const texts = (await collectAgentHistory(agent)).map(messageText);
      expect(texts).toContain('live deferred origin');
      expect(texts).toContain('live continuation');
      expect(texts).not.toContain('recorded origin');
    });
  }, 30000);
});
