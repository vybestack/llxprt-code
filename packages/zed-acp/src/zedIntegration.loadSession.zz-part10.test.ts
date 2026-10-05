/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { RequestError } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import { RecordingConnection } from './zed-test-helpers.js';
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

  it('RE-ATTACH propagates a wrapped internalError and removes the partially replayed live session', async () => {
    const stub = buildStubAgent({
      liveHistory: [modelMessage('will fail to deliver')],
    });
    // beforeEach (F2) already reset the mock; set this test's single resolution
    // for the fromConfig build-count assertion below.
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    } as acp.NewSessionRequest);
    connection.clearSessionUpdateFailure();
    connection.failSessionUpdateAfter(0, new Error('transport is dead'));

    let caught: unknown;
    try {
      await zedAgent.loadSession({
        sessionId: created.sessionId,
        cwd: '/project',
        mcpServers: [],
      } as acp.LoadSessionRequest);
    } catch (e) {
      caught = e;
    }

    // A lost re-attach transcript surfaces as a wrapped internalError (replay
    // phase), mirroring the disk path's strict-replay contract.
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32603);
    expect((caught as RequestError).message).toContain('replay');
    // Once replay delivery partially fails, retaining the live session would
    // leave client and server transcript state inconsistent.
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    connection.clearSessionUpdateFailure();
    await expect(
      zedAgent.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'recovered?' }],
      } as acp.PromptRequest),
    ).rejects.toThrow(/Session not found/);
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
  });

  // ─── FINDING A: strict history-replay delivery ────────────────────────────
});
