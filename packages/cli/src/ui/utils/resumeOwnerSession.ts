/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  describeUnreadableRecording,
  matchUnreadableRecordings,
} from '@vybestack/llxprt-code-core';
/**
 * Resume through the Agent session owner. Recordings discovery skipped as
 * unreadable come back as `warnings` (shown after the restore, like the raw
 * resume does), and a failed resume names the unreadable file it matched.
 */
export async function resumeOwnerSession(
  agent: Agent,
  ref: string,
): Promise<{
  readonly warnings: readonly string[];
}> {
  try {
    await agent.session.resume(ref);
  } catch (error) {
    throw await nameUnreadableRecording(agent, ref, error);
  }
  const { unreadableRecordings } =
    await agent.session.listBrowserTargetsDetailed();
  return {
    warnings: unreadableRecordings.map(
      (recording) =>
        `Skipped unreadable session recording ${describeUnreadableRecording(recording)}`,
    ),
  };
}

async function nameUnreadableRecording(
  agent: Agent,
  ref: string,
  error: unknown,
): Promise<unknown> {
  if (!(error instanceof Error)) return error;
  const { unreadableRecordings } =
    await agent.session.listBrowserTargetsDetailed();
  const named = matchUnreadableRecordings(
    ref,
    error.message.replace(/^Failed to resume session: /, ''),
    unreadableRecordings,
  );
  if (named.length === 0) return error;
  return new Error(
    `${error.message} (unreadable recording skipped: ${named.map(describeUnreadableRecording).join('; ')})`,
  );
}
