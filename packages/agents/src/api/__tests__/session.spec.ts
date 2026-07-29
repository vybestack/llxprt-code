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

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Agent,
  AgentMessage,
  AgentHistoryItem,
  CheckpointInfo,
} from '@vybestack/llxprt-code-agents';
import { buildAgent } from './helpers/agentHarness.js';

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
 * LLXPRT_CONFIG_HOME, then the platform default. The vitest setup file
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
async function withIsolatedAgent(
  fixture: string,
  fn: (agent: Agent) => Promise<void>,
): Promise<void> {
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-session-spec-'));
  const { agent, cleanup } = await buildAgent(fixture, { workingDir });
  try {
    await fn(agent);
  } finally {
    await cleanup();
    rmSync(workingDir, { recursive: true, force: true });
    rmSync(storageTempDirFor(workingDir), { recursive: true, force: true });
  }
}

describe('Session control @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', () => {
  it('creates and lists recording-native checkpoints without legacy checkpoint files @plan:2026-07-28-issue-2625', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      const seeded = [
        textMessage('user', 'remember the magic word: quokka'),
        textMessage('model', 'got it, the magic word is quokka'),
      ];
      await agent.setHistory(seeded);

      const checkpoint: CheckpointInfo =
        await agent.session.createCheckpoint('milestone-1');
      expect(checkpoint.name).toBe('milestone-1');
      expect(checkpoint.sessionId.length).toBeGreaterThan(0);
      expect(checkpoint.sequence).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(checkpoint.createdAt))).toBe(false);

      const listed = await agent.session.listCheckpoints();
      expect(listed).toContainEqual(checkpoint);
      expect(
        readFileSync(agent.session.getRecording().path ?? '', 'utf8'),
      ).toContain('checkpoint_created');
    });
  });

  it('forks from a checkpoint into a self-contained child while preserving resume history @plan:2026-07-28-issue-2625', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      await agent.setHistory([
        textMessage('user', 'branch source'),
        textMessage('model', 'source reply'),
      ]);
      const checkpoint = await agent.session.createCheckpoint('branch-point');
      await agent.setHistory([
        textMessage('user', 'branch source'),
        textMessage('model', 'source reply'),
        textMessage('user', 'source-only tail'),
      ]);

      const child = await agent.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      expect(child.id).not.toBe(checkpoint.sessionId);
      expect(child.parentSessionId).toBe(checkpoint.sessionId);
      expect(child.checkpointId).toBe(checkpoint.checkpointId);
      expect(child.checkpointName).toBe('branch-point');
      expect((await agent.getHistory()).map(messageText)).toStrictEqual([
        'branch source',
        'source reply',
      ]);
    });
  });

  it('durably clears recorded history without re-recording restored entries @plan:2026-07-28-issue-2625', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      const history = [
        textMessage('user', 'initial question'),
        textMessage('model', 'initial answer'),
        textMessage('user', 'later question'),
        textMessage('model', 'later answer'),
      ];
      await agent.setHistory(history);
      await agent.session.setRecording({ enabled: true });
      const recordingPath = agent.session.getRecording().path ?? '';

      await agent.resetChat();
      expect((await agent.getHistory()).map(messageText)).toStrictEqual([
        'initial question',
        'initial answer',
      ]);

      await agent.session.setRecording({ enabled: false });
      const lines = readFileSync(recordingPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string });
      expect(lines.filter((line) => line.type === 'rewind')).toHaveLength(1);
      expect(lines.filter((line) => line.type === 'content')).toHaveLength(4);

      await agent.session.resume('latest');
      expect((await agent.getHistory()).map(messageText)).toStrictEqual([
        'initial question',
        'initial answer',
      ]);
    });
  });

  it('resets an already-empty chat while recording is enabled', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      await agent.setHistory([textMessage('user', 'stale previous history')]);
      await agent.resetChat();
      await agent.session.setRecording({ enabled: true });

      await agent.resetChat();
      expect(await agent.getHistory()).toStrictEqual([]);
      expect(agent.session.getRecording().enabled).toBe(true);
    });
  });

  it('setRecording(enabled:true) activates a recording with a defined path; setRecording(enabled:false) deactivates it @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // No recording before activation.
      const before = agent.session.getRecording();
      expect(before.enabled).toBe(false);

      // Seed a turn so the activated recording materializes a file.
      await agent.setHistory([textMessage('user', 'recorded turn')]);
      await agent.session.setRecording({ enabled: true });

      const active = agent.session.getRecording();
      expect(active.enabled).toBe(true);
      expect(typeof active.path).toBe('string');
      expect(active.path?.length ?? 0).toBeGreaterThan(0);
      expect(active.format).toBe('jsonl');

      await agent.session.setRecording({ enabled: false });
      const stopped = agent.session.getRecording();
      expect(stopped.enabled).toBe(false);
    });
  });

  it('resume(target) with no saved sessions throws a clear, non not-implemented error @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // The isolated working dir has no recorded sessions, so resume must fail
      // with a clear typed error sourced from the core resume machinery — never
      // a not-implemented signal.
      let caught: unknown;
      try {
        await agent.session.resume('latest');
      } catch (e: unknown) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).not.toMatch(/NotYetImplemented/i);
      expect(message.toLowerCase()).toContain('session');
    });
  });

  it('setRecording(enabled:true) materializes a real JSONL session file containing the seeded content @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
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
      expect(recording.enabled).toBe(true);
      expect(typeof recording.path).toBe('string');
      const recordingPath = recording.path ?? '';
      expect(recordingPath.length).toBeGreaterThan(0);

      // The materialized file is non-empty JSONL whose lines parse and whose
      // content events carry the seeded text — proof the swap wrote real data.
      const raw = readFileSync(recordingPath, 'utf8');
      expect(raw.trim().length).toBeGreaterThan(0);
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(raw).toContain('persist this sentinel: capybara');
      expect(raw).toContain('recorded the sentinel: capybara');

      await agent.session.setRecording({ enabled: false });
    });
  });

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
      const mutated = (await agent.getHistory()).map(messageText);
      expect(mutated).toContain('unrelated current turn');
      expect(mutated).not.toContain('resume sentinel: pangolin');

      // Resume the latest recorded session: the reconstructed history flows
      // through the same client restore path getHistory observes.
      await agent.session.resume('latest');
      const restored = (await agent.getHistory()).map(messageText);
      expect(restored).toContain('resume sentinel: pangolin');
      expect(restored).toContain('acknowledged sentinel: pangolin');
      expect(restored).not.toContain('unrelated current turn');

      // The resumed recording is active and installed as the live recording.
      const afterResume = agent.session.getRecording();
      expect(afterResume.enabled).toBe(true);
    });
  });
});
