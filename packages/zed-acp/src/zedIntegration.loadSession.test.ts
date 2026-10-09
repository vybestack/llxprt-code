/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
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

  it('continues creating a session when optional recording setup fails', async () => {
    const stub = buildStubAgent({
      recordingError: new Error('recording unavailable'),
    });
    mockFromConfig.mockResolvedValue(stub.agent);
    const zedAgent = await makeZedAgent(
      new RecordingConnection(),
      emptyChatsLister,
    );

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    expect(created.sessionId).toStrictEqual(expect.any(String));
    expect(stub.dispose).not.toHaveBeenCalled();
  });

  it('disposes a new session when initial command advertisement fails', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const connection = new RecordingConnection();
    connection.failSessionUpdateAfter(0, new Error('transport unavailable'));
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    await expect(
      zedAgent.newSession({ cwd: '/project', mcpServers: [] }),
    ).rejects.toThrow('transport unavailable');
    expect(stub.dispose).toHaveBeenCalledTimes(1);
  });

  it('resumeSession reattaches a live session without replaying history', async () => {
    const stub = buildStubAgent({
      liveHistory: [modelMessage('must not replay')],
    });
    mockFromConfig.mockResolvedValue(stub.agent);
    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection, async () => []);
    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    });

    const response = await zedAgent.resumeSession({
      sessionId: created.sessionId,
      cwd: '/project',
      mcpServers: [],
    });

    expect(response.modes?.currentModeId).toBe('default');
    expect(connection.onlySessionUpdates()).toStrictEqual([]);
    expect(stub.resume).not.toHaveBeenCalled();
  });

  it('resumeSession rejects an unknown session without replaying updates', async () => {
    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection, async () => []);

    await expect(
      zedAgent.resumeSession({
        sessionId: 'missing-session',
        cwd: '/project',
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32002 });
    expect(connection.onlySessionUpdates()).toStrictEqual([]);
  });
});
