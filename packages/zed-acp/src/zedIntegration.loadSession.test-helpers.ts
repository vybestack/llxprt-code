/**
 * @license
 * Copyright 2026 Vybestack LLC
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

import { vi } from 'bun:test';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';
import type { ChatSessionFileLister } from './zed-session-loader.js';

import type { RecordingConnection } from './zed-test-helpers.js';
import type { ZedAgent } from './zedIntegration.js';

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
export const emptyChatsLister: ChatSessionFileLister = async () => [];

/**
 * Honest readdir-like lister that reports a recorded session file on disk for
 * each given session id, driving loadSession down the DISK-RESUME path (the file
 * "exists"). Returns real directory ENTRY NAMES matching the
 * `session-<timestamp>-<first-12-of-id>.jsonl` shape SessionRecordingService
 * writes, so the production findMatchingSessionFile logic (not a result-shaped
 * mock) decides the branch.
 */
export function recordedFilesLister(
  ...sessionIds: string[]
): ChatSessionFileLister {
  const names = sessionIds.map(
    (id) => `session-2026-07-11T10-00-00-${id.substring(0, 12)}.jsonl`,
  );
  return async () => names;
}

export const mockFromConfig = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  fromConfig: (...args: unknown[]) => mockFromConfig(...args),
}));

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
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
export function buildStubAgent(options: {
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
    return (async function* () {
      yield* options.resumeHistory ?? [];
    })();
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
    async *streamHistory() {
      yield* await getHistory();
    },
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

/** Builds a neutral live agent message for the re-attach getHistory stub. */
export function modelMessage(text: string): AgentMessage {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export function buildBaseConfig(): Config {
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

/** Typed InitializeRequest for a client that advertises no capabilities. */
export function buildInitializeRequest(): acp.InitializeRequest {
  return { protocolVersion: 1, clientCapabilities: {} };
}

/**
 * Constructs a ZedAgent over the RecordingConnection with typed stub args (no
 * `as never`, F14) and initializes it. Shared by every orchestration test,
 * including the initialize()-advertises-loadSession assertion (F15) so the
 * makeZedAgent setup is not duplicated.
 */
export async function makeZedAgent(
  connection: RecordingConnection,
  sessionFileLister?: ChatSessionFileLister,
): Promise<ZedAgent> {
  const mod = await import('./zedIntegration.js');
  const zedAgent = new mod.ZedAgent(
    buildBaseConfig(),
    connection as unknown as acp.AgentSideConnection,
    sessionFileLister,
  );
  await zedAgent.initialize(buildInitializeRequest());
  return zedAgent;
}
