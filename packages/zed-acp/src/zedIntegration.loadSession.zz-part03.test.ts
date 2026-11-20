/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import {
  mockFromConfig,
  buildStubAgent,
  buildInitializeRequest,
  makeUninitializedZedAgent,
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

  it('closeSession reports disposal failure and removes the session', async () => {
    const stub = buildStubAgent({});
    const failure = new Error('dispose failed');
    stub.dispose.mockRejectedValueOnce(failure);
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
    ).rejects.toBe(failure);
    await expect(
      zedAgent.prompt({ sessionId: created.sessionId, prompt: [] }),
    ).rejects.toThrow(/Session not found/);
  });

  it('initialize() advertises loadSession: true', async () => {
    const connection = new RecordingConnection();
    // Reuse the shared typed constructor args (F15) rather than re-inlining the
    // ZedAgent setup; assert the capability from a fresh initialize() call.
    const zedAgent = await makeUninitializedZedAgent(connection);
    const response = await zedAgent.initialize(buildInitializeRequest());
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.sessionCapabilities).toStrictEqual({
      list: {},
      resume: {},
    });
  });
});
