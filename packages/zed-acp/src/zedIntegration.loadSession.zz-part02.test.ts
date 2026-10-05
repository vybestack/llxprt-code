/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { RecordingConnection } from './zed-test-helpers.js';
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

  it('closeSession disposes a live session and is idempotent', async () => {
    const stub = buildStubAgent({});
    mockFromConfig.mockResolvedValue(stub.agent);
    const zedAgent = await makeZedAgent(
      new RecordingConnection(),
      async () => [],
    );
    const created = await zedAgent.newSession({
      cwd: '/project',
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
      cwd: '/project',
      mcpServers: [],
    });

    await expect(
      zedAgent.resumeSession({
        sessionId: created.sessionId,
        cwd: '/project/other',
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
      cwd: '/project',
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
});
