/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  deriveCredentialBindings,
  deriveMemberAuthBinding,
  memberCredentialBindings,
  intersectPolicy,
} from './resolution/index.js';
import type {
  LoadBalancerProfileDocument,
  StandardProfileDocument,
} from './contracts/profileDocument.js';

describe('resolution module coverage exports', () => {
  it('derives oauth credentials from a member', () => {
    const doc: StandardProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth' as const, buckets: ['b1'] },
    };
    expect(deriveCredentialBindings(doc).bindings).toStrictEqual([
      { kind: 'oauth', provider: 'openai', buckets: ['b1'] },
    ]);
  });

  it('derives member auth binding', () => {
    const member: StandardProfileDocument = {
      version: 1,
      provider: 'anthropic',
      model: 'claude',
      modelParams: {},
      ephemeralSettings: { 'auth-key-name': 'A' },
    };
    expect(deriveMemberAuthBinding(member).binding).toStrictEqual({
      kind: 'key-name',
      keyName: 'A',
    });
  });

  it('resolves members with attribution', () => {
    const lb: LoadBalancerProfileDocument = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['miss'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };
    const members: Partial<Record<string, StandardProfileDocument>> = {};
    const out = memberCredentialBindings(lb, members);
    expect(out.warnings).toStrictEqual(['member miss document unavailable']);
  });

  it('intersects profile policies', () => {
    const policy = intersectPolicy({ allowedTools: ['x'] }, {}, {});
    expect(policy.policy.allowedTools).toStrictEqual(['x']);
  });
});
