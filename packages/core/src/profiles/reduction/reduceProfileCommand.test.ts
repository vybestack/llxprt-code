/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceProfileCommand } from './reduceProfileCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileState } from '../contracts/profileState.js';
import type { ProfileCommand } from '../contracts/profileCommands.js';

const configured = (revision: number): ProfileState => ({
  status: 'configured',
  revision,
  identity: {
    kind: 'saved',
    name: 'work',
    source: { kind: 'stat', mtimeMs: 1_700_000_000_000, size: 1024 },
  },
  document: {
    version: 1,
    type: 'standard',
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: {},
    ephemeralSettings: {},
  },
});

describe('reduceProfileCommand revision gate', () => {
  it('returns stale when expectedRevision mismatches on configured state', () => {
    const outcome = reduceProfileCommand(
      configured(4),
      { kind: 'model', model: 'gpt-4o', expectedRevision: 3 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'stale',
      expectedRevision: 3,
      currentRevision: 4,
    });
  });

  it('accepts a matching expectedRevision', () => {
    const outcome = reduceProfileCommand(
      configured(4),
      { kind: 'model', model: 'gpt-4o', expectedRevision: 4 },
      emptyReductionEnvironment(),
    );
    expect(outcome.kind).toBe('no-op');
  });
});

describe('reduceProfileCommand on unconfigured state', () => {
  it('returns stale when expectedRevision is nonzero', () => {
    const outcome = reduceProfileCommand(
      { status: 'unconfigured' },
      { kind: 'startup', expectedRevision: 1 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'stale',
      expectedRevision: 1,
      currentRevision: 0,
    });
  });

  it('rejects a non-setup/startup command', () => {
    const outcome = reduceProfileCommand(
      { status: 'unconfigured' },
      { kind: 'model', model: 'gpt-4o', expectedRevision: 0 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['command requires a configured profile'],
      revision: 0,
    });
  });

  it('starts a blank draft from an unconfigured workspace with setup', () => {
    const outcome = reduceProfileCommand(
      { status: 'unconfigured' },
      { kind: 'setup', expectedRevision: 0 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'candidate',
      document: {
        version: 1,
        type: 'standard',
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      },
      identity: { kind: 'draft' },
      baseRevision: 0,
      nextRevision: 1,
    });
  });

  it('rejects a blank unconfigured startup with the one-of error', () => {
    const outcome = reduceProfileCommand(
      { status: 'unconfigured' },
      { kind: 'startup', expectedRevision: 0 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['startup requires a profile, provider, or model'],
      revision: 0,
    });
  });
});

describe('reduceProfileCommand confirm-discard', () => {
  it.each(['x', 'setup', 'provider', 'startup-provider:x'])(
    'namespaces replacement tokens for profile %s',
    (name) => {
      const saved = configured(3);
      if (
        saved.status !== 'configured' ||
        saved.document.type === 'loadbalancer'
      ) {
        throw new Error('expected configured standard fixture');
      }
      const state: ProfileState = { ...saved, identity: { kind: 'draft' } };
      const env = {
        ...emptyReductionEnvironment(),
        repository: {
          [name]: {
            document: saved.document,
            fingerprint: { kind: 'hash', hash: 'source' },
          },
        },
        providerTemplates: { [name]: saved.document },
      } satisfies ReturnType<typeof emptyReductionEnvironment>;
      const commands: ProfileCommand[] = [
        { kind: 'load', name, expectedRevision: 3 },
        { kind: 'startup', profileName: name, expectedRevision: 3 },
        { kind: 'startup', provider: name, expectedRevision: 3 },
        { kind: 'setup', expectedRevision: 3 },
        { kind: 'provider', provider: name, expectedRevision: 3 },
      ];
      const tokens = commands.map((command) => {
        const outcome = reduceProfileCommand(state, command, env);
        if (outcome.kind !== 'confirmation-required') {
          throw new Error(`expected confirmation, got ${outcome.kind}`);
        }
        return outcome.pending.token;
      });
      expect(tokens).toStrictEqual([
        `discard:load:${name}`,
        `discard:startup:${name}`,
        `discard:startup-provider:${name}`,
        'discard:setup',
        'discard:provider',
      ]);
      expect(new Set(tokens).size).toStrictEqual(commands.length);
    },
  );

  it('authorizes a discard when the token is non-empty', () => {
    const outcome = reduceProfileCommand(
      configured(3),
      {
        kind: 'confirm-discard',
        pending: {
          token: 'tok-abc',
          commandKind: 'load',
          description: 'discard unsaved changes',
        },
        expectedRevision: 3,
      },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({ kind: 'discard-authorized', revision: 3 });
  });

  it('rejects a discard with an empty token', () => {
    const outcome = reduceProfileCommand(
      configured(3),
      {
        kind: 'confirm-discard',
        pending: {
          token: '',
          commandKind: 'load',
          description: 'discard unsaved changes',
        },
        expectedRevision: 3,
      },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['pending confirmation token must be non-empty'],
      revision: 3,
    });
  });
});
