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

import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { describe, it, expect } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Agent,
  AgentMessage,
  AgentHistoryItem,
  CheckpointInfo,
} from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  internalConfig,
  isDoneEvent,
} from './helpers/agentHarness.js';

/** Builds a public AgentMessage (Content) with role + a single text part. */
function textMessage(role: 'user' | 'model', text: string): AgentMessage {
  // Post-P21: produce neutral IContent shape { speaker, blocks }.
  // AgentMessage is the public type but runtime objects are IContent.
  return {
    speaker: role === 'user' ? 'human' : 'ai',
    blocks: [{ type: 'text', text }],
  } as unknown as AgentMessage;
}

/**
 * Extracts the concatenated text of a message's blocks (neutral IContent).
 * Post-P21, getHistory() returns IContent at runtime (typed as AgentMessage).
 * Reads .blocks (neutral) and falls back to .parts (legacy Content) so the
 * helper works regardless of which shape the runtime carries.
 */
function messageText(msg: AgentMessage | AgentHistoryItem): string {
  const blocks = (msg as unknown as AgentHistoryItem).blocks;
  if (Array.isArray(blocks)) {
    return blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }
  // Legacy Content shape fallback
  const parts = msg.parts;
  if (Array.isArray(parts)) {
    return parts.map((p) => ('text' in p ? p.text : '')).join('');
  }
  return '';
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
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-session-spec-'));
  const { agent, cleanup } = await buildAgent(fixture, { workingDir });
  try {
    return await fn(agent, workingDir);
  } finally {
    await cleanup();
    rmSync(workingDir, { recursive: true, force: true });
    rmSync(storageTempDirFor(workingDir), { recursive: true, force: true });
  }
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
      const recordingRaw = readFileSync(
        agent.session.getRecording().path ?? '',
        'utf8',
      );
      const legacyCheckpointDirExists = existsSync(
        join(storageTempDirFor(workingDir), 'checkpoints'),
      );

      return {
        checkpoint,
        listed,
        recordingRaw,
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
      const before = readFileSync(recordingPath, 'utf8');

      await agent.resetChat();
      const historyAfterReset = (await collectAgentHistory(agent)).map(
        messageText,
      );
      const after = readFileSync(recordingPath, 'utf8');

      await agent.session.setRecording({ enabled: false });
      expect(readFileSync(recordingPath, 'utf8')).toBe(after);
      expect(after.startsWith(before)).toBe(true);
      const appended = after
        .slice(before.length)
        .trim()
        .split('\n')
        .map((line) => {
          const event = JSON.parse(line) as {
            type: string;
            payload: unknown;
          };
          return { type: event.type, payload: event.payload };
        });

      await agent.session.resume('latest');
      const historyAfterResume = (await collectAgentHistory(agent)).map(
        messageText,
      );

      return { appended, historyAfterReset, historyAfterResume };
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

    // The materialized file is non-empty JSONL whose lines parse and whose
    // content events carry the seeded text — proof the swap wrote real data.
    const raw = readFileSync(recordingPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const allLinesParse = lines.every((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });

    await agent.session.setRecording({ enabled: false });
    return { recording, recordingPath, raw, lines, allLinesParse };
  });

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010: recording checkpoints', () => {
  it('creates and lists recording-native checkpoints without legacy checkpoint files @plan:2026-07-28-issue-2625', async () => {
    const { checkpoint, listed, recordingRaw, legacyCheckpointDirExists } =
      await observeCreatesAndListsRecordingNativeCheckpointsWithoutLegacyCheckpointFiles();
    expect(checkpoint.name).toBe('milestone-1');
    expect(checkpoint.sessionId.length).toBeGreaterThan(0);
    expect(checkpoint.sequence).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(checkpoint.createdAt))).toBe(false);
    expect(listed).toContainEqual(checkpoint);
    expect(recordingRaw).toContain('checkpoint_created');
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
    const { appended, historyAfterReset, historyAfterResume } =
      await observeDurablyClearsRecordedHistoryWithoutReRecordingRestoredEntries();
    expect(historyAfterReset).toStrictEqual([
      'initial question',
      'initial answer',
    ]);
    expect(appended).toStrictEqual([
      { type: 'rewind', payload: { itemsRemoved: 2, cutSeq: 3 } },
    ]);
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
      expect(
        afterTurn
          .slice(afterClear.length)
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { type: string })
          .filter((line) => line.type === 'rewind'),
      ).toStrictEqual([]);
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
    expect(active.format).toBe('jsonl');
    expect(stopped.enabled).toBe(false);
  });

  it('resume(target) with no saved sessions throws a clear, non not-implemented error @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    const { caught, message } =
      await observeResumeTargetWithNoSavedSessionsThrowsAClearNonNotImplemented();
    expect(caught).toBeInstanceOf(Error);
    expect(message).not.toMatch(/NotYetImplemented/i);
    expect(message.toLowerCase()).toContain('session');
  });

  it('setRecording(enabled:true) materializes a real JSONL session file containing the seeded content @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    const observation = await observeMaterializedRecording();
    expect(observation.recording.enabled).toBe(true);
    expect(typeof observation.recording.path).toBe('string');
    expect(observation.recordingPath.length).toBeGreaterThan(0);
    expect(observation.raw.trim().length).toBeGreaterThan(0);
    expect(observation.lines.length).toBeGreaterThan(0);
    expect(observation.allLinesParse).toBe(true);
    expect(observation.raw).toContain('persist this sentinel: capybara');
    expect(observation.raw).toContain('recorded the sentinel: capybara');
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

      const history = internalConfig(agent)
        .getAgentClient()
        .getHistoryService();
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
