/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { SendMessageParams } from './chatSession.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import {
  applyToolSelectionHook,
  selectRequestTools,
  buildRuntimeContext,
  streamSemanticPurgeRequest,
  type ToolSelectionHookResult,
  type PreparedRequest,
} from './streamRequestHelpers.js';
import { streamDiskSource } from './streamprocessor-disk-source.js';
import type { PreparedSourcePromptEnvelopeSend } from './prompt-envelope-source-send.js';
import type { SourceAfterModelRequest } from './source-after-model-hook.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { withCompressionCallbackCleanup } from './streamCleanup.js';
import { logApiError } from './turnLogging.js';

export interface StreamRequestInput {
  readonly runtime: AgentRuntimeContext;
  readonly compression: CompressionHandler;
  readonly history: HistoryService;
  readonly provider: RuntimeProvider;
  readonly params: SendMessageParams;
  readonly promptId: string;
  readonly userContent: IContent | IContent[];
  readonly semanticMediaPurge: SemanticMediaPurgeAttempt | undefined;
  readonly fallbackTools: PreparedRequest['requestPayload']['tools'];
  readonly buildRuntime: (
    extras: Record<string, unknown>,
  ) => ProviderRuntimeContext;
  readonly buildOptions: (
    contents: Iterable<IContent> | AsyncIterable<IContent>,
    tools: PreparedRequest['requestPayload']['tools'],
    runtime: ProviderRuntimeContext,
    base: ProviderRuntimeContext,
  ) => RuntimeGenerateChatOptions;
  readonly consumeSource: (
    stream: AsyncIterable<IContent>,
    startTime: number,
    allowedTools: string[] | undefined,
    afterModel: SourceAfterModelRequest,
  ) => Promise<AsyncGenerator<ModelStreamChunk>>;
  readonly setEstimate: (estimate: PromptEnvelopeEstimate | null) => void;
  readonly recordSourceSeam: (
    prepared: PreparedSourcePromptEnvelopeSend,
    tools: PreparedRequest['requestPayload']['tools'],
    signal: AbortSignal | undefined,
  ) => Promise<void>;
  readonly log: (message: string) => void;
}

async function selection(
  input: StreamRequestInput,
): Promise<ToolSelectionHookResult> {
  return applyToolSelectionHook(
    input.runtime.providerRuntime.config,
    selectRequestTools(input.params, input.fallbackTools),
    input.runtime.state.model,
  );
}

function pinnedAfterModel(
  pinned: () => ProviderRequestRows | undefined,
  tools: PreparedRequest['requestPayload']['tools'],
  signal: AbortSignal | undefined,
): SourceAfterModelRequest {
  return {
    rows: () => {
      const rows = pinned();
      if (rows === undefined)
        throw new Error('Source AfterModel requires a prepared selection');
      return rows;
    },
    tools,
    signal,
  };
}

async function diskRequest(
  input: StreamRequestInput,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  const startTime = Date.now();
  try {
    const tools = await selection(input);
    // Each attempt re-prepares its source; AfterModel reads the live one.
    let pinned: ProviderRequestRows | undefined;
    const stream = await streamDiskSource({
      runtime: input.runtime,
      compression: input.compression,
      history: input.history,
      userContent: input.userContent,
      promptId: input.promptId,
      provider: input.provider,
      tools: tools.tools,
      log: input.log,
      signal: input.params.config?.abortSignal,
      historyOverride: streamSemanticPurgeRequest(
        input.semanticMediaPurge,
        input.params.config?.abortSignal,
      ),
      buildOptions: (contents, count) => {
        const base = input.buildRuntime({
          historyLength: count,
          conversationLogEmptyTools: tools.conversationLogEmptyTools,
        });
        return input.buildOptions(
          contents,
          tools.tools,
          buildRuntimeContext(base, input.params),
          base,
        );
      },
      onReleased: () => {
        pinned = undefined;
      },
      onPrepared: async (prepared) => {
        pinned = prepared.source;
        input.setEstimate(prepared.estimate);
        await input.runtime.telemetry.logApiRequest({
          model: input.runtime.state.model,
          promptId: input.promptId,
          sessionId: input.runtime.state.sessionId,
          runtimeId: input.runtime.state.runtimeId,
          provider: input.runtime.state.provider,
          timestamp: Date.now(),
        });
        await input.recordSourceSeam(
          prepared,
          tools.tools,
          input.params.config?.abortSignal,
        );
      },
    });
    return await input.consumeSource(
      stream,
      startTime,
      tools.allowedFunctionNames,
      pinnedAfterModel(
        () => pinned,
        tools.tools,
        input.params.config?.abortSignal,
      ),
    );
  } catch (error) {
    input.setEstimate(null);
    logApiError(
      input.runtime,
      input.runtime.state,
      input.runtime.state.model,
      input.promptId,
      Date.now() - startTime,
      error,
    );
    throw error;
  }
}

export async function buildAndSendStreamRequest(
  input: StreamRequestInput,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  try {
    return withCompressionCallbackCleanup(
      await diskRequest(input),
      input.provider,
      input.compression,
      input.params.config?.abortSignal,
    );
  } catch (error) {
    input.compression.clearProviderCompressionCallback(input.provider);
    throw error;
  }
}
