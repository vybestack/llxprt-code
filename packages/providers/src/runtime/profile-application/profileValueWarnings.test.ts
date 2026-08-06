/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2896 - A profile written by the model config dialog carried
 * `"top_p": ".95"`, and the only signal was a 400 from the provider. These
 * tests pin the advisory behaviour AND, just as importantly, pin that it is
 * not a gate: unknown keys and custom-model parameters must never warn.
 */

import { describe, it, expect } from 'bun:test';
import {
  collectProfileValueWarnings,
  formatProfileValueWarnings,
} from './profileValueWarnings.js';

const NONE: Record<string, unknown> = {};

describe('collectProfileValueWarnings — never gates on key membership', () => {
  it.each([
    ['some_custom_vendor_param', 'anything'],
    ['some_custom_vendor_param', 42],
    ['parse_reasoning', true],
    ['chat_template_kwargs', { enable_thinking: true }],
    ['enable_thinking', 'yes'],
    ['a.dotted.vendor.key', 'v'],
  ])('stays silent for the unrecognized model param %s', (key, value) => {
    expect(collectProfileValueWarnings({ [key]: value }, NONE)).toStrictEqual(
      [],
    );
  });

  it('stays silent for an unrecognized ephemeral setting', () => {
    expect(
      collectProfileValueWarnings(NONE, { 'some-future-setting': 'on' }),
    ).toStrictEqual([]);
  });

  it('stays silent for free-form registered params of any shape', () => {
    expect(
      collectProfileValueWarnings(
        {
          stop: ['x'],
          response_format: { type: 'json_object' },
          tool_choice: 'auto',
          logit_bias: { '1': 2 },
          metadata: { a: 'b' },
        },
        NONE,
      ),
    ).toStrictEqual([]);
  });
});

describe('collectProfileValueWarnings — reports only unrepairable type errors', () => {
  it('stays silent for a repairable numeric string, which egress fixes', () => {
    // '.95' is coerced to 0.95 before the check, so the user is not nagged
    // about something that works.
    expect(collectProfileValueWarnings({ top_p: '.95' }, NONE)).toStrictEqual(
      [],
    );
  });

  it('reports a non-numeric value for a numeric param', () => {
    const found = collectProfileValueWarnings({ top_p: 'abc' }, NONE);

    expect(found).toHaveLength(1);
    expect(found[0].key).toBe('top_p');
    expect(found[0].message).toContain('must be a number');
  });

  it('reports an overflow literal, which cannot be repaired either', () => {
    expect(
      collectProfileValueWarnings({ temperature: '1e400' }, NONE),
    ).toHaveLength(1);
  });

  it('reports each offending key across params and ephemerals', () => {
    const found = collectProfileValueWarnings(
      { top_p: 'abc', max_tokens: 'lots' },
      { 'context-limit': 'huge' },
    );

    expect(found.map((w) => w.key).sort()).toStrictEqual([
      'context-limit',
      'max_tokens',
      'top_p',
    ]);
  });

  it('ignores null and undefined rather than reporting them', () => {
    expect(
      collectProfileValueWarnings(
        { top_p: null, temperature: undefined },
        NONE,
      ),
    ).toStrictEqual([]);
  });
});

describe('formatProfileValueWarnings', () => {
  it('names the profile and says the value is still being used', () => {
    const [line] = formatProfileValueWarnings('crusoeglm', [
      { key: 'top_p', message: 'top_p must be a number' },
    ]);

    expect(line).toContain('crusoeglm');
    expect(line).toContain('top_p must be a number');
    expect(line).toContain('used as written');
  });

  it('produces nothing when there is nothing to report', () => {
    expect(formatProfileValueWarnings('p', [])).toStrictEqual([]);
  });
});
