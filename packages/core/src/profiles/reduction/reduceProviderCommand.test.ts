/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceProviderCommand } from './reduceProviderCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';
import type { WorkingProfileIdentity } from '../contracts/profileState.js';

const revision = 5;

const identity = (): WorkingProfileIdentity => ({
  kind: 'saved',
  name: 'work',
  source: { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 1024 },
});

const anthropicTemplate = {
  version: 1,
  type: 'standard',
  provider: 'anthropic',
  model: 'claude-3-7-sonnet',
  modelParams: {},
  ephemeralSettings: { 'auth-key-name': 'creds' },
} as const;

const openaiState = (): ConfiguredProfile => ({
  status: 'configured',
  revision,
  identity: identity(),
  document: {
    version: 1,
    type: 'standard',
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.9 },
    ephemeralSettings: { 'auth-key': 'sk-current' },
    auth: { type: 'apikey' },
  },
});

const envWith = (
  overrides: Partial<ProfileReductionEnvironment> = {},
): ProfileReductionEnvironment => ({
  ...emptyReductionEnvironment(),
  ...overrides,
});

describe('reduceProviderCommand', () => {
  it.each([undefined, false])(
    'protects a draft with discardUnsaved=%s',
    (discardUnsaved) => {
      expect(
        reduceProviderCommand(
          { ...openaiState(), identity: { kind: 'draft' } },
          {
            kind: 'provider',
            provider: 'anthropic',
            discardUnsaved,
            expectedRevision: revision,
          },
          envWith({ providerTemplates: { anthropic: anthropicTemplate } }),
        ),
      ).toStrictEqual({
        kind: 'confirmation-required',
        pending: {
          token: 'discard:provider',
          commandKind: 'provider',
          description:
            'Changing provider will discard unsaved changes to the working profile',
        },
        revision,
      });
    },
  );

  it('replaces a draft when discardUnsaved is true', () => {
    expect(
      reduceProviderCommand(
        { ...openaiState(), identity: { kind: 'draft' } },
        {
          kind: 'provider',
          provider: 'anthropic',
          discardUnsaved: true,
          expectedRevision: revision,
        },
        envWith({ providerTemplates: { anthropic: anthropicTemplate } }),
      ),
    ).toStrictEqual({
      kind: 'candidate',
      document: anthropicTemplate,
      identity: { kind: 'draft' },
      baseRevision: revision,
      nextRevision: revision + 1,
    });
  });

  it('produces a candidate equal to the template with a bare draft identity', () => {
    const anthropicState = {
      ...openaiState(),
      document: { ...anthropicTemplate },
    };
    const outcome = reduceProviderCommand(
      openaiState(),
      { kind: 'provider', provider: 'anthropic', expectedRevision: revision },
      envWith({ providerTemplates: { anthropic: anthropicState.document } }),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: { ...anthropicTemplate },
      identity: { kind: 'draft' },
      baseRevision: revision,
      nextRevision: revision + 1,
    });
  });

  it('resets to the template even when the provider is unchanged', () => {
    const openaiTemplate = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    } as const;
    const outcome = reduceProviderCommand(
      openaiState(),
      { kind: 'provider', provider: 'openai', expectedRevision: revision },
      envWith({ providerTemplates: { openai: { ...openaiTemplate } } }),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: { ...openaiTemplate },
      identity: { kind: 'draft' },
      baseRevision: revision,
      nextRevision: revision + 1,
    });
  });

  it('is invalid for an unknown provider', () => {
    const outcome = reduceProviderCommand(
      openaiState(),
      { kind: 'provider', provider: 'nonexistent', expectedRevision: revision },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown provider template'],
      revision,
    });
  });
});

describe('provider environment map safety', () => {
  it.each(['__proto__', 'toString'])(
    'rejects inherited provider template %s',
    (provider) => {
      expect(
        reduceProviderCommand(
          openaiState(),
          { kind: 'provider', provider, expectedRevision: revision },
          emptyReductionEnvironment(),
        ),
      ).toStrictEqual({
        kind: 'invalid',
        errors: ['unknown provider template'],
        revision,
      });
    },
  );
});
