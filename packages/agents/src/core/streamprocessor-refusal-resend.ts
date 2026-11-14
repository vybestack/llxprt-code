/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import type { ProviderReadyRequest } from './sendRequestState.js';
import type { SendMessageParams, ChatSessionConfig } from './chatSession.js';
import type { RawTokenDeltaBridge } from './streamTelemetryLogger.js';
import { responseTransportSource } from './response-transport-source.js';
import { enforceAndStreamSourcePromptEnvelopeRetries } from './prompt-envelope-source-send.js';
import { buildStreamChatOptions } from './streamChatOptions.js';

export function resendKeptRequestSource(
  ports: StreamProcessorRuntime,
  bound: RuntimeProvider,
  kept: ProviderReadyRequest,
  params: SendMessageParams,
  promptId: string,
  turnId: string,
  generationConfig: ChatSessionConfig,
  bridge: RawTokenDeltaBridge | null,
  onPrepared: (estimate: PromptEnvelopeEstimate | null) => void,
): ReturnType<typeof responseTransportSource> {
  const source = kept.prepared.source;
  return responseTransportSource(
    {
      runtime: ports,
      history: ports.history,
      promptId,
      userContent: {
        speaker: 'human',
        blocks: [],
        metadata: { turnId },
      },
      recordingExecution: params.recordingExecution,
    },
    async (onTransportAttempt) =>
      enforceAndStreamSourcePromptEnvelopeRetries({
        provider: bound,
        source,
        signal: params.config?.abortSignal,
        tokenizerFactory: ports.promptEstimator,
        fallbackEstimate: async () => kept.prepared.estimatedPromptTokens,
        enforce: async (rows) => rows,
        takeSource: async () => {},
        shouldRetryOnError: () => false,
        buildOptions: (rows) => ({
          ...buildStreamChatOptions(
            ports.prepareProviderInvocation,
            bound.name,
            promptId,
            {
              contents: {
                [Symbol.asyncIterator]: () =>
                  rows.openReader(params.config?.abortSignal),
              },
              tools: kept.toolSelection.tools,
            },
            kept.prepared.options.metadata,
            params,
            {
              ...generationConfig,
              systemInstruction: kept.systemInstruction,
            },
            bridge,
          ),
          requestRows: rows,
          contentCount: rows.count,
          onTransportAttempt,
          requestDiagnostics: ports.requestDiagnostics,
        }),
        onPrepared: (prepared) => {
          onPrepared(prepared.estimate);
        },
      }),
  );
}
