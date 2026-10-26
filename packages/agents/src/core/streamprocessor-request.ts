/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
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
import { bindResponseArrival, responseArrivalFor } from './responseArrival.js';
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
  ) => ProviderRequestCollaborators;
  readonly buildOptions: (
    contents: Iterable<IContent> | AsyncIterable<IContent>,
    tools: PreparedRequest['requestPayload']['tools'],
    runtime: ProviderRequestCollaborators,
    base: ProviderRequestCollaborators,
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
    selectRequestTools(input.params, input.fallbackTools),
    input.runtime.state.model,
    hookOwnerOf(input.params),
  );
}

function hookOwnerOf(params: SendMessageParams) {
  return params.hookOwner ?? params.recordingExecution?.hookOwner;
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

/** What one send knows as its attempts prepare, log and release the request. */
interface SendProgress {
  /** Each attempt re-prepares its source; AfterModel reads the live one. */
  pinned: ProviderRequestRows | undefined;
  /**
   * Set once the request is logged for the provider. A failure before that
   * (hook block, abort, compression or context overflow) made no provider API
   * call, so it is not an api_error.
   */
  requestLogged: boolean;
}

function preparedRequestLogger(
  input: StreamRequestInput,
  tools: ToolSelectionHookResult,
  progress: SendProgress,
) {
  return async (prepared: PreparedSourcePromptEnvelopeSend): Promise<void> => {
    progress.pinned = prepared.source;
    input.setEstimate(prepared.estimate);
    await input.runtime.telemetry.logApiRequest({
      model: input.runtime.state.model,
      promptId: input.promptId,
      sessionId: input.runtime.state.sessionId,
      runtimeId: input.runtime.state.runtimeId,
      provider: input.runtime.state.provider,
      timestamp: Date.now(),
    });
    progress.requestLogged = true;
    await input.recordSourceSeam(
      prepared,
      tools.tools,
      input.params.config?.abortSignal,
    );
  };
}

async function diskRequest(
  input: StreamRequestInput,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  const startTime = Date.now();
  const progress: SendProgress = { pinned: undefined, requestLogged: false };
  try {
    const tools = await selection(input);
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
      recordingExecution: input.params.recordingExecution,
      hookOwner: hookOwnerOf(input.params),
      modelParameters: input.params.modelParameters,
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
        progress.pinned = undefined;
      },
      onPrepared: preparedRequestLogger(input, tools, progress),
    });
    return await input.consumeSource(
      stream,
      startTime,
      tools.allowedFunctionNames,
      pinnedAfterModel(
        () => progress.pinned,
        tools.tools,
        input.params.config?.abortSignal,
      ),
    );
  } catch (error) {
    input.setEstimate(null);
    if (progress.requestLogged) {
      logApiError(
        input.runtime,
        input.runtime.state,
        input.runtime.state.model,
        input.promptId,
        Date.now() - startTime,
        error,
      );
    }
    throw error;
  }
}

export async function buildAndSendStreamRequest(
  input: StreamRequestInput,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  try {
    const source = await diskRequest(input);
    const stream = withCompressionCallbackCleanup(
      source,
      input.provider,
      input.compression,
      input.params.config?.abortSignal,
    );
    const arrival = responseArrivalFor(source);
    if (arrival !== undefined) bindResponseArrival(stream, arrival);
    return stream;
  } catch (error) {
    input.compression.clearProviderCompressionCallback(input.provider);
    throw error;
  }
}
