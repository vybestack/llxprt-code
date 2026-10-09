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

  it('does not leave a stale/half-dead session when the replacement resume fails, and a later successful load for the same id works (FINDING 1)', async () => {
    // First load succeeds and installs a live in-memory session.
    const firstStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'live session' }] },
      ],
    });
    // Second load (a reconnect) builds a fresh agent whose resume REJECTS: the
    // prior session was already disposed to release the on-disk lock, so this
    // must NOT leave a half-dead entry behind.
    const failingStub = buildStubAgent({
      resumeError: new Error('Session is in use by another process'),
    });
    // Third load (a retry) succeeds again and must cleanly install.
    const retryStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'retry session' }] },
      ],
    });
    mockFromConfig
      .mockResolvedValueOnce(firstStub.agent)
      .mockResolvedValueOnce(failingStub.agent)
      .mockResolvedValueOnce(retryStub.agent);

    const connection = new RecordingConnection();
    // This is a RECORDED session (the reconnect exercises the disk-resume replace
    // path), so the injected probe reports a matching on-disk file for the id —
    // driving loadSession down the destroy-prior + resume branch, NOT re-attach.
    const zedAgent = await makeZedAgent(
      connection,
      recordedFilesLister('lock-session'),
    );

    const params: acp.LoadSessionRequest = {
      sessionId: 'lock-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    // 1) Initial successful load installs a live session; nothing disposed yet.
    await zedAgent.loadSession(params);
    expect(firstStub.dispose).toHaveBeenCalledTimes(0);

    // 2) Failing reload: surfaces the underlying detail, disposes the fresh
    // (failing) agent, and leaves NO stale entry for the id.
    let caught: unknown;
    try {
      await zedAgent.loadSession(params);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RequestError);
    // 'in use' is a lock reason (not not-found) -> internalError carrying detail.
    expect((caught as RequestError).code).toBe(-32603);
    expect((caught as RequestError).message).toContain('in use');
    // The prior in-memory session was disposed FIRST (to release the on-disk
    // lock the replacement needs), and the fresh failing agent was disposed on
    // the failure path — each exactly once.
    expect(firstStub.dispose).toHaveBeenCalledTimes(1);
    expect(failingStub.dispose).toHaveBeenCalledTimes(1);
    // Prompting the id now fails because NO stale entry survived the failed load.
    await expect(
      zedAgent.prompt({
        sessionId: 'lock-session',
        prompt: [{ type: 'text', text: 'are you there?' }],
      } as acp.PromptRequest),
    ).rejects.toThrow(/Session not found/);

    // 3) A subsequent successful load for the SAME id works and streams again.
    const response = await zedAgent.loadSession(params);
    expect(response.modes?.currentModeId).toBe('default');
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['live session', 'retry session']);
  });
});
