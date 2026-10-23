import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { join } from 'node:path';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { describe, expect, it } from 'bun:test';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleModelSelection } from '../model-selection.js';
import { ProviderActivationIntent } from '../config-types.js';
import { makeFakeConfigForOauth } from './helpers/provider-auth-fixtures.js';
import { fixturesDir } from './helpers/agentHarness.js';

describe('provider-or-oauth oauth branch (#2374 round-3 Fix 4)', () => {
  it('takes the oauth branch when the manager has NO active provider: refreshAuth(oauth) runs, provider-branch side effects absent', async () => {
    // buildCliStyleConfig always activates FakeProvider, so it cannot exercise
    // the oauth branch (no-active-provider path). The minimal typed fake below
    // implements just the Config surface the executor touches, with a manager
    // that reports hasActiveProvider()===false. The observable: refreshAuth is
    // called with 'oauth' (not 'provider'), and the provider-branch-only side
    // effects (ensureProviderManagerOnConfig, attachProviderManagerToContentConfig)
    // did NOT occur (contentGeneratorConfig.providerManager stays undefined).
    const {
      config: fakeConfig,
      probe,
      manager,
      refreshClient,
    } = makeFakeConfigForOauth(false, join(fixturesDir, 'plain-text.jsonl'));
    const intent: ProviderActivationIntent = {
      authMode: 'provider-or-oauth',
    };
    const activationSettingsOwner16 = new SessionSettingsOwner(
      new SettingsService(),
    );
    const result = await executeProviderActivation(
      fakeConfig as Config,
      intent,
      async () => {
        throw new Error('Unexpected switch in auth-only test');
      },
      new SettingsService(),
      manager,
      refreshClient,
      assembleModelSelection(activationSettingsOwner16),
    );
    expect(result.authFailed).toBe(false);
    // Observable: refreshAuth('oauth') ran (not 'provider').
    expect(probe.oauthCalled).toBe(true);
    expect(probe.providerCalled).toBe(false);
    expect(probe.refreshMethod).toBe('oauth');
    // Observable: the provider-branch-only side effect (attaching
    // providerManager to contentGeneratorConfig) did NOT run.
    expect(probe.contentProviderManager).toBeUndefined();
  });

  it('takes the provider branch when the manager HAS an active provider: refreshAuth(provider) runs', async () => {
    const {
      config: fakeConfig,
      probe,
      manager,
      refreshClient,
    } = makeFakeConfigForOauth(true, join(fixturesDir, 'plain-text.jsonl'));
    const intent: ProviderActivationIntent = {
      authMode: 'provider-or-oauth',
    };
    const activationSettingsOwner17 = new SessionSettingsOwner(
      new SettingsService(),
    );
    const result = await executeProviderActivation(
      fakeConfig as Config,
      intent,
      async () => {
        throw new Error('Unexpected switch in auth-only test');
      },
      new SettingsService(),
      manager,
      refreshClient,
      assembleModelSelection(activationSettingsOwner17),
    );
    expect(result.authFailed).toBe(false);
    // Observable: refreshAuth('provider') ran (not 'oauth').
    expect(probe.providerCalled).toBe(true);
    expect(probe.oauthCalled).toBe(false);
    expect(probe.refreshMethod).toBe('provider');
  });
});
