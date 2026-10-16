/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import {
  actual,
  emptyChatsLister,
  mockFromConfig,
  buildStubAgent,
  modelMessage,
  makeZedAgent,
  makeUninitializedZedAgent,
  buildInitializeRequest,
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

  afterEach(() => {
    mockFromConfig.mockImplementation(actual.fromConfig);
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
      cwd: process.cwd(),
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
      zedAgent.newSession({ cwd: process.cwd(), mcpServers: [] }),
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
      cwd: process.cwd(),
      mcpServers: [],
    });

    const response = await zedAgent.resumeSession({
      sessionId: created.sessionId,
      cwd: process.cwd(),
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
        cwd: process.cwd(),
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32002 });
    expect(connection.onlySessionUpdates()).toStrictEqual([]);
  });

  it('closeSession disposes a live session and is idempotent', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const zedAgent = await makeZedAgent(
      new RecordingConnection(),
      async () => [],
    );
    const created = await zedAgent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });

    await expect(
      zedAgent.closeSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    await expect(
      zedAgent.closeSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    await expect(
      zedAgent.prompt({ sessionId: created.sessionId, prompt: [] }),
    ).rejects.toThrow(/Session not found/);
  });

  it('resumeSession rejects a live session when cwd does not match', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const zedAgent = await makeZedAgent(
      new RecordingConnection(),
      async () => [],
    );
    const created = await zedAgent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });

    await expect(
      zedAgent.resumeSession({
        sessionId: created.sessionId,
        cwd: path.join(process.cwd(), 'src'),
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32002 });
  });

  it('deleteSession succeeds for a live session before recording materializes', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const zedAgent = await makeZedAgent(
      new RecordingConnection(),
      async () => [],
    );
    const created = await zedAgent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });

    await expect(
      zedAgent.deleteSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    await expect(
      zedAgent.prompt({ sessionId: created.sessionId, prompt: [] }),
    ).rejects.toThrow(/Session not found/);
  });

  it('closeSession succeeds and removes the session even when agent disposal fails', async () => {
    const stub = buildStubAgent({});
    stub.dispose.mockRejectedValueOnce(new Error('dispose failed'));
    mockFromConfig.mockResolvedValue(stub.agent);
    const zedAgent = await makeZedAgent(
      new RecordingConnection(),
      async () => [],
    );
    const created = await zedAgent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });

    await expect(
      zedAgent.closeSession({ sessionId: created.sessionId }),
    ).resolves.toStrictEqual({});
    await expect(
      zedAgent.prompt({ sessionId: created.sessionId, prompt: [] }),
    ).rejects.toThrow(/Session not found/);
  });

  it('initialize() advertises loadSession: true', async () => {
    const connection = new RecordingConnection();
    const zedAgent = await makeUninitializedZedAgent(connection);
    const response = await zedAgent.initialize(buildInitializeRequest());
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.sessionCapabilities).toStrictEqual({
      list: {},
      resume: {},
    });
  });
});
