/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  hasExplicitReasoningField,
  REASONING_WIRE_KEYS,
} from './openaiReasoningDialect.js';

describe('hasExplicitReasoningField: known wire keys', () => {
  it('covers every vendor dialect named in issue #2896', () => {
    expect([...REASONING_WIRE_KEYS].sort()).toStrictEqual([
      'parse_reasoning',
      'reasoning',
      'reasoning_effort',
      'thinking',
    ]);
  });

  it.each([...REASONING_WIRE_KEYS])('detects an explicit %s', (key) => {
    expect(hasExplicitReasoningField({ [key]: 'anything' })).toBe(true);
  });

  it.each([...REASONING_WIRE_KEYS])(
    'ignores an inherited %s property so translation stays active',
    (key) => {
      const body: Record<string, unknown> = Object.create({
        [key]: 'inherited-value',
      });
      body.model = 'gpt-4o';

      expect(hasExplicitReasoningField(body)).toBe(false);
    },
  );

  it.each(['reasoning_effort', 'enable_thinking'])(
    'detects explicit chat_template_kwargs.%s',
    (key) => {
      expect(
        hasExplicitReasoningField({ chat_template_kwargs: { [key]: true } }),
      ).toBe(true);
    },
  );

  it.each(['reasoning_effort', 'enable_thinking'])(
    'ignores an inherited chat_template_kwargs.%s property',
    (key) => {
      const templateKwargs: Record<string, unknown> = Object.create({
        [key]: 'inherited-value',
      });
      templateKwargs.tokenize = false;

      expect(
        hasExplicitReasoningField({
          chat_template_kwargs: templateKwargs,
        }),
      ).toBe(false);
    },
  );

  it('does not treat unrelated template kwargs as a collision', () => {
    expect(
      hasExplicitReasoningField({
        chat_template_kwargs: { tokenize: false },
      }),
    ).toBe(false);
  });

  it('detects an own output_config.effort as an explicit representation', () => {
    expect(
      hasExplicitReasoningField({ output_config: { effort: 'low' } }),
    ).toBe(true);
  });

  it('does not treat unrelated output_config siblings as a collision', () => {
    expect(
      hasExplicitReasoningField({ output_config: { service_hint: 'keep' } }),
    ).toBe(false);
  });

  it('ignores an inherited output_config.effort property', () => {
    const outputConfig: Record<string, unknown> = Object.create({
      effort: 'inherited-effort',
    });
    outputConfig.service_hint = 'keep';

    expect(hasExplicitReasoningField({ output_config: outputConfig })).toBe(
      false,
    );
  });

  it('returns false for a body with no reasoning representation', () => {
    expect(hasExplicitReasoningField({ model: 'gpt-4o', top_p: 0.95 })).toBe(
      false,
    );
  });
});
