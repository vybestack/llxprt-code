/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildAnthropicRequestBody } from './AnthropicRequestBuilder.js';

describe('Anthropic request text settings (Issue #1738)', () => {
  it('omits OpenAI text settings while preserving Anthropic model parameters', () => {
    const body = buildAnthropicRequestBody({
      model: 'claude-fable-5',
      messages: [{ role: 'user', content: 'Summarize this context.' }],
      maxTokens: 4096,
      streamingEnabled: true,
      modelParams: {
        text: { verbosity: 'medium' },
        'text.verbosity': 'medium',
        temperature: 0.7,
        top_p: 0.9,
      },
    });

    expect(body).not.toHaveProperty('text');
    expect(body).not.toHaveProperty('text.verbosity');
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });
});
