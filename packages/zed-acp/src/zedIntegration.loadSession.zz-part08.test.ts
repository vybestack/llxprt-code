/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { RecordingConnection } from './zed-test-helpers.js';
import {
  emptyChatsLister,
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

  it('RE-ATTACHES a just-created unprompted session on immediate loadSession: succeeds with modes, ZERO replay updates, original session preserved (promptable), fromConfig NOT called again, nothing disposed', async () => {
    // A fresh session created via newSession with no prompt: empty live history
    // (zero replay), and a stream that completes so a later prompt proves the
    // ORIGINAL session object is still live.
    const stub = buildStubAgent({ liveHistory: [], streamText: 'still alive' });
    // The top-level beforeEach (F2) reset the mock; set this test's single
    // resolution for the strict fromConfig build-count assertions below.
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    // Empty chats dir → no on-disk recording for the unprompted session → the
    // load must RE-ATTACH rather than destroy-and-resume.
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    } as acp.NewSessionRequest);
    // newSession built exactly one agent.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);

    const response = await zedAgent.loadSession({
      sessionId: created.sessionId,
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest);

    // Succeeds and advertises modes (ACP loadSession conformance on a live,
    // never-prompted session — no resourceNotFound).
    expect(response.modes?.currentModeId).toBe('default');
    expect(response.modes?.availableModes.map((m) => m.id)).toContain(
      'default',
    );
    // ZERO replay updates: an unprompted session has no history to replay.
    expect(connection.sessionUpdateKinds()).toStrictEqual([]);
    // The live in-memory history was consulted (re-attach path), and the disk
    // resume was NOT taken.
    expect(stub.getHistory).toHaveBeenCalledTimes(1);
    expect(stub.resume).toHaveBeenCalledTimes(0);
    // No SECOND agent was built — the ORIGINAL session was re-attached, not
    // rebuilt.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
    // Nothing was disposed: the live session survived the load.
    expect(stub.dispose).toHaveBeenCalledTimes(0);

    // The ORIGINAL session is still live and promptable after the re-attach.
    await expect(
      zedAgent.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'are you there?' }],
      } as acp.PromptRequest),
    ).resolves.toBeDefined();
    // Still the SAME agent (never rebuilt/disposed) served the prompt.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
    expect(stub.dispose).toHaveBeenCalledTimes(0);
  });
});
