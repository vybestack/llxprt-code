/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: the request-media budget is derived by the provider unless the
 * user declared one. A profile must therefore round-trip an absent setting as
 * absent, and explicit values (including 15 MiB and zero) as explicit.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { buildRuntimeProfileSnapshot } from './profileSnapshot.js';

describe('image-payload-budget-bytes profile provenance (issue #3984)', () => {
  let profilesDir = '';

  beforeEach(async () => {
    profilesDir = await mkdtemp(join(tmpdir(), 'llxprt-issue3984-profile-'));
  });

  afterEach(async () => {
    await rm(profilesDir, { recursive: true, force: true });
  });

  async function roundTrip(
    ephemeralSettings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const manager = new ProfileManager(profilesDir);
    await manager.saveProfile(
      'budget',
      buildRuntimeProfileSnapshot({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4-20250514',
        providerSettings: {},
        ephemeralSettings,
      }),
    );
    const loaded = await manager.loadProfile('budget');
    return { ...loaded.ephemeralSettings };
  }

  it('does not persist a default when the user never declared a budget', async () => {
    const loaded = await roundTrip({});

    expect(Object.keys(loaded)).not.toContain('image-payload-budget-bytes');
  });

  it('persists an unset budget as absent', async () => {
    const loaded = await roundTrip({ 'image-payload-budget-bytes': undefined });

    expect(loaded['image-payload-budget-bytes']).toBeUndefined();
  });

  it('keeps an explicit 15 MiB budget explicit', async () => {
    const loaded = await roundTrip({
      'image-payload-budget-bytes': 15 * 1024 * 1024,
    });

    expect(loaded['image-payload-budget-bytes']).toBe(15 * 1024 * 1024);
  });

  it('keeps an explicit zero budget explicit', async () => {
    const loaded = await roundTrip({ 'image-payload-budget-bytes': 0 });

    expect(loaded['image-payload-budget-bytes']).toBe(0);
  });
});
