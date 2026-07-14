/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the ProfileCreateWizard saveProfile utility.
 * Verifies that profile writes are routed through the settings persistence
 * API with create-only vs overwrite semantics and 0600 mode.
 * Uses real temp directories and the actual filesystem — no mocking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';
import { saveProfile } from '../ui/components/ProfileCreateWizard/utils.js';

async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'llxprt-wizard-test-'));
}

function profilesDirForConfigHome(configHome: string): string {
  return path.join(configHome, 'profiles');
}

describe('ProfileCreateWizard saveProfile — settings persistence API', () => {
  let configHome: string;
  let originalConfigHome: string | undefined;

  beforeEach(async () => {
    configHome = await makeTempDir();
    originalConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = configHome;
  });

  afterEach(async () => {
    if (originalConfigHome !== undefined) {
      process.env.LLXPRT_CONFIG_HOME = originalConfigHome;
    } else {
      delete process.env.LLXPRT_CONFIG_HOME;
    }
    await fsp.rm(configHome, { recursive: true, force: true });
  });

  it('creates a new profile with 0600 mode', async () => {
    const result = await saveProfile(
      'myprof',
      { version: 1, provider: 'openai', model: 'gpt-4' },
      { overwrite: false },
    );
    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBeFalsy();

    const profilesDir = profilesDirForConfigHome(Storage.getGlobalConfigDir());
    const profilePath = path.join(profilesDir, 'myprof.json');
    expect(fs.existsSync(profilePath)).toBe(true);
    const stat = fs.statSync(profilePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('create collision returns alreadyExists without overwriting', async () => {
    const profilesDir = profilesDirForConfigHome(Storage.getGlobalConfigDir());
    fs.mkdirSync(profilesDir, { recursive: true });
    const existing = JSON.stringify({
      version: 1,
      provider: 'anthropic',
      model: 'claude',
    });
    fs.writeFileSync(path.join(profilesDir, 'existing.json'), existing, {
      mode: 0o600,
    });

    const result = await saveProfile(
      'existing',
      { version: 1, provider: 'openai', model: 'gpt-4' },
      { overwrite: false },
    );
    expect(result.success).toBe(false);
    expect(result.alreadyExists).toBe(true);
    expect(result.error).toContain('already exists');

    // Original content preserved.
    const content = fs.readFileSync(
      path.join(profilesDir, 'existing.json'),
      'utf-8',
    );
    expect(JSON.parse(content).provider).toBe('anthropic');
  });

  it('overwrite mode replaces an existing profile', async () => {
    const profilesDir = profilesDirForConfigHome(Storage.getGlobalConfigDir());
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(
      path.join(profilesDir, 'overwrite.json'),
      JSON.stringify({
        version: 1,
        provider: 'anthropic',
        model: 'claude',
      }),
      { mode: 0o600 },
    );

    const result = await saveProfile(
      'overwrite',
      { version: 1, provider: 'openai', model: 'gpt-4o' },
      { overwrite: true },
    );
    expect(result.success).toBe(true);

    const content = fs.readFileSync(
      path.join(profilesDir, 'overwrite.json'),
      'utf-8',
    );
    expect(JSON.parse(content).provider).toBe('openai');
    expect(JSON.parse(content).model).toBe('gpt-4o');
  });

  it('does not leave a lock file behind after writing', async () => {
    await saveProfile(
      'nolock',
      { version: 1, provider: 'openai', model: 'gpt-4' },
      { overwrite: false },
    );
    const profilesDir = profilesDirForConfigHome(Storage.getGlobalConfigDir());
    const lockExists = fs.existsSync(path.join(profilesDir, '.profiles.lock'));
    expect(lockExists).toBe(false);
  });
});
