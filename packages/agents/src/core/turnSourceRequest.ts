/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeGenerateChatOptions,
  RuntimeProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { PreparedSourcePromptEnvelopeSend } from './prompt-envelope-source-send.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';
import { streamDiskSource } from './streamprocessor-disk-source.js';
import { shouldRetryDirectProviderError } from './turnRetryPolicy.js';

export interface TurnSourceRequestInput {
  readonly runtime: AgentRuntimeContext;
  readonly compression: CompressionHandler;
  readonly history: HistoryService;
  readonly provider: RuntimeProvider;
  readonly promptId: string;
  readonly userContents: IContent[];
  readonly semanticMediaPurge: SemanticMediaPurgeAttempt | undefined;
  readonly tools: RuntimeProviderToolset | undefined;
  readonly signal: AbortSignal | undefined;
  readonly log: (message: string) => void;
  readonly buildOptions: (
    contents: AsyncIterable<IContent>,
  ) => RuntimeGenerateChatOptions;
  readonly onPrepared: (
    prepared: PreparedSourcePromptEnvelopeSend,
    attemptIndex: number,
  ) => void | Promise<void>;
  /** One provider attempt: transport plus full consumption of its response. */
  readonly attempt: (
    prepared: PreparedSourcePromptEnvelopeSend,
    attemptIndex: number,
  ) => Promise<IContent>;
}

async function* singleResponse(
  run: () => Promise<IContent>,
): AsyncGenerator<IContent, void, unknown> {
  yield await run();
}

/**
 * Non-streaming turn send through the shared source pipeline. The provider
 * response is consumed inside each attempt so the retry policy covers the whole
 * exchange, exactly as the direct-send retry loop did.
 */
export async function sendTurnSource(
  input: TurnSourceRequestInput,
): Promise<IContent> {
  const stream = await streamDiskSource({
    runtime: input.runtime,
    compression: input.compression,
    history: input.history,
    userContent: input.userContents,
    promptId: input.promptId,
    provider: input.provider,
    tools: input.tools,
    log: input.log,
    signal: input.signal,
    historyOverride: streamSemanticPurgeRequest(
      input.semanticMediaPurge,
      input.signal,
    ),
    buildOptions: (contents) => input.buildOptions(contents),
    onPrepared: input.onPrepared,
    shouldRetryOnError: shouldRetryDirectProviderError,
    send: (prepared, attemptIndex) =>
      singleResponse(() => input.attempt(prepared, attemptIndex)),
  });
  let response: IContent | undefined;
  for await (const chunk of stream) response = chunk;
  if (response === undefined) throw new Error('No response from provider');
  return response;
}
