/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { ProfileRepositoryPort } from '../ports/profileRepositoryPort.js';
import type { ProviderModelCatalogPort } from '../ports/providerCatalogPort.js';
import type {
  LoadBalancerProfileDocument,
  StandardProfileDocument,
} from '../contracts/profileDocument.js';
import type {
  ProfilePolicyIntent,
  PolicyCeiling,
} from './policyIntersection.js';
import { resolveProfileCandidate } from './resolveProfileCandidate.js';

const standard = (
  overrides: Partial<StandardProfileDocument> = {},
): StandardProfileDocument => ({
  version: 1,
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: {},
  ephemeralSettings: {},
  ...overrides,
});

const lb = (profiles: readonly string[] = []): LoadBalancerProfileDocument => ({
  version: 1,
  type: 'loadbalancer',
  policy: 'roundrobin',
  profiles,
  provider: '',
  model: '',
  modelParams: {},
  ephemeralSettings: {},
});

const catalog = (
  validate: (
    provider: string,
    model: string,
    params?: Readonly<Record<string, unknown>>,
  ) => { status: 'valid' | 'invalid' | 'unknown'; reason?: string },
  listModels: (provider: string) => string[],
): ProviderModelCatalogPort => ({
  validateModelSupport: async (provider, model, params) => {
    const support = validate(provider, model, params);
    if (support.status === 'invalid') {
      return { status: 'invalid', reason: support.reason ?? '' };
    }
    if (support.status === 'unknown') {
      return { status: 'unknown' };
    }
    return { status: 'valid' };
  },
  listModels: async (provider: string) => listModels(provider),
  getDefaultModel: async () => undefined,
  getProviderTemplate: async () => undefined,
});

const trust = {
  getToolCeiling: () => ({
    allowedTools: [] as readonly string[],
    disabledTools: [] as readonly string[],
  }),
  isToolAvailable: () => true,
  getShellCeiling: () => 'all' as const,
  getApprovalCeiling: () => 'standard' as const,
};

function deps(
  overrides: {
    catalog?: ReturnType<typeof catalog>;
    repository?: ProfileRepositoryPort;
    policyIntent?: ProfilePolicyIntent;
    role?: PolicyCeiling;
    session?: PolicyCeiling;
  } = {},
) {
  const repo = overrides.repository;
  return {
    catalog:
      overrides.catalog ??
      catalog(
        () => ({ status: 'valid' }),
        () => [],
      ),
    trust,
    session: overrides.session ?? {},
    role: overrides.role,
    repository: repo,
    policyIntent: overrides.policyIntent ?? {},
  };
}

describe('resolveProfileCandidate standard documents', () => {
  for (const model of ['gpt-4o', 'unknown-model']) {
    it(`validates model parameters for ${model} without treating unknown metadata as invalid`, async () => {
      const result = await resolveProfileCandidate(
        {
          document: standard({ model, modelParams: { 'bogus-param': true } }),
          policyIntent: {},
        },
        deps({
          catalog: catalog(
            (_provider, candidateModel, params) => {
              if (candidateModel !== 'gpt-4o') {
                return { status: 'unknown' };
              }
              return params !== undefined && 'bogus-param' in params
                ? { status: 'invalid', reason: 'unknown parameter bogus-param' }
                : { status: 'valid' };
            },
            () => ['gpt-4o'],
          ),
        }),
      );
      expect(result.status).toStrictEqual(
        model === 'gpt-4o' ? 'invalid' : 'unverified',
      );
      expect(result.errors).toStrictEqual(
        model === 'gpt-4o'
          ? [
              'unknown parameter bogus-param',
              'model gpt-4o is not supported by provider openai',
            ]
          : [],
      );
    });
  }

  it('resolves a valid standard document to valid with a provider-default binding', async () => {
    const document = standard();
    const result = await resolveProfileCandidate(
      { document, policyIntent: {} },
      deps(),
    );
    expect(result.status).toBe('valid');
    expect(result.resolved.credentialBindings).toStrictEqual([
      { kind: 'provider-default', provider: 'openai' },
    ]);
    expect(result.resolved.document).toBe(document);
    expect(result.errors).toStrictEqual([]);
    expect(result.memberCaptures).toBeUndefined();
  });

  it('marks an unsupported model invalid and reports the exact message', async () => {
    const result = await resolveProfileCandidate(
      { document: standard(), policyIntent: {} },
      deps({
        catalog: catalog(
          () => ({ status: 'invalid', reason: 'model retired' }),
          () => [],
        ),
      }),
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain(
      'model gpt-4o is not supported by provider openai',
    );
    expect(result.errors).toContain('model retired');
  });

  it('marks an unknown model unverified without unverified errors', async () => {
    const result = await resolveProfileCandidate(
      { document: standard(), policyIntent: {} },
      deps({
        catalog: catalog(
          () => ({ status: 'unknown' }),
          () => [],
        ),
      }),
    );
    expect(result.status).toBe('unverified');
    expect(result.unverifiedConstraints).toStrictEqual([
      'model support unknown for provider openai',
    ]);
    expect(result.errors).toStrictEqual([]);
  });

  it('propagates auth-key warnings from a standard document', async () => {
    const result = await resolveProfileCandidate(
      {
        document: standard({ ephemeralSettings: { 'auth-key': 'sk-secret' } }),
        policyIntent: {},
      },
      deps(),
    );
    expect(result.status).toBe('valid');
    expect(result.warnings).toContain(
      'inline auth-key present; prefer auth-key-name for rotation',
    );
  });

  it('commits a blank setup draft without a runtime build', async () => {
    const blank: StandardProfileDocument = {
      version: 1,
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };
    const result = await resolveProfileCandidate(
      { document: blank, policyIntent: {} },
      deps(),
    );
    expect(result.status).toBe('valid');
    expect(result.resolved.credentialBindings).toStrictEqual([]);
    expect(result.resolved.policy).toStrictEqual({
      allowedTools: [],
      disabledTools: [],
      shellMode: 'all',
      approvalCeiling: 'standard',
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([]);
  });

  it('rejects an empty provider with a non-empty model', async () => {
    const result = await resolveProfileCandidate(
      {
        document: standard({ provider: '', model: 'gpt-4o' }),
        policyIntent: {},
      },
      deps({
        catalog: catalog(
          () => ({ status: 'invalid', reason: '' }),
          () => [],
        ),
      }),
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain('provider is required');
  });
});

const memberRepository = (
  document: StandardProfileDocument,
): ProfileRepositoryPort => ({
  load: async () => ({
    document,
    fingerprint: { kind: 'hash', hash: 'member' },
  }),
  save: async () => ({ kind: 'hash', hash: 'saved' }),
  list: async () => [],
  delete: async () => {},
  stat: async () => null,
});

describe('resolveProfileCandidate load balancer documents', () => {
  it.each([
    { provider: '', model: 'gpt-4o' },
    { provider: 'openai', model: '' },
    { provider: '', model: '' },
  ])(
    'rejects unconfigured member %j despite a validating catalog',
    async (fields) => {
      const result = await resolveProfileCandidate(
        { document: lb(['blank']), policyIntent: {} },
        deps({ repository: memberRepository(standard(fields)) }),
      );
      expect(result.status).toStrictEqual('invalid');
      expect(result.errors).toStrictEqual([
        'member blank must configure a provider and model',
      ]);
      expect(result.resolved.credentialBindings).toStrictEqual([]);
      expect(Object.keys(result.memberCaptures ?? {})).toStrictEqual([]);
    },
  );

  it('rejects a load balancer without members', async () => {
    const result = await resolveProfileCandidate(
      { document: lb([]), policyIntent: {} },
      deps(),
    );
    expect(result.status).toStrictEqual('invalid');
    expect(result.errors).toStrictEqual([
      'load balancer must include at least one member',
    ]);
    expect(result.resolved.credentialBindings).toStrictEqual([]);
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'resolves own member %s without prototype pollution',
    async (name) => {
      const member = standard();
      const result = await resolveProfileCandidate(
        { document: lb([name]), policyIntent: {} },
        deps({ repository: memberRepository(member) }),
      );
      expect(result.status).toStrictEqual('valid');
      expect(result.errors).toStrictEqual([]);
      expect(Object.keys(result.resolved.memberDocuments ?? {})).toStrictEqual([
        name,
      ]);
      expect(Object.keys(result.memberCaptures ?? {})).toStrictEqual([name]);
      expect(result.resolved.memberDocuments?.[name]).toStrictEqual(member);
      expect(result.memberCaptures?.[name]).toStrictEqual({
        revision: 0,
        provider: 'openai',
        sourceDocument: member,
        models: [],
      });
      expect(result.resolved.credentialBindings).toStrictEqual([
        { kind: 'provider-default', provider: 'openai' },
      ]);
      expect(
        Object.getPrototypeOf(result.resolved.memberDocuments),
      ).toStrictEqual(null);
      expect(Object.getPrototypeOf(result.memberCaptures)).toStrictEqual(null);
    },
  );

  it.each(['__proto__', 'constructor', 'toString'])(
    'rejects unavailable member %s without reading inherited properties',
    async (name) => {
      const result = await resolveProfileCandidate(
        { document: lb([name]), policyIntent: {} },
        deps(),
      );
      expect(result.status).toStrictEqual('invalid');
      expect(result.errors).toStrictEqual([
        `member ${name} could not be loaded`,
      ]);
      expect(result.resolved.credentialBindings).toStrictEqual([]);
    },
  );

  it.each(['standard', 'loadbalancer'])(
    'reports rejected model support as unverified for %s',
    async (kind) => {
      const rejectingCatalog: ProviderModelCatalogPort = {
        ...catalog(
          () => ({ status: 'valid' }),
          () => [],
        ),
        validateModelSupport: async () => {
          throw new Error('catalog offline');
        },
      };
      const result = await resolveProfileCandidate(
        {
          document: kind === 'standard' ? standard() : lb(['alpha']),
          policyIntent: {},
        },
        deps({
          catalog: rejectingCatalog,
          repository: memberRepository(standard()),
        }),
      );
      expect(result.status).toStrictEqual('unverified');
      expect(result.errors).toStrictEqual([]);
      expect(result.unverifiedConstraints).toStrictEqual([
        'model support unavailable for provider openai',
      ]);
    },
  );

  it('resolves members with distinct per-member bindings and unmutated document', async () => {
    const document = lb(['alpha', 'beta']);
    const alpha = standard({
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: { 'auth-key-name': 'OPENAI_KEY' },
    });
    const beta = standard({
      provider: 'anthropic',
      model: 'claude-3',
      modelParams: {},
      ephemeralSettings: { 'auth-key-name': 'ANTHROPIC_KEY' },
    });
    const listModels = (provider: string): string[] =>
      provider === 'openai' ? ['gpt-4o'] : ['claude-3'];
    const repo: ProfileRepositoryPort = {
      load: async (name: string) => {
        if (name === 'alpha') {
          return { document: alpha, fingerprint: { kind: 'hash', hash: 'x' } };
        }
        return { document: beta, fingerprint: { kind: 'hash', hash: 'y' } };
      },
      save: async () => ({ kind: 'hash', hash: 'z' }),
      list: async () => [{ name: 'alpha' }, { name: 'beta' }],
      delete: async () => {},
      stat: async () => ({ kind: 'hash', hash: 'z' }),
    };
    const result = await resolveProfileCandidate(
      { document, policyIntent: {} },
      deps({
        repository: repo,
        catalog: catalog(() => ({ status: 'valid' }), listModels),
      }),
    );
    expect(result.status).toBe('valid');
    expect(result.errors).toStrictEqual([]);
    const alphaCapture = result.memberCaptures?.['alpha'];
    const betaCapture = result.memberCaptures?.['beta'];
    expect(alphaCapture?.provider).toBe('openai');
    expect(betaCapture?.provider).toBe('anthropic');
    expect(alphaCapture?.models).toStrictEqual(['gpt-4o']);
    expect(betaCapture?.models).toStrictEqual(['claude-3']);
    expect(result.resolved.credentialBindings).toStrictEqual([
      { kind: 'key-name', keyName: 'OPENAI_KEY' },
      { kind: 'key-name', keyName: 'ANTHROPIC_KEY' },
    ]);
    expect(result.resolved.document).toBe(document);
  });

  it('rejects a load balancer with a missing member', async () => {
    const repo: ProfileRepositoryPort = {
      load: async () => {
        throw new Error('not found');
      },
      save: async () => ({ kind: 'hash', hash: 'z' }),
      list: async () => [],
      delete: async () => {},
      stat: async () => null,
    };
    const result = await resolveProfileCandidate(
      { document: lb(['ghost']), policyIntent: {} },
      deps({ repository: repo }),
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain('member ghost could not be loaded');
  });

  it('rejects a load-balancer member that is itself a load balancer', async () => {
    const nested = lb(['deep']);
    const repo: ProfileRepositoryPort = {
      load: async () => ({
        document: nested,
        fingerprint: { kind: 'hash', hash: 'w' },
      }),
      save: async () => ({ kind: 'hash', hash: 'z' }),
      list: async () => [],
      delete: async () => {},
      stat: async () => null,
    };
    const result = await resolveProfileCandidate(
      { document: lb(['nested']), policyIntent: {} },
      deps({ repository: repo }),
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain('member nested must be a standard profile');
  });

  it('hard-fails when members cannot be loaded without a repository', async () => {
    const result = await resolveProfileCandidate(
      { document: lb(['alpha']), policyIntent: {} },
      deps({ repository: undefined }),
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain('member alpha could not be loaded');
  });

  it('marks an unsupported member model invalid', async () => {
    const alpha = standard();
    const repo: ProfileRepositoryPort = {
      load: async () => ({
        document: alpha,
        fingerprint: { kind: 'hash', hash: 'x' },
      }),
      save: async () => ({ kind: 'hash', hash: 'z' }),
      list: async () => [],
      delete: async () => {},
      stat: async () => null,
    };
    const result = await resolveProfileCandidate(
      { document: lb(['alpha']), policyIntent: {} },
      deps({
        repository: repo,
        catalog: catalog(
          () => ({ status: 'invalid', reason: '' }),
          () => [],
        ),
      }),
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain(
      'model gpt-4o is not supported by provider openai',
    );
  });

  it('treats an unknown member model as unverified but not invalid', async () => {
    const alpha = standard();
    const repo: ProfileRepositoryPort = {
      load: async () => ({
        document: alpha,
        fingerprint: { kind: 'hash', hash: 'x' },
      }),
      save: async () => ({ kind: 'hash', hash: 'z' }),
      list: async () => [],
      delete: async () => {},
      stat: async () => null,
    };
    const result = await resolveProfileCandidate(
      { document: lb(['alpha']), policyIntent: {} },
      deps({
        repository: repo,
        catalog: catalog(
          (p) => ({ status: p === 'openai' ? 'unknown' : 'valid' }),
          () => {
            throw new Error('menu down');
          },
        ),
      }),
    );
    expect(result.status).toBe('unverified');
    expect(result.unverifiedConstraints).toContain(
      'model support unknown for provider openai',
    );
  });

  it('rejects a policy required tool that the trust disallows', async () => {
    const document = standard();
    const strictTrust = {
      ...trust,
      isToolAvailable: () => false,
    };
    const strictCatalog = catalog(
      () => ({ status: 'valid' }),
      () => [],
    );
    const result = await resolveProfileCandidate(
      {
        document,
        policyIntent: { allowedTools: ['tool-a'], requiredTools: ['tool-a'] },
      },
      {
        ...deps(),
        catalog: strictCatalog,
        trust: strictTrust,
        session: { allowedTools: ['tool-a'] },
      },
    );
    expect(result.status).toBe('invalid');
    expect(result.errors).toContain(
      'required tool tool-a is not effectively allowed',
    );
  });
});
