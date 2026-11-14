/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { RequestError } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
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

  it('rejects with internalError and fully cleans up when history replay delivery FAILS on the very first update (FINDING A)', async () => {
    const stub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'lost transcript' }] },
      ],
    });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    // Dead transport: every session/update rejects, starting with the first.
    connection.failSessionUpdateAfter(0, new Error('transport is dead'));
    const zedAgent = await makeZedAgent(connection);

    const params: acp.LoadSessionRequest = {
      sessionId: 'replay-fail-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    let caught: unknown;
    try {
      await zedAgent.loadSession(params);
    } catch (e) {
      caught = e;
    }

    // A lost transcript must NOT resolve as success: it is an internal error.
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32603);
    expect((caught as RequestError).message).toContain('replay');
    // The fresh agent was disposed exactly once (releasing the recording lock).
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    // No transcript survived, and NO stale session entry remains: prompting the
    // id fails with "Session not found".
    await expect(
      zedAgent.prompt({
        sessionId: 'replay-fail-session',
        prompt: [{ type: 'text', text: 'hello?' }],
      } as acp.PromptRequest),
    ).rejects.toThrow(/Session not found/);
  });
});
