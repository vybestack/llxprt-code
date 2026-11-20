/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { RequestError } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import type { IContent } from '@vybestack/llxprt-code-core';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import {
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

  it('cleans up on a PARTIAL replay failure (first N updates delivered, then a mid-stream failure) and a later retry loads cleanly (FINDING A)', async () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a1' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a2-never-delivered' }] },
    ];
    const failingStub = buildStubAgent({ resumeHistory: history });
    const retryStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'retry ok' }] },
      ],
    });
    mockFromConfig
      .mockResolvedValueOnce(failingStub.agent)
      .mockResolvedValueOnce(retryStub.agent);

    const connection = new RecordingConnection();
    // Deliver the first two updates, then fail the third mid-replay.
    connection.failSessionUpdateAfter(2, new Error('socket closed mid-replay'));
    const zedAgent = await makeZedAgent(connection);

    const params: acp.LoadSessionRequest = {
      sessionId: 'partial-fail-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    let caught: unknown;
    try {
      await zedAgent.loadSession(params);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32603);
    // The two updates that DID land are recorded; the third failed the load.
    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'user_message_chunk',
      'agent_message_chunk',
    ]);
    // Full cleanup even on partial delivery: fresh agent disposed once.
    expect(failingStub.dispose).toHaveBeenCalledTimes(1);

    // Pre-retry proof of cleanup (F16): prompting the failed id throws
    // "Session not found" because the partially-replayed load removed its
    // this.sessions entry (no stale/half-dead session survived the failure).
    await expect(
      zedAgent.prompt({
        sessionId: 'partial-fail-session',
        prompt: [{ type: 'text', text: 'still there?' }],
      } as acp.PromptRequest),
    ).rejects.toThrow(/Session not found/);

    // Transport recovers before the retry.
    connection.clearSessionUpdateFailure();

    // A subsequent load for the SAME id (transport now healthy) succeeds and
    // installs cleanly, proving no leaked lock / stale entry blocked the retry.
    const response = await zedAgent.loadSession(params);
    expect(response.modes?.currentModeId).toBe('default');
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    // 'a1' from the failed load, then 'retry ok' from the successful retry.
    expect(agentTexts).toStrictEqual(['a1', 'retry ok']);
  });

  // ─── FINDING F5: concurrent same-id loadSession serialization ─────────────
});
