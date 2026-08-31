/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Non-CLI host contract for sequential approval boundaries on a live stream.
 *
 * A host that embeds the public Agent facade (the a2a server is the reference
 * host) cannot subscribe-and-forget confirmations: it must surface each
 * confirmation to its own user, pause stream consumption at that boundary,
 * resolve the confirmation out-of-band via `tools.respondToConfirmation`, and
 * resume iterating the SAME stream object. This pins that contract for a
 * multi-tool turn with two confirmation-requiring calls:
 *
 * - pausing at the first tool-confirmation does not lose or kill the stream;
 * - responding out-of-band resumes execution and yields the approved call's
 *   tool-result followed by the NEXT call's distinct confirmation;
 * - a scheduler snapshot may re-list already-resolved confirmations after a
 *   resume — a host distinguishes them by toolCallId, and the stream still
 *   terminates with exactly one done;
 * - both tool side effects land and the final text continuation arrives.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAgentFromContent,
  tempRoot,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import { PolicyDecision } from '@vybestack/llxprt-code-agents';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';

type ConfirmationEvent = Extract<AgentEvent, { type: 'tool-confirmation' }>;

function isConfirmation(e: AgentEvent): e is ConfirmationEvent {
  return e.type === 'tool-confirmation';
}

/**
 * Pulls events from a shared iterator until the stop predicate matches (or
 * the stream completes) — the host-side shape of pausing at a boundary.
 */
async function takeUntil(
  iterator: AsyncIterator<AgentEvent>,
  stop: (e: AgentEvent) => boolean,
): Promise<{ events: AgentEvent[]; stopped: boolean }> {
  const events: AgentEvent[] = [];
  let next = await iterator.next();
  while (next.done !== true) {
    events.push(next.value);
    if (stop(next.value)) {
      return { events, stopped: true };
    }
    next = await iterator.next();
  }
  return { events, stopped: false };
}

describe('host sequential approvals over a paused stream', () => {
  it('pause → respond → resume reaches the second confirmation and completes with one done', async () => {
    const workspace = mkdtempSync(join(tempRoot, 'host-seq-approvals-'));
    const fileA = join(workspace, 'a.txt');
    const fileB = join(workspace, 'b.txt');
    const jsonl =
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call-w1',
                name: 'write_file',
                parameters: { file_path: fileA, content: 'A' },
              },
              {
                type: 'tool_call',
                id: 'call-w2',
                name: 'write_file',
                parameters: { file_path: fileB, content: 'B' },
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'after both writes' }],
          },
        ],
      }) + '\n';

    const { agent, cleanup } = await buildAgentFromContent(jsonl, {
      workingDir: workspace,
      policy: { defaultDecision: PolicyDecision.ASK_USER },
      harness: { forceConfirmations: false },
    });
    try {
      // The facade types stream() as AsyncIterable; a manual iterator handle
      // lets the host stop and later RESUME the same stream, which is the
      // contract under test.
      const iterator = agent.stream('write both files')[Symbol.asyncIterator]();

      // Phase 1: iterate until the first confirmation boundary, then pause.
      const phase1 = await takeUntil(iterator, isConfirmation);
      const first = phase1.events.find(isConfirmation);
      expect(phase1.stopped).toBe(true);
      expect(first).toBeDefined();
      expect(first!.confirmation.toolCallId).toBe('call-w1');
      expect(phase1.events.some((e) => e.type === 'done')).toBe(false);

      // Host resolves the first confirmation out-of-band (no subscription).
      agent.tools.respondToConfirmation(
        first!.confirmation.confirmationId,
        ToolConfirmationOutcome.ProceedOnce,
      );

      // Phase 2: resuming the SAME stream must reach the second call's
      // confirmation. Stale replays of the resolved call may interleave; the
      // host skips confirmations whose toolCallId it has already resolved.
      const isSecondConfirmation = (e: AgentEvent): e is ConfirmationEvent =>
        isConfirmation(e) && e.confirmation.toolCallId !== 'call-w1';
      const phase2 = await takeUntil(iterator, isSecondConfirmation);
      const second = phase2.events.find(isSecondConfirmation);
      expect(phase2.stopped).toBe(true);
      expect(second).toBeDefined();
      expect(second!.confirmation.toolCallId).toBe('call-w2');
      expect(second!.confirmation.confirmationId).not.toBe(
        first!.confirmation.confirmationId,
      );

      agent.tools.respondToConfirmation(
        second!.confirmation.confirmationId,
        ToolConfirmationOutcome.ProceedOnce,
      );

      // Phase 3: drain to completion.
      const phase3 = await takeUntil(iterator, () => false);

      const all = [...phase1.events, ...phase2.events, ...phase3.events];
      const doneEvents = all.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
      const lastEvent = all[all.length - 1];
      expect(lastEvent.type).toBe('done');
      expect(all.some((e) => e.type === 'text')).toBe(true);

      const resultIds = all
        .filter((e) => e.type === 'tool-result')
        .map((e) => e.result.id);
      expect(resultIds).toContain('call-w1');
      expect(resultIds).toContain('call-w2');
      // the first approved call's result precedes the second's
      expect(resultIds.indexOf('call-w1')).toBeLessThan(
        resultIds.indexOf('call-w2'),
      );

      // both approved writes actually landed
      expect(readFileSync(fileA, 'utf8')).toBe('A');
      expect(readFileSync(fileB, 'utf8')).toBe('B');

      // stale replays are tolerated but recorded: they must never produce a
      // THIRD distinct confirmation (the turn has exactly two tool calls)
      const distinctConfirmationCalls = new Set(
        all.filter(isConfirmation).map((e) => e.confirmation.toolCallId),
      );
      expect([...distinctConfirmationCalls].sort()).toStrictEqual([
        'call-w1',
        'call-w2',
      ]);
      // stale replays are tolerated but must be identifiable: each replay
      // of the already-resolved call reuses the ORIGINAL confirmationId, so
      // a host keyed on confirmationId (or toolCallId) can dedupe them.
      const isReplayOfFirst = (e: AgentEvent): e is ConfirmationEvent =>
        isConfirmation(e) && e.confirmation.toolCallId === 'call-w1';
      for (const replay of phase2.events.filter(isReplayOfFirst)) {
        expect(replay.confirmation.confirmationId).toBe(
          first!.confirmation.confirmationId,
        );
      }
    } finally {
      try {
        await cleanup();
      } finally {
        // Remove the workspace even when cleanup throws, so repeated runs
        // do not accumulate orphaned temp directories.
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('post-creation setModel is visible through the facade provider getters (provider unchanged)', async () => {
    const workspace = mkdtempSync(join(tempRoot, 'host-config-change-'));
    const jsonl =
      JSON.stringify({
        chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] }],
      }) + '\n';

    const { agent, cleanup } = await buildAgentFromContent(jsonl, {
      workingDir: workspace,
    });
    try {
      const providerBefore = agent.getProvider();
      const statusBefore = agent.getProviderStatus();
      expect(statusBefore.model).toBe('fake-model');

      // A non-CLI host re-points the model after creation through the SAME
      // facade it created the agent with — no config reload, no rebuild.
      await agent.setModel('fake-model-v2');
      expect(agent.getProviderStatus().model).toBe('fake-model-v2');

      // The provider stays the fake seam; only the model slot changed.
      expect(agent.getProvider()).toBe(providerBefore);
    } finally {
      try {
        await cleanup();
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  }, 60_000);
});
