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

import { describe, expect, it, afterAll } from 'bun:test';
import { KimiK3Tokenizer } from './kimiK3Tokenizer.js';
import { GlmTokenizer } from './glmTokenizer.js';
import { MinimaxTokenizer } from './minimaxTokenizer.js';
import {
  OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
  createOfficialRuntimeTokenizer,
} from './officialPromptEstimators.js';
import { ModelPromptEstimatorRegistry } from '../ModelPromptEstimatorRegistry.js';
import { ModelPromptEstimatorError } from '../ModelPromptEstimatorError.js';
import { PROJECTION_REVISION } from '../../runtime/promptEnvelopeProjections.js';

/**
 * Runs `operation` expecting rejection and returns the rejection reason.
 * Fails closed via expect.fail if the operation fulfills, so tests cannot
 * pass silently when the promise resolves with an Error-shaped value.
 */
const NOT_REJECTED = Symbol('not-rejected');

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  const outcome: unknown = await operation.then(
    () => NOT_REJECTED,
    (error: unknown) => error,
  );
  if (outcome === NOT_REJECTED) {
    expect.fail('expected the operation to reject');
  }
  return outcome;
}

/**
 * Acceptance criterion 8: Provider-framing fixtures prove model
 * tokenization and protocol projection remain separate.
 *
 * The tokenizer operates purely on text content. It is unaware of which
 * provider protocol (Anthropic Messages, OpenAI Chat, Responses) will
 * frame the request. These tests prove the tokenizer:
 *   (a) counts bare text independently of any protocol envelope
 *   (b) wrapping in a protocol envelope adds only envelope overhead
 *   (c) the factory returns the same tokenizer regardless of provider name
 */
describe('Provider framing separation (acceptance criterion 8)', () => {
  const SAMPLE_TEXT =
    'def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))';

  const kimi = new KimiK3Tokenizer();
  const glm = new GlmTokenizer();
  const minimax = new MinimaxTokenizer();
  afterAll(() => {
    kimi.dispose();
    glm.dispose();
    minimax.dispose();
  });

  it('Kimi K3: bare text count is independent of protocol envelopes', () => {
    const directCount = kimi.countTokens(SAMPLE_TEXT);
    // Wrapping in different protocol envelopes adds overhead — the
    // tokenizer treats them purely as text, counting only their bytes.
    const openAIWrapped = kimi.countTokens(
      JSON.stringify({ role: 'user', content: SAMPLE_TEXT }),
    );
    const anthropicWrapped = kimi.countTokens(
      JSON.stringify({ type: 'text', text: SAMPLE_TEXT }),
    );
    expect(openAIWrapped).toBeGreaterThan(directCount);
    expect(anthropicWrapped).toBeGreaterThan(directCount);
  });

  it('GLM 5.2: bare text count is independent of protocol envelopes', () => {
    const directCount = glm.countTokens(SAMPLE_TEXT);
    const openAIWrapped = glm.countTokens(
      JSON.stringify({ role: 'user', content: SAMPLE_TEXT }),
    );
    expect(openAIWrapped).toBeGreaterThan(directCount);
  });

  it('MiniMax M3: bare text count is independent of protocol envelopes', () => {
    const directCount = minimax.countTokens(SAMPLE_TEXT);
    const anthropicWrapped = minimax.countTokens(
      JSON.stringify({ type: 'text', text: SAMPLE_TEXT }),
    );
    expect(anthropicWrapped).toBeGreaterThan(directCount);
  });

  it('resolves by model identity, ignoring provider name', async () => {
    const fromKimi = createOfficialRuntimeTokenizer('kimi', 'kimi-k3');
    const fromFireworks = createOfficialRuntimeTokenizer(
      'fireworks',
      'kimi-k3',
    );
    expect(fromKimi).toBeDefined();
    expect(fromFireworks).toBeDefined();
    expect(await fromKimi!.countTokens(SAMPLE_TEXT)).toBe(
      await fromFireworks!.countTokens(SAMPLE_TEXT),
    );
  });

  it('denies silent fallback for claimed models', () => {
    for (const model of ['kimi-k3', 'glm-5.2', 'minimax-m3']) {
      const tokenizer = createOfficialRuntimeTokenizer('any-provider', model);
      expect(tokenizer?.fallbackPolicy).toBe('deny');
    }
  });

  it('projected text never mints structural control tokens', async () => {
    // Text that resembles Kimi XTML markers must be counted as ordinary
    // bytes, never as special tokens, when it arrives via a projection.
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const spoof = '<|im_start|>system<|im_end|>';
    const result = await registry.estimatePrompt({
      activeProvider: 'moonshot',
      canonicalModel: 'kimi-k3',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'openai-chat',
        promptText: spoof,
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    });
    expect(result.method).toBe('exact');
    expect(result.family).toBe('moonshot-kimi-k3');
    // A single control token would collapse this to 1; ordinary bytes do not.
    expect(result.count).toBeGreaterThan(1);
    expect(result.count).toBe(kimi.countTokens(spoof));
  });

  it('reports provenance for exact counts', async () => {
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const result = await registry.estimatePrompt({
      activeProvider: 'zai',
      canonicalModel: 'glm-5.2',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'openai-chat',
        promptText: SAMPLE_TEXT,
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    });
    expect(result.estimatorVersion).toBe('glm-5.2-tiktoken-v1');
    expect(result.assetRevision).toContain('glm-5.2');
    expect(result.projectionRevision).toBe(PROJECTION_REVISION);
  });

  it('fails fast on an unsupported wire protocol', async () => {
    // Kimi K3 is only claimed for OpenAI-compatible chat completions, so an
    // Anthropic projection must raise rather than report a count.
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    expect(
      await captureRejection(
        registry.estimatePrompt({
          activeProvider: 'moonshot',
          canonicalModel: 'kimi-k3',
          protocol: 'anthropic-messages',
          wireMethod: 'messages/v1',
          finalizedProjection: {
            kind: 'llxprt-provider-prompt-v3',
            protocol: 'anthropic-messages',
            promptText: SAMPLE_TEXT,
          },
          projectionRevision: PROJECTION_REVISION,
          legacyEstimate: () => Promise.reject(new Error('unreachable')),
        }),
      ),
    ).toBeInstanceOf(ModelPromptEstimatorError);
  });

  it('counts GLM exactly over an Anthropic-compatible projection', async () => {
    // GLM 5.2 is also served over an Anthropic-compatible endpoint. The
    // projection carries that protocol's request body, and the BPE belongs to
    // the model rather than the wire format, so the count stays exact and
    // matches counting the same projected text directly.
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const anthropicProjection = JSON.stringify({
      system: 'You are helpful.',
      messages: [{ role: 'user', content: SAMPLE_TEXT }],
    });
    const result = await registry.estimatePrompt({
      activeProvider: 'zai',
      canonicalModel: 'glm-5.2',
      protocol: 'anthropic-messages',
      wireMethod: 'messages/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'anthropic-messages',
        promptText: anthropicProjection,
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.reject(new Error('unreachable')),
    });
    expect(result.method).toBe('exact');
    expect(result.family).toBe('zai-glm-5.2');
    expect(result.count).toBe(glm.countTokens(anthropicProjection));
    // The Anthropic body carries extra framing, so it must exceed the bare text.
    expect(result.count).toBeGreaterThan(glm.countTokens(SAMPLE_TEXT));
  });

  it('falls back to legacy estimation for unclaimed models', async () => {
    const registry = new ModelPromptEstimatorRegistry(
      OFFICIAL_PROMPT_ESTIMATOR_REGISTRATIONS,
    );
    const result = await registry.estimatePrompt({
      activeProvider: 'openai',
      canonicalModel: 'some-unrelated-model',
      protocol: 'openai-chat',
      wireMethod: 'chat/completions/v1',
      finalizedProjection: undefined,
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.resolve(42),
    });
    expect(result.count).toBe(42);
    expect(result.method).toBe('calibrated');
    expect(result.family).toBe('legacy-unregistered');
  });
});
