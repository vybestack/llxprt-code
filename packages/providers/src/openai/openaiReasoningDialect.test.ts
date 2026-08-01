/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveReasoningDialect,
  applyReasoningDialect,
  hasExplicitReasoningField,
  REASONING_WIRE_KEYS,
} from './openaiReasoningDialect.js';

describe('resolveReasoningDialect — host to dialect mapping', () => {
  it('resolves openrouter.ai to the openrouter dialect', () => {
    expect(resolveReasoningDialect('https://openrouter.ai/api/v1')).toBe(
      'openrouter',
    );
  });

  it('resolves *.openrouter.ai to the openrouter dialect', () => {
    expect(resolveReasoningDialect('https://api.openrouter.ai/api/v1')).toBe(
      'openrouter',
    );
  });

  it('does NOT match evil-openrouter.ai.attacker.com (suffix spoofing)', () => {
    expect(
      resolveReasoningDialect('https://evil-openrouter.ai.attacker.com/v1'),
    ).toBe('none');
  });

  it('resolves z.ai and *.z.ai to the thinking dialect', () => {
    expect(resolveReasoningDialect('https://z.ai/api/paas/v4')).toBe(
      'thinking',
    );
    expect(resolveReasoningDialect('https://api.z.ai/api/paas/v4')).toBe(
      'thinking',
    );
  });

  it('resolves bigmodel.cn and *.bigmodel.cn to the thinking dialect', () => {
    expect(
      resolveReasoningDialect('https://open.bigmodel.cn/api/paas/v4'),
    ).toBe('thinking');
    expect(resolveReasoningDialect('https://bigmodel.cn/api/paas/v4')).toBe(
      'thinking',
    );
  });

  it('resolves api.openai.com to none', () => {
    expect(resolveReasoningDialect('https://api.openai.com/v1')).toBe('none');
  });

  it('resolves friendli to none', () => {
    expect(
      resolveReasoningDialect('https://api.friendli.ai/serverless/v1'),
    ).toBe('none');
  });

  it('resolves crusoe to none (trailing slash)', () => {
    expect(
      resolveReasoningDialect('https://api.inference.crusoecloud.com/v1/'),
    ).toBe('none');
  });

  it('resolves undefined base URL to none', () => {
    expect(resolveReasoningDialect(undefined)).toBe('none');
  });

  it('resolves empty string to none', () => {
    expect(resolveReasoningDialect('')).toBe('none');
  });

  it('resolves whitespace-only string to none', () => {
    expect(resolveReasoningDialect('   ')).toBe('none');
  });

  it('resolves invalid URL string to none', () => {
    expect(resolveReasoningDialect('not a url')).toBe('none');
  });
});

describe('applyReasoningDialect — wire-shape emission', () => {
  it('openrouter: emits reasoning.effort when effort is set', () => {
    expect(
      applyReasoningDialect('openrouter', { enabled: true, effort: 'high' }),
    ).toStrictEqual({ key: 'reasoning', value: { effort: 'high' } });
  });

  it('openrouter: emits reasoning.enabled when effort is not set', () => {
    expect(
      applyReasoningDialect('openrouter', { enabled: true }),
    ).toStrictEqual({ key: 'reasoning', value: { enabled: true } });
    expect(
      applyReasoningDialect('openrouter', { enabled: false }),
    ).toStrictEqual({ key: 'reasoning', value: { enabled: false } });
  });

  it('openrouter: emits nothing when neither effort nor enabled is set', () => {
    expect(applyReasoningDialect('openrouter', {})).toBeNull();
  });

  it('openrouter: an explicit enabled=false outranks a leftover effort', () => {
    expect(
      applyReasoningDialect('openrouter', { enabled: false, effort: 'high' }),
    ).toStrictEqual({ key: 'reasoning', value: { enabled: false } });
  });

  it('openrouter: falls back to enabled when effort is an empty string', () => {
    expect(
      applyReasoningDialect('openrouter', { effort: '', enabled: true }),
    ).toStrictEqual({ key: 'reasoning', value: { enabled: true } });
  });

  it('openrouter: emits nothing when effort is empty and enabled is unset', () => {
    expect(applyReasoningDialect('openrouter', { effort: '' })).toBeNull();
  });

  it('thinking: emits thinking.type=enabled when enabled is true', () => {
    expect(applyReasoningDialect('thinking', { enabled: true })).toStrictEqual({
      key: 'thinking',
      value: { type: 'enabled' },
    });
  });

  it('thinking: emits thinking.type=disabled when enabled is false', () => {
    expect(applyReasoningDialect('thinking', { enabled: false })).toStrictEqual(
      {
        key: 'thinking',
        value: { type: 'disabled' },
      },
    );
  });

  it('thinking: an effort level alone still enables thinking', () => {
    expect(applyReasoningDialect('thinking', { effort: 'high' })).toStrictEqual(
      { key: 'thinking', value: { type: 'enabled' } },
    );
  });

  it('thinking: an explicit enabled=false outranks a leftover effort', () => {
    expect(
      applyReasoningDialect('thinking', { enabled: false, effort: 'high' }),
    ).toStrictEqual({ key: 'thinking', value: { type: 'disabled' } });
  });

  it('thinking: emits nothing when no reasoning setting is present', () => {
    expect(applyReasoningDialect('thinking', {})).toBeNull();
    expect(applyReasoningDialect('thinking', { effort: '' })).toBeNull();
  });

  it('none: always emits nothing', () => {
    expect(
      applyReasoningDialect('none', { enabled: true, effort: 'high' }),
    ).toBeNull();
  });
});

describe('hasExplicitReasoningField — known wire keys', () => {
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

  it('returns false for a body with no reasoning representation', () => {
    expect(hasExplicitReasoningField({ model: 'gpt-4o', top_p: 0.95 })).toBe(
      false,
    );
  });
});
