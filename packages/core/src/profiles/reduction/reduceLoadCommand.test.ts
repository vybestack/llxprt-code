/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceLoadCommand, buildLoadCandidate } from './reduceLoadCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type {
  CapturedStandardSource,
  SourceFingerprint,
} from '../contracts/profileState.js';
import type { LoadBalancerProfileDocument } from '../contracts/profileDocument.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';

const stat: SourceFingerprint = {
  kind: 'stat',
  mtimeMs: 1_700_000_000_000,
  size: 1024,
};

const savedState = (revision: number): ConfiguredProfile => ({
  status: 'configured',
  revision,
  identity: { kind: 'saved', name: 'work', source: { ...stat } },
  document: {
    version: 1,
    type: 'standard',
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: {},
    ephemeralSettings: {},
  },
});

const draftState = (revision: number): ConfiguredProfile => ({
  status: 'configured',
  revision,
  identity: { kind: 'draft' },
  document: {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: {},
    ephemeralSettings: {},
  },
});

const lbDoc: LoadBalancerProfileDocument = {
  version: 1,
  type: 'loadbalancer',
  policy: 'roundrobin' as const,
  profiles: ['alpha'],
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: { temperature: 0.2 },
  ephemeralSettings: { 'base-url': 'https://api.example.com' },
};

const memberCapture = (): CapturedStandardSource => ({
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
});

describe('reduceLoadCommand', () => {
  it('rejects an empty load balancer even with a capture named undefined', () => {
    expect(
      reduceLoadCommand(
        savedState(3),
        { kind: 'load', name: 'empty', expectedRevision: 3 },
        {
          ...emptyReductionEnvironment(),
          repository: {
            empty: { document: { ...lbDoc, profiles: [] }, fingerprint: stat },
          },
          memberCaptures: { undefined: memberCapture() },
        },
      ),
    ).toStrictEqual({
      kind: 'invalid',
      errors: ['load balancer has no members'],
      revision: 3,
    });
  });

  it('is invalid for an unknown profile', () => {
    const outcome = reduceLoadCommand(
      savedState(3),
      { kind: 'load', name: 'missing', expectedRevision: 3 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown profile'],
      revision: 3,
    });
  });

  it('asks confirmation for a draft without discardUnsaved', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      repository: {
        prod: {
          document: lbDoc,
          fingerprint: { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 512 },
        },
      },
    };
    const outcome = reduceLoadCommand(
      draftState(2),
      { kind: 'load', name: 'prod', expectedRevision: 2 },
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'confirmation-required',
      pending: {
        token: 'discard:load:prod',
        commandKind: 'load',
        description:
          'Loading profile prod will discard unsaved changes to the working profile',
      },
      revision: 2,
    });
  });

  it('loads without confirmation on a configured draft with discardUnsaved', () => {
    const env: ProfileReductionEnvironment = {
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
    };
    const outcome = reduceLoadCommand(
      draftState(2),
      { kind: 'load', name: 'prod', discardUnsaved: true, expectedRevision: 2 },
      env,
    );
    expect(outcome.kind).toBe('candidate');
  });

  it('loads without confirmation on a configured saved identity', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      repository: {
        prod: {
          document: {
            version: 1,
            provider: 'anthropic',
            model: 'claude-3-7-sonnet',
            modelParams: {},
            ephemeralSettings: {},
          },
          fingerprint: { kind: 'hash', hash: 'abc123' },
        },
      },
    };
    const outcome = reduceLoadCommand(
      savedState(1),
      { kind: 'load', name: 'prod', expectedRevision: 1 },
      env,
    );
    expect(outcome.kind).toBe('candidate');
  });

  it('builds a candidate with saved identity and activeMember from first member when captured', () => {
    const env: ProfileReductionEnvironment = {
      ...emptyReductionEnvironment(),
      repository: {
        prod: {
          document: lbDoc,
          fingerprint: { kind: 'hash', hash: 'abc123' },
        },
      },
      memberCaptures: { alpha: memberCapture() },
    };
    const outcome = buildLoadCandidate(draftState(2), 'prod', env);
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: lbDoc,
      identity: {
        kind: 'saved',
        name: 'prod',
        source: { kind: 'hash', hash: 'abc123' },
      },
      activeMember: memberCapture(),
      baseRevision: 2,
      nextRevision: 3,
    });
  });
});

describe('load environment map safety', () => {
  it.each(['__proto__', 'toString'])('rejects inherited profile %s', (name) => {
    expect(
      reduceLoadCommand(
        savedState(3),
        { kind: 'load', name, expectedRevision: 3 },
        emptyReductionEnvironment(),
      ),
    ).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown profile'],
      revision: 3,
    });
    expect(
      buildLoadCandidate(savedState(3), name, emptyReductionEnvironment()),
    ).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown profile'],
      revision: 3,
    });
  });

  it('does not capture an inherited first member', () => {
    const document: LoadBalancerProfileDocument = {
      ...lbDoc,
      profiles: ['toString'],
    };
    expect(
      buildLoadCandidate(savedState(3), 'prod', {
        ...emptyReductionEnvironment(),
        repository: { prod: { document, fingerprint: stat } },
      }),
    ).toStrictEqual({
      kind: 'candidate',
      document,
      identity: { kind: 'saved', name: 'prod', source: stat },
      activeMember: undefined,
      baseRevision: 3,
      nextRevision: 4,
    });
  });
});
