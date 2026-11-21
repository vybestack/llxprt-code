/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import { ProfileManager } from '../ProfileManager.js';
import { parseProfile } from '../../settings/validation.js';

describe('ProfileManager — blank setup drafts', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(process.cwd(), '.blank-profile-test-'),
    );
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.each([undefined, 'standard'] as const)(
    'round-trips a blank setup draft with type %s',
    async (type) => {
      const profile = {
        version: 1 as const,
        ...(type === undefined ? {} : { type }),
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      await pm.saveProfile('blank', profile);
      expect(await pm.loadProfile('blank')).toStrictEqual(profile);
    },
  );

  it.each([
    { provider: '', model: 'gpt-4' },
    { provider: 'openai', model: '' },
    { provider: undefined, model: '' },
    { provider: '', model: undefined },
    { provider: null, model: '' },
    { provider: '', model: null },
    { provider: 0, model: '' },
    { provider: '', model: 0 },
  ])('rejects incomplete or non-string selections: %j', async (selection) => {
    await fs.writeFile(
      path.join(tempDir, 'invalid-selection.json'),
      JSON.stringify({
        version: 1,
        ...selection,
        modelParams: {},
        ephemeralSettings: {},
      }),
    );
    await expect(pm.loadProfile('invalid-selection')).rejects.toThrow(
      'missing required fields',
    );
  });

  it('normalizes legacy blank drafts that omit modelParams', () => {
    expect(
      parseProfile({
        version: 1,
        provider: '',
        model: '',
        ephemeralSettings: {},
      }),
    ).toStrictEqual({
      version: 1,
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    });
  });

  it.each([{ version: 2 }, { modelParams: null }, { ephemeralSettings: null }])(
    'keeps validating the remaining draft fields: %j',
    (invalidFields) => {
      expect(() =>
        parseProfile({
          version: 1,
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
          ...invalidFields,
        }),
      ).toThrow(/missing required fields|unsupported profile version/);
    },
  );
});
