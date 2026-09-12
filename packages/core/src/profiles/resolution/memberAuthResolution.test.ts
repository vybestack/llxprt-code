/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type {
  LoadBalancerProfileDocument,
  StandardProfileDocument,
} from '../contracts/profileDocument.js';
import {
  deriveMemberAuthBinding,
  memberCredentialBindings,
} from './memberAuthResolution.js';

const member = (
  overrides: Partial<StandardProfileDocument> = {},
): StandardProfileDocument => ({
  version: 1,
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: {},
  ephemeralSettings: {},
  ...overrides,
});

const lb = (profiles: readonly string[]): LoadBalancerProfileDocument => ({
  version: 1,
  type: 'loadbalancer',
  policy: 'roundrobin',
  profiles,
  provider: '',
  model: '',
  modelParams: {},
  ephemeralSettings: {},
});

describe('deriveMemberAuthBinding', () => {
  it('prefers a member OAuth auth config', () => {
    const outcome = deriveMemberAuthBinding(
      member({ auth: { type: 'oauth', buckets: ['member-bucket'] } }),
    );
    expect(outcome).toStrictEqual({
      binding: {
        kind: 'oauth',
        provider: 'openai',
        buckets: ['member-bucket'],
      },
      warnings: [],
    });
  });

  it('keeps the member OAuth buckets distinct that differ from the parent', () => {
    const outcome = deriveMemberAuthBinding(
      member({
        provider: 'anthropic',
        auth: { type: 'oauth', buckets: ['anthropic-prod'] },
      }),
    );
    expect(outcome).toStrictEqual({
      binding: {
        kind: 'oauth',
        provider: 'anthropic',
        buckets: ['anthropic-prod'],
      },
      warnings: [],
    });
  });

  it('uses a member key-name without the parent key-file', () => {
    const outcome = deriveMemberAuthBinding(
      member({ ephemeralSettings: { 'auth-key-name': 'MEMBER_KEY' } }),
    );
    expect(outcome).toStrictEqual({
      binding: { kind: 'key-name', keyName: 'MEMBER_KEY' },
      warnings: [],
    });
  });

  it('warns on a member inline auth-key', () => {
    const outcome = deriveMemberAuthBinding(
      member({ ephemeralSettings: { 'auth-key': 'member-secret' } }),
    );
    expect(outcome).toStrictEqual({
      binding: undefined,
      warnings: ['inline auth-key present; prefer auth-key-name for rotation'],
    });
  });

  it('falls back to the member provider without explicit intent', () => {
    const outcome = deriveMemberAuthBinding(member({ provider: 'openai' }));
    expect(outcome).toStrictEqual({
      binding: { kind: 'provider-default', provider: 'openai' },
      warnings: [],
    });
  });

  it('scopes binding to the own member provider when only its auth-key-name matters', () => {
    const outcome = deriveMemberAuthBinding(
      member({
        provider: 'anthropic',
        ephemeralSettings: { 'auth-key-name': 'PARENT_OWNED' },
      }),
    );
    expect(outcome).toStrictEqual({
      binding: { kind: 'key-name', keyName: 'PARENT_OWNED' },
      warnings: [],
    });
  });
});

describe('memberCredentialBindings', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'does not bind inherited member %s',
    (name) => {
      expect(memberCredentialBindings(lb([name]), {})).toStrictEqual({
        bindings: [],
        perMember: [{ member: name, binding: undefined }],
        warnings: [`member ${name} document unavailable`],
      });
    },
  );

  it('resolves members in lb.profiles order', () => {
    const members = {
      alpha: member({
        provider: 'openai',
        auth: { type: 'oauth', buckets: ['alpha-bucket'] },
      }),
      beta: member({ provider: 'anthropic' }),
    };
    const outcome = memberCredentialBindings(lb(['alpha', 'beta']), members);
    expect(outcome.bindings).toStrictEqual([
      { kind: 'oauth', provider: 'openai', buckets: ['alpha-bucket'] },
      { kind: 'provider-default', provider: 'anthropic' },
    ]);
    expect(outcome.perMember).toStrictEqual([
      {
        member: 'alpha',
        binding: {
          kind: 'oauth',
          provider: 'openai',
          buckets: ['alpha-bucket'],
        },
      },
      {
        member: 'beta',
        binding: { kind: 'provider-default', provider: 'anthropic' },
      },
    ]);
    expect(outcome.warnings).toStrictEqual([]);
  });

  it('keeps a member OAuth binding distinct from a parent OAuth config', () => {
    const members = {
      parent: member({
        provider: 'openai',
        ephemeralSettings: { 'auth-key-name': 'PARENT_KEY' },
      }),
    };
    const outcome = memberCredentialBindings(lb(['parent']), members);
    expect(outcome.bindings).toStrictEqual([
      { kind: 'key-name', keyName: 'PARENT_KEY' },
    ]);
  });

  it('emits a warning and no binding for a missing member', () => {
    const outcome = memberCredentialBindings(lb(['alpha']), {});
    expect(outcome.bindings).toStrictEqual([]);
    expect(outcome.perMember).toStrictEqual([
      { member: 'alpha', binding: undefined },
    ]);
    expect(outcome.warnings).toStrictEqual([
      'member alpha document unavailable',
    ]);
  });

  it('preserves per-member order when a middle member is missing', () => {
    const outcome = memberCredentialBindings(lb(['alpha', 'missing', 'beta']), {
      beta: member({ provider: 'anthropic' }),
      alpha: member({ provider: 'openai' }),
    });
    expect(outcome.perMember.map((entry) => entry.member)).toStrictEqual([
      'alpha',
      'missing',
      'beta',
    ]);
    expect(outcome.warnings).toStrictEqual([
      'member missing document unavailable',
    ]);
    expect(outcome.bindings).toStrictEqual([
      { kind: 'provider-default', provider: 'openai' },
      { kind: 'provider-default', provider: 'anthropic' },
    ]);
  });
});
