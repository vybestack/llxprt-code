/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceStartupCommand } from './reduceStartupCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type {
  CapturedStandardSource,
  ProfileState,
} from '../contracts/profileState.js';
import type { ProfileCommand } from '../contracts/profileCommands.js';

const profileState = (): ProfileState => ({
  status: 'configured',
  revision: 2,
  identity: { kind: 'draft' },
  document: {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.2 },
    ephemeralSettings: { 'base-url': 'https://api.example.com' },
  },
});

const startup = (
  overrides: Partial<Extract<ProfileCommand, { kind: 'startup' }>> = {},
): Extract<ProfileCommand, { kind: 'startup' }> => ({
  kind: 'startup',
  ...overrides,
  expectedRevision: overrides.expectedRevision ?? 0,
});

const envStandard = {
  ...emptyReductionEnvironment(),
  repository: {
    prod: {
      document: {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        modelParams: {},
        ephemeralSettings: {},
      },
      fingerprint: { kind: 'hash', hash: 'abc123' },
    },
  },
} satisfies ProfileReductionEnvironment;

const alpha: CapturedStandardSource = {
  revision: 3,
  provider: 'openai',
  sourceDocument: {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.2 },
    ephemeralSettings: { 'base-url': 'https://api.example.com' },
  },
  models: ['gpt-4o', 'gpt-4o-mini'],
};

const lbEnv: ProfileReductionEnvironment = {
  ...emptyReductionEnvironment(),
  repository: {
    lb: {
      document: {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['alpha'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      },
      fingerprint: { kind: 'hash', hash: 'lb123' },
    },
  },
  memberCaptures: { alpha },
};

describe('reduceStartupCommand validation', () => {
  it('is invalid with none of profile, provider, or model', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({}),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['startup requires a profile, provider, or model'],
      revision: 0,
    });
  });

  it('is invalid with both provider and profile', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'prod', provider: 'anthropic' }),
      envStandard,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['startup cannot specify both provider and profile'],
      revision: 0,
    });
  });

  it('is invalid with a model needing a profile or provider', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ model: 'claude-3-7-sonnet' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['startup model requires a profile or provider'],
      revision: 0,
    });
  });

  it('is invalid with a load-balancer profile and model without a member', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'lb', model: 'gpt-4o' }),
      lbEnv,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: [
        'startup with a load-balancer profile and model requires an explicit member',
      ],
      revision: 0,
    });
  });

  it('is invalid with a load-balancer profile, model, but an unknown member', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'lb', model: 'gpt-4o', member: 'beta' }),
      lbEnv,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown member'],
      revision: 0,
    });
  });

  it('is invalid when the model is missing from the member menu', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'lb', model: 'not-in-menu', member: 'alpha' }),
      lbEnv,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['model must be in the member menu'],
      revision: 0,
    });
  });

  it('forks an explicit captured member into a standard candidate with the model', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'lb', model: 'gpt-4o', member: 'alpha' }),
      lbEnv,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: { temperature: 0.2 },
        ephemeralSettings: { 'base-url': 'https://api.example.com' },
      },
      identity: { kind: 'draft' },
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('starts a standard profile loading a repository document', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'prod' }),
      envStandard,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        modelParams: {},
        ephemeralSettings: {},
      },
      identity: {
        kind: 'saved',
        name: 'prod',
        source: { kind: 'hash', hash: 'abc123' },
      },
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('starts a configured state and loads with confirmation on a draft', () => {
    const outcome = reduceStartupCommand(
      profileState(),
      startup({ profileName: 'prod' }),
      envStandard,
    );
    expect(outcome).toStrictEqual({
      kind: 'confirmation-required',
      pending: {
        token: 'discard:startup:prod',
        commandKind: 'startup',
        description:
          'Loading profile prod will discard unsaved changes to the working profile',
      },
      revision: 2,
    });
  });

  it('applies a model on a loaded standard document', () => {
    const state: ProfileState = {
      status: 'configured',
      revision: 1,
      identity: {
        kind: 'saved',
        name: 'prod',
        source: { kind: 'hash', hash: 'abc123' },
      },
      document: {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: { temperature: 0.2 },
        ephemeralSettings: { 'base-url': 'https://api.example.com' },
      },
    };
    const outcome = reduceStartupCommand(
      state,
      startup({
        profileName: 'prod',
        model: 'claude-3-5-haiku',
        expectedRevision: 1,
      }),
      envStandard,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        ...envStandard.repository.prod.document,
        model: 'claude-3-5-haiku',
      },
      identity: {
        kind: 'draft',
        derivedFrom: {
          name: 'prod',
          source: envStandard.repository.prod.fingerprint,
        },
      },
      baseRevision: 1,
      nextRevision: 2,
    });
  });

  it('starts by provider name as a provider reset', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      providerTemplates: {
        anthropic: {
          version: 1,
          type: 'standard',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          modelParams: {},
          ephemeralSettings: {},
        },
      },
    };
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ provider: 'anthropic' }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        modelParams: {},
        ephemeralSettings: {},
      },
      identity: { kind: 'draft' },
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('applies an explicit model on top of the provider template', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      providerTemplates: {
        anthropic: {
          version: 1,
          type: 'standard',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          modelParams: { temperature: 0.4 },
          ephemeralSettings: { 'auth-key-name': 'creds' },
        },
      },
      providerModelMenus: {
        anthropic: ['claude-3-7-sonnet', 'claude-3-5-haiku'],
      },
    };
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ provider: 'anthropic', model: 'claude-3-5-haiku' }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-5-haiku',
        modelParams: { temperature: 0.4 },
        ephemeralSettings: { 'auth-key-name': 'creds' },
      },
      identity: { kind: 'draft' },
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('is invalid when a composed model is outside the provider menu', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      providerTemplates: {
        anthropic: {
          version: 1,
          type: 'standard',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          modelParams: {},
          ephemeralSettings: {},
        },
      },
      providerModelMenus: {
        anthropic: ['claude-3-7-sonnet', 'claude-3-5-haiku'],
      },
    };
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ provider: 'anthropic', model: 'gpt-4o' }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['model must be in the provider menu'],
      revision: 0,
    });
  });

  it('keeps a composed model unverified when no provider menu is captured', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      providerTemplates: {
        anthropic: {
          version: 1,
          type: 'standard',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          modelParams: {},
          ephemeralSettings: {},
        },
      },
    };
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ provider: 'anthropic', model: 'gpt-4o' }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
      },
      identity: { kind: 'draft' },
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('is invalid for a named profile the repository does not have', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'missing' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown profile missing'],
      revision: 0,
    });
  });

  it('is invalid for a missing profile even with a model', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ profileName: 'missing', model: 'gpt-4o' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown profile missing'],
      revision: 0,
    });
  });

  it('advances the revision from a configured state on a provider startup', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      providerTemplates: {
        anthropic: {
          version: 1,
          type: 'standard',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          modelParams: {},
          ephemeralSettings: {},
        },
      },
    };
    const state: ProfileState = {
      status: 'configured',
      revision: 7,
      identity: {
        kind: 'saved',
        name: 'work',
        source: { kind: 'hash', hash: 'abc123' },
      },
      document: {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
      },
    };
    const outcome = reduceStartupCommand(
      state,
      startup({ provider: 'anthropic', expectedRevision: 7 }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        modelParams: {},
        ephemeralSettings: {},
      },
      identity: { kind: 'draft' },
      baseRevision: 7,
      nextRevision: 8,
    });
  });
});

describe('startup replacement safety', () => {
  it.each([undefined, false])(
    'protects drafts on provider startup with discardUnsaved=%s',
    (discardUnsaved) => {
      expect(
        reduceStartupCommand(
          profileState(),
          startup({
            provider: 'anthropic',
            discardUnsaved,
            expectedRevision: 2,
          }),
          {
            ...envStandard,
            providerTemplates: {
              anthropic: envStandard.repository.prod.document,
            },
          },
        ),
      ).toStrictEqual({
        kind: 'confirmation-required',
        pending: {
          token: 'discard:startup-provider:anthropic',
          commandKind: 'startup',
          description:
            'Starting provider anthropic will discard unsaved changes to the working profile',
        },
        revision: 2,
      });
    },
  );

  it('allows an explicitly confirmed provider startup over a draft', () => {
    expect(
      reduceStartupCommand(
        profileState(),
        startup({
          provider: 'anthropic',
          discardUnsaved: true,
          expectedRevision: 2,
        }),
        {
          ...envStandard,
          providerTemplates: {
            anthropic: envStandard.repository.prod.document,
          },
        },
      ),
    ).toStrictEqual({
      kind: 'candidate',
      document: envStandard.repository.prod.document,
      identity: { kind: 'draft' },
      baseRevision: 2,
      nextRevision: 3,
    });
  });

  it('keeps the loaded saved identity when the requested model is unchanged', () => {
    expect(
      reduceStartupCommand(
        { status: 'unconfigured' },
        startup({ profileName: 'prod', model: 'claude-3-7-sonnet' }),
        envStandard,
      ),
    ).toStrictEqual({
      kind: 'candidate',
      document: envStandard.repository.prod.document,
      identity: {
        kind: 'saved',
        name: 'prod',
        source: envStandard.repository.prod.fingerprint,
      },
      activeMember: undefined,
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('reports a member catalog outage as unverified', () => {
    expect(
      reduceStartupCommand(
        { status: 'unconfigured' },
        startup({ profileName: 'lb', model: 'gpt-4o-mini', member: 'alpha' }),
        { ...lbEnv, memberCaptures: { alpha: { ...alpha, models: [] } } },
      ),
    ).toStrictEqual({
      kind: 'unverified',
      constraints: ['model menu unavailable for provider openai'],
      revision: 0,
    });
  });

  it.each(['__proto__', 'toString'])(
    'rejects inherited repository entry %s',
    (profileName) => {
      expect(
        reduceStartupCommand(
          { status: 'unconfigured' },
          startup({ profileName }),
          emptyReductionEnvironment(),
        ),
      ).toStrictEqual({
        kind: 'invalid',
        errors: [`unknown profile ${profileName}`],
        revision: 0,
      });
    },
  );

  it('rejects an inherited member capture even when listed in the target', () => {
    const env: ProfileReductionEnvironment = {
      ...lbEnv,
      repository: {
        lb: {
          ...lbEnv.repository.lb,
          document: {
            ...lbEnv.repository.lb.document,
            type: 'loadbalancer',
            policy: 'roundrobin',
            profiles: ['toString'],
          },
        },
      },
    };
    expect(
      reduceStartupCommand(
        { status: 'unconfigured' },
        startup({ profileName: 'lb', model: 'gpt-4o', member: 'toString' }),
        env,
      ),
    ).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown member'],
      revision: 0,
    });
  });

  it.each([undefined, false])(
    'requires confirmation before applying a model with discardUnsaved=%s',
    (discardUnsaved) => {
      expect(
        reduceStartupCommand(
          profileState(),
          startup({
            profileName: 'prod',
            model: 'claude-3-5-haiku',
            discardUnsaved,
            expectedRevision: 2,
          }),
          envStandard,
        ),
      ).toStrictEqual({
        kind: 'confirmation-required',
        pending: {
          token: 'discard:startup:prod',
          commandKind: 'startup',
          description:
            'Loading profile prod will discard unsaved changes to the working profile',
        },
        revision: 2,
      });
    },
  );

  it.each([undefined, 'claude-3-5-haiku'])(
    'loads over a draft with explicit discard and model=%s',
    (model) => {
      const outcome = reduceStartupCommand(
        profileState(),
        startup({
          profileName: 'prod',
          model,
          discardUnsaved: true,
          expectedRevision: 2,
        }),
        envStandard,
      );
      expect(outcome).toStrictEqual({
        kind: 'candidate',
        document: {
          ...envStandard.repository.prod.document,
          model: model ?? 'claude-3-7-sonnet',
        },
        identity:
          model === undefined
            ? {
                kind: 'saved',
                name: 'prod',
                source: { kind: 'hash', hash: 'abc123' },
              }
            : {
                kind: 'draft',
                derivedFrom: {
                  name: 'prod',
                  source: { kind: 'hash', hash: 'abc123' },
                },
              },
        baseRevision: 2,
        nextRevision: 3,
      });
    },
  );

  it.each(['alpha', 'beta'])(
    'checks member %s against the target load balancer',
    (member) => {
      const beta: CapturedStandardSource = {
        ...alpha,
        sourceDocument: {
          ...alpha.sourceDocument,
          ephemeralSettings: { 'base-url': 'https://beta.example.com' },
        },
      };
      const state: ProfileState = {
        status: 'configured',
        revision: 2,
        identity: {
          kind: 'saved',
          name: 'lbA',
          source: { kind: 'hash', hash: 'lbA' },
        },
        document: lbEnv.repository.lb.document,
        activeMember: alpha,
      };
      const env: ProfileReductionEnvironment = {
        ...lbEnv,
        repository: {
          lbB: {
            document: {
              ...lbEnv.repository.lb.document,
              type: 'loadbalancer',
              policy: 'roundrobin',
              profiles: ['beta'],
            },
            fingerprint: { kind: 'hash', hash: 'lbB' },
          },
        },
        memberCaptures: { alpha, beta },
      };
      const outcome = reduceStartupCommand(
        state,
        startup({
          profileName: 'lbB',
          model: 'gpt-4o-mini',
          member,
          expectedRevision: 2,
        }),
        env,
      );
      expect(outcome).toStrictEqual(
        member === 'alpha'
          ? { kind: 'invalid', errors: ['unknown member'], revision: 2 }
          : {
              kind: 'candidate',
              document: { ...beta.sourceDocument, model: 'gpt-4o-mini' },
              identity: { kind: 'draft' },
              baseRevision: 2,
              nextRevision: 3,
            },
      );
    },
  );

  it('does not use an inherited provider model menu', () => {
    const outcome = reduceStartupCommand(
      { status: 'unconfigured' },
      startup({ provider: 'custom', model: 'custom-model' }),
      {
        ...emptyReductionEnvironment(),
        providerTemplates: {
          custom: {
            version: 1,
            provider: 'toString',
            model: 'default',
            modelParams: {},
            ephemeralSettings: {},
          },
        },
      },
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        provider: 'toString',
        model: 'custom-model',
        modelParams: {},
        ephemeralSettings: {},
      },
      identity: { kind: 'draft' },
      baseRevision: 0,
      nextRevision: 1,
    });
  });
});
