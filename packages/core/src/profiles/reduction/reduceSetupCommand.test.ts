/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceSetupCommand } from './reduceSetupCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileState } from '../contracts/profileState.js';

const configured = (): ProfileState => ({
  status: 'configured',
  revision: 4,
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
    modelParams: { temperature: 0.2 },
    ephemeralSettings: { 'base-url': 'https://api.example.com' },
  },
});

const envWith = (): ProfileReductionEnvironment => emptyReductionEnvironment();

describe('reduceSetupCommand', () => {
  it('builds the exact blank draft from an unconfigured state', () => {
    const outcome = reduceSetupCommand(
      { status: 'unconfigured' },
      { kind: 'setup', expectedRevision: 0 },
      envWith(),
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

  it('starts a blank draft from a configured state at its revision', () => {
    const outcome = reduceSetupCommand(
      configured(),
      { kind: 'setup', expectedRevision: 4 },
      envWith(),
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
      baseRevision: 4,
      nextRevision: 5,
    });
  });

  it('carries no active member', () => {
    const state: ProfileState = {
      status: 'configured',
      revision: 1,
      identity: { kind: 'draft' },
      document: {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {},
      },
    };
    const outcome = reduceSetupCommand(
      state,
      { kind: 'setup', discardUnsaved: true, expectedRevision: 1 },
      envWith(),
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
      baseRevision: 1,
      nextRevision: 2,
    });
  });
});

describe('setup draft replacement', () => {
  it.each([undefined, false])(
    'requires confirmation with discardUnsaved=%s',
    (discardUnsaved) => {
      const saved = configured();
      if (saved.status !== 'configured') {
        throw new Error('expected a configured fixture');
      }
      expect(
        reduceSetupCommand(
          { ...saved, identity: { kind: 'draft' } },
          { kind: 'setup', discardUnsaved, expectedRevision: 4 },
          envWith(),
        ),
      ).toStrictEqual({
        kind: 'confirmation-required',
        pending: {
          token: 'discard:setup',
          commandKind: 'setup',
          description:
            'Setup will discard unsaved changes to the working profile',
        },
        revision: 4,
      });
    },
  );
});
