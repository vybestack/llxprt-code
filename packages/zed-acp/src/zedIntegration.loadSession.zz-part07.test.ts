/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
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

  it('takes the DISK-RESUME path (dispose prior + fresh build/resume/replay) when a matching recording EXISTS on disk for a live same-id session (#1604 probe decides disk branch)', async () => {
    const firstStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'first load' }] },
      ],
    });
    const secondStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'second load' }] },
      ],
    });
    // The top-level beforeEach (FINDING F2) already reset the mock; this test
    // just establishes its ordered two-agent resolution for the build-count
    // assertion below.
    mockFromConfig
      .mockResolvedValueOnce(firstStub.agent)
      .mockResolvedValueOnce(secondStub.agent);

    const connection = new RecordingConnection();
    // A recording EXISTS on disk for this id, so the second (reconnect) load must
    // take the disk-resume replace path — NOT re-attach. The injected lister is an
    // honest readdir fake returning the real session-*-<first12>.jsonl entry name,
    // so production findMatchingSessionFile decides the branch.
    const lister = recordedFilesLister('dup-session');
    const listerSpy = vi.fn(lister);
    const zedAgent = await makeZedAgent(connection, listerSpy);

    const params: acp.LoadSessionRequest = {
      sessionId: 'dup-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    await zedAgent.loadSession(params);
    await zedAgent.loadSession(params);

    // The probe was consulted on the second load (a live session existed) and,
    // finding a matching file, routed to the disk path.
    expect(listerSpy).toHaveBeenCalledTimes(1);
    // Disk path: a fresh agent was built + resumed for the reconnect...
    expect(mockFromConfig).toHaveBeenCalledTimes(2);
    expect(secondStub.resume).toHaveBeenCalledWith('dup-session');
    // ...and the prior session's agent was disposed when the second load replaced it.
    expect(firstStub.dispose).toHaveBeenCalledTimes(1);
    // Both loads streamed their respective (disk-resumed) transcripts.
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['first load', 'second load']);
  });

  // ─── #1604: re-attach live unprompted sessions on session/load ────────────
});
