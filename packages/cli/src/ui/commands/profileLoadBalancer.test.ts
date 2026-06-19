/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  extractExplicitLoadBalancerContextLimit,
  getAmbientLoadBalancerContextLimit,
  buildLoadBalancerEphemeralSettings,
  createLoadBalancerProfileDefinition,
} from './profileLoadBalancer.js';

describe('extractExplicitLoadBalancerContextLimit', () => {
  it('extracts --context-limit=N flag', () => {
    const result = extractExplicitLoadBalancerContextLimit([
      '--context-limit=5000',
      'profA',
      'profB',
    ]);
    expect(result.contextLimit).toBe(5000);
    expect(result.profileArgs).toStrictEqual(['profA', 'profB']);
    expect(result.error).toBeUndefined();
  });

  it('extracts --context-limit N flag (space-separated)', () => {
    const result = extractExplicitLoadBalancerContextLimit([
      '--context-limit',
      '3000',
      'profA',
    ]);
    expect(result.contextLimit).toBe(3000);
    expect(result.profileArgs).toStrictEqual(['profA']);
  });

  it('returns error for non-integer value', () => {
    const result = extractExplicitLoadBalancerContextLimit([
      '--context-limit=abc',
    ]);
    expect(result.error).toBeDefined();
    expect(result.error?.messageType).toBe('error');
  });

  it('returns error for zero or negative value', () => {
    const zero = extractExplicitLoadBalancerContextLimit(['--context-limit=0']);
    expect(zero.error).toBeDefined();

    const negative = extractExplicitLoadBalancerContextLimit([
      '--context-limit=-5',
    ]);
    expect(negative.error).toBeDefined();
  });

  it('returns error when --context-limit has no value', () => {
    const result = extractExplicitLoadBalancerContextLimit(['--context-limit']);
    expect(result.error).toBeDefined();
  });

  it('passes through non-flag args', () => {
    const result = extractExplicitLoadBalancerContextLimit(['profA', 'profB']);
    expect(result.contextLimit).toBeUndefined();
    expect(result.profileArgs).toStrictEqual(['profA', 'profB']);
  });
});

describe('getAmbientLoadBalancerContextLimit', () => {
  it('returns a valid integer context-limit', () => {
    expect(getAmbientLoadBalancerContextLimit({ 'context-limit': 4096 })).toBe(
      4096,
    );
  });

  it('returns undefined for non-integer value', () => {
    expect(
      getAmbientLoadBalancerContextLimit({ 'context-limit': 1.5 }),
    ).toBeUndefined();
  });

  it('returns undefined for zero', () => {
    expect(
      getAmbientLoadBalancerContextLimit({ 'context-limit': 0 }),
    ).toBeUndefined();
  });

  it('returns undefined when absent', () => {
    expect(getAmbientLoadBalancerContextLimit({})).toBeUndefined();
  });
});

describe('buildLoadBalancerEphemeralSettings', () => {
  it('filters out context-limit and undefined/null values', () => {
    const result = buildLoadBalancerEphemeralSettings({
      'context-limit': 1000,
      temperature: 0.7,
      removed: undefined,
      alsoRemoved: null,
      kept: 'yes',
    });
    expect(result).toStrictEqual({ temperature: 0.7, kept: 'yes' });
    expect(result).not.toHaveProperty('context-limit');
  });
});

describe('createLoadBalancerProfileDefinition', () => {
  it('builds a roundrobin profile with context limit', () => {
    const profile = createLoadBalancerProfileDefinition(
      'roundrobin',
      ['a', 'b'],
      { temperature: 0.5 },
      2048,
    );
    expect(profile.type).toBe('loadbalancer');
    expect(profile.policy).toBe('roundrobin');
    expect(profile.profiles).toStrictEqual(['a', 'b']);
    expect(profile.contextLimit).toBe(2048);
    expect(profile.ephemeralSettings).toStrictEqual({ temperature: 0.5 });
  });

  it('omits contextLimit when undefined', () => {
    const profile = createLoadBalancerProfileDefinition(
      'failover',
      ['a'],
      {},
      undefined,
    );
    expect(profile.contextLimit).toBeUndefined();
    expect(profile.policy).toBe('failover');
  });
});
