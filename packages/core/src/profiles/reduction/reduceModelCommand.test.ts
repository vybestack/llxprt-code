/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceModelCommand } from './reduceModelCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';
import type { ProfileCommand } from '../contracts/profileCommands.js';
import type {
  CapturedStandardSource,
  WorkingProfileIdentity,
} from '../contracts/profileState.js';
import {
  isStandardProfileDocument,
  type ProfileDocument,
  type ProfileAuthConfig,
  type StandardProfileDocument,
} from '../contracts/profileDocument.js';

const revision = 7;

const modelParams = { temperature: 0.7 };
const ephemeralSettings = { 'auth-key': 'sk-abc' };
const auth: ProfileAuthConfig = { type: 'oauth', buckets: ['bucket-a'] };

const standardDoc = (): StandardProfileDocument => ({
  version: 1,
  type: 'standard',
  provider: 'anthropic',
  model: 'claude-3-7-sonnet',
  modelParams,
  ephemeralSettings,
  auth,
});

const identity = (): Extract<WorkingProfileIdentity, { kind: 'saved' }> => ({
  kind: 'saved',
  name: 'work',
  source: { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 1024 },
});

const standardState = (): ConfiguredProfile => ({
  status: 'configured',
  revision,
  identity: identity(),
  document: standardDoc(),
});

const memberCapture = (
  provider: string,
  models: readonly string[],
): CapturedStandardSource => ({
  revision: 7,
  provider,
  sourceDocument: {
    version: 1,
    provider,
    model: models[0] || 'm1',
    modelParams: {},
    ephemeralSettings: {},
  },
  models,
});

const lbDoc = (): ProfileDocument => ({
  version: 1,
  type: 'loadbalancer',
  policy: 'roundrobin',
  profiles: ['alpha', 'beta'],
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: {},
  ephemeralSettings: {},
});

const lbState = (): ConfiguredProfile => ({
  status: 'configured',
  revision,
  identity: identity(),
  document: lbDoc(),
  activeMember: memberCapture('openai', ['gpt-4o', 'gpt-4o-mini']),
});

const modelCommand = (
  overrides: { model?: string; member?: string } = {},
): Extract<ProfileCommand, { kind: 'model' }> => ({
  kind: 'model',
  model: overrides.model ?? 'claude-3-7-sonnet',
  expectedRevision: revision,
  ...(overrides.member === undefined ? {} : { member: overrides.member }),
});

describe('reduceModelCommand standard document', () => {
  it('is a no-op when the model is unchanged', () => {
    const outcome = reduceModelCommand(
      standardState(),
      modelCommand({ model: 'claude-3-7-sonnet' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'no-op',
      reason: 'model unchanged',
      revision,
    });
  });

  it('produces a candidate clone with the new model, draft identity, and no active member', () => {
    const outcome = reduceModelCommand(
      standardState(),
      modelCommand({ model: 'claude-3-5-haiku' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: { ...standardDoc(), model: 'claude-3-5-haiku' },
      identity: {
        kind: 'draft',
        derivedFrom: { name: 'work', source: identity().source },
      },
      baseRevision: revision,
      nextRevision: revision + 1,
    });
  });

  it('copies pinned modelParams, ephemeralSettings, and auth by reference', () => {
    const outcome = reduceModelCommand(
      standardState(),
      modelCommand({ model: 'claude-3-5-haiku' }),
      emptyReductionEnvironment(),
    );
    expect(outcome.kind).toBe('candidate');
    if (outcome.kind !== 'candidate') {
      return;
    }
    if (!isStandardProfileDocument(outcome.document)) {
      throw new Error('expected a standard document');
    }
    expect(outcome.document.modelParams).toBe(modelParams);
    expect(outcome.document.ephemeralSettings).toBe(ephemeralSettings);
    expect(outcome.document.auth).toBe(auth);
  });

  it('never reads a provider template', () => {
    const divergentEnv: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      providerTemplates: {
        anthropic: {
          version: 1,
          provider: 'anthropic',
          model: 'would-be-used-if-read',
          modelParams: { temperature: 9.9 },
          ephemeralSettings: { 'auth-key': 'from-template' },
        },
      },
    };
    const outcome = reduceModelCommand(
      standardState(),
      modelCommand({ model: 'claude-3-5-haiku' }),
      divergentEnv,
    );
    expect(outcome.kind).toBe('candidate');
    if (outcome.kind !== 'candidate') {
      return;
    }
    if (!isStandardProfileDocument(outcome.document)) {
      throw new Error('expected a standard document');
    }
    expect(outcome.document.modelParams).toBe(modelParams);
    expect(outcome.document.ephemeralSettings).toBe(ephemeralSettings);
    expect(outcome.document.auth).toBe(auth);
  });
});

describe('reduceModelCommand load balancer document', () => {
  it('rejects a captured member belonging to a different load balancer', () => {
    expect(
      reduceModelCommand(
        lbState(),
        modelCommand({ model: 'gpt-4o-mini', member: 'other-lb-member' }),
        {
          ...emptyReductionEnvironment(),
          memberCaptures: {
            'other-lb-member': memberCapture('openai', ['gpt-4o-mini']),
          },
        },
      ),
    ).toStrictEqual({ kind: 'invalid', errors: ['unknown member'], revision });
  });

  it('reports an unavailable member model menu as unverified', () => {
    const outcome = reduceModelCommand(
      { ...lbState(), activeMember: memberCapture('openai', []) },
      modelCommand({ model: 'gpt-4o-mini' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'unverified',
      constraints: ['model menu unavailable for provider openai'],
      revision,
    });
  });

  it('forks the active member source into a standard candidate with the patched model', () => {
    const source = memberCapture('openai', [
      'gpt-4o',
      'gpt-4o-mini',
    ]).sourceDocument;
    const outcome = reduceModelCommand(
      lbState(),
      modelCommand({ model: 'gpt-4o-mini' }),
      emptyReductionEnvironment(),
    );
    expect(outcome.kind).toBe('candidate');
    if (outcome.kind !== 'candidate') {
      return;
    }
    expect(outcome.document).toStrictEqual({
      ...source,
      model: 'gpt-4o-mini',
    });
    expect(outcome.document).not.toHaveProperty('type');
    expect(outcome.identity).toStrictEqual({
      kind: 'draft',
      derivedFrom: { name: 'work', source: identity().source },
    });
    expect(outcome.activeMember).toBeUndefined();
    expect(outcome.baseRevision).toBe(revision);
    expect(outcome.nextRevision).toBe(revision + 1);
  });

  it('uses command.member over the active member when offered', () => {
    const member = memberCapture('openai', ['gpt-4o', 'gpt-4o-mini']);
    const env = {
      ...emptyReductionEnvironment(),
      memberCaptures: { alpha: member },
    };
    const outcome = reduceModelCommand(
      lbState(),
      modelCommand({ model: 'gpt-4o-mini', member: 'alpha' }),
      env,
    );
    expect(outcome.kind).toBe('candidate');
    if (outcome.kind !== 'candidate') {
      return;
    }
    expect(outcome.document).toStrictEqual({
      ...member.sourceDocument,
      model: 'gpt-4o-mini',
    });
  });

  it.each(['missing', '__proto__', 'toString'])(
    'is invalid when member %s is not an own capture',
    (member) => {
      const outcome = reduceModelCommand(
        lbState(),
        modelCommand({ model: 'gpt-4o-mini', member }),
        emptyReductionEnvironment(),
      );
      expect(outcome).toStrictEqual({
        kind: 'invalid',
        errors: ['unknown member'],
        revision,
      });
    },
  );

  it('is invalid when neither an active member nor command.member is available', () => {
    const stateWithoutMember: ConfiguredProfile = {
      status: 'configured',
      revision,
      identity: identity(),
      document: lbDoc(),
    };
    const outcome = reduceModelCommand(
      stateWithoutMember,
      modelCommand({}),
      emptyReductionEnvironment(),
    );
    expect(outcome.kind).toBe('invalid');
  });

  it('is invalid when the model is not in the member menu', () => {
    const outcome = reduceModelCommand(
      lbState(),
      modelCommand({ model: 'claude-3-7-sonnet' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['model not offered by member provider'],
      revision,
    });
  });
});
