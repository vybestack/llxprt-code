/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  SECRET_SETTING_KEYS,
  redactProfileDocument,
  redactSecrets,
  buildRedactedSnapshot,
  diffProfileDocuments,
} from './profileViews.js';
import {
  isLoadBalancerProfileDocument,
  type ProfileDocument,
} from './profileDocument.js';
import type { WorkingProfileIdentity } from './profileState.js';

const standardDocument = (): ProfileDocument => ({
  version: 1,
  type: 'standard',
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: { temperature: 0.2 },
  ephemeralSettings: {
    'auth-key': 'sk-secret-abc',
    'auth-key-name': 'creds',
    'base-url': 'https://api.example.com',
    temperature: 0.7,
  },
});

const loadBalancerDocument = (): ProfileDocument => ({
  version: 1,
  type: 'loadbalancer',
  policy: 'roundrobin',
  profiles: ['alpha', 'beta', 'gamma'],
  contextLimit: 128000,
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: {},
  ephemeralSettings: {
    'auth-key': 'sk-lb-secret',
    'context-limit': 128000,
  },
});

const identity = (): WorkingProfileIdentity => ({
  kind: 'saved',
  name: 'work',
  source: { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 1024 },
});

describe('SECRET_SETTING_KEYS', () => {
  it('contains the auth-key key', () => {
    expect(SECRET_SETTING_KEYS).toContain('auth-key');
  });

  it('covers the credential-bearing value keys across the repo', () => {
    expect(SECRET_SETTING_KEYS).toContain('api-key');
    expect(SECRET_SETTING_KEYS).toContain('apikey');
    expect(SECRET_SETTING_KEYS).toContain('authorization');
    expect(SECRET_SETTING_KEYS).toContain('x-api-key');
    expect(SECRET_SETTING_KEYS).toContain('auth-token');
  });

  it('keeps reference keys out of the secret set', () => {
    expect(SECRET_SETTING_KEYS).not.toContain('auth-key-name');
    expect(SECRET_SETTING_KEYS).not.toContain('auth-keyfile');
  });
});

describe('redactSecrets', () => {
  it('masks a key-value fragment', () => {
    expect(redactSecrets('build failed with auth-key: sk-123 in env')).toBe(
      'build failed with auth-key: [redacted]',
    );
  });

  it('masks quoted JSON members', () => {
    expect(redactSecrets('{"api-key": "sk-9", "model": "m1"}')).toBe(
      '{"api-key": "[redacted]", "model": "m1"}',
    );
  });

  it('masks every credential-bearing value key', () => {
    const message = `apikey: k1
authorization: Bearer t2
x-api-key: k3
auth-token: t4`;
    const redacted = redactSecrets(message);
    expect(redacted).not.toContain('k1');
    expect(redacted).not.toContain('t2');
    expect(redacted).not.toContain('k3');
    expect(redacted).not.toContain('t4');
    expect(redacted).toContain('apikey: [redacted]');
    expect(redacted).toContain('authorization: [redacted]');
    expect(redacted).toContain('x-api-key: [redacted]');
    expect(redacted).toContain('auth-token: [redacted]');
  });

  it('leaves reference keys and non-secret text readable', () => {
    const message =
      'auth-key-name: creds auth-keyfile: /path/key base-url: https://x';
    expect(redactSecrets(message)).toBe(message);
  });

  it('leaves messages without secret keys untouched', () => {
    expect(redactSecrets('runtime factory build failed')).toBe(
      'runtime factory build failed',
    );
  });
});

describe('redactProfileDocument', () => {
  it('masks a secret setting value', () => {
    const doc = standardDocument();
    const redacted = redactProfileDocument(doc);
    expect(redacted.ephemeralSettings['auth-key']).toBe('[redacted]');
  });

  it('leaves non-secret settings untouched', () => {
    const redacted = redactProfileDocument(standardDocument());
    expect(redacted.ephemeralSettings['auth-key-name']).toBe('creds');
    expect(redacted.ephemeralSettings['base-url']).toBe(
      'https://api.example.com',
    );
    expect(redacted.ephemeralSettings['temperature']).toBe(0.7);
  });

  it('does not mutate the input document or share nested objects', () => {
    const modelOptions = { depth: 2 };
    const settingOptions = { enabled: true };
    const buckets = ['primary'];
    const doc: ProfileDocument = {
      ...standardDocument(),
      type: 'standard',
      modelParams: { options: modelOptions },
      ephemeralSettings: {
        'auth-key': 'sk-secret-abc',
        options: settingOptions,
      },
      auth: { type: 'oauth', buckets },
    };
    const redacted = redactProfileDocument(doc);
    expect(doc.ephemeralSettings['auth-key']).toBe('sk-secret-abc');
    const clonedOptions = redacted.modelParams['options'];
    if (
      typeof clonedOptions !== 'object' ||
      clonedOptions === null ||
      !('depth' in clonedOptions)
    ) {
      throw new Error('expected nested model options');
    }
    clonedOptions.depth = 4;
    expect(modelOptions.depth).toBe(2);
    modelOptions.depth = 6;
    expect(clonedOptions.depth).toBe(4);

    const clonedSettings = redacted.ephemeralSettings['options'];
    if (
      typeof clonedSettings !== 'object' ||
      clonedSettings === null ||
      !('enabled' in clonedSettings)
    ) {
      throw new Error('expected nested setting options');
    }
    clonedSettings.enabled = false;
    expect(settingOptions.enabled).toBe(true);
    settingOptions.enabled = false;
    clonedSettings.enabled = true;
    expect(settingOptions.enabled).toBe(false);

    if (redacted.type !== 'standard' || redacted.auth?.type !== 'oauth') {
      throw new Error('expected oauth auth');
    }
    buckets.push('backup');
    expect(redacted.auth.buckets).toStrictEqual(['primary']);
    redacted.auth.buckets = ['replacement'];
    expect(doc.auth).toStrictEqual({
      type: 'oauth',
      buckets: ['primary', 'backup'],
    });
  });

  it('masks mixed-case secret keys in documents and text', () => {
    const doc: ProfileDocument = {
      ...standardDocument(),
      ephemeralSettings: {
        'Auth-Key': 'mixed-auth-secret',
        'X-API-Key': 'mixed-api-secret',
        'Auth-Key-Name': 'creds',
      },
    };
    expect(redactProfileDocument(doc).ephemeralSettings).toStrictEqual({
      'Auth-Key': '[redacted]',
      'X-API-Key': '[redacted]',
      'Auth-Key-Name': 'creds',
    });
    expect(
      redactSecrets(`Auth-Key: mixed-auth-secret
X-API-Key: mixed-api-secret`),
    ).toBe(
      `Auth-Key: [redacted]
X-API-Key: [redacted]`,
    );
  });

  it('preserves the original document shape and kind', () => {
    const doc = standardDocument();
    const redacted = redactProfileDocument(doc);
    expect(redacted.type).toBe('standard');
    expect(redacted.provider).toBe('openai');
    expect(redacted.model).toBe('gpt-4o');
    expect(redacted.modelParams['temperature']).toBe(0.2);
  });

  it('redacts a load balancer document without disturbing its members', () => {
    const doc = loadBalancerDocument();
    const redacted = redactProfileDocument(doc);
    expect(redacted.type).toBe('loadbalancer');
    expect(redacted.ephemeralSettings['auth-key']).toBe('[redacted]');
    if (!isLoadBalancerProfileDocument(redacted)) {
      throw new Error('expected a load balancer document');
    }
    expect(redacted.profiles).toStrictEqual(['alpha', 'beta', 'gamma']);
  });

  it('redacts every credential-bearing value key on the document', () => {
    const doc: ProfileDocument = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'api-key': 'sk-1',
        apikey: 'k2',
        authorization: 'Bearer t3',
        'x-api-key': 'sk-4',
        'auth-token': 't5',
        'auth-key-name': 'creds',
      },
    };
    const redacted = redactProfileDocument(doc);
    expect(redacted.ephemeralSettings['api-key']).toBe('[redacted]');
    expect(redacted.ephemeralSettings['apikey']).toBe('[redacted]');
    expect(redacted.ephemeralSettings['authorization']).toBe('[redacted]');
    expect(redacted.ephemeralSettings['x-api-key']).toBe('[redacted]');
    expect(redacted.ephemeralSettings['auth-token']).toBe('[redacted]');
    expect(redacted.ephemeralSettings['auth-key-name']).toBe('creds');
    expect(JSON.stringify(redacted)).not.toContain('sk-1');
    expect(JSON.stringify(redacted)).not.toContain('Bearer t3');
  });

  it('carries only key names, never secret values, into a diff against a secret-bearing document', () => {
    const doc: ProfileDocument = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'api-key': 'sk-1',
        'x-api-key': 'sk-2',
        'auth-key': 'sk-3',
      },
    };
    const redacted = redactProfileDocument(doc);
    const diff = diffProfileDocuments(doc, redacted);
    for (const key of [
      'ephemeralSettings.api-key',
      'ephemeralSettings.x-api-key',
      'ephemeralSettings.auth-key',
    ]) {
      expect(diff.changedKeys).toContain(key);
    }
    const serialized = JSON.stringify(diff);
    expect(serialized).not.toContain('sk-1');
    expect(serialized).not.toContain('sk-2');
    expect(serialized).not.toContain('sk-3');
    const snapshot = buildRedactedSnapshot({
      revision: 1,
      identity: identity(),
      document: redacted,
    });
    expect(JSON.stringify(snapshot)).not.toContain('sk-1');
  });
});

describe('buildRedactedSnapshot', () => {
  it('builds a standard snapshot without memberCount', () => {
    const state = {
      revision: 4,
      identity: identity(),
      document: standardDocument(),
    };
    const snapshot = buildRedactedSnapshot(state);
    expect(snapshot.revision).toBe(4);
    expect(snapshot.identity.kind).toBe('saved');
    expect(snapshot.provider).toBe('openai');
    expect(snapshot.model).toBe('gpt-4o');
    expect(snapshot.isLoadBalancer).toBe(false);
    expect(snapshot.memberCount).toBeUndefined();
  });

  it('counts members for a load balancer snapshot', () => {
    const state = {
      revision: 5,
      identity: identity(),
      document: loadBalancerDocument(),
    };
    const snapshot = buildRedactedSnapshot(state);
    expect(snapshot.isLoadBalancer).toBe(true);
    expect(snapshot.memberCount).toBe(3);
  });
});

describe('diffProfileDocuments', () => {
  it('reports added, removed, and changed top-level keys', () => {
    const before: ProfileDocument = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'apikey' },
    };
    const after: ProfileDocument = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      modelParams: {},
      ephemeralSettings: {},
    };
    const diff = diffProfileDocuments(before, after);
    expect(diff.removes).toContain('auth');
    expect(diff.adds).not.toContain('provider');
    expect(diff.changedKeys).toContain('provider');
    expect(diff.changedKeys).toContain('model');
  });

  it('reports added and removed settings with their surface prefix', () => {
    const before: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: { 'auth-key-name': 'creds', 'base-url': 'u' },
    };
    const after: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: { 'auth-key-name': 'creds-rotated', temperature: 0.7 },
    };
    const diff = diffProfileDocuments(before, after);
    expect(diff.removes).toContain('ephemeralSettings.base-url');
    expect(diff.adds).toContain('ephemeralSettings.temperature');
    expect(diff.changedKeys).toContain('ephemeralSettings.auth-key-name');
  });

  it('reports changed model params without values', () => {
    const before: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { temperature: 0.2 },
      ephemeralSettings: {},
    };
    const after: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { temperature: 0.8, maxTokens: 4096 },
      ephemeralSettings: { temperature: 2 },
    };
    const diff = diffProfileDocuments(before, after);
    expect(diff.changedKeys).toContain('modelParams.temperature');
    expect(diff.adds).toContain('modelParams.maxTokens');
    expect(diff.changedKeys).not.toContain('modelParams.maxTokens');
  });

  it('reports identical documents as an empty diff on every surface', () => {
    const before = standardDocument();
    const after = standardDocument();
    const diff = diffProfileDocuments(before, after);
    expect(diff.changedKeys).toStrictEqual([]);
    expect(diff.adds).toStrictEqual([]);
    expect(diff.removes).toStrictEqual([]);
  });

  it('reports a shared key as changed only when its value differs', () => {
    const before = standardDocument();
    const after: ProfileDocument = {
      ...standardDocument(),
      model: 'gpt-4o-mini',
    };
    const diff = diffProfileDocuments(before, after);
    expect(diff.changedKeys).toStrictEqual(['model']);
    expect(diff.adds).toStrictEqual([]);
    expect(diff.removes).toStrictEqual([]);
  });

  it('compares nested setting values structurally', () => {
    const before: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { options: { depth: 2, modes: ['fast', 'deep'] } },
      ephemeralSettings: { 'auth-key-name': 'creds' },
    };
    const sameNested: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { options: { modes: ['fast', 'deep'], depth: 2 } },
      ephemeralSettings: { 'auth-key-name': 'creds' },
    };
    const unchanged = diffProfileDocuments(before, sameNested);
    expect(unchanged.changedKeys).toStrictEqual([]);

    const divergentNested: ProfileDocument = {
      ...sameNested,
      modelParams: { options: { modes: ['fast', 'deeper'], depth: 2 } },
    };
    const changed = diffProfileDocuments(before, divergentNested);
    expect(changed.changedKeys).toStrictEqual([
      'modelParams',
      'modelParams.options',
    ]);
  });

  it('reports a nested auth object as changed only when it differs', () => {
    const before: ProfileDocument = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['b1', 'b2'] },
    };
    const same: ProfileDocument = {
      ...before,
      auth: { type: 'oauth', buckets: ['b1', 'b2'] },
    };
    expect(diffProfileDocuments(before, same).changedKeys).toStrictEqual([]);

    const different: ProfileDocument = {
      ...before,
      auth: { type: 'oauth', buckets: ['b1'] },
    };
    const diff = diffProfileDocuments(before, different);
    expect(diff.changedKeys).toStrictEqual(['auth']);
  });
});
