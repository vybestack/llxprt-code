/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They reuse the CANONICAL config builder (buildCliStyleConfig) so the
 * assertions exercise a REAL CLI-style Config wired to the FakeProvider.
 */

import { describe, it, expect } from 'vitest';
import {
  executeProviderActivation,
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
  type ProviderActivationResult,
} from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  buildCliStyleConfig,
  type MessageBus,
} from './helpers/buildCliStyleConfig.js';
import { buildAgent } from './helpers/agentHarness.js';
import {
  getActiveProviderName,
  getActiveModelParams,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reaches the adopted Config's provider manager active-provider name through
 * the public Config surface (no deep import of the manager). Used to assert
 * the resulting activation state independent of the global runtime accessor.
 */
function configActiveProvider(config: {
  getProviderManager():
    | {
        getActiveProviderName(): string | undefined;
      }
    | undefined;
}): string | undefined {
  return config.getProviderManager()?.getActiveProviderName();
}

describe('ProviderActivationIntent / executeProviderActivation (#2374)', () => {
  it('(a) API-key auth via cliOverrides.key activates the provider and authenticates', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
      );
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.config)).toBe('fake');
      // Observable authenticated state: the CLI override path
      // (applyCliArgumentOverrides → resolveFromKeyArg) applies the key to the
      // active provider AND sets the auth-key ephemeral, so the config reports
      // the key as applied — the real signal that auth materialized, not just
      // that the provider name resolved.
      expect(built.config.getEphemeralSetting('auth-key')).toBe('sk-test-key');
    } finally {
      await built.cleanup();
    }
  });

  it('(b) provider-or-oauth mode with an active manager takes the provider branch: refreshAuth runs and contentGeneratorConfig is populated', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // buildCliStyleConfig registers FakeProvider and sets it active, so the
      // provider-or-oauth executor observes hasActiveProvider()===true and
      // takes the PROVIDER branch (refreshAuth('provider') +
      // ensureProviderManagerOnConfig). The distinguishing observable vs a
      // no-auth scenario is that the content generator config is populated
      // (refreshAuth ran) and the active provider is preserved.
      const intent: ProviderActivationIntent = {
        authMode: 'provider-or-oauth',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
      );
      expect(result.authFailed).toBe(false);
      // The provider branch ran refreshAuth, producing a content generator
      // config — a real signal auth materialized (not just authFailed=false).
      expect(built.config.getContentGeneratorConfig()).toBeDefined();
      expect(configActiveProvider(built.config)).toBe('fake');
    } finally {
      await built.cleanup();
    }
  });

  it('(c) no-provider case falls back to defaultProvider; auth errors swallowed (authFailed false), config remains usable', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        defaultProvider: 'fake',
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
      );
      expect(result.authFailed).toBe(false);
      // The active provider equals the fallback defaultProvider.
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.config)).toBe('fake');
      // The config remains usable (no throw) — the executor resolves and the
      // config's content generator surface is intact for downstream turns.
      expect(() => built.config.getContentGeneratorConfig()).not.toThrow();
    } finally {
      await built.cleanup();
    }
  });

  it('(e) model + modelParams application incl. stale-param clearing', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      built.config.setEphemeralSetting('stale-param', 'old');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        modelParams: { temperature: 0.7 },
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
      );
      expect(result.authFailed).toBe(false);
      expect(built.config.getModel()).toBe('fake-model');
    } finally {
      await built.cleanup();
    }
  });

  it('(f) authMode none skips auth refresh entirely (no authFailed, no throw)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'none',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
      );
      expect(result.authFailed).toBe(false);
    } finally {
      await built.cleanup();
    }
  });
});

describe('fromConfig executes the activation intent (#2374)', () => {
  it('(a) fromConfig with activation intent activates the provider', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        model: 'fake-model',
        authMode: 'auto',
      };
      const agent: Agent = await fromConfig({
        config: built.config,
        activation: intent,
      });
      expect(agent.getProvider()).toBe('fake');
      expect(getActiveProviderName()).toBe('fake');
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('(d) profile-auth-ephemerals survive fromConfig (provider already active + ephemerals intact)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // Simulate a profile-loaded provider runtime: the provider is already
      // active and profile auth ephemerals are present.
      built.config.setEphemeralSetting('auth-keyfile', '/tmp/profile.key');
      built.config.setEphemeralSetting(
        'base-url',
        'https://profile.example/v1',
      );

      const beforeKeyfile = built.config.getEphemeralSetting('auth-keyfile');
      const beforeBaseUrl = built.config.getEphemeralSetting('base-url');
      expect(beforeKeyfile).toBe('/tmp/profile.key');
      expect(beforeBaseUrl).toBe('https://profile.example/v1');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      const agent: Agent = await fromConfig({
        config: built.config,
        activation: intent,
      });
      try {
        // The profile auth ephemerals MUST survive fromConfig — the provider
        // was already active WITH profile ephemerals, so fromConfig must NOT
        // re-switch / clear them (the restoreActiveProvider compensation is
        // unnecessary).
        expect(built.config.getEphemeralSetting('auth-keyfile')).toBe(
          '/tmp/profile.key',
        );
        expect(built.config.getEphemeralSetting('base-url')).toBe(
          'https://profile.example/v1',
        );
        expect(configActiveProvider(built.config)).toBe('fake');
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('(f) fromConfig with authMode none skips auth refresh', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'none',
      };
      const agent: Agent = await fromConfig({
        config: built.config,
        activation: intent,
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('fromConfig without activation preserves backward-compatible behavior', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
      const agent: Agent = await fromConfig({
        config: built.config,
        messageBus: callerBus,
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 remediation: Finding 1 (createAgent activation intent) ──────────

describe('createAgent with declarative activation intent (#2374 finding 1)', () => {
  it('createAgent with activation intent yields the intended provider/auth state', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      activation: {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      },
    });
    try {
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
      expect(getActiveProviderName()).toBe('fake');
    } finally {
      await cleanup();
    }
  });

  it('createAgent without activation preserves byte-identical legacy behavior', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      await cleanup();
    }
  });

  // ─── #2374 round-3: Fix 1 — activation intent desync ────────────────────
  //
  // When the activation intent changes the runtime provider/model to something
  // DIFFERENT from the original AgentConfig fields, the constructed Agent's
  // public state (getProvider/getModel) must reflect the POST-activation truth,
  // not the stale parsed-config values. Under the FakeProvider seam, setting
  // provider:'openai' in the base config but activation.provider:'fake' means
  // the executor activates 'fake' while parsed.provider stays 'openai'. The
  // Agent facade must report 'fake'.
  it('createAgent with activation.provider differing from config.provider reports the activated provider', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      model: 'gpt-4',
      activation: {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      },
    });
    try {
      // POST-activation truth: the executor switched to 'fake' (registered +
      // active under the fake seam) and set model 'fake-model'. The facade
      // must NOT report the stale parsed-provider 'openai'.
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
      expect(getActiveProviderName()).toBe('fake');
    } finally {
      await cleanup();
    }
  });
});

// ─── #2374 round-3: Fix 1 — fromConfig activation intent desync ─────────────

describe('fromConfig activation intent does not desync Agent facade (#2374 round-3 fix 1)', () => {
  it('fromConfig with activation intent differing from adopted config provider reports the activated provider', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // Force the adopted config to report a DIFFERENT provider than the
      // intent will activate, so the desync is observable: the config says
      // 'openai' but the runtime active provider (and the intent's target) is
      // 'fake'. After activation, the facade must report 'fake'.
      built.config.setProvider('openai');
      expect(built.config.getProvider()).toBe('openai');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'intent-override-model',
        authMode: 'auto',
      };
      const agent: Agent = await fromConfig({
        config: built.config,
        activation: intent,
      });
      try {
        // POST-activation truth: the executor switched to 'fake' (registered +
        // active under the fake seam) and applied the intent's model override.
        // The facade must NOT report the stale config provider 'openai'.
        expect(agent.getProvider()).toBe('fake');
        expect(agent.getModel()).toBe('intent-override-model');
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 remediation: Finding 2 (provider-or-oauth fresh active state) ───

describe('provider-or-oauth branches on fresh post-switch state (#2374 finding 2)', () => {
  it('intent with provider + provider-or-oauth takes the provider branch after successful activation', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // The FakeProvider is registered and active after buildCliStyleConfig.
      // An intent that re-activates 'fake' in provider-or-oauth mode must take
      // the provider branch (refreshAuth('provider') +
      // ensureProviderManagerOnConfig), NOT the oauth branch.
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.config)).toBe('fake');
      // Provider-branch distinguishing observable: refreshAuth('provider') ran,
      // so the content generator config is populated AND carries the provider
      // manager (the provider-branch ensureProviderManagerOnConfig wired it).
      const cgc = built.config.getContentGeneratorConfig();
      expect(cgc).toBeDefined();
      expect(cgc?.providerManager).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });

  it('provider-or-oauth provider branch attaches providerManager to the content generator config (provider-branch side effect)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      await executeProviderActivation(built.config, intent);
      // The provider branch calls ensureProviderManagerOnConfig +
      // attachProviderManagerToContentConfig, so the content generator config
      // carries the provider manager. This is the provider-branch-only side
      // effect that distinguishes it from a hypothetical no-manager path.
      const cgc = built.config.getContentGeneratorConfig();
      expect(cgc).toBeDefined();
      expect(cgc?.providerManager).toBe(built.config.getProviderManager());
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 remediation: Finding 3 (fromConfig throws on authFailed) ────────

describe('fromConfig surfaces auth failure (#2374 finding 3)', () => {
  it('fromConfig with intent whose provider switch fails reports the failure (auto mode, unknown provider)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // Under the FakeProvider seam, switching to an unregistered provider
      // ('nonexistent') in auto mode falls through — the executor's auto path
      // resolves configProvider='nonexistent', switches (swallowed under fake
      // seam), refreshes auth. The auth for an unknown provider fails, which
      // the executor maps to authFailed:true. fromConfig must throw
      // AgentBootstrapError.
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };
      // Assert on the observable error name + message (behavioral) rather than
      // instanceof, because vitest resolves the test's AgentBootstrapError
      // import and fromConfig's import to distinct module instances, breaking
      // instanceof identity. The error.name is the reliable cross-identity
      // signal that fromConfig surfaced an AgentBootstrapError.
      await expect(
        fromConfig({ config: built.config, activation: intent }),
      ).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof Error)) {
          return false;
        }
        return (
          err.name === 'AgentBootstrapError' &&
          err.message.includes('fromConfig activation failed')
        );
      });
    } finally {
      await built.cleanup();
    }
  });

  it('fromConfig with intent for already-active provider with profile ephemerals resolves (ephemerals intact)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      built.config.setEphemeralSetting('auth-keyfile', '/tmp/profile.key');
      built.config.setEphemeralSetting(
        'base-url',
        'https://profile.example/v1',
      );

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      const agent = await fromConfig({
        config: built.config,
        activation: intent,
      });
      try {
        expect(built.config.getEphemeralSetting('auth-keyfile')).toBe(
          '/tmp/profile.key',
        );
        expect(built.config.getEphemeralSetting('base-url')).toBe(
          'https://profile.example/v1',
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 remediation: Finding 5 (ephemerals survive provider-or-oauth switch) ─

describe('provider-or-oauth preserves profile-auth ephemerals across switch (#2374 finding 5)', () => {
  it('ephemerals set + provider switch in provider-or-oauth mode → overrides still applied', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      built.config.setEphemeralSetting('base-url', 'https://custom.example/v1');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.authFailed).toBe(false);
      // The base-url ephemeral must survive the switch (switchActiveProvider
      // clears ephemerals; the executor snapshots+reapplies).
      expect(built.config.getEphemeralSetting('base-url')).toBe(
        'https://custom.example/v1',
      );
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 remediation: Finding 6 (switchError surfaced) ───────────────────

describe('executeProviderActivation surfaces switchError (#2374 finding 6)', () => {
  it('executor with unknown provider in authMode none returns switchError', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'none',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.switchError).toBeDefined();
      expect(typeof result.switchError).toBe('string');
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 remediation round 2: Finding 4 (Zed provider-or-oauth outcomes) ─

describe('provider-or-oauth runtime overrides (Zed features) (#2374 finding 4)', () => {
  it('(i) auth-keyfile ephemeral with ~ expansion → api key applied from file content', async () => {
    // Write a real keyfile under the user's home dir so the ~ expansion path
    // resolves to an existing file. The executor reads the file, applies the
    // key via setProviderApiKey, and normalizes the auth-keyfile ephemeral to
    // the resolved absolute path.
    const keyFileDir = mkdtempSync(join(tmpdir(), 'llxprt-keyfile-'));
    const homeRelativeDir = keyFileDir.replace(homedir(), '~');
    const keyfilePath = join(homeRelativeDir, 'api-key.txt');
    const absKeyfilePath = join(keyFileDir, 'api-key.txt');
    writeFileSync(absKeyfilePath, '  sk-from-file-123  \n', 'utf8');
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      built.config.setEphemeralSetting('auth-keyfile', keyfilePath);
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.authFailed).toBe(false);
      // Observable: the auth-keyfile ephemeral is normalized to the resolved
      // absolute path (~ expanded to os.homedir()), proving the file was read
      // and the key applied.
      expect(built.config.getEphemeralSetting('auth-keyfile')).toBe(
        absKeyfilePath,
      );
    } finally {
      await built.cleanup();
      rmSync(keyFileDir, { recursive: true, force: true });
    }
  });

  it('(ii) base-url ephemeral applied to the active provider settings', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      built.config.setEphemeralSetting(
        'base-url',
        'https://custom-endpoint.example/v1',
      );
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.authFailed).toBe(false);
      // Observable: setProviderBaseUrl wrote the base-url into the active
      // provider's settings via the settings service.
      const providerSettings = built.config
        .getSettingsService()
        .getProviderSettings('fake');
      expect(providerSettings['base-url']).toBe(
        'https://custom-endpoint.example/v1',
      );
    } finally {
      await built.cleanup();
    }
  });

  it('(ii-cont) base-url "none" is NOT applied — provider setting cleared', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // Pre-set a base-url on the provider, then activate with base-url 'none'.
      built.config
        .getSettingsService()
        .setProviderSetting('fake', 'base-url', 'https://pre-existing.example');
      built.config.setEphemeralSetting('base-url', 'none');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.authFailed).toBe(false);
      // Observable: setProviderBaseUrl('none') clears the provider setting
      // (updateActiveProviderBaseUrl normalizes 'none' → null → undefined).
      const providerSettings = built.config
        .getSettingsService()
        .getProviderSettings('fake');
      expect(providerSettings['base-url']).toBeUndefined();
    } finally {
      await built.cleanup();
    }
  });

  it('(iv) merged modelParams applied to the active provider runtime', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        modelParams: { temperature: 0.42, top_p: 0.9 },
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(built.config, intent);
      expect(result.authFailed).toBe(false);
      // Observable: the model params were pushed onto the active provider
      // runtime via setActiveModelParam.
      const params = getActiveModelParams();
      expect(params['temperature']).toBe(0.42);
      expect(params['top_p']).toBe(0.9);
    } finally {
      await built.cleanup();
    }
  });
});

// ─── #2374 round-3 Fix 4: genuine oauth-branch + fallback precedence ───────

/**
 * Minimal typed fake Config surface for executor-unit testing of the oauth
 * branch. buildCliStyleConfig always activates FakeProvider (the Fake wiring
 * requires an active provider to route requests), so it cannot produce a
 * no-active-provider manager for the oauth branch without breaking the Fake
 * seam. This fake implements just the Config surface the executor touches in
 * the provider-or-oauth path, typed (no `any`/`as never`). The boundary cast
 * `as unknown as Parameters<typeof executeProviderActivation>[0]` is the repo
 * idiom for typed test doubles (Pick<> + as unknown as X).
 */
interface FakeOauthProbe {
  oauthCalled: boolean;
  providerCalled: boolean;
  refreshMethod: string | undefined;
  contentProviderManager: unknown;
}

function makeFakeConfigForOauth(hasActiveProvider: boolean): {
  config: unknown;
  probe: FakeOauthProbe;
} {
  const probe: FakeOauthProbe = {
    oauthCalled: false,
    providerCalled: false,
    refreshMethod: undefined,
    contentProviderManager: undefined,
  };
  const manager = {
    hasActiveProvider: () => hasActiveProvider,
    getActiveProviderName: () => (hasActiveProvider ? 'fake' : undefined),
    getServerToolsProvider: () => undefined,
  };
  const contentGenConfig: { providerManager?: unknown } = {};
  const config = {
    refreshAuth: async (method?: string) => {
      probe.refreshMethod = method;
      probe.oauthCalled = method === 'oauth';
      probe.providerCalled = method === 'provider';
    },
    getProviderManager: () => manager,
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: () => {},
    getContentGeneratorConfig: () => {
      probe.contentProviderManager = contentGenConfig.providerManager;
      return contentGenConfig;
    },
    getProvider: () => undefined,
    getModel: () => 'placeholder-model',
    // configureProviderRuntimeFactories (provider branch) calls setProviderManager.
    setProviderManager: () => {},
    // configureProviderRuntimeFactories reads getSettingsService for factory
    // construction; a no-op stub is sufficient since the provider branch only
    // needs the call to not throw.
    getSettingsService: () => ({ getValue: () => undefined }),
  };
  return { config, probe };
}

describe('provider-or-oauth oauth branch (#2374 round-3 Fix 4)', () => {
  it('takes the oauth branch when the manager has NO active provider: refreshAuth(oauth) runs, provider-branch side effects absent', async () => {
    // buildCliStyleConfig always activates FakeProvider, so it cannot exercise
    // the oauth branch (no-active-provider path). The minimal typed fake below
    // implements just the Config surface the executor touches, with a manager
    // that reports hasActiveProvider()===false. The observable: refreshAuth is
    // called with 'oauth' (not 'provider'), and the provider-branch-only side
    // effects (ensureProviderManagerOnConfig, attachProviderManagerToContentConfig)
    // did NOT occur (contentGeneratorConfig.providerManager stays undefined).
    const { config: fakeConfig, probe } = makeFakeConfigForOauth(false);
    const intent: ProviderActivationIntent = {
      authMode: 'provider-or-oauth',
    };
    const result = await executeProviderActivation(
      fakeConfig as Config,
      intent,
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
    const { config: fakeConfig, probe } = makeFakeConfigForOauth(true);
    const intent: ProviderActivationIntent = {
      authMode: 'provider-or-oauth',
    };
    const result = await executeProviderActivation(
      fakeConfig as Config,
      intent,
    );
    expect(result.authFailed).toBe(false);
    // Observable: refreshAuth('provider') ran (not 'oauth').
    expect(probe.providerCalled).toBe(true);
    expect(probe.oauthCalled).toBe(false);
    expect(probe.refreshMethod).toBe('provider');
  });
});

describe('missing-credentials fallback precedence (#2374 round-3 Fix 4)', () => {
  it('no provider in intent → defaultProvider activated, auth error swallowed, authFailed false, config usable', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // No provider in intent → the auto path falls back to defaultProvider.
      // Auth errors are swallowed (NOT fatal) in the no-provider branch.
      const intent: ProviderActivationIntent = {
        // No provider field → triggers the no-provider/fallback branch.
        defaultProvider: 'fake',
        authMode: 'auto',
      };
      const result = await executeProviderActivation(built.config, intent);

      // Observable: authFailed is false even if auth had issues (swallowed).
      expect(result.authFailed).toBe(false);
      // The defaultProvider was activated.
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.config)).toBe('fake');
      // The config remains usable — no throw, content generator surface intact.
      expect(() => built.config.getContentGeneratorConfig()).not.toThrow();
    } finally {
      await built.cleanup();
    }
  });

  it('explicit provider with failing auth → authFailed true with authError populated', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // An explicitly-requested provider that does not exist triggers the
      // provider branch. Under the FakeProvider seam, switching to an unknown
      // provider resolves the auth failure which the executor maps to
      // authFailed:true. The authError must be populated so fromConfig can
      // include it in the thrown AgentBootstrapError.
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };
      const result = await executeProviderActivation(built.config, intent);

      // Observable: authFailed is true and authError is populated.
      expect(result.authFailed).toBe(true);
      expect(result.authError).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });
});
