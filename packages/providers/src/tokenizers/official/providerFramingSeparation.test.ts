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

import { describe, expect, it, afterAll } from 'vitest';
import { KimiK3Tokenizer } from './kimiK3Tokenizer.js';
import { GlmTokenizer } from './glmTokenizer.js';
import { MinimaxTokenizer } from './minimaxTokenizer.js';
import { createRegisteredTokenizerFactory } from '../modelTokenizerRegistry.js';

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

  it('factory resolves by model identity, ignoring provider name', () => {
    const factory = createRegisteredTokenizerFactory();
    const fromKimi = factory.getTokenizer('kimi', 'kimi-k3');
    const fromFireworks = factory.getTokenizer('fireworks', 'kimi-k3');
    expect(fromKimi).toBe(fromFireworks);
    expect(fromKimi!.countTokens(SAMPLE_TEXT)).toBe(
      fromFireworks!.countTokens(SAMPLE_TEXT),
    );
  });
});
