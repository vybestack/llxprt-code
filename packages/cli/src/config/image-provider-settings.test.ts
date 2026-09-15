/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoadedSettings, SettingScope } from './settings.js';
import { settingsZodSchema } from './settings-validation.js';

describe('image provider settings', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'llxprt-image-settings-'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('persists and reloads the optional image provider alias', () => {
    const empty = { settings: {}, path: join(directory, 'unused.json') };
    const path = join(directory, 'settings.json');
    const settings = new LoadedSettings(
      empty,
      empty,
      { settings: {}, path },
      empty,
      true,
    );
    expect(settings.merged.imageProvider).toBeUndefined();
    settings.setValue(SettingScope.User, 'imageProvider', 'codex');
    const restored = settingsZodSchema.parse(
      JSON.parse(readFileSync(path, 'utf8')),
    );
    const reloaded = new LoadedSettings(
      empty,
      empty,
      { settings: restored, path },
      empty,
      true,
    );
    expect(reloaded.merged.imageProvider).toBe('codex');
  });
});
