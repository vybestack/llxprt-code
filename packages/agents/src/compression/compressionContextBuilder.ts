/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';
import { Storage } from '@vybestack/llxprt-code-settings/storage/Storage.js';
import path from 'node:path';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * Build CompressionContext for compression strategies.
 *
 * `transcriptPathProvider` reports where the session journal is being written.
 * It is a provider rather than a value because recording is optional, starts
 * unmaterialized, and can be swapped by a resume; the key is omitted whenever
 * no file exists so the strategies degrade silently.
 *
 * @plan PLAN-20260211-HIGHDENSITY.P14
 * @requirement REQ-CS-001.6
 */
export async function buildCompressionContext(
  promptId: string,
  runtimeContext: AgentRuntimeContext,
  historyService: HistoryService,
  providerResolver: (
    profileName?: string,
  ) => Promise<CompressionProviderResult>,
  activeTodosProvider: (() => Promise<string | undefined>) | undefined,
  transcriptPathProvider: (() => string | undefined) | undefined,
  logger: DebugLogger,
  options?: { targetTokenCount?: number },
): Promise<CompressionContext> {
  const promptResolver = new PromptResolver();
  const promptBaseDir = path.join(Storage.getGlobalConfigDir(), 'prompts');

  let activeTodos: string | undefined;
  if (activeTodosProvider) {
    try {
      activeTodos = await activeTodosProvider();
    } catch (error) {
      logger.debug('Failed to fetch active todos for compression', error);
    }
  }

  // Resolved on every build so a recording service that is enabled, disabled,
  // or swapped mid-session (resume) is reflected at the next compression.
  const transcriptPath = transcriptPathProvider?.();

  const config = runtimeContext.providerRuntime.config;

  return {
    history: historyService.getCurated(),
    runtimeContext,
    runtimeState: runtimeContext.state,
    estimateTokens: (contents) =>
      historyService.estimateTokensForContents(contents as IContent[]),
    currentTokenCount: historyService.getTotalTokens(),
    ...(options?.targetTokenCount !== undefined
      ? { targetTokenCount: options.targetTokenCount }
      : {}),
    logger,
    resolveProvider: providerResolver,
    promptResolver,
    promptBaseDir,
    promptContext: {
      provider: runtimeContext.state.provider,
      model: runtimeContext.state.model,
    },
    promptId,
    ...(activeTodos ? { activeTodos } : {}),
    ...(transcriptPath ? { transcriptPath } : {}),
    compressionVerification:
      runtimeContext.ephemerals.compressionVerification(),
    ...(config ? { config } : {}),
    cacheAnchorSeq: historyService.getCacheAnchorSeq(),
  };
}
