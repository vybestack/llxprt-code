/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BEHAVIORAL coverage for the isolated-runtime OAuthManager construction
 * (issue #2616): the runtime factory must thread the runtime Config into the
 * OAuthManager it builds, so getHigherPriorityAuth consults the authOnly
 * setting through Config.getSettingsService(). A manager built without the
 * config silently skips that check and reports the stored API key even when
 * authOnly forbids it.
 *
 * The test drives the REAL isolated-runtime path (createIsolatedRuntimeContext)
 * and the REAL file-backed OAuth settings provider (seeded through
 * LLXPRT_CONFIG_HOME) — no mocks — and observes the outcome of
 * getHigherPriorityAuth on the manager the runtime built.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createIsolatedRuntimeContext } from '../runtime/runtimeSettings.js';
import type { IsolatedRuntimeContextHandle } from '../runtime/runtimeSettings.js';

describe('isolated-runtime OAuthManager honors authOnly through the threaded config', () => {
  let tmpConfigHome: string;
  let previousConfigHome: string | undefined;
  let previousAnthropicKey: string | undefined;
  let handle: IsolatedRuntimeContextHandle | undefined;

  const writeUserSettings = (settings: Record<string, unknown>): void => {
    fs.writeFileSync(
      path.join(tmpConfigHome, 'settings.json'),
      JSON.stringify(settings),
      'utf-8',
    );
  };

  beforeEach(() => {
    previousConfigHome = process.env['LLXPRT_CONFIG_HOME'];
    previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    tmpConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-authonly-'));
    process.env['LLXPRT_CONFIG_HOME'] = tmpConfigHome;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(async () => {
    await handle?.cleanup();
    handle = undefined;
    if (previousConfigHome === undefined) {
      delete process.env['LLXPRT_CONFIG_HOME'];
    } else {
      process.env['LLXPRT_CONFIG_HOME'] = previousConfigHome;
    }
    if (previousAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
    fs.rmSync(tmpConfigHome, { recursive: true, force: true });
  });

  it('suppresses a stored API key once authOnly is enabled (check honored, not skipped)', async () => {
    // The user has an API key in the user-scope settings file, so the
    // file-backed provider the runtime builds WILL report one.
    writeUserSettings({ providerApiKeys: { anthropic: 'sk-test-key' } });

    // The isolated runtime builds its Config on THIS settings service; the
    // regression was that the factory-built OAuthManager never received that
    // config, so the authOnly read was skipped and the API key won.
    const settingsService = new SettingsService();

    handle = createIsolatedRuntimeContext({
      runtimeId: 'oauth-authonly-isolated',
      settingsService,
      workspaceDir: process.cwd(),
      model: 'auth-only-model',
      prepare: async () => {},
    });

    // Sanity guard against a vacuous pass: with authOnly unset the same
    // manager must report the stored key, proving the file-backed provider
    // is live on this manager.
    const beforeAuthOnly =
      await handle.oauthManager.getHigherPriorityAuth('anthropic');
    expect(beforeAuthOnly).toBe('API Key');

    settingsService.set('authOnly', true);

    const afterAuthOnly =
      await handle.oauthManager.getHigherPriorityAuth('anthropic');
    expect(afterAuthOnly).toBeNull();
  });
});
