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

import type * as acp from '@agentclientprotocol/sdk';
import { Config, type IContent } from '@vybestack/llxprt-code-core';
import { vi } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';
import { SESSION_FILE_EXTENSION } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createConnectionProviderManager } from './__tests__/connection-provider-fixture.js';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { unusedProfileApplication } from './test-profile-application.js';
import type { ChatSessionFileLister } from './zed-session-loader.js';

import type { RecordingConnection } from './__tests__/zed-test-helpers.js';
import type { ZedAgent } from './zedIntegration.js';

/**
 * A chats dir that never exists on disk, so the disk-resume corrupt-vs-missing
 * probe (zed-session-loader.listSessionFileNames does a REAL readdir here) always
 * hits ENOENT and falls back to the plain not-found mapping — keeping the
 * resourceNotFound test deterministic. The RE-ATTACH probe (hasRecordedSessionFile)
 * uses the INJECTED lister below instead, so this path value is irrelevant to it.
 */
const definitionFixture = installZedDefinitionFixture();

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
 * `session-<timestamp>-<first-12-of-id><extension>` shape the selected recorder
 * writes, so the production findMatchingSessionFile logic (not a result-shaped
 * mock) decides the branch.
 */
export function recordedFilesLister(
  ...sessionIds: string[]
): ChatSessionFileLister {
  const names = sessionIds.map(
    (id) =>
      `session-2026-07-11T10-00-00-${id.substring(0, 12)}${SESSION_FILE_EXTENSION}`,
  );
  return async () => names;
}

export const mockFromConfig = vi.fn();

export const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  fromConfig: (...args: unknown[]) => mockFromConfig(...args),
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
  const settingsOwner = new SessionSettingsOwner(new SettingsService());
  const dispose = vi.fn(async () => settingsOwner.dispose());
  const getHistory = vi.fn(async () => options.liveHistory ?? []);
  const streamText = options.streamText;
  const agent = {
    getModel: () => 'test-model',
    getEphemeralSetting: (key: string) => settingsOwner.readNamedParameter(key),
    setEphemeralSetting: (key: string, value: unknown) =>
      settingsOwner.writeUserParameter(key, value),
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
    session: {
      resume,
      setRecording,
      getRecordingTitle: () => undefined,
      recordRecordingTitle: async () => undefined,
    },
    tools: { respondToConfirmation: vi.fn() },
  } as unknown as Agent;
  return { agent, resume, setRecording, dispose, getHistory };
}

/** Builds a neutral live agent message for the re-attach getHistory stub. */
export function modelMessage(text: string): AgentMessage {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export function buildBaseConfig(): Config {
  return new Config({
    sessionId: 'base',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    storageRoot: NONEXISTENT_CHATS_PARENT,
    model: 'test-model',
    debugMode: false,
    maxSessionTurns: 50,
  });
}

/** Typed InitializeRequest for a client that advertises no capabilities. */
export function buildInitializeRequest(): acp.InitializeRequest {
  return { protocolVersion: 1, clientCapabilities: {} };
}

export async function makeUninitializedZedAgent(
  connection: RecordingConnection,
  sessionFileLister?: ChatSessionFileLister,
): Promise<ZedAgent> {
  const mod = await import('./zedIntegration.js');
  const config = buildBaseConfig();
  const settingsService = new SettingsService();
  return new mod.ZedAgent(
    config,
    connection as unknown as acp.AgentSideConnection,
    unusedProfileApplication,
    createConnectionProviderManager(config, settingsService),
    () => new SettingsService({ sessionSource: settingsService }),
    sessionFileLister,
    definitionFixture(),
  );
}

/**
 * Constructs a ZedAgent over the RecordingConnection with typed stub args (no
 * `as never`, F14) and initializes it. Shared by every orchestration test.
 */
export async function makeZedAgent(
  connection: RecordingConnection,
  sessionFileLister?: ChatSessionFileLister,
): Promise<ZedAgent> {
  const zedAgent = await makeUninitializedZedAgent(
    connection,
    sessionFileLister,
  );
  await zedAgent.initialize(buildInitializeRequest());
  return zedAgent;
}
