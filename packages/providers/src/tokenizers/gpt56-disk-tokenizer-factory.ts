/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { isSanctionedOpenAIO200kModel } from '../openai/openaiModelPolicy.js';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';
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
      if (!isSanctionedOpenAIO200kModel(request.canonicalModel))
        return Promise.reject(
          new Error('Disk text route requires a pinned o200k model'),
        );
      const signals = [signal, request.finalizedProjection.signal].filter(
        (value): value is AbortSignal => value !== undefined,
      );
      return estimateGpt56PromptFromSources(request, {
        workspaceDirectory,
        signal: signals.length === 0 ? undefined : AbortSignal.any(signals),
      });
    },
  };
}
