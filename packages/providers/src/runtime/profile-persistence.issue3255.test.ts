/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  type ProfileEphemeralSettings,
} from '@vybestack/llxprt-code-settings';

const runtimeEphemerals = {
  'reasoning.effortWireFormat': 'anthropic-budget',
  'reasoning.enabledWireFormat': 'thinking',
  'reasoning.effortMap': { low: 2048, high: 8192, max: null },
  'reasoning.enabledMap': { true: 'enabled', false: null },
  'media.semantic-purge': 'summary',
  'image-payload-budget-bytes': 12_000_000,
  'media-store-quota-bytes': 3_000_000_000,
  'session-recording-queue-max-bytes': 8_000_000,
  'session-persistence-queue-max-bytes': 7_000_000,
} satisfies ProfileEphemeralSettings;

void vi.mock('./runtimeAccessors.js', () => ({
  getCliRuntimeServices: () => ({
    config: {
      getEphemeralSettings: () => runtimeEphemerals,
    },
    settingsService: {},
    providerManager: {},
  }),
  maybeGetCliOAuthManager: () => null,
  getActiveModelName: () => 'reasoning-model',
  getActiveModelParams: () => ({}),
  _internal: {
    resolveActiveProviderName: () => 'openai',
    getProviderSettingsSnapshot: () => ({ model: 'reasoning-model' }),
    getActiveProviderOrThrow: () => {
      throw new Error('Not used while building a profile snapshot');
    },
    extractModelParams: () => ({}),
  },
}));

void vi.mock('./profileApplication.js', () => ({
  applyProfileWithGuards: vi.fn(),
}));

const { buildRuntimeProfileSnapshot } = await import('./profileSnapshot.js');

describe('reasoning wire profile persistence', () => {
  let profilesDir = '';

  beforeEach(async () => {
    profilesDir = await mkdtemp(join(tmpdir(), 'llxprt-reasoning-profile-'));
  });

  afterEach(async () => {
    await rm(profilesDir, { recursive: true, force: true });
  });

  it('saves and loads the registry-driven runtime snapshot without changing maps', async () => {
    const profileManager = new ProfileManager(profilesDir);
    const snapshot = buildRuntimeProfileSnapshot();

    await profileManager.saveProfile('reasoning-wire', snapshot);
    const loaded = await profileManager.loadProfile('reasoning-wire');

    expect(loaded.ephemeralSettings).toMatchObject(runtimeEphemerals);
  });
});
