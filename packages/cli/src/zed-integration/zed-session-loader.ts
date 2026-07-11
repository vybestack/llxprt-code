/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resume + error-classification helpers for ACP session/load (loadSession)
 * (issue #1604). These own the I/O-touching parts of a load (the recorded-history
 * resume and the corrupt-vs-missing session-file probe) plus the final
 * RequestError normalization, kept OUT of zedIntegration.ts so that near-cap file
 * stays within its max-lines budget and the load orchestration is individually
 * testable.
 */

import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { classifyResumeFailure } from './zed-session-errors.js';

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
  const chatsDir = path.join(
    sessionConfig.storage.getProjectTempDir(),
    'chats',
  );
  return readdir(chatsDir);
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
