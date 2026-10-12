/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2616 PR A — formerly-ambient prompt settings resolution runs
 * outside any AsyncLocalStorage scope with an explicit settings reader and
 * succeeds with no ambient fallback. When the reader is absent the same
 * defaults today's catch branch produced must apply.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from 'bun:test';

(() => {
  delete globalThis.process.env.LLXPRT_PROMPT_MANIFEST;
})();

import {
  getCoreSystemPromptAsync,
  initializePromptSystem,
  type CoreSystemPromptOptions,
} from './prompts.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { UNCONFIGURED_PROVIDER } from '../config/models.js';
import { __resetManifestCacheForTests } from '../prompt-config/defaults/manifest-loader.js';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('getCoreSystemPromptAsync with explicit settings reader', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-test-'));
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
    delete process.env.LLXPRT_PROMPT_MANIFEST;
    __resetManifestCacheForTests();
    await initializePromptSystem();
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetManifestCacheForTests();
  });

  it('uses the selected session provider rather than another store during prompt assembly', async () => {
    const selected = new SessionSettingsOwner(new SettingsService());
    const peer = new SessionSettingsOwner(new SettingsService());
    selected.initializeProviderSelection('reader-provider', 'prompt-model');
    peer.initializeProviderSelection('peer-provider', 'prompt-model');
    const prompt = await getCoreSystemPromptAsync({
      provider: selected.readSelectedProvider(),
      policy: selected.readRuntimePolicy().promptPolicy,
    });
    expect(prompt).toContain('via reader-provider.');
    expect(prompt).not.toContain('via peer-provider.');
    expect(prompt).not.toContain(UNCONFIGURED_PROVIDER);
  });

  it('falls back to the unconfigured sentinel when no selected provider is supplied', async () => {
    const options: CoreSystemPromptOptions = {};
    const prompt = await getCoreSystemPromptAsync(options);
    expect(prompt).toContain(UNCONFIGURED_PROVIDER);
  });

  it('rejects assembly from a closed session instead of silently changing provider identity', () => {
    const owner = new SessionSettingsOwner(new SettingsService());
    owner.initializeProviderSelection('reader-provider', 'prompt-model');
    owner.closeAdmission();
    expect(() => owner.readSelectedProvider()).toThrow(
      'Session settings owner is closed',
    );
  });

  it('uses the explicit request route for prompt assembly while preserving session selection', async () => {
    const owner = new SessionSettingsOwner(new SettingsService());
    owner.initializeProviderSelection('reader-provider', 'prompt-model');
    const prompt = await getCoreSystemPromptAsync({
      provider: 'explicit-option',
      policy: owner.readRuntimePolicy().promptPolicy,
    });
    expect(prompt).toContain('via explicit-option.');
    expect(owner.readSelectedProvider()).toBe('reader-provider');
  });
});
