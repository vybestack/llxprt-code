/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import {
  emptyChatsLister,
  mockFromConfig,
  buildStubAgent,
  modelMessage,
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

  it('RE-ATTACH replays the live in-memory transcript (from getHistory) when an unprompted session was loaded after some in-memory turns, without a disk resume', async () => {
    // A live session whose in-memory history has content but which has NOT yet
    // materialized a recording file (empty chats dir): re-attach must replay the
    // LIVE history (getHistory), not the disk resume fixture.
    const stub = buildStubAgent({
      liveHistory: [modelMessage('live reattach text')],
      // resumeHistory is deliberately DIFFERENT so a wrong (disk) path is visible.
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'DISK not used' }] },
      ],
    });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    } as acp.NewSessionRequest);

    await zedAgent.loadSession({
      sessionId: created.sessionId,
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest);

    // The live transcript was replayed via getHistory; resume was NOT called.
    expect(stub.getHistory).toHaveBeenCalledTimes(1);
    expect(stub.resume).toHaveBeenCalledTimes(0);
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['live reattach text']);
    // Live session preserved (re-attach never disposes a healthy session).
    expect(stub.dispose).toHaveBeenCalledTimes(0);
  });
});
