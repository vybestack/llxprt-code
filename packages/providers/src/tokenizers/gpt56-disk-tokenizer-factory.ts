/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { isSanctionedOpenAIO200kModel } from '../openai/openaiModelPolicy.js';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';
import { estimateSourceThroughFamilyRegistry } from './source-family-estimator.js';
import { estimateGpt56PromptFromSources } from './gpt56-source-prompt-estimator.js';

export function withGpt56DiskSources(
  factory: RuntimeTokenizerFactory,
  workspaceDirectory: string,
  signal?: AbortSignal,
): RuntimeTokenizerFactory {
  return {
    ...factory,
    estimatePrompt: (request) => {
      if (!(request.finalizedProjection instanceof Gpt56SourceProjection))
        return factory.estimatePrompt(request);
      const signals = [signal, request.finalizedProjection.signal].filter(
        (value): value is AbortSignal => value !== undefined,
      );
      const combined =
        signals.length === 0 ? undefined : AbortSignal.any(signals);
      // The pinned o200k disk counter serves the GPT-5.6/6 family; every
      // other family estimates the same sealed segments through the registry.
      if (!isSanctionedOpenAIO200kModel(request.canonicalModel))
        return estimateSourceThroughFamilyRegistry(
          request,
          request.finalizedProjection,
          factory,
          combined,
        );
      return estimateGpt56PromptFromSources(request, {
        workspaceDirectory,
        signal: combined,
      });
    },
  };
}
