/**
 * Copyright 2026 Vybestack LLC
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

import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { KimiK3Tokenizer } from './official/kimiK3Tokenizer.js';
import { GlmTokenizer } from './official/glmTokenizer.js';
import { MinimaxTokenizer } from './official/minimaxTokenizer.js';

/**
 * Explicit anchored model → tokenizer factory registrations.
 *
 * Only exact canonical model names resolve. Near-miss names (e.g.
 * "kimi-k4", "glm-4", "minimax-m2") do NOT resolve and fall through to
 * the caller's fallback logic. This avoids the substring-matching
 * problems of the legacy factory.
 *
 * When #2249 lands the full prompt-estimator registry, these entries
 * migrate to the richer ModelPromptEstimator contract. Until then this
 * provides the model-family-owned token-counting seam.
 */
const MODEL_REGISTRY: ReadonlyMap<string, () => RuntimeTokenizer> = new Map<
  string,
  () => RuntimeTokenizer
>([
  ['kimi-k3', () => new KimiK3Tokenizer()],
  ['k3-256k', () => new KimiK3Tokenizer()],
  ['glm-5.2', () => new GlmTokenizer()],
  ['minimax-m3', () => new MinimaxTokenizer()],
]);

/** Lazily constructed singleton tokenizers (BPE load + WASM init is costly). */
const instanceCache = new Map<string, RuntimeTokenizer>();

/**
 * Look up a registered tokenizer by exact canonical model name.
 *
 * Returns undefined when no anchored registration matches. Callers
 * must NOT treat undefined as a signal to use a word/char fallback for
 * a registered model family — they should use their existing generic
 * path for unregistered models only.
 *
 * The tokenizer instance is cached per model so repeated calls reuse
 * the loaded BPE ranks and WASM encoder.
 */
export function getRegisteredTokenizer(
  model: string,
): RuntimeTokenizer | undefined {
  const factory = MODEL_REGISTRY.get(model.toLowerCase());
  if (factory === undefined) {
    return undefined;
  }
  let instance = instanceCache.get(model);
  if (instance === undefined) {
    instance = factory();
    instanceCache.set(model, instance);
  }
  return instance;
}

/**
 * Returns true when the model has an explicit anchored registration.
 */
export function isRegisteredModel(model: string): boolean {
  return MODEL_REGISTRY.has(model.toLowerCase());
}

/**
 * Clear all cached tokenizer instances. Useful for error recovery and tests.
 */
export function clearRegisteredTokenizerCache(): void {
  instanceCache.clear();
}

/**
 * Returns the list of all anchored model names.
 */
export function getRegisteredModelNames(): readonly string[] {
  return Array.from(MODEL_REGISTRY.keys());
}

/**
 * Create a RuntimeTokenizerFactory that checks anchored registrations
 * first, then delegates to a fallback factory for unregistered models.
 *
 * This extends the existing factory composition without replacing it.
 */
export function createRegisteredTokenizerFactory(
  fallback?: RuntimeTokenizerFactory,
): RuntimeTokenizerFactory {
  return {
    getTokenizer(
      providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined {
      if (model !== undefined) {
        const registered = getRegisteredTokenizer(model);
        if (registered !== undefined) {
          return registered;
        }
      }
      return fallback?.getTokenizer(providerName, model);
    },
  };
}
