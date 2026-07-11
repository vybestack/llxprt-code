/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ACP session/load (loadSession) in the Zed integration
 * (issue #1604). Two honest layers:
 *
 *  1. IContent -> ACP SessionUpdate mapping (mapHistoryToSessionUpdates):
 *     asserts EXACT v1 snake_case wire payload shapes for every block kind, so a
 *     regression in the discriminators or field names is caught structurally.
 *
 *  2. ZedAgent.loadSession orchestration: drives the REAL ZedAgent with a stubbed
 *     `fromConfig` whose agent.session.resume returns a fixed IContent[]. Asserts
 *     the restored conversation is streamed to the client (RecordingConnection)
 *     as ordered session/update notifications BEFORE loadSession resolves, that
 *     the response advertises modes, that an unknown session rejects with the
 *     chosen RequestError, and that a duplicate load replaces the prior session.
 *
 * The record->resume->history FIDELITY is proven separately by the agents-package
 * behavioral tests (sessionControl.recording.behavior.test.ts) against the REAL
 * recording services; here the resume return value is a fixed fixture so the
 * mapping + orchestration are asserted without a provider bootstrap.
 */

import { describe, expect, it, vi } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

import { mapHistoryToSessionUpdates } from './zed-session-replay.js';
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

// ─── Layer 1: pure mapping (exact v1 snake_case wire shapes) ─────────────────

describe('mapHistoryToSessionUpdates (issue #1604 replay mapping)', () => {
  it('maps a human text block to a user_message_chunk', () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello there' }] },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'hello there' },
      },
    ]);
  });

  it('maps an ai text block to an agent_message_chunk', () => {
    const history: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'the answer' }] },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'the answer' },
      },
    ]);
  });

  it('maps an ai thinking block to an agent_thought_chunk carrying the thought text', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'let me reason' }],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'let me reason' },
      },
    ]);
  });

  it('maps an ai tool_call block to a completed tool_call with inferred kind + rawInput', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'read_file',
            parameters: { absolute_path: '/project/a.ts' },
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'read_file',
        status: 'completed',
        kind: 'read',
        rawInput: { absolute_path: '/project/a.ts' },
      },
    ]);
  });

  it('maps a tool tool_response block to a completed tool_call_update with text content', () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'read_file',
            result: 'file body contents',
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'file body contents' },
          },
        ],
      },
    ]);
  });

  it('emits an empty content array for a tool_response with no representable text', () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-2',
            toolName: 'secret_tool',
            result: {},
          },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-2',
        status: 'completed',
        content: [],
      },
    ]);
  });

  it('skips whitespace-only text and skips media/code blocks (v1 replay)', () => {
    const history: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: '   ' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'AAAA',
            encoding: 'base64',
          },
          { type: 'code', code: 'const x = 1;' },
        ],
      },
    ];
    expect(mapHistoryToSessionUpdates(history)).toStrictEqual([]);
  });

  it('omits kind for an unknown tool name but still emits the tool_call', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-x',
            name: 'totally_unknown_tool',
            parameters: { foo: 'bar' },
          },
        ],
      },
    ];
    const [update] = mapHistoryToSessionUpdates(history);
    expect(update).toStrictEqual({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-x',
      title: 'totally_unknown_tool',
      status: 'completed',
      rawInput: { foo: 'bar' },
    });
    expect('kind' in update).toBe(false);
  });

  it('preserves whole-conversation order across a multi-block transcript', () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'do a thing' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'planning' },
          { type: 'text', text: 'working on it' },
          {
            type: 'tool_call',
            id: 'c1',
            name: 'run_shell_command',
            parameters: { command: 'ls' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'run_shell_command',
            result: 'a.ts b.ts',
          },
        ],
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] },
    ];
    expect(
      mapHistoryToSessionUpdates(history).map((u) => u.sessionUpdate),
    ).toStrictEqual([
      'user_message_chunk',
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
      'agent_message_chunk',
    ]);
  });
});

// ─── Layer 2: ZedAgent.loadSession orchestration ────────────────────────────

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
});
