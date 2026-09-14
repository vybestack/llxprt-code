/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceSetCommand } from './reduceSetCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { CapturedStandardSource } from '../contracts/profileState.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';

const setCommand = (
  patch: Record<string, unknown>,
): Extract<ProfileCommand, { kind: 'set' }> => ({
  kind: 'set',
  patch,
  expectedRevision: 2,
});

const auth = (): CapturedStandardSource => ({
  revision: 1,
  provider: 'openai',
  sourceDocument: {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.2 },
    ephemeralSettings: { 'base-url': 'https://api.example.com' },
  },
  models: ['gpt-4o'],
});

const state = (): ConfiguredProfile => ({
  status: 'configured',
  revision: 2,
  identity: { kind: 'draft' },
  document: {
    version: 1,
    type: 'standard',
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: { temperature: 0.2 },
    ephemeralSettings: {
      temperature: 0.2,
      'base-url': 'https://api.example.com',
    },
  },
});

const lbState = (): ConfiguredProfile => ({
  status: 'configured',
  revision: 2,
  identity: { kind: 'draft' },
  activeMember: auth(),
  document: {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles: ['alpha'],
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: { temperature: 0.7 },
  },
});

describe('reduceSetCommand', () => {
  it('rejects every application-owned key with settings guidance', () => {
    const env = {
      ...emptyReductionEnvironment(),
      isApplicationOwnedKey: (key: string) => key === 'temperature',
    };
    const outcome = reduceSetCommand(
      state(),
      setCommand({ temperature: 0.9, 'base-url': 'u' }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: [
        'key temperature is application-owned; configure it via /settings',
      ],
      revision: 2,
    });
  });

  it('reports every owned key when several are owned', () => {
    const env = {
      ...emptyReductionEnvironment(),
      isApplicationOwnedKey: (key: string) =>
        key === 'temperature' || key === 'context-length',
    };
    const outcome = reduceSetCommand(
      state(),
      setCommand({ temperature: 1.0, 'context-length': 5 }),
      env,
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: [
        'key context-length is application-owned; configure it via /settings',
        'key temperature is application-owned; configure it via /settings',
      ],
      revision: 2,
    });
  });

  it('sets a key and derives a draft identity', () => {
    const outcome = reduceSetCommand(
      state(),
      setCommand({ 'base-url': 'https://new.example.com' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: { temperature: 0.2 },
        ephemeralSettings: {
          temperature: 0.2,
          'base-url': 'https://new.example.com',
        },
      },
      identity: { kind: 'draft' },
      baseRevision: 2,
      nextRevision: 3,
    });
  });

  it('deletes a key when value is null', () => {
    const outcome = reduceSetCommand(
      state(),
      setCommand({ temperature: null }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: { temperature: 0.2 },
        ephemeralSettings: { 'base-url': 'https://api.example.com' },
      },
      identity: { kind: 'draft' },
      baseRevision: 2,
      nextRevision: 3,
    });
  });

  it('is a no-op when the patch changes nothing', () => {
    const outcome = reduceSetCommand(
      state(),
      setCommand({ temperature: 0.2 }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'no-op',
      reason: 'patch changes nothing',
      revision: 2,
    });
  });

  it('preserves the active member on a load balancer', () => {
    const outcome = reduceSetCommand(
      lbState(),
      setCommand({ shellMode: 'strict' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['alpha'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: { temperature: 0.7, shellMode: 'strict' },
      },
      identity: { kind: 'draft' },
      activeMember: auth(),
      baseRevision: 2,
      nextRevision: 3,
    });
  });

  it('carries no active member on a standard document', () => {
    const outcome = reduceSetCommand(
      state(),
      setCommand({ 'base-url': 'x' }),
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: { temperature: 0.2 },
        ephemeralSettings: {
          'base-url': 'x',
          temperature: 0.2,
        },
      },
      identity: { kind: 'draft' },
      baseRevision: 2,
      nextRevision: 3,
    });
  });
});

describe('set unsafe keys', () => {
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects %s without changing settings or their prototype',
    (key) => {
      const original = state();
      const env = emptyReductionEnvironment();
      for (const value of ['x', { polluted: true }]) {
        expect(
          reduceSetCommand(original, setCommand({ [key]: value }), env),
        ).toStrictEqual({
          kind: 'invalid',
          errors: [`unsafe setting key ${key}`],
          revision: 2,
        });
      }
      const valid = reduceSetCommand(
        original,
        setCommand({ temperature: 0.9 }),
        env,
      );
      if (valid.kind !== 'candidate') {
        throw new Error('expected a valid settings candidate');
      }
      expect(valid.document.ephemeralSettings).toStrictEqual({
        temperature: 0.9,
        'base-url': 'https://api.example.com',
      });
      expect(
        Object.getPrototypeOf(valid.document.ephemeralSettings),
      ).toStrictEqual(Object.prototype);
      expect(original).toStrictEqual(state());
      expect(
        Object.getPrototypeOf(original.document.ephemeralSettings),
      ).toStrictEqual(Object.prototype);
    },
  );
});
