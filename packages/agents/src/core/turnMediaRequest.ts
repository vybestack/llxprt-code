/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import { logApiRequest } from './turnLogging.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';

interface TurnMediaRequestOptions {
  readonly runtimeContext: AgentRuntimeContext;
  readonly historyService: HistoryService;
  readonly compressionHandler: CompressionHandler;
  readonly userContents: IContent[];
  readonly provider: IProvider;
  readonly promptId: string;
  readonly semanticMediaPurge: SemanticMediaPurgeAttempt | undefined;
  readonly signal?: AbortSignal;
  readonly estimateFinalizedPromptTokens:
    | ((contents: IContent[]) => Promise<number>)
    | undefined;
}

export async function enforceTurnMediaRequestContents(
  options: TurnMediaRequestOptions,
): Promise<IContent[]> {
  const requestContents: IContent[] = [];
  for await (const row of options.historyService.getCuratedForProviderStream(
    options.userContents,
    options.signal,
    streamSemanticPurgeRequest(options.semanticMediaPurge, options.signal),
  )) {
    requestContents.push(row);
  }
  const contents = await options.compressionHandler.enforceProviderContents(
    {
      contents: requestContents,
      pendingContents: options.userContents,
    },
    options.promptId,
    options.provider,
    options.estimateFinalizedPromptTokens,
  );
  logApiRequest(
    options.runtimeContext,
    options.runtimeContext.state,
    contents,
    options.runtimeContext.state.model,
    options.promptId,
  );
  return contents;
}
