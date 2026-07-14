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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { ChatSessionFileLister } from './zed-session-loader.js';

import { RecordingConnection } from './zed-test-helpers.js';

/**
 * A chats dir that never exists on disk, so the disk-resume corrupt-vs-missing
 * probe (zed-session-loader.listSessionFileNames does a REAL readdir here) always
 * hits ENOENT and falls back to the plain not-found mapping — keeping the
 * resourceNotFound test deterministic. The RE-ATTACH probe (hasRecordedSessionFile)
 * uses the INJECTED lister below instead, so this path value is irrelevant to it.
 */
const NONEXISTENT_CHATS_PARENT = path.join(
  os.tmpdir(),
  'llxprt-zed-loadsession-tests-nonexistent',
);

/**
 * Honest readdir-like lister that reports NO on-disk recordings (empty chats
 * dir), driving loadSession down the RE-ATTACH path when a live session exists.
 */
const emptyChatsLister: ChatSessionFileLister = async () => [];

/**
 * Honest readdir-like lister that reports a recorded session file on disk for
 * each given session id, driving loadSession down the DISK-RESUME path (the file
 * "exists"). Returns real directory ENTRY NAMES matching the
 * `session-<timestamp>-<first-12-of-id>.jsonl` shape SessionRecordingService
 * writes, so the production findMatchingSessionFile logic (not a result-shaped
 * mock) decides the branch.
 */
function recordedFilesLister(...sessionIds: string[]): ChatSessionFileLister {
  const names = sessionIds.map(
    (id) => `session-2026-07-11T10-00-00-${id.substring(0, 12)}.jsonl`,
  );
  return async () => names;
}

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
  readonly getHistory: ReturnType<typeof vi.fn>;
}

/**
 * Builds a stub Agent whose session.resume returns the given fixed history (or
 * rejects with the given error). Captures the resume/setRecording/dispose/getHistory
 * spies so orchestration can be asserted without a real provider bootstrap.
 *
 * `getHistory` returns the LIVE in-memory history (Gemini AgentMessage[]) used by
 * the #1604 re-attach replay path; it defaults to empty (a fresh unprompted
 * session → zero replay updates). It is DISTINCT from `resumeHistory`, which is
 * the neutral IContent[] the disk resume returns.
 */
function buildStubAgent(options: {
  resumeHistory?: readonly IContent[];
  resumeError?: Error;
  liveHistory?: readonly AgentMessage[];
  streamText?: string;
  recordingError?: Error;
}): StubAgentHandle {
  const resume = vi.fn(async () => {
    if (options.resumeError !== undefined) {
      throw options.resumeError;
    }
    return options.resumeHistory ?? [];
  });
  const setRecording = vi.fn(async () => {
    if (options.recordingError !== undefined) {
      throw options.recordingError;
    }
  });
  const dispose = vi.fn(async () => undefined);
  const getHistory = vi.fn(async () => options.liveHistory ?? []);
  const streamText = options.streamText;
  const agent = {
    getApprovalMode: () => 'default',
    setApprovalMode: vi.fn(),
    dispose,
    getHistory,
    async *stream() {
      if (streamText !== undefined) {
        yield { type: 'text', text: streamText };
      }
      yield { type: 'done', reason: 'stop' };
    },
    session: { resume, setRecording },
    tools: { respondToConfirmation: vi.fn() },
  } as unknown as Agent;
  return { agent, resume, setRecording, dispose, getHistory };
}

/**
 * Builds a live Gemini AgentMessage (Content) for the re-attach getHistory stub:
 * a model turn carrying a single text part. Used to prove the re-attach path
 * replays the live in-memory transcript (not the disk resume fixture).
 */
function modelMessage(text: string): AgentMessage {
  return { role: 'model', parts: [{ text }] } as unknown as AgentMessage;
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
    getProjectRoot: () => '/project',
    getMaxSessionTurns: () => 50,
    // No recording service in loadSession tests — the session lifecycle under
    // test does not depend on session recording (only the re-attach/resume
    // probes and session-info hydration paths are exercised here).
    getSessionRecordingService: () => undefined,
    // The re-attach + corrupt-vs-missing probes derive the chats dir from
    // storage.getProjectChatsDir(); point it at a dir that never exists so the
    // disk-resume probe's REAL readdir hits ENOENT (falling back to the plain
    // mapping) while the injected re-attach lister decides the re-attach branch.
    storage: {
      getProjectTempDir: () => NONEXISTENT_CHATS_PARENT,
      getProjectChatsDir: () => path.join(NONEXISTENT_CHATS_PARENT, 'chats'),
    },
  } as unknown as Config;
}

/**
 * Minimal typed LoadedSettings stub (F14): the ZedAgent constructor only stores
 * the settings arg (it is unused by the loadSession/newSession orchestration
 * paths under test), so a typed empty projection avoids an `as never` cast while
 * staying honest about what the code touches.
 */
function buildStubSettings(): LoadedSettings {
  return {} as LoadedSettings;
}

/** Typed InitializeRequest for a client that advertises no capabilities. */
function buildInitializeRequest(): acp.InitializeRequest {
  return { protocolVersion: 1, clientCapabilities: {} };
}

/**
 * Constructs a ZedAgent over the RecordingConnection with typed stub args (no
 * `as never`, F14) and initializes it. Shared by every orchestration test,
 * including the initialize()-advertises-loadSession assertion (F15) so the
 * makeZedAgent setup is not duplicated.
 */
async function makeZedAgent(
  connection: RecordingConnection,
  sessionFileLister?: ChatSessionFileLister,
): Promise<InstanceType<typeof import('./zedIntegration.js').ZedAgent>> {
  const mod = await import('./zedIntegration.js');
  const zedAgent = new mod.ZedAgent(
    buildBaseConfig(),
    buildStubSettings(),
    connection as unknown as acp.AgentSideConnection,
    sessionFileLister,
  );
  await zedAgent.initialize(buildInitializeRequest());
  return zedAgent;
}

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

  it('closeSession succeeds and removes the session even when agent disposal fails', async () => {
    const stub = buildStubAgent({});
    stub.dispose.mockRejectedValueOnce(new Error('dispose failed'));
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
      zedAgent.prompt({ sessionId: created.sessionId, prompt: [] }),
    ).rejects.toThrow(/Session not found/);
  });

  it('initialize() advertises loadSession: true', async () => {
    const connection = new RecordingConnection();
    const mod = await import('./zedIntegration.js');
    // Reuse the shared typed constructor args (F15) rather than re-inlining the
    // ZedAgent setup; assert the capability from a fresh initialize() call.
    const zedAgent = new mod.ZedAgent(
      buildBaseConfig(),
      buildStubSettings(),
      connection as unknown as acp.AgentSideConnection,
    );
    const response = await zedAgent.initialize(buildInitializeRequest());
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.sessionCapabilities).toStrictEqual({
      list: {},
      resume: {},
    });
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

  it('RE-ATTACHES a just-created unprompted session on immediate loadSession: succeeds with modes, ZERO replay updates, original session preserved (promptable), fromConfig NOT called again, nothing disposed', async () => {
    // A fresh session created via newSession with no prompt: empty live history
    // (zero replay), and a stream that completes so a later prompt proves the
    // ORIGINAL session object is still live.
    const stub = buildStubAgent({ liveHistory: [], streamText: 'still alive' });
    // The top-level beforeEach (F2) reset the mock; set this test's single
    // resolution for the strict fromConfig build-count assertions below.
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    // Empty chats dir → no on-disk recording for the unprompted session → the
    // load must RE-ATTACH rather than destroy-and-resume.
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    } as acp.NewSessionRequest);
    // newSession built exactly one agent.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);

    const response = await zedAgent.loadSession({
      sessionId: created.sessionId,
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest);

    // Succeeds and advertises modes (ACP loadSession conformance on a live,
    // never-prompted session — no resourceNotFound).
    expect(response.modes?.currentModeId).toBe('default');
    expect(response.modes?.availableModes.map((m) => m.id)).toContain(
      'default',
    );
    // ZERO replay updates: an unprompted session has no history to replay.
    expect(connection.sessionUpdateKinds()).toStrictEqual([]);
    // The live in-memory history was consulted (re-attach path), and the disk
    // resume was NOT taken.
    expect(stub.getHistory).toHaveBeenCalledTimes(1);
    expect(stub.resume).toHaveBeenCalledTimes(0);
    // No SECOND agent was built — the ORIGINAL session was re-attached, not
    // rebuilt.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
    // Nothing was disposed: the live session survived the load.
    expect(stub.dispose).toHaveBeenCalledTimes(0);

    // The ORIGINAL session is still live and promptable after the re-attach.
    await expect(
      zedAgent.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'are you there?' }],
      } as acp.PromptRequest),
    ).resolves.toBeDefined();
    // Still the SAME agent (never rebuilt/disposed) served the prompt.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
    expect(stub.dispose).toHaveBeenCalledTimes(0);
  });

  it('RE-ATTACH replays the live in-memory transcript (from getHistory) when an unprompted session was loaded after some in-memory turns, without a disk resume', async () => {
    // A live session whose in-memory history has content but which has NOT yet
    // materialized a recording file (empty chats dir): re-attach must replay the
    // LIVE history (getHistory), not the disk resume fixture.
    const stub = buildStubAgent({
      liveHistory: [modelMessage('live reattach text')],
      // resumeHistory is deliberately DIFFERENT so a wrong (disk) path is visible.
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'DISK not used' }] },
      ],
    });
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    } as acp.NewSessionRequest);

    await zedAgent.loadSession({
      sessionId: created.sessionId,
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest);

    // The live transcript was replayed via getHistory; resume was NOT called.
    expect(stub.getHistory).toHaveBeenCalledTimes(1);
    expect(stub.resume).toHaveBeenCalledTimes(0);
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['live reattach text']);
    // Live session preserved (re-attach never disposes a healthy session).
    expect(stub.dispose).toHaveBeenCalledTimes(0);
  });

  it('RE-ATTACH propagates a wrapped internalError WITHOUT disposing the healthy live session when replay delivery fails', async () => {
    const stub = buildStubAgent({
      liveHistory: [modelMessage('will fail to deliver')],
    });
    // beforeEach (F2) already reset the mock; set this test's single resolution
    // for the fromConfig build-count assertion below.
    mockFromConfig.mockResolvedValue(stub.agent);

    const connection = new RecordingConnection();
    const zedAgent = await makeZedAgent(connection, emptyChatsLister);

    const created = await zedAgent.newSession({
      cwd: '/project',
      mcpServers: [],
    } as acp.NewSessionRequest);
    connection.clearSessionUpdateFailure();
    connection.failSessionUpdateAfter(0, new Error('transport is dead'));

    let caught: unknown;
    try {
      await zedAgent.loadSession({
        sessionId: created.sessionId,
        cwd: '/project',
        mcpServers: [],
      } as acp.LoadSessionRequest);
    } catch (e) {
      caught = e;
    }

    // A lost re-attach transcript surfaces as a wrapped internalError (replay
    // phase), mirroring the disk path's strict-replay contract.
    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).code).toBe(-32603);
    expect((caught as RequestError).message).toContain('replay');
    // CRUCIAL re-attach cleanup semantics: the healthy live session is NOT
    // disposed on a replay failure (it was never destroyed), so it is still
    // live and promptable — unlike the disk path which disposes on replay failure.
    expect(stub.dispose).toHaveBeenCalledTimes(0);
    // clearing the transport, the SAME live session still serves a prompt.
    connection.clearSessionUpdateFailure();
    await expect(
      zedAgent.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'recovered?' }],
      } as acp.PromptRequest),
    ).resolves.toBeDefined();
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
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

    // Pre-retry proof of cleanup (F16): prompting the failed id throws
    // "Session not found" because the partially-replayed load removed its
    // this.sessions entry (no stale/half-dead session survived the failure).
    await expect(
      zedAgent.prompt({
        sessionId: 'partial-fail-session',
        prompt: [{ type: 'text', text: 'still there?' }],
      } as acp.PromptRequest),
    ).rejects.toThrow(/Session not found/);

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

  // ─── FINDING F5: concurrent same-id loadSession serialization ─────────────

  it('serializes two CONCURRENT loadSession calls for the SAME id so exactly one live session remains and neither agent is double-disposed (FINDING F5)', async () => {
    // The FIRST load's resume is gated so it resolves AFTER the second load has
    // already been dispatched: without per-id serialization both loads would
    // build agents and race to install, the later overwriting the earlier and
    // orphaning its recording lock. With serialization the second load runs only
    // after the first fully installs, then disposes it (replace semantics) and
    // installs itself — leaving exactly one live session, each agent disposed at
    // most once.
    let releaseFirstResume!: () => void;
    const firstResumeGate = new Promise<void>((resolve) => {
      releaseFirstResume = resolve;
    });
    const firstResume = vi.fn(async () => {
      await firstResumeGate;
      return [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'first' }] },
      ] as readonly IContent[];
    });
    const firstDispose = vi.fn(async () => undefined);
    const firstAgent = {
      getApprovalMode: () => 'default',
      setApprovalMode: vi.fn(),
      getHistory: vi.fn(async () => []),
      dispose: firstDispose,
      async *stream() {},
      session: { resume: firstResume, setRecording: vi.fn() },
      tools: { respondToConfirmation: vi.fn() },
    } as unknown as Agent;

    const secondStub = buildStubAgent({
      resumeHistory: [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] },
      ],
    });

    // The top-level beforeEach (F2) already reset the mock; establish this
    // test's ordered two-agent resolution for the build-count assertion below.
    mockFromConfig
      .mockResolvedValueOnce(firstAgent)
      .mockResolvedValueOnce(secondStub.agent);

    const connection = new RecordingConnection();
    // Recorded session: the second (serialized) load must take the disk-resume
    // replace path, so the injected probe reports a matching on-disk file.
    const zedAgent = await makeZedAgent(
      connection,
      recordedFilesLister('concurrent-session'),
    );

    const params: acp.LoadSessionRequest = {
      sessionId: 'concurrent-session',
      cwd: '/project',
      mcpServers: [],
    } as acp.LoadSessionRequest;

    // Fire both loads concurrently; the second is dispatched while the first is
    // still awaiting its gated resume.
    const firstLoad = zedAgent.loadSession(params);
    const secondLoad = zedAgent.loadSession(params);

    // Flush to a macrotask boundary so ALL runnable microtasks settle: the first
    // load progresses until it parks on the gated resume, and the second load
    // parks behind the first's queue entry (serialization). A macrotask flush is
    // robust to the exact number of intermediate awaits, unlike a single
    // Promise.resolve() tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The first load built its agent and called resume (now parked on the gate);
    // the second is serialized behind it, so it has NOT built an agent and its
    // resume has NOT been called — proving the two same-id loads do not race.
    expect(mockFromConfig).toHaveBeenCalledTimes(1);
    expect(firstResume).toHaveBeenCalledTimes(1);
    expect(secondStub.resume).toHaveBeenCalledTimes(0);

    // Release the first resume; both loads now settle in order.
    releaseFirstResume();
    const [firstResult, secondResult] = await Promise.all([
      firstLoad,
      secondLoad,
    ]);

    // Both settled sanely with modes advertised.
    expect(firstResult.modes?.currentModeId).toBe('default');
    expect(secondResult.modes?.currentModeId).toBe('default');

    // The first session was disposed exactly once (replaced by the second); the
    // second remains live and was never disposed. No double-dispose occurred.
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondStub.dispose).toHaveBeenCalledTimes(0);

    // Exactly one live session remains: prompting the id reaches the SECOND
    // (live) agent's stream and completes rather than throwing "Session not
    // found".
    await expect(
      zedAgent.prompt({
        sessionId: 'concurrent-session',
        prompt: [{ type: 'text', text: 'who is live?' }],
      } as acp.PromptRequest),
    ).resolves.toBeDefined();

    // Both transcripts streamed in order: first load's 'first', then the second
    // load's 'second'.
    const agentTexts = connection
      .onlySessionUpdates()
      .filter((u) => u.sessionUpdate === 'agent_message_chunk')
      .map((u) => (u as { content: { text: string } }).content.text);
    expect(agentTexts).toStrictEqual(['first', 'second']);
  });
});
