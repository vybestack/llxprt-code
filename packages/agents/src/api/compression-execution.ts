/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { SessionControl } from './control/sessionControl.js';
import { createCompressionRecordingOptions } from './recordingExecution.js';
import { readCompressionTokenCount } from './agentStatsProjector.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { CompressionResult } from './agent.js';
import { projectCompressionResult } from './agentStatsProjector.js';

export async function executeCompression(
  promptId: string,
  prepare: () => Promise<void>,
  compress: () => Promise<PerformCompressionResult>,
  readTokenCount: () => number,
): Promise<CompressionResult> {
  await prepare();
  const originalTokenCount = readTokenCount();
  const result = await compress();
  return projectCompressionResult(
    result,
    promptId,
    originalTokenCount,
    result === PerformCompressionResult.COMPRESSED
      ? readTokenCount()
      : originalTokenCount,
  );
}

export function executeHookCompression(
  promptId: string,
  prepare: () => Promise<void>,
  readChat: () => AgentChatContract,
  session: SessionControl,
  sessionId: () => string,
  hooks: Pick<SessionHookOwner, 'execution'>,
  readHistory: () => HistoryService | null,
): Promise<CompressionResult> {
  return executeCompression(
    promptId,
    prepare,
    () =>
      readChat().performCompression(
        promptId,
        createCompressionRecordingOptions(session, sessionId, hooks),
      ),
    () => readCompressionTokenCount(readHistory()),
  );
}
