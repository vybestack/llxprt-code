/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { StandardProfileDocument } from '../contracts/profileDocument.js';
import { deriveCredentialBindings } from './credentialBindings.js';

const base = (): StandardProfileDocument => ({
  version: 1,
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: {},
  ephemeralSettings: {},
});

describe('deriveCredentialBindings precedence', () => {
  it('prefers an OAuth auth config', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      auth: { type: 'oauth', buckets: ['bucket-a', 'bucket-b'] },
    });
    expect(outcome).toStrictEqual({
      bindings: [
        {
          kind: 'oauth',
          provider: 'openai',
          buckets: ['bucket-a', 'bucket-b'],
        },
      ],
      warnings: [],
    });
  });

  it('uses OAuth with empty buckets when none are given', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      auth: { type: 'oauth' },
    });
    expect(outcome).toStrictEqual({
      bindings: [{ kind: 'oauth', provider: 'openai', buckets: [] }],
      warnings: [],
    });
  });

  it('uses an auth-key-name setting next', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      ephemeralSettings: { 'auth-key-name': 'LLM_API_KEY' },
    });
    expect(outcome).toStrictEqual({
      bindings: [{ kind: 'key-name', keyName: 'LLM_API_KEY' }],
      warnings: [],
    });
  });

  it('uses an auth-keyfile setting over an inline auth-key', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      ephemeralSettings: {
        'auth-keyfile': '~/.keys/openai.pem',
        'auth-key': 'sk-secret-abc',
      },
    });
    expect(outcome).toStrictEqual({
      bindings: [{ kind: 'keyfile', path: '~/.keys/openai.pem' }],
      warnings: [],
    });
  });

  it('prefers auth-key-name over auth-keyfile and inline auth-key', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      ephemeralSettings: {
        'auth-key-name': 'OPENAI_KEY',
        'auth-keyfile': '~/.keys/openai.pem',
        'auth-key': 'sk-secret-abc',
      },
    });
    expect(outcome).toStrictEqual({
      bindings: [{ kind: 'key-name', keyName: 'OPENAI_KEY' }],
      warnings: [],
    });
  });

  it('warns on an inline auth-key without a key-name or keyfile', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      ephemeralSettings: { 'auth-key': 'sk-secret-abc' },
    });
    expect(outcome).toStrictEqual({
      bindings: [],
      warnings: ['inline auth-key present; prefer auth-key-name for rotation'],
    });
  });

  it('falls back to a provider-default binding when there is a provider', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      provider: 'anthropic',
    });
    expect(outcome).toStrictEqual({
      bindings: [{ kind: 'provider-default', provider: 'anthropic' }],
      warnings: [],
    });
  });

  it('returns an empty result for an empty provider', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      provider: '',
    });
    expect(outcome).toStrictEqual({
      bindings: [],
      warnings: [],
    });
  });

  it('never copies secret material into bindings', () => {
    const outcome = deriveCredentialBindings({
      ...base(),
      ephemeralSettings: { 'auth-key': 'sk-super-secret-value' },
    });
    const serialized = JSON.stringify(outcome.bindings);
    expect(serialized).not.toContain('sk-super-secret-value');
    expect(outcome.bindings).toHaveLength(0);
  });
});
