/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { reduceSaveCommand } from './reduceSaveCommand.js';
import { emptyReductionEnvironment } from './reductionEnvironment.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';

const draftState = (): ConfiguredProfile => ({
  status: 'configured',
  revision: 5,
  identity: { kind: 'draft' },
  document: {
    version: 1,
    provider: 'openai',
    model: 'gpt-4o',
    modelParams: {},
    ephemeralSettings: {},
  },
});

const savedState = (): ConfiguredProfile => ({
  status: 'configured',
  revision: 5,
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
});

describe('reduceSaveCommand', () => {
  it('is invalid when an unsaved draft has no name and none given', () => {
    const outcome = reduceSaveCommand(
      draftState(),
      { kind: 'save', expectedRevision: 5 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'invalid',
      errors: ['save requires a name for an unsaved draft'],
      revision: 5,
    });
  });

  it('is a no-op when a saved identity matches the requested name', () => {
    const outcome = reduceSaveCommand(
      savedState(),
      { kind: 'save', expectedRevision: 5 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'no-op',
      reason: 'working profile already saved and unchanged',
      revision: 5,
    });
  });

  it('carries the working document and unchanged revision in a save outcome', () => {
    const outcome = reduceSaveCommand(
      draftState(),
      { kind: 'save', name: 'prod', expectedRevision: 5 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'save',
      name: 'prod',
      document: draftState().document,
      revision: 5,
    });
  });

  it('uses the saved name when no name is given', () => {
    const outcome = reduceSaveCommand(
      savedState(),
      { kind: 'save', name: 'alt', expectedRevision: 5 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'save',
      name: 'alt',
      document: savedState().document,
      revision: 5,
    });
  });

  it('is a save with an explicit new name for a draft', () => {
    const outcome = reduceSaveCommand(
      draftState(),
      { kind: 'save', name: 'alt', expectedRevision: 5 },
      emptyReductionEnvironment(),
    );
    expect(outcome).toStrictEqual({
      kind: 'save',
      name: 'alt',
      document: draftState().document,
      revision: 5,
    });
  });
});
