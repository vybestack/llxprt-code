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
import { UNCONFIGURED_PROVIDER } from '../config/models.js';
import { __resetManifestCacheForTests } from '../prompt-config/defaults/manifest-loader.js';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface PromptSettingsReader {
  get(key: string): unknown;
  getAllGlobalSettings(): Record<string, unknown>;
}

function readerFrom(overrides: {
  values?: Record<string, unknown>;
  onGet?: (key: string) => unknown;
}): PromptSettingsReader {
  return {
    get: (key: string) => {
      if (overrides.onGet) {
        return overrides.onGet(key);
      }
      return overrides.values?.[key];
    },
    getAllGlobalSettings: () => ({ ...(overrides.values ?? {}) }),
  };
}

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

  it('resolves the active provider from the explicit reader when no provider option is passed', async () => {
    const settings = readerFrom({
      values: { activeProvider: 'reader-provider' },
    });

    const prompt = await getCoreSystemPromptAsync({ settings });

    expect(prompt).toContain('via reader-provider.');
    expect(prompt).not.toContain(UNCONFIGURED_PROVIDER);
  });

  it('falls back to the unconfigured sentinel when the reader is absent', async () => {
    const options: CoreSystemPromptOptions = {};

    const prompt = await getCoreSystemPromptAsync(options);

    expect(prompt).toContain(UNCONFIGURED_PROVIDER);
  });

  it('uses the catch-branch defaults when the explicit reader throws', async () => {
    const settings = readerFrom({
      onGet: () => {
        throw new Error('reader unavailable');
      },
    });

    const prompt = await getCoreSystemPromptAsync({ settings });

    expect(prompt).toContain(UNCONFIGURED_PROVIDER);
  });

  it('an explicit provider option still wins over the reader value', async () => {
    const settings = readerFrom({
      values: { activeProvider: 'reader-provider' },
    });

    const prompt = await getCoreSystemPromptAsync({
      provider: 'explicit-option',
      settings,
    });

    expect(prompt).toContain('via explicit-option.');
  });
});
