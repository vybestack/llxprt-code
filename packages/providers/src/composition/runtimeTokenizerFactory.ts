/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimeTokenizer,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { isSanctionedGpt56Model } from '../openai/openaiModelPolicy.js';
import { AnthropicTokenizer } from '../tokenizers/AnthropicTokenizer.js';
import {
  createGpt56RuntimeTokenizer,
  prepareGpt56RuntimeTokenizer,
} from '../tokenizers/Gpt56O200kPromptEstimator.js';
import {
  createGpt56PromptEstimatorRegistration,
  ModelPromptEstimatorRegistry,
} from '../tokenizers/ModelPromptEstimatorRegistry.js';
import { OpenAITokenizer } from '../tokenizers/OpenAITokenizer.js';
import {
  CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS,
  createClaudeRuntimeTokenizer,
} from '../tokenizers/claude/claudePromptEstimator.js';
import {
  createO200kBaseEncoderResolver,
  loadTiktokenModule,
  type TiktokenModuleLoader,
} from '../tokenizers/o200kBaseCounter.js';
import {
  OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
  createOfficialRuntimeTokenizer,
} from '../tokenizers/official/index.js';

class RuntimeTokenizerAdapter implements RuntimeTokenizer {
  constructor(
    private readonly tokenizer: {
      countTokens(text: string, model: string): Promise<number>;
    },
    private readonly model: string,
  ) {}

  async countTokens(content: unknown): Promise<number> {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content);
    return this.tokenizer.countTokens(text, this.model);
  }
}

const ANTHROPIC_TOKENIZER_MATCHERS = ['anthropic', 'claude'] as const;
const OPENAI_TOKENIZER_MATCHERS = [
  'openai',
  'codex',
  'gpt',
  'o1',
  'o3',
  'o4',
  'deepseek',
] as const;

function matchesTokenizer(
  providerKey: string,
  modelKey: string,
  matchers: readonly string[],
): boolean {
  return matchers.some(
    (matcher) => providerKey.includes(matcher) || modelKey.includes(matcher),
  );
}

export function createRuntimeTokenizerFactory(
  loadModule: TiktokenModuleLoader = loadTiktokenModule,
): RuntimeTokenizerFactory {
  const openaiTokenizer = new OpenAITokenizer();
  const anthropicTokenizer = new AnthropicTokenizer();
  const resolveGpt56Encoder = createO200kBaseEncoderResolver(loadModule);
  // Bind the GPT-5.6 estimator to this factory's encoder resolver so
  // readiness, runtime tokenization, and final prompt-envelope estimation all
  // observe the same encoder — including when a loader is injected. The
  // production default resolver still delegates to the process-wide encoder.
  const estimatorRegistry = new ModelPromptEstimatorRegistry([
    createGpt56PromptEstimatorRegistration(resolveGpt56Encoder),
    ...OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    ...CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS,
  ]);

  return {
    async prepareTokenizer(providerName, model): Promise<void> {
      const resolvedModel = model ?? providerName;
      if (isSanctionedGpt56Model(resolvedModel)) {
        await prepareGpt56RuntimeTokenizer(
          providerName,
          resolvedModel,
          resolveGpt56Encoder,
        );
      }
    },
    claimsModel: (canonicalModel) =>
      estimatorRegistry.claimsModel(canonicalModel),
    getEstimatorFamily: (canonicalModel) =>
      estimatorRegistry.getEstimatorFamily(canonicalModel),
    estimatePrompt: (request) => estimatorRegistry.estimatePrompt(request),
    getTokenizer(
      providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined {
      const resolvedModel = model ?? providerName;
      if (isSanctionedGpt56Model(resolvedModel)) {
        return createGpt56RuntimeTokenizer(
          providerName,
          resolvedModel,
          resolveGpt56Encoder,
        );
      }
      const officialTokenizer = createOfficialRuntimeTokenizer(
        providerName,
        resolvedModel,
      );
      if (officialTokenizer !== undefined) {
        return officialTokenizer;
      }
      const claudeTokenizer = createClaudeRuntimeTokenizer(
        providerName,
        resolvedModel,
      );
      if (claudeTokenizer !== undefined) {
        return claudeTokenizer;
      }
      const providerKey = providerName.toLowerCase();
      const modelKey = resolvedModel.toLowerCase();
      if (
        matchesTokenizer(providerKey, modelKey, ANTHROPIC_TOKENIZER_MATCHERS)
      ) {
        return new RuntimeTokenizerAdapter(
          anthropicTokenizer,
          model ?? providerName,
        );
      }
      if (matchesTokenizer(providerKey, modelKey, OPENAI_TOKENIZER_MATCHERS)) {
        return new RuntimeTokenizerAdapter(
          openaiTokenizer,
          model ?? providerName,
        );
      }
      return undefined;
    },
  };
}
