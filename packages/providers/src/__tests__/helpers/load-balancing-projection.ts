/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GenerateChatOptions, IProvider } from '../../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  collectContents,
  isAsyncIterableContents,
} from '../../utils/collectContents.js';
export interface ProjectingDelegate {
  readonly provider: IProvider;
  readonly projectedOptions: GenerateChatOptions[];
  /** Model of each send attempt this delegate served, in attempt order. */
  readonly sentModels: string[];
  readonly delegateTokens: object[];
}

export function createProjectingDelegate(spec: {
  name: string;
  estimateTokens: (options: GenerateChatOptions) => number | Promise<number>;
  releaseIfUnsent?: () => Promise<void>;
  resolveProjection?: (
    options: GenerateChatOptions,
  ) => Promise<PromptEnvelopeProjection | undefined>;
  /** Fail (throw) the first N send attempts; projection still succeeds. */
  failFirstSends?: number;
  /** Report this many usage tokens on the sent chunk (TPM tracking). */
  usageTokens?: number;
}): ProjectingDelegate {
  const projectedOptions: GenerateChatOptions[] = [];
  const sentModels: string[] = [];
  const delegateTokens: object[] = [];
  const provider: IProvider = {
    name: spec.name,
    async projectPromptEnvelope(options: GenerateChatOptions) {
      projectedOptions.push(options);
      if (spec.resolveProjection !== undefined) {
        return spec.resolveProjection(options);
      }
      const transportToken = Object.freeze({ seq: delegateTokens.length });
      delegateTokens.push(transportToken);
      // The wrapper's request lease closes after projection, so measure now.
      const estimate = await spec.estimateTokens(options);
      return {
        model: options.resolved?.model ?? spec.name,
        protocol: 'openai-chat',
        method: 'chat/completions/v1',
        projectionRevision: 7,
        unsupportedMedia: [],
        transportToken,
        finalizedProjection: Object.freeze({ kind: 'test', promptText: 'x' }),
        legacyEstimate: () => Promise.resolve(estimate),
        ...(spec.releaseIfUnsent === undefined
          ? {}
          : { releaseIfUnsent: spec.releaseIfUnsent }),
      };
    },
    async *generateChatCompletion(
      optionsOrStream: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncGenerator<IContent> {
      if (isAsyncIterableContents(optionsOrStream)) {
        throw new Error('legacy positional overload is not exercised here');
      }
      const options = optionsOrStream;
      projectedOptions.push(options);
      sentModels.push(options.resolved?.model ?? spec.name);
      if (sentModels.length <= (spec.failFirstSends ?? 0)) {
        throw new Error(`delegate ${spec.name} send failed`);
      }
      const okChunk: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
      };
      if (spec.usageTokens === undefined) {
        yield okChunk;
        return;
      }
      // Gemini wire usage shape: BackendMetricsCollector.extractTokenCount
      // reads this compat form off the last chunk; IContent itself keeps
      // usage in neutral metadata, so the wire fields need a cast here.
      const usedChunk = {
        ...okChunk,
        usageMetadata: { promptTokenCount: spec.usageTokens },
      };
      yield usedChunk;
    },
    getModels: async () => [],
    getDefaultModel: () => 'delegate-default',
  };
  return { provider, projectedOptions, sentModels, delegateTokens };
}

export async function serializedEnvelopeTokens(
  options: GenerateChatOptions,
): Promise<number> {
  const contents = await collectContents(options.contents);
  const contentText = contents
    .map((content) => JSON.stringify(content.blocks))
    .join('\n');
  const toolText = (options.tools ?? [])
    .map((tool) => JSON.stringify(tool))
    .join('\n');
  return Math.ceil((contentText.length + toolText.length) / 4);
}
