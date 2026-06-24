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
 * - Checkpoint round-trip: createCheckpoint persists the live history, the
 *   checkpoint is listed, and restoreCheckpoint reproduces the original items
 *   after the history is mutated.
 * - listCheckpoints reflects zero / one / many saves deterministically in an
 *   isolated working dir.
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
  SessionCheckpoint,
} from '@vybestack/llxprt-code-agents';
import { buildAgent } from './helpers/agentHarness.js';

/** Builds a public AgentMessage (Content) with role + a single text part. */
function textMessage(role: 'user' | 'model', text: string): AgentMessage {
  return { role, parts: [{ text }] };
}

/** Extracts the concatenated text of a message's parts. */
function messageText(msg: AgentMessage): string {
  return msg.parts.map((p) => ('text' in p ? p.text : '')).join('');
}

/**
 * Derives the core storage temp dir for a working directory, mirroring
 * @vybestack/llxprt-code-storage Storage.getProjectTempDir
 * (`~/.llxprt/tmp/<sha256(workingDir)>`). Used only for test cleanup so
 * checkpoint/recording artifacts never accumulate in the shared global temp.
 */
function storageTempDirFor(workingDir: string): string {
  const hash = createHash('sha256').update(workingDir).digest('hex');
  return join(homedir(), '.llxprt', 'tmp', hash);
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
  it('createCheckpoint persists the live history, listCheckpoints surfaces it, and restoreCheckpoint reproduces it after a mutation @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // Seed a known two-message history.
      const seeded = [
        textMessage('user', 'remember the magic word: quokka'),
        textMessage('model', 'got it, the magic word is quokka'),
      ];
      await agent.setHistory(seeded);

      // Create a labelled checkpoint over the live history.
      const checkpoint: SessionCheckpoint =
        await agent.session.createCheckpoint('milestone-1');
      expect(checkpoint.label).toBe('milestone-1');
      expect(checkpoint.id).toBe('milestone-1');
      expect(checkpoint.messageCount).toBe(seeded.length);
      expect(typeof checkpoint.createdAt).toBe('string');
      expect(Number.isNaN(Date.parse(checkpoint.createdAt))).toBe(false);

      // The checkpoint appears in the listing by id + label.
      const listed = agent.session.listCheckpoints();
      const found = listed.find((c) => c.id === 'milestone-1');
      expect(found).toBeDefined();
      expect(found?.label).toBe('milestone-1');
      expect(found?.messageCount).toBe(seeded.length);

      // Mutate the live history away from the checkpoint.
      await agent.setHistory([textMessage('user', 'a totally different turn')]);
      const mutated = (await agent.getHistory()).map(messageText);
      expect(mutated).toContain('a totally different turn');
      expect(mutated).not.toContain('remember the magic word: quokka');

      // Restore the checkpoint and confirm the original items reappear.
      await agent.session.restoreCheckpoint('milestone-1');
      const restored = (await agent.getHistory()).map(messageText);
      expect(restored).toContain('remember the magic word: quokka');
      expect(restored).toContain('got it, the magic word is quokka');
      expect(restored).not.toContain('a totally different turn');
    });
  });

  it('listCheckpoints is empty before any save and reflects each subsequent createCheckpoint @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // Deterministic empty start in an isolated working dir.
      expect(agent.session.listCheckpoints()).toHaveLength(0);

      await agent.setHistory([textMessage('user', 'first turn')]);
      await agent.session.createCheckpoint('alpha');
      const afterFirst = agent.session.listCheckpoints();
      expect(afterFirst.map((c) => c.id)).toContain('alpha');
      expect(afterFirst).toHaveLength(1);

      await agent.setHistory([
        textMessage('user', 'second turn'),
        textMessage('model', 'second reply'),
      ]);
      await agent.session.createCheckpoint('beta');
      const afterSecond = agent.session.listCheckpoints();
      const ids = afterSecond.map((c) => c.id);
      expect(ids).toContain('alpha');
      expect(ids).toContain('beta');
      expect(afterSecond).toHaveLength(2);

      // The beta checkpoint records the larger message count.
      const beta = afterSecond.find((c) => c.id === 'beta');
      expect(beta?.messageCount).toBe(2);
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
