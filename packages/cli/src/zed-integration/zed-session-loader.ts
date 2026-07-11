/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resume + error-classification helpers for ACP session/load (loadSession)
 * (issue #1604). These own the I/O-touching parts of a load (the recorded-history
 * resume, the corrupt-vs-missing session-file probe, the live-session re-attach
 * probe, and the in-memory history bridge) plus the final RequestError
 * normalization, kept OUT of zedIntegration.ts so that near-cap file stays within
 * its max-lines budget and the load orchestration is individually testable.
 */

import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  classifyResumeFailure,
  findMatchingSessionFile,
} from './zed-session-errors.js';

/**
 * A readdir-like directory lister injected for testability (FINDING B / #1604
 * re-attach). Production passes {@link nodeChatSessionFileLister} (a thin wrapper
 * over `node:fs/promises` readdir); tests pass an honest fake that returns the
 * directory entry names, NOT a result-shaped mock of our matching logic, so the
 * real chats-dir derivation + filename matching are exercised.
 */
export type ChatSessionFileLister = (
  chatsDir: string,
) => Promise<readonly string[]>;

/**
 * Default {@link ChatSessionFileLister}: the real `node:fs/promises` readdir,
 * wrapped so it satisfies the lister signature regardless of readdir's overloads.
 */
export const nodeChatSessionFileLister: ChatSessionFileLister = (chatsDir) =>
  readdir(chatsDir);

const logger = new DebugLogger('llxprt:zed-integration:session-loader');

/**
 * Resumes the agent's recorded history, mapping a resume rejection to a precise
 * ACP RequestError via {@link classifyResumeFailure}. When the plain
 * classification would be "not found", the on-disk session-file namespace (the
 * same chats dir the recording writes to) is probed so a corrupt-but-present
 * session is reported as internalError ("file exists but could not be
 * read/replayed") rather than being misreported as resourceNotFound (FINDING B).
 */
export async function resumeAgentHistory(
  agent: Agent,
  sessionId: string,
  sessionConfig: Config,
): Promise<readonly IContent[]> {
  try {
    return await agent.session.resume(sessionId);
  } catch (error) {
    throw await classifyResumeFailure(sessionId, error, () =>
      listSessionFileNames(sessionConfig),
    );
  }
}

/**
 * Lists the chats-dir entry names for the corrupt-vs-missing probe (FINDING B),
 * deriving the directory the SAME way the recording layer does
 * (`join(storage.getProjectTempDir(), 'chats')`). A read failure propagates to
 * {@link classifyResumeFailure}, which swallows it and falls back to the plain
 * mapping so the original resume failure is never masked.
 */
async function listSessionFileNames(
  sessionConfig: Config,
): Promise<readonly string[]> {
  const chatsDir = chatsDirFor(sessionConfig);
  return readdir(chatsDir);
}

/**
 * Re-attach decision probe (#1604): true when a recorded session file for
 * `sessionId` already exists on disk under the ZedAgent config's chats dir.
 *
 * A freshly created but UNPROMPTED session has no recording — SessionRecordingService
 * only materializes the JSONL file on the FIRST content event — so this returns
 * false for it, signalling loadSession to RE-ATTACH the live in-memory session
 * (replaying its in-memory history) instead of destroying it and failing a disk
 * resume that would find no file. Once the session has been prompted (a file
 * exists), this returns true and loadSession takes the destroy-prior + disk-resume
 * path. Any probe failure (e.g. the chats dir does not exist yet, ENOENT) is
 * treated as "no recording present" (returns false, logged at debug) so a missing
 * directory safely routes to re-attach rather than surfacing an error.
 *
 * The directory is derived the SAME way the recording layer does
 * (`join(storage.getProjectTempDir(), 'chats')`) and matched with the SAME
 * filename rule the corrupt-vs-missing resume probe uses
 * ({@link findMatchingSessionFile}), keeping the two in lockstep.
 */
export async function hasRecordedSessionFile(
  config: Config,
  sessionId: string,
  listFiles: ChatSessionFileLister,
): Promise<boolean> {
  try {
    const chatsDir = chatsDirFor(config);
    const entries = await listFiles(chatsDir);
    return findMatchingSessionFile(sessionId, entries) !== null;
  } catch (error) {
    logger.debug(
      () =>
        `hasRecordedSessionFile: probe failed for ${sessionId}; treating as ` +
        `no on-disk recording (re-attach): ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return false;
  }
}

/**
 * Reads a live agent's in-memory conversation as neutral IContent[] for the
 * re-attach replay (#1604). `agent.getHistory()` returns the Gemini-shaped
 * history (readonly AgentMessage[]); it is converted to IContent[] via the SAME
 * ContentConverters.toIContents bridge the recording/resume path uses (see
 * sessionControl.ts), so the re-attach replay maps identically to a disk resume.
 * A fresh unprompted session has empty history, yielding an empty array (zero
 * replay updates).
 */
export async function readAgentHistoryAsIContent(
  agent: Agent,
): Promise<readonly IContent[]> {
  const history = await agent.getHistory();
  return ContentConverters.toIContents([...history]);
}

/**
 * Derives the chats directory (where session recordings live) from a config's
 * project storage temp dir, matching the recording layer + SessionControl
 * derivation exactly.
 */
function chatsDirFor(config: Config): string {
  return path.join(config.storage.getProjectTempDir(), 'chats');
}

/**
 * Normalizes a post-fromConfig load failure into an ACP RequestError (FINDING E).
 * An error that is ALREADY a RequestError (e.g. the precise error returned by
 * {@link resumeAgentHistory}) passes through unchanged; any other throw (such as
 * one while constructing the Session AFTER resume already adopted the recording +
 * lock) is wrapped as internalError carrying the detail, so the caller can always
 * dispose the fresh agent and rethrow a single, well-formed RequestError.
 */
export function toLoadRequestError(
  sessionId: string,
  error: unknown,
): acp.RequestError {
  if (error instanceof acp.RequestError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return acp.RequestError.internalError({ sessionId, reason: detail }, detail);
}
