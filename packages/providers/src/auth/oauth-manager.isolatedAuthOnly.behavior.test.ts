/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';

describe('isolated-runtime OAuthManager honors authOnly through the threaded config', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let previousAnthropicKey: string | undefined;
  beforeEach(() => {
    previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(async () => {
    try {
      await runCleanupSteps(retiring.splice(0).reverse());
    } finally {
      if (previousAnthropicKey === undefined)
        delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    }
  });

  it('suppresses a stored API key once authOnly is enabled (check honored, not skipped)', async () => {
    const directory = process.env.LLXPRT_CONFIG_HOME;
    if (directory === undefined) throw new Error('Missing credential home');
    writeFileSync(
      join(directory, 'settings.json'),
      JSON.stringify({ providerApiKeys: { anthropic: 'sk-test-key' } }),
    );
    const settingsService = new SettingsService();
    const config = new Config({
      sessionId: 'oauth-authonly-isolated',
      targetDir: directory,
      cwd: directory,
      model: 'auth-only-model',
      debugMode: false,
    });
    retiring.push(() => config.dispose());
    const release = new AcquisitionRelease();
    retiring.push(() => release.close());
    const settingsOwner = new SessionSettingsOwner(settingsService);
    release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(config);
    const policy = new RuntimePolicyOwner(config);
    release.acquire('policy', () => policy.dispose());
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, 'oauth-authonly-isolated'),
    );
    const manager = acquirePreferredProviderManager(
      config,
      settingsService,
      settingsOwner,
      files,
      'oauth-authonly-isolated',
      credentials().authority,
      release,
    );
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settingsService,
      manager,
      'oauth-authonly-isolated',
      undefined,
      credentials().authority,
      release,
    );
    const beforeAuthOnly = await oauth.getHigherPriorityAuth('anthropic');
    expect(beforeAuthOnly).toBe('API Key');
    settingsService.set('authOnly', true);
    const afterAuthOnly = await oauth.getHigherPriorityAuth('anthropic');
    expect(afterAuthOnly).toBeNull();
  });
});
