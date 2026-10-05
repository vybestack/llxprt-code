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

  it('rejects an unknown session with RequestError.resourceNotFound (code -32002)', async () => {
    const stub = buildStubAgent({
      resumeError: new Error('No sessions found for this project'),
    });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection);

    let caught: unknown;
    try {
      await zedAgent.loadSession({
        sessionId: 'missing-session',
        cwd: '/project',
        mcpServers: [],
      } as acp.LoadSessionRequest);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32002);
    expect((caught as RequestError).message).toContain('missing-session');
    // The freshly built agent was torn down so no lock/recording leaks.
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    // No transcript was streamed for a failed load.
    expect(connection.sessionUpdateKinds()).toStrictEqual([]);
  });

  it('maps a non-not-found resume failure (locked/corrupt) to RequestError.internalError (code -32603) carrying the underlying detail (FINDING 4)', async () => {
    const stub = buildStubAgent({
      resumeError: new Error(
        'Failed to resume session: Failed to replay session: Missing or corrupt session_start event',
      ),
    });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection);

    let caught: unknown;
    try {
      await zedAgent.loadSession({
        sessionId: 'corrupt-session',
        cwd: '/project',
        mcpServers: [],
      } as acp.LoadSessionRequest);
    } catch (e) {
      caught = e;
    }

    // A corrupt/locked reason is NOT resourceNotFound: it is surfaced as an
    // internal error so the client sees the session exists but could not load.
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32603);
    // The underlying core detail is carried in the message AND the data payload
    // so the client can show why the load failed (actionable, not "not found").
    expect((caught as RequestError).message).toContain('corrupt');
    expect((caught as RequestError).data).toMatchObject({
      sessionId: 'corrupt-session',
    });
    expect(
      ((caught as RequestError).data as { reason: string }).reason,
    ).toContain('corrupt');
    // The freshly built agent was still torn down on the failure path.
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    expect(connection.sessionUpdateKinds()).toStrictEqual([]);
  });
});
