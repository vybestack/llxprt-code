/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer as ITokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import { estimateTokens as estimateTextTokens } from '../../utils/toolOutputLimiter.js';
import { simpleTokenEstimateForText } from './historyTokenEstimation.js';

/** Dependencies the adapter needs to resolve tokenizers. */
export interface TokenizerAdapterDeps {
  tokenizerCache: Map<string, ITokenizer>;
  tokenizerFactory?: RuntimeTokenizerFactory;
}

/**
 * Get or create a tokenizer for a specific model.
 *
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-01, lines 10-15
 *
 * When a RuntimeTokenizerFactory is injected, it is preferred over
 * direct provider tokenizer construction. This removes the core→providers
 * dependency when using the injection path.
 */
export function getTokenizerForModel(
  modelName: string,
  deps: TokenizerAdapterDeps,
): ITokenizer {
  const { tokenizerCache, tokenizerFactory } = deps;

  const cached = tokenizerCache.get(modelName);
  if (cached) {
    return cached;
  }

  // @plan:PLAN-20260603-ISSUE1584.P05
  // @requirement:REQ-DEP-001
  // Prefer injected factory when available — this is the injection path
  if (tokenizerFactory) {
    const runtimeTokenizer = tokenizerFactory.getTokenizer(modelName);
    if (runtimeTokenizer) {
      // Adapt RuntimeTokenizer to ITokenizer interface for backward compatibility
      const adapter: ITokenizer = {
        countTokens: (text: string, _model?: string) =>
          Promise.resolve(runtimeTokenizer.countTokens(text)),
      };
      tokenizerCache.set(modelName, adapter);
      return adapter;
    }
  }

  // @plan:PLAN-20260603-ISSUE1584.P11
  // @requirement:REQ-DEP-001
  // Core fallback is estimate-only; concrete provider tokenizers are injected by CLI/providers.
  const tokenizer: ITokenizer = {
    countTokens: (content: unknown) => {
      if (typeof content === 'string') {
        return simpleTokenEstimateForText(content);
      }
      return estimateTextTokens(String(content ?? ''));
    },
  };

  tokenizerCache.set(modelName, tokenizer);
  return tokenizer;
}
