/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 *
 * Continuous session-recording + resume-returns-history behavior for the public
 * agent.session surface (REQ-010, issue #1604). These tests drive the REAL
 * SessionControl wired onto the core recording machinery (SessionRecordingService
 * + RecordingIntegration + resumeSession) over a real FakeProvider, and assert
 * real observable state on disk — never mocks-were-called theater.
 *
 * Covers the architectural fix that makes Zed session recording work:
 *  (a) setRecording(true) subscribes a RecordingIntegration so a SUBSEQUENT
 *      turn's content is appended to the JSONL file (continuous recording, not a
 *      one-shot snapshot) — the acceptance bar from the brief.
 *  (b) resume() returns the reconstructed IContent[] so callers can replay it.
 *  (c) post-resume turns keep appending to the resumed JSONL file.
 *  (d) teardown (setRecording(false)) unsubscribes the integration from the
 *      HistoryService (no leaked 'contentAdded' listener).
 *
 * TEST HYGIENE mirrors session.spec.ts: every test uses a fresh isolated working
 * dir and removes BOTH it and its derived storage temp dir in `finally`.
 */

import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  captureHistoryServiceIdentity,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';

/** Builds a public AgentMessage (IContent) with speaker + a single text block. */
function textMessage(role: 'user' | 'model', text: string): AgentMessage {
  return {
    speaker: role === 'user' ? 'human' : 'ai',
    blocks: [{ type: 'text' as const, text }],
  } as AgentMessage;
}

/**
 * Derives the core storage temp dir for a working directory, mirroring
 * Storage.getProjectTempDir (`~/.llxprt/tmp/<sha256(workingDir)>`). Used only
 * for test cleanup so recording artifacts never accumulate.
 */
function storageTempDirFor(workingDir: string): string {
  const hash = createHash('sha256').update(workingDir).digest('hex');
  return join(homedir(), '.llxprt', 'tmp', hash);
}

/**
 * Reaches the Agent's live HistoryService as an EventEmitter via the same
 * documented internal probe the harness uses (captureHistoryServiceIdentity).
 * HistoryService extends EventEmitter, so listenerCount is a genuine public
 * observable for subscribe/unsubscribe assertions.
 */
function historyEmitter(agent: Agent): EventEmitter {
  const hs = captureHistoryServiceIdentity(agent);
  if (!(hs instanceof EventEmitter)) {
    throw new Error('HistoryService not reachable as EventEmitter');
  }
  return hs;
}

/**
 * Runs a scenario against a real Agent over an isolated working dir, then
 * disposes the agent and removes both the working dir and its derived storage
 * temp dir. Guarantees no stray recording artifacts survive.
 */
async function withIsolatedAgent(
  fixture: string,
  fn: (agent: Agent) => Promise<void>,
): Promise<void> {
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-rec-spec-'));
  // The temp dirs must be removed on EVERY exit path, including a buildAgent
  // rejection (which would otherwise leak the just-created workingDir), a
  // scenario failure, and a cleanup() rejection, which must NOT skip the rmSync
  // calls. Note that only ONE error can ultimately propagate:
  // if fn() throws AND cleanup() then also rejects in the finally, cleanup()'s
  // error replaces fn()'s. That is the standard try/finally trade-off and
  // acceptable here — either failure fails the test loudly; the invariant this
  // helper guarantees is only that no temp dir survives.
  try {
    const { agent, cleanup } = await buildAgent(fixture, { workingDir });
    try {
      await fn(agent);
    } finally {
      await cleanup();
    }
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
    rmSync(storageTempDirFor(workingDir), { recursive: true, force: true });
  }
}

describe('SessionControl continuous recording @plan:PLAN-20260617-COREAPI.P20 @requirement:REQ-010', () => {
  it('appends a turn that happens AFTER setRecording(true) to the JSONL file (continuous, not a one-shot snapshot) @requirement:REQ-010', async () => {
    await withIsolatedAgent('multi-turn-text.jsonl', async (agent) => {
      // Turn 1 happens BEFORE recording is enabled.
      await drain(agent.stream('first-user-utterance'));

      // Enable recording: snapshots the current history (turn 1) and subscribes
      // a RecordingIntegration to the reused HistoryService.
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path ?? '';
      expect(path.length).toBeGreaterThan(0);

      // Turn 2 happens AFTER recording is enabled. Its user + assistant content
      // reaches the JSONL file ONLY via the subscribed integration — a one-shot
      // snapshot taken at enable time could not contain it.
      await drain(agent.stream('second-user-sentinel-epsilon'));

      // Disable to flush + dispose the service so all queued writes land.
      await agent.session.setRecording({ enabled: false });

      const raw = readFileSync(path, 'utf8');
      // The SECOND turn's user prompt and assistant reply are both present.
      expect(raw).toContain('second-user-sentinel-epsilon');
      expect(raw).toContain('turn two reply');
    });
  });

  it('resume() returns the reconstructed IContent[] history @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // Record a real session to disk: seed a known history, enable recording
      // (materialize + snapshot + flush), then disable (flush + dispose + release
      // the lock so the file becomes resumable).
      const seeded = [
        textMessage('user', 'resume-return sentinel: wombat'),
        textMessage('model', 'acknowledged wombat'),
      ];
      await agent.setHistory(seeded);
      await agent.session.setRecording({ enabled: true });
      await agent.session.setRecording({ enabled: false });

      const restored = await agent.session.resume('latest');

      // The returned value is a real IContent[] carrying the recorded turns —
      // not void, not a Gemini Content[] round-trip.
      expect(Array.isArray(restored)).toBe(true);
      expect(restored.length).toBeGreaterThanOrEqual(2);
      for (const item of restored) {
        expect(item).toHaveProperty('speaker');
        expect(item).toHaveProperty('blocks');
        expect(Array.isArray(item.blocks)).toBe(true);
      }
      const serialized = JSON.stringify(restored);
      expect(serialized).toContain('resume-return sentinel: wombat');
      expect(serialized).toContain('acknowledged wombat');
    });
  });

  it('post-resume turns append to the resumed JSONL file @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // Record + release a session so it can be resumed.
      await agent.setHistory([textMessage('user', 'pre-resume base turn')]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.setRecording({ enabled: false });

      // Resume: adopts the resumed recording service and subscribes a fresh
      // integration so post-resume turns keep appending to the SAME file.
      await agent.session.resume('latest');
      const path = agent.session.getRecording().path ?? '';
      expect(path.length).toBeGreaterThan(0);

      // A post-resume turn appends to the resumed file.
      await drain(agent.stream('post-resume-sentinel-gamma'));

      // Disable to flush the appended content.
      await agent.session.setRecording({ enabled: false });

      const raw = readFileSync(path, 'utf8');
      expect(raw).toContain('post-resume-sentinel-gamma');
      expect(raw).toContain('a plain text reply');
    });
  });

  it('records COMPLETED TOOL CALLS (call + response) into the session JSONL for later replay (issue #1605 verification) @requirement:REQ-010', async () => {
    await withIsolatedAgent('tool-call-then-answer.jsonl', async (agent) => {
      // Recording is enabled BEFORE the tool turn, so the tool call and its
      // response reach the JSONL only via the live RecordingIntegration
      // subscription — proving the Agent API runtime records completed tool
      // calls into session history (the #1605 acceptance bar the Zed
      // loadSession replay depends on). The file materializes on first content
      // (the session is unprompted at enable time), so the path is read AFTER
      // the turn.
      await agent.session.setRecording({ enabled: true });

      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        await drain(agent.stream('run the tool'));
      } finally {
        responder.unsubscribe();
      }

      const path = agent.session.getRecording().path ?? '';
      expect(path.length).toBeGreaterThan(0);

      // Disable to flush + dispose so all queued writes land.
      await agent.session.setRecording({ enabled: false });

      const raw = readFileSync(path, 'utf8');
      // The recorded transcript carries the tool CALL block for read_file …
      expect(raw).toContain('"tool_call"');
      expect(raw).toContain('read_file');
      // … its RESPONSE block …
      expect(raw).toContain('"tool_response"');
      // … and the post-tool assistant text, i.e. the full completed exchange.
      expect(raw).toContain('after the tool ran');

      // The recorded call and response PAIR: the response's callId equals the
      // recorded call's id (the runtime normalizes ids in history, so the
      // fixture's raw id is not asserted — the pairing invariant is what the
      // #1604 replay's tool_call/tool_call_update matching depends on).
      const blocks = raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .flatMap((entry) => {
          const payload = entry['payload'] as
            | { content?: { blocks?: ReadonlyArray<Record<string, unknown>> } }
            | undefined;
          return payload?.content?.blocks ?? [];
        });
      const callBlock = blocks.find((b) => b['type'] === 'tool_call');
      const responseBlock = blocks.find((b) => b['type'] === 'tool_response');
      expect(callBlock).toBeDefined();
      expect(responseBlock).toBeDefined();
      expect(typeof callBlock?.['id']).toBe('string');
      expect(responseBlock?.['callId']).toBe(callBlock?.['id']);
    });
  });

  it('teardown unsubscribes the RecordingIntegration from the HistoryService (no leaked listener) @requirement:REQ-010', async () => {
    await withIsolatedAgent('plain-text.jsonl', async (agent) => {
      // Warm up so the chat + reused HistoryService are materialized and the
      // identity probe returns a stable EventEmitter.
      await drain(agent.stream('warm up the history service'));
      const emitter = historyEmitter(agent);
      const baseline = emitter.listenerCount('contentAdded');

      await agent.session.setRecording({ enabled: true });
      // Enabling subscribes exactly one additional 'contentAdded' listener.
      expect(emitter.listenerCount('contentAdded')).toBe(baseline + 1);

      await agent.session.setRecording({ enabled: false });
      // Disabling disposes the integration, returning the listener count to the
      // pre-enable baseline (no leaked subscription).
      expect(emitter.listenerCount('contentAdded')).toBe(baseline);
    });
  });
});
