/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ACP session/load (loadSession) ORCHESTRATION in the Zed
 * integration (issue #1604). This drives the REAL ZedAgent with a stubbed
 * `fromConfig` whose agent.session.resume returns a fixed IContent[] (or
 * rejects). It asserts the restored conversation is streamed to the client
 * (RecordingConnection) as ordered session/update notifications BEFORE
 * loadSession resolves, that the response advertises modes, that an unknown
 * session rejects with the chosen RequestError, that a duplicate load replaces
 * the prior session, and — for the second review round — that a failing
 * history-replay transport fully cleans up (no stale entry / leaked lock) so a
 * retry loads cleanly (FINDING A).
 *
 * The pure IContent -> ACP SessionUpdate MAPPING (mapHistoryToSessionUpdates,
 * exact wire shapes + ordered tool pairing + MCP extraction) is asserted
 * separately in zed-session-replay.test.ts; the record->resume->history FIDELITY
 * is proven by the agents-package behavioral tests
 * (sessionControl.recording.behavior.test.ts) against the REAL recording
 * services. Here the resume return value is a fixed fixture so the orchestration
 * is asserted without a provider bootstrap.
 */

import { describe, expect, it, vi } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

import { RecordingConnection } from './zed-test-helpers.js';

const mockFromConfig = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-agents', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fromConfig: (...args: unknown[]) => mockFromConfig(...args),
  };
});

vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  loadProfileByName: vi.fn(),
  setCliRuntimeContext: vi.fn(),
}));

interface StubAgentHandle {
  readonly agent: Agent;
  readonly resume: ReturnType<typeof vi.fn>;
  readonly setRecording: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
}

/**
 * Builds a stub Agent whose session.resume returns the given fixed history (or
 * rejects with the given error). Captures the resume/setRecording/dispose spies
 * so orchestration can be asserted without a real provider bootstrap.
 */
function buildStubAgent(options: {
  resumeHistory?: readonly IContent[];
  resumeError?: Error;
}): StubAgentHandle {
  const resume = vi.fn(async () => {
    if (options.resumeError !== undefined) {
      throw options.resumeError;
    }
    return options.resumeHistory ?? [];
  });
  const setRecording = vi.fn(async () => undefined);
  const dispose = vi.fn(async () => undefined);
  const agent = {
    getApprovalMode: () => 'default',
    setApprovalMode: vi.fn(),
    dispose,
    async *stream() {},
    session: { resume, setRecording },
    tools: { respondToConfirmation: vi.fn() },
  } as unknown as Agent;
  return { agent, resume, setRecording, dispose };
}

function buildBaseConfig(): Config {
  return {
    getFileSystemService: () => ({
      readTextFile: vi.fn(async () => 'base'),
      writeTextFile: vi.fn(async () => undefined),
    }),
    getProviderManager: () => ({ id: 'base' }),
    setProviderManager: vi.fn(),
    getProfileManager: () => undefined,
    getEphemeralSetting: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getMaxSessionTurns: () => 50,
  } as unknown as Config;
}

async function makeZedAgent(
  connection: RecordingConnection,
): Promise<InstanceType<typeof import('./zedIntegration.js').ZedAgent>> {
  const mod = await import('./zedIntegration.js');
  const zedAgent = new mod.ZedAgent(
    buildBaseConfig(),
    { debug: () => {} } as never,
    connection as unknown as acp.AgentSideConnection,
  );
  await zedAgent.initialize({
    protocolVersion: '1',
    clientCapabilities: {},
  } as never);
  return zedAgent;
}

describe('ZedAgent.loadSession orchestration (issue #1604)', () => {
  it('initialize() advertises loadSession: true', async () => {
    const connection = new RecordingConnection();
    const mod = await import('./zedIntegration.js');
    const zedAgent = new mod.ZedAgent(
      buildBaseConfig(),
      { debug: () => {} } as never,
      connection as unknown as acp.AgentSideConnection,
    );
    const response = await zedAgent.initialize({
      protocolVersion: '1',
      clientCapabilities: {},
    } as never);
    expect(response.agentCapabilities?.loadSession).toBe(true);
  });

  it('streams the restored conversation as ordered session/update notifications and returns modes', async () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'earlier question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'recalling' },
          { type: 'text', text: 'earlier answer' },
          {
            type: 'tool_call',
            id: 'tc-1',
            name: 'read_file',
            parameters: { absolute_path: '/project/x.ts' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'tc-1',
            toolName: 'read_file',
            result: 'the file text',
          },
        ],
      },
    ];
    const stub = buildStubAgent({ resumeHistory: history });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection);

    const response = await zedAgent.loadSession({
      sessionId: 'session-abc',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest);

    // resume was called with the requested session id.
    expect(stub.resume).toHaveBeenCalledWith('session-abc');

    // The restored transcript was streamed in order BEFORE loadSession resolved.
    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'user_message_chunk',
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);

    // The response advertises the available modes + current mode.
    expect(response.modes?.currentModeId).toBe('default');
    expect(response.modes?.availableModes.map((m) => m.id)).toContain(
      'default',
    );
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
    const zedAgent = await makeZedAgent(connection);

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

  it('replaces a prior loaded session with the same id (reconnect friendliness)', async () => {
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
    mockFromConfig
      .mockResolvedValueOnce(firstStub.agent)
      .mockResolvedValueOnce(secondStub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection);

    const params: acp.LoadSessionRequest = {
      sessionId: 'dup-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    await zedAgent.loadSession(params);
    await zedAgent.loadSession(params);

    // The prior session's agent was disposed when the second load replaced it.
    expect(firstStub.dispose).toHaveBeenCalledTimes(1);
    // Both loads streamed their respective transcripts.
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['first load', 'second load']);
  });

  // ─── FINDING A: strict history-replay delivery ────────────────────────────

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

  it('cleans up on a PARTIAL replay failure (first N updates delivered, then a mid-stream failure) and a later retry loads cleanly (FINDING A)', async () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a1' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a2-never-delivered' }] },
    ];
    const failingStub = buildStubAgent({ resumeHistory: history });
    const retryStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'retry ok' }] },
      ],
    });
    mockFromConfig
      .mockResolvedValueOnce(failingStub.agent)
      .mockResolvedValueOnce(retryStub.agent);

    const connection = new RecordingConnection();
    // Deliver the first two updates, then fail the third mid-replay.
    connection.failSessionUpdateAfter(2, new Error('socket closed mid-replay'));
    const zedAgent = await makeZedAgent(connection);

    const params: acp.LoadSessionRequest = {
      sessionId: 'partial-fail-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    let caught: unknown;
    try {
      await zedAgent.loadSession(params);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32603);
    // The two updates that DID land are recorded; the third failed the load.
    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'user_message_chunk',
      'agent_message_chunk',
    ]);
    // Full cleanup even on partial delivery: fresh agent disposed once.
    expect(failingStub.dispose).toHaveBeenCalledTimes(1);

    // Transport recovers before the retry.
    connection.clearSessionUpdateFailure();

    // A subsequent load for the SAME id (transport now healthy) succeeds and
    // installs cleanly, proving no leaked lock / stale entry blocked the retry.
    const response = await zedAgent.loadSession(params);
    expect(response.modes?.currentModeId).toBe('default');
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    // 'a1' from the failed load, then 'retry ok' from the successful retry.
    expect(agentTexts).toStrictEqual(['a1', 'retry ok']);
  });
});
