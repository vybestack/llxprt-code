/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type {
  LoadBalancerProfile,
  Profile,
  StandardProfile,
} from '@vybestack/llxprt-code-settings';
import {
  getProfileEphemeralSettings,
  getProfileModel,
  getProfileModelParams,
  getProfileProvider,
} from './profileAccessors.js';

function standardProfile(overrides: Partial<StandardProfile> = {}): Profile {
  return {
    version: 1,
    type: 'standard',
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.4, max_tokens: 512 },
    ephemeralSettings: { streaming: 'enabled', 'context-limit': 8000 },
    ...overrides,
  };
}

function loadBalancerProfile(
  overrides: Partial<LoadBalancerProfile> = {},
): Profile {
  return {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles: ['primary', 'secondary'],
    provider: 'anthropic',
    model: 'claude-sonnet',
    modelParams: { top_p: 0.9 },
    ephemeralSettings: { 'auth-key': 'lb-token' },
    ...overrides,
  };
}

describe('profileAccessors', () => {
  it('reads provider/model and record-shaped settings from a standard profile', () => {
    const profile = standardProfile();

    expect(getProfileProvider(profile)).toBe('openai');
    expect(getProfileModel(profile)).toBe('gpt-4o');
    expect(getProfileEphemeralSettings(profile)).toMatchObject({
      streaming: 'enabled',
      'context-limit': 8000,
    });
    expect(getProfileModelParams(profile)).toMatchObject({
      temperature: 0.4,
      max_tokens: 512,
    });
  });

  it('reads provider/model and record-shaped settings from a load-balancer profile', () => {
    const profile = loadBalancerProfile();

    expect(getProfileProvider(profile)).toBe('anthropic');
    expect(getProfileModel(profile)).toBe('claude-sonnet');
    expect(getProfileEphemeralSettings(profile)).toMatchObject({
      'auth-key': 'lb-token',
    });
    expect(getProfileModelParams(profile)).toMatchObject({ top_p: 0.9 });
  });

  it('returns empty records when a profile carries no params/ephemerals', () => {
    const profile = standardProfile({
      modelParams: {},
      ephemeralSettings: {},
    });

    expect(getProfileModelParams(profile)).toStrictEqual({});
    expect(getProfileEphemeralSettings(profile)).toStrictEqual({});
    expect(getProfileProvider(profile)).toBe('openai');
    expect(getProfileModel(profile)).toBe('gpt-4o');
  });

  it('returns the underlying provider/model strings verbatim (including empty)', () => {
    const profile = standardProfile({ provider: '', model: '   ' });

    // provider/model are typed strings; the accessors return them unchanged so
    // callers (which trim/normalize) preserve the original pass-through behavior.
    expect(getProfileProvider(profile)).toBe('');
    expect(getProfileModel(profile)).toBe('   ');
  });
});
