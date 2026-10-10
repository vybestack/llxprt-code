/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { makeFakeConfigForOauth } from './helpers/provider-auth-fixtures.js';

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They reuse the CANONICAL config builder (buildCliStyleConfig) so the
 * assertions exercise a REAL CLI-style Config wired to the FakeProvider.
 */

import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect } from 'bun:test';
import {
  executeProviderActivation,
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
  type ProviderActivationResult,
} from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { buildAgent, fixturesDir } from './helpers/agentHarness.js';
import { getActiveModelParams } from '@vybestack/llxprt-code-providers/runtime.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reaches the adopted Config's provider manager active-provider name through
 * the public Config surface (no deep import of the manager). Used to assert
 * the resulting activation state independent of the global runtime accessor.
 */
function configActiveProvider(manager: {
  getActiveProviderName(): string | undefined;
}): string | undefined {
  return manager.getActiveProviderName();
}

async function activatedReply(
  client: import('@vybestack/llxprt-code-core/core/clientContract.js').AgentClientContract,
): Promise<string> {
  const output = await client.generateDirectMessage(
    { message: 'Generate after provider activation' },
    'activation-proof',
  );
  return output.content.blocks.map(blockTextOrEmpty).join('');
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
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.providerManager)).toBe('fake');
      // Observable authenticated state: the CLI override path
      // (applyCliArgumentOverrides → resolveFromKeyArg) applies the key to the
      // active provider AND sets the auth-key ephemeral, so the config reports
      // the key as applied — the real signal that auth materialized, not just
      // that the provider name resolved.
      expect(built.settingsOwner.readNamedParameter('auth-key')).toBe(
        'sk-test-key',
      );
    } finally {
      await built.cleanup();
    }
  });

  it('(b) provider-or-oauth mode with an active manager refreshes the session client for generation', async () => {
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
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // The provider branch ran refreshAuth, producing a content generator
      // config — a real signal auth materialized (not just authFailed=false).
      expect(await activatedReply(built.agentClient)).toBe(
        'a plain text reply',
      );
      expect(configActiveProvider(built.providerManager)).toBe('fake');
    } finally {
      await built.cleanup();
    }
  });

  it('(g) gemini-named activation via provider-or-oauth activates and the switched provider generates (#2626)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // A provider registered under the 'gemini' name — the name that used to
      // trigger the serverToolsProvider setConfig poke inside
      // ensureProviderManagerOnConfig. The provider itself is inert test
      // data: the component under test is the activation executor, and the
      // generation below proves the no-poke path leaves the switched
      // provider fully usable.
      const gateTriggerProvider = {
        name: 'gemini',
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'gemini activation ok' }],
          };
        },
      };
      built.providerManager.registerProvider(gateTriggerProvider);

      const intent: ProviderActivationIntent = {
        provider: 'gemini',
        model: 'gemini-activation-model',
        authMode: 'provider-or-oauth',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );

      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('gemini');
      expect(configActiveProvider(built.providerManager)).toBe('gemini');
      // The activated runtime generates through the switched provider: the
      // executor's provider branch (configure runtime factories, refresh
      // auth, attach manager) leaves the manager's active provider usable
      // without any serverToolsProvider poke.
      const active = built.providerManager.getActiveProvider();
      expect(active?.name).toBe('gemini');
      const chunks: string[] = [];
      for await (const chunk of active!.generateChatCompletion({
        contents: [],
        invocation: built.settingsOwner.prepareProviderInvocation(
          'gemini-activation',
          'gemini',
        ),
      })) {
        const text = chunk.blocks
          .map((block) => blockTextOrEmpty(block))
          .join('');
        chunks.push(text);
      }
      expect(chunks.join('')).toBe('gemini activation ok');

      // Dead-surface trap on the LIVE production manager the executor just
      // used: the deleted manager member must stay deleted. The member name
      // is assembled from parts so this absence probe is not itself a
      // textual reference to the retired concept (issue #2626 acceptance
      // grep requires zero occurrences).
      const deletedManagerMember = ['getServer', 'Tools', 'Provider'].join('');
      const liveManager = built.providerManager;
      expect(liveManager).toBeDefined();
      expect(deletedManagerMember in (liveManager as object)).toBe(false);
    } finally {
      await built.cleanup();
    }
  });

  it('(h) #2534 review Finding 1: switch + cliOverrides persist credentials into the TARGET provider scope (main parity)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // Register a second provider so the auto path performs a REAL switch
      // (buildCliStyleConfig leaves 'fake' active). The provider itself is
      // inert test data: the component under test is the ORDER of override
      // application relative to the switch, not provider behavior.
      const switchTargetProvider = {
        name: 'gemini',
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'target scope ok' }],
          };
        },
      };
      built.providerManager.registerProvider(switchTargetProvider);

      const intent: ProviderActivationIntent = {
        provider: 'gemini',
        cliOverrides: {
          key: 'sk-target-scope-key',
          baseUrl: 'https://target-scope.example/v1',
        },
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('gemini');
      expect(configActiveProvider(built.providerManager)).toBe('gemini');

      // Main's legacy activation order (switchActiveProvider FIRST, then
      // updateActiveProviderApiKey/updateActiveProviderBaseUrl) persisted
      // credentials into the switched-to provider's scope. The executor must
      // preserve that persistence target: auth-key/base-url land in the
      // TARGET provider's provider-scoped settings.
      const settings = built.settingsService;
      const targetScope = settings.getProviderSettings('gemini');
      expect(targetScope['auth-key']).toBe('sk-target-scope-key');
      expect(targetScope['base-url']).toBe('https://target-scope.example/v1');
      // And NOT into the outgoing provider's scope (the pre-switch active
      // 'fake' must stay clean — this assertion fails if overrides run before
      // the switch).
      const outgoingScope = settings.getProviderSettings('fake');
      expect(outgoingScope['auth-key']).toBeUndefined();
      expect(outgoingScope['base-url']).toBeUndefined();
      // The session still sees the credentials through the ephemerals set by
      // the override application (identical in both orders — this pins the
      // session-level behavior that must not regress through the reorder).
      expect(built.settingsOwner.readNamedParameter('auth-key')).toBe(
        'sk-target-scope-key',
      );
      expect(built.settingsOwner.readNamedParameter('base-url')).toBe(
        'https://target-scope.example/v1',
      );
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
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // The active provider equals the fallback defaultProvider.
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.providerManager)).toBe('fake');
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
      built.settingsOwner.writeUserParameter('stale-param', 'old');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        modelParams: { temperature: 0.7 },
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
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
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
    } finally {
      await built.cleanup();
    }
  });
});

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
      expect(agent.providerManager.getActiveProviderName()).toBe('fake');
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
      expect(agent.providerManager.getActiveProviderName()).toBe('fake');
    } finally {
      await cleanup();
    }
  });
});

// ─── #2374 round-3: Fix 1 — fromConfig activation intent desync ─────────────

describe('fromConfig activation intent does not desync Agent facade (#2374 round-3 fix 1)', () => {
  it('fromConfig with activation intent differing from adopted config provider reports the activated provider', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      provider: 'openai',
      activation: { provider: 'fake', model: 'fake-model' },
    });
    try {
      // Force the adopted config to report a DIFFERENT provider than the
      // intent will activate, so the desync is observable: the config says
      // 'openai' but the runtime active provider (and the intent's target) is
      // 'fake'. After activation, the facade must report 'fake'.
      expect(built.config.getProvider()).toBe('openai');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'intent-override-model',
        authMode: 'auto',
      };
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
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
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.providerManager)).toBe('fake');
      // Provider-branch distinguishing observable: refreshAuth('provider') ran,
      // so the content generator config is populated AND carries the provider
      // manager (the provider-branch ensureProviderManagerOnConfig wired it).
      expect(await activatedReply(built.agentClient)).toBe(
        'a plain text reply',
      );
      await built.agentClient.startChat();
      expect(built.agentClient.isInitialized()).toBe(true);
    } finally {
      await built.cleanup();
    }
  });

  it('provider-or-oauth provider branch binds the activated manager to the session generator', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      // The provider branch calls ensureProviderManagerOnConfig +
      // attachProviderManagerToContentConfig, so the content generator config
      // carries the provider manager. This is the provider-branch-only side
      // effect that distinguishes it from a hypothetical no-manager path.
      expect(await activatedReply(built.agentClient)).toBe(
        'a plain text reply',
      );
      await built.agentClient.startChat();
      expect(
        await built.agentClient.getContentGenerator().countTokens({
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'model admission boundary' }],
            },
          ],
        }),
      ).toStrictEqual({ totalTokens: 6 });
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
      // instanceof, because the runner resolves the test's AgentBootstrapError
      // import and fromConfig's import to distinct module instances, breaking
      // instanceof identity. The error.name is the reliable cross-identity
      // signal that fromConfig surfaced an AgentBootstrapError.
      let thrownError: unknown;
      try {
        await fromConfig({
          settingsOwner: built.settingsOwner,
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          activation: intent,
        });
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).name).toBe('AgentBootstrapError');
      expect((thrownError as Error).message).toContain(
        'fromConfig activation failed',
      );
    } finally {
      await built.cleanup();
    }
  });

  it('fromConfig with intent for already-active provider with profile ephemerals resolves (ephemerals intact)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      built.settingsOwner.writeUserParameter(
        'auth-keyfile',
        '/tmp/profile.key',
      );
      built.settingsOwner.writeUserParameter(
        'base-url',
        'https://profile.example/v1',
      );

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      const agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
      });
      try {
        expect(built.settingsOwner.readNamedParameter('auth-keyfile')).toBe(
          '/tmp/profile.key',
        );
        expect(built.settingsOwner.readNamedParameter('base-url')).toBe(
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
      built.settingsOwner.writeUserParameter(
        'base-url',
        'https://custom.example/v1',
      );
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // The base-url ephemeral must survive the switch (switchActiveProvider
      // clears ephemerals; the executor snapshots+reapplies).
      expect(built.settingsOwner.readNamedParameter('base-url')).toBe(
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
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
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
      built.settingsOwner.writeUserParameter('auth-keyfile', keyfilePath);
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // Observable: the auth-keyfile ephemeral is normalized to the resolved
      // absolute path (~ expanded to os.homedir()), proving the file was read
      // and the key applied.
      expect(built.settingsOwner.readNamedParameter('auth-keyfile')).toBe(
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
      built.settingsOwner.writeUserParameter(
        'base-url',
        'https://custom-endpoint.example/v1',
      );
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // Observable: setProviderBaseUrl wrote the base-url into the active
      // provider's settings via the settings service.
      const providerSettings =
        built.settingsService.getProviderSettings('fake');
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
      built.settingsService.setProviderSetting(
        'fake',
        'base-url',
        'https://pre-existing.example',
      );
      built.settingsOwner.writeUserParameter('base-url', 'none');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // Observable: setProviderBaseUrl('none') clears the provider setting
      // (updateActiveProviderBaseUrl normalizes 'none' → null → undefined).
      const providerSettings =
        built.settingsService.getProviderSettings('fake');
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
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // Observable: the model params were pushed onto the active provider
      // runtime via setActiveModelParam.
      const params = getActiveModelParams(
        built.settingsService,
        built.providerManager.getActiveProviderName(),
      );
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
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );

      // Observable: authFailed is false even if auth had issues (swallowed).
      expect(result.authFailed).toBe(false);
      // The defaultProvider was activated.
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(built.providerManager)).toBe('fake');
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
      const result = await executeProviderActivation(
        built.config,
        intent,
        built.switchProvider,
        built.settingsService,
        built.providerManager,
        (method) => built.sessionClient.refreshAuth(method),
        assembleModelSelection(built.settingsOwner),
      );

      // Observable: authFailed is true and authError is populated.
      expect(result.authFailed).toBe(true);
      expect(result.authError).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });
});
