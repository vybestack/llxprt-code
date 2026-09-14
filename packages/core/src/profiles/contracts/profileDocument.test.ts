/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  isStandardProfileDocument,
  isLoadBalancerProfileDocument,
} from './profileDocument.js';

describe('isStandardProfileDocument', () => {
  it('treats undefined load balancer fields as absent', () => {
    expect(
      isStandardProfileDocument({
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
        type: undefined,
        auth: undefined,
        contextLimit: undefined,
        policy: undefined,
        profiles: undefined,
      }),
    ).toBe(true);
  });

  it.each([
    { contextLimit: '128000' },
    { policy: null },
    { profiles: 'alpha' },
  ])('rejects defined load balancer fields %j', (fields) => {
    expect(
      isStandardProfileDocument({
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
        ...fields,
      }),
    ).toBe(false);
  });

  it.each([
    { type: 'oauth', buckets: 'primary' },
    { type: 'oauth', buckets: ['primary', 7] },
    { type: 'unknown' },
  ])('rejects malformed auth %j', (auth) => {
    const doc = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
      auth,
    };
    expect(isStandardProfileDocument(doc)).toBe(false);
    expect(
      isLoadBalancerProfileDocument({
        ...doc,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['alpha'],
      }),
    ).toBe(false);
  });

  it('accepts a standard document with oauth auth', () => {
    const doc: unknown = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      modelParams: { temperature: 0.7 },
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['bucket-a', 'bucket-b'] },
    };
    expect(isStandardProfileDocument(doc)).toBe(true);
  });

  it('accepts a standard document without an explicit type field', () => {
    const doc: unknown = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isStandardProfileDocument(doc)).toBe(true);
  });

  it('rejects a load balancer document', () => {
    const doc: unknown = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['alpha', 'beta'],
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isStandardProfileDocument(doc)).toBe(false);
  });
});

describe('isLoadBalancerProfileDocument', () => {
  it.each(['128000', NaN, -1, 0, Infinity, -Infinity, null])(
    'rejects invalid contextLimit %s',
    (contextLimit) => {
      expect(
        isLoadBalancerProfileDocument({
          version: 1,
          type: 'loadbalancer',
          policy: 'roundrobin',
          profiles: ['alpha'],
          contextLimit,
          provider: 'openai',
          model: 'gpt-4o',
          modelParams: {},
          ephemeralSettings: {},
        }),
      ).toBe(false);
    },
  );

  it('accepts an explicitly undefined contextLimit', () => {
    expect(
      isLoadBalancerProfileDocument({
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['alpha'],
        contextLimit: undefined,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
      }),
    ).toBe(true);
  });

  it('accepts a load balancer document with roundrobin policy and two members', () => {
    const doc: unknown = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['alpha', 'beta'],
      contextLimit: 128000,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isLoadBalancerProfileDocument(doc)).toBe(true);
  });

  it('accepts a load balancer document with failover policy', () => {
    const doc: unknown = {
      version: 1,
      type: 'loadbalancer',
      policy: 'failover',
      profiles: ['primary', 'backup'],
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isLoadBalancerProfileDocument(doc)).toBe(true);
  });

  it('rejects a standard document', () => {
    const doc: unknown = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'apikey' },
    };
    expect(isLoadBalancerProfileDocument(doc)).toBe(false);
  });
});

describe('malformed profile documents', () => {
  it('rejects null in both guards', () => {
    expect(isStandardProfileDocument(null)).toBe(false);
    expect(isLoadBalancerProfileDocument(null)).toBe(false);
  });

  it('rejects undefined in both guards', () => {
    expect(isStandardProfileDocument(undefined)).toBe(false);
    expect(isLoadBalancerProfileDocument(undefined)).toBe(false);
  });

  it('rejects primitive values in both guards', () => {
    for (const primitive of ['profile', 42, true, Symbol('p')]) {
      expect(isStandardProfileDocument(primitive)).toBe(false);
      expect(isLoadBalancerProfileDocument(primitive)).toBe(false);
    }
  });

  it('rejects an array in both guards', () => {
    expect(isStandardProfileDocument([])).toBe(false);
    expect(isLoadBalancerProfileDocument([])).toBe(false);
  });

  it('rejects a document missing provider in both guards', () => {
    const doc: unknown = {
      version: 1,
      type: 'standard',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isStandardProfileDocument(doc)).toBe(false);
    expect(isLoadBalancerProfileDocument(doc)).toBe(false);
  });

  it('rejects a document with a non-string provider in both guards', () => {
    const doc: unknown = {
      version: 1,
      provider: 7,
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isStandardProfileDocument(doc)).toBe(false);
    expect(isLoadBalancerProfileDocument(doc)).toBe(false);
  });

  it('rejects a document whose version is not the number 1 in both guards', () => {
    for (const version of ['1', 2, null, undefined]) {
      const doc: unknown = {
        version,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
      };
      expect(isStandardProfileDocument(doc)).toBe(false);
      expect(isLoadBalancerProfileDocument(doc)).toBe(false);
    }
  });

  it('rejects a load balancer document with a non-array profiles field', () => {
    const doc: unknown = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: 'alpha',
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isLoadBalancerProfileDocument(doc)).toBe(false);
  });

  it('rejects a load balancer document with an invalid policy', () => {
    const doc: unknown = {
      version: 1,
      type: 'loadbalancer',
      policy: 'weighted',
      profiles: ['alpha', 'beta'],
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };
    expect(isLoadBalancerProfileDocument(doc)).toBe(false);
  });
});
