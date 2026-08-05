/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  CLAUDE_FABLE_5_CLAIM,
  CLAUDE_OPUS_5_CLAIM,
  isSanctionedClaudeFable5Model,
  isSanctionedClaudeOpus5Model,
} from './claudeModelIdentity.js';

const OPUS_5_ACCEPTED = [
  'claude-opus-5',
  'claude-opus-5-latest',
  'claude-opus-5-20260731',
  'claude-opus-5-20240229',
  'CLAUDE-OPUS-5',
  'Claude-Opus-5-Latest',
];

const FABLE_5_ACCEPTED = [
  'claude-fable-5',
  'claude-fable-5-latest',
  'claude-fable-5-20260731',
  'CLAUDE-FABLE-5-20260731',
];

const NEAR_MISSES = [
  'claude-opus-50',
  'claude-fable-50',
  'claude-opus-5-mini',
  'claude-opus-5-thinking',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-latest',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-5-2026-07-31',
  'claude-opus-5-20261345',
  'claude-opus-5-20260230',
  'claude-opus-5-2026073',
  'claude-opus-5-202607311',
  'anthropic/claude-opus-5',
  ' claude-opus-5',
  'claude-opus-5 ',
  'claude-opus-5-',
  '',
];

describe('Claude 5 anchored model identity', () => {
  it.each(OPUS_5_ACCEPTED)('accepts %s as Opus 5', (model) => {
    expect(isSanctionedClaudeOpus5Model(model)).toBe(true);
  });

  it.each(FABLE_5_ACCEPTED)('accepts %s as Fable 5', (model) => {
    expect(isSanctionedClaudeFable5Model(model)).toBe(true);
  });

  it.each(NEAR_MISSES)('rejects the near miss %s for both models', (model) => {
    expect(isSanctionedClaudeOpus5Model(model)).toBe(false);
    expect(isSanctionedClaudeFable5Model(model)).toBe(false);
  });

  it('does not let either Claude 5 model match the other', () => {
    for (const model of OPUS_5_ACCEPTED) {
      expect(isSanctionedClaudeFable5Model(model)).toBe(false);
    }
    for (const model of FABLE_5_ACCEPTED) {
      expect(isSanctionedClaudeOpus5Model(model)).toBe(false);
    }
  });

  it('rejects impossible leap days but accepts real ones', () => {
    expect(isSanctionedClaudeOpus5Model('claude-opus-5-20240229')).toBe(true);
    expect(isSanctionedClaudeOpus5Model('claude-opus-5-20260229')).toBe(false);
    expect(isSanctionedClaudeOpus5Model('claude-opus-5-21000229')).toBe(false);
    expect(isSanctionedClaudeOpus5Model('claude-opus-5-20000229')).toBe(true);
  });

  it('claims lookalike suffixes so they fail loudly instead of silently', () => {
    expect(CLAUDE_OPUS_5_CLAIM.test('claude-opus-5-mini')).toBe(true);
    expect(isSanctionedClaudeOpus5Model('claude-opus-5-mini')).toBe(false);
    expect(CLAUDE_FABLE_5_CLAIM.test('claude-fable-5-mini')).toBe(true);
    expect(isSanctionedClaudeFable5Model('claude-fable-5-mini')).toBe(false);
  });

  it('does not claim a different model version', () => {
    for (const model of [
      'claude-opus-50',
      'claude-opus-4-8',
      'claude-fable-50',
    ]) {
      expect(CLAUDE_OPUS_5_CLAIM.test(model)).toBe(false);
      expect(CLAUDE_FABLE_5_CLAIM.test(model)).toBe(false);
    }
  });

  it('claims each family without claiming the other', () => {
    expect(CLAUDE_OPUS_5_CLAIM.test('claude-fable-5')).toBe(false);
    expect(CLAUDE_FABLE_5_CLAIM.test('claude-opus-5')).toBe(false);
  });
});
