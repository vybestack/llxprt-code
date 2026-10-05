/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { RecordingConnection } from './zed-test-helpers.js';
import {
  recordedFilesLister,
  mockFromConfig,
  buildStubAgent,
  makeZedAgent,
} from './zedIntegration.loadSession.test-helpers.js';

describe('ZedAgent.loadSession orchestration (issue #1604)', () => {
  // FINDING F2: reset the module-level fromConfig mock before EVERY test so no
  // test inherits queued mockResolvedValueOnce implementations or accumulated
  // call counts from a prior test. Each test then establishes its OWN
  // resolved-value expectation (single mockResolvedValue or ordered
  // mockResolvedValueOnce chain), so the strict build-count / call-order
  // assertions are self-contained and order-independent. This replaces the
  // scattered inline mockFromConfig.mockReset() calls the individual tests used
  // to need.
  beforeEach(() => {
    mockFromConfig.mockReset();
  });

  it('serializes two CONCURRENT loadSession calls for the SAME id so exactly one live session remains and neither agent is double-disposed (FINDING F5)', async () => {
    // The FIRST load's resume is gated so it resolves AFTER the second load has
    // already been dispatched: without per-id serialization both loads would
    // build agents and race to install, the later overwriting the earlier and
    // orphaning its recording lock. With serialization the second load runs only
    // after the first fully installs, then disposes it (replace semantics) and
    // installs itself — leaving exactly one live session, each agent disposed at
    // most once.
    let releaseFirstResume!: () => void;
    const firstResumeGate = new Promise<void>((resolve) => {
      releaseFirstResume = resolve;
    });
    const firstResume = vi.fn(async () => {
      await firstResumeGate;
      return [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'first' }] },
      ] as readonly IContent[];
    });
    const firstDispose = vi.fn(async () => undefined);
    const firstAgent = {
      getApprovalMode: () => 'default',
      setApprovalMode: vi.fn(),
      getHistory: vi.fn(async () => []),
      dispose: firstDispose,
      async *stream() {},
      session: { resume: firstResume, setRecording: vi.fn() },
      tools: { respondToConfirmation: vi.fn() },
    } as unknown as Agent;

    const secondStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] },
      ],
    });

    // The top-level beforeEach (F2) already reset the mock; establish this
    // test's ordered two-agent resolution for the build-count assertion below.
    mockFromConfig
      .mockResolvedValueOnce(firstAgent)
      .mockResolvedValueOnce(secondStub.agent);

    const connection = new RecordingConnection();
    // Recorded session: the second (serialized) load must take the disk-resume
    // replace path, so the injected probe reports a matching on-disk file.
    const zedAgent = await makeZedAgent(
      connection,
      recordedFilesLister('concurrent-session'),
    );

    const params: acp.LoadSessionRequest = {
      sessionId: 'concurrent-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    // Fire both loads concurrently; the second is dispatched while the first is
    // still awaiting its gated resume.
    const firstLoad = zedAgent.loadSession(params);
    const secondLoad = zedAgent.loadSession(params);

    // Flush to a macrotask boundary so ALL runnable microtasks settle: the first
    // load progresses until it parks on the gated resume, and the second load
    // parks behind the first's queue entry (serialization). A macrotask flush is
    // robust to the exact number of intermediate awaits, unlike a single
    // Promise.resolve() tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The first load built its agent and called resume (now parked on the gate);
    // the second is serialized behind it, so it has NOT built an agent and its
    // resume has NOT been called — proving the two same-id loads do not race.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
    expect(firstResume).toHaveBeenCalledTimes(1);
    expect(secondStub.resume).toHaveBeenCalledTimes(0);

    // Release the first resume; both loads now settle in order.
    releaseFirstResume();
    const [firstResult, secondResult] = await Promise.all([
      firstLoad,
      secondLoad,
    ]);

    // Both settled sanely with modes advertised.
    expect(firstResult.modes?.currentModeId).toBe('default');
    expect(secondResult.modes?.currentModeId).toBe('default');

    // The first session was disposed exactly once (replaced by the second); the
    // second remains live and was never disposed. No double-dispose occurred.
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondStub.dispose).toHaveBeenCalledTimes(0);

    // Exactly one live session remains: prompting the id reaches the SECOND
    // (live) agent's stream and completes rather than throwing "Session not
    // found".
    await expect(
      zedAgent.prompt({
        sessionId: 'concurrent-session',
        prompt: [{ type: 'text', text: 'who is live?' }],
      } as acp.PromptRequest),
    ).resolves.toBeDefined();

    // Both transcripts streamed in order: first load's 'first', then the second
    // load's 'second'.
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['first', 'second']);
  });
});
