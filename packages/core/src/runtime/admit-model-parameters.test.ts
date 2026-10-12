/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { admitModelParameters } from './admit-model-parameters.js';

describe('model parameter data admission', () => {
  it('owns nested parameters and excludes provider configuration', () => {
    const nested = { effort: 'high' };
    const global = {
      temperature: 0.4,
      maxOutputTokens: 123,
      'auth-key': 'secret',
      model: 'global-model',
    };
    const provider = {
      temperature: 0.2,
      reasoning: nested,
      'base-url': 'https://example.com',
      model: 'provider-model',
    };
    const captured = admitModelParameters(global, provider, 'openai');
    nested.effort = 'low';
    provider.temperature = 0.8;
    expect(captured.modelParams).toStrictEqual({
      temperature: 0.2,
      reasoning: { effort: 'high' },
    });
    expect(captured.genericMaxOutputTokens).toBe(123);
    expect(Object.isFrozen(captured.modelParams.reasoning)).toBe(true);
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it.each([undefined, 0, -1, Infinity, NaN, '123'])(
    'omits invalid generic output limits: %s',
    (maxOutputTokens) => {
      expect(
        admitModelParameters({ maxOutputTokens }, {}, 'openai')
          .genericMaxOutputTokens,
      ).toBeUndefined();
    },
  );

  it('captures independent partitions for equal-label owners', () => {
    const global = { temperature: 0.4 };
    const a = admitModelParameters(global, { top_p: 0.2 }, 'openai');
    const b = admitModelParameters(global, { top_p: 0.8 }, 'openai');
    expect([a.modelParams.top_p, b.modelParams.top_p]).toStrictEqual([
      0.2, 0.8,
    ]);
    expect(a.modelParams).not.toBe(b.modelParams);
  });
});
