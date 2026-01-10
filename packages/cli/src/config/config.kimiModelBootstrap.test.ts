/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from './settings.js';
import { parseArguments, loadCliConfig } from './config.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import { ExtensionStorage } from './extension.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('@vybestack/llxprt-code-core');
  return {
    ...actual,
    isRipgrepAvailable: vi.fn().mockResolvedValue(true),
  };
});

// Regression test for start.js model.missing when provider != gemini and no model provided.
// Expected behavior: provider aliases with defaultModel should supply a non-empty model.

describe('loadCliConfig provider alias model bootstrap', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    clearActiveProviderRuntimeContext();
  });

  it('uses kimi alias defaultModel when --provider kimi is set and no --model is provided', async () => {
    process.argv = ['node', 'script.js', '--provider', 'kimi'];
    const argv = await parseArguments({} as Settings);

    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );

    expect(config.getProvider()).toBe('kimi');
    expect(config.getModel()).toBe('kimi-for-coding');
  });
});
