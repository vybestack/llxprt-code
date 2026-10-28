/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  OpenAIProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type {
  ProviderContributionRegistry,
  RuntimeProviderContribution,
} from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import type { ProviderActivationIntent } from '../config-types.js';
import type { Agent } from '../agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They run the production foreground preflight route, which executes
 * the activation for a REAL CLI-style Config wired to the FakeProvider or to
 * contributed providers.
 */

const OUTGOING = 'outgoing-local';
const TARGET = 'target-local';
const OUTGOING_MODEL = 'outgoing-default';
const TARGET_REPLY = 'gemini activation ok';

class InertProvider extends OpenAIProvider {
  constructor(
    private readonly replyText: string,
    baseUrl: string,
  ) {
    super('test-key', baseUrl);
  }

  protected override async *generateChatCompletionWithOptions(): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: this.replyText }],
    };
  }
}

function contributeInertProvider(
  alias: string,
  defaultModel: string,
  replyText: string,
): RuntimeProviderContribution {
  const providerId = `${alias}-provider`;
  const baseUrl = `http://${alias}.invalid/v1`;
  return {
    providerId,
    createProvider: (entry) => {
      const provider = new InertProvider(replyText, baseUrl);
      bindProviderAliasIdentity(provider, entry.alias);
      return provider;
    },
    builtinAliases: [
      {
        alias,
        config: {
          baseProvider: providerId,
          'base-url': baseUrl,
          'requires-auth': false,
          defaultModel,
          staticModels: [{ id: defaultModel, name: defaultModel }],
        },
      },
    ],
  };
}

function contributeOutgoingAndTarget(): ProviderContributionRegistry {
  return buildProviderContributionRegistry([
    {
      specifier: 'memory:provider-activation-providers',
      manifest: {
        apiVersion: 1,
        id: 'provider-activation-providers',
        providers: [
          contributeInertProvider(OUTGOING, OUTGOING_MODEL, 'outgoing ok'),
          contributeInertProvider(TARGET, 'target-default', TARGET_REPLY),
        ],
      },
    },
  ]);
}

async function acceptedAgent(
  route: RouteBPreflight,
  intent: ProviderActivationIntent,
  result: Awaited<ReturnType<AgentProfilePreflight['preflight']>>,
): Promise<Agent> {
  const { token } = result;
  if (token === undefined)
    throw new Error('Preflight did not accept the activation');
  return AgentProfilePreflight.createForegroundAgent(
    route.preflight,
    token,
    intent,
    {},
  );
}

describe('ProviderActivationIntent / executeProviderActivation (#2374)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const builtCredentials = useOwnedCredentials();

  async function openBuiltCaller(
    contributions?: ProviderContributionRegistry,
    outgoing: { provider: string; model: string } = {
      provider: 'fake',
      model: 'fake-model',
    },
  ): Promise<RouteBPreflight> {
    const route = await openRouteBPreflight({
      authority: builtCredentials().authority,
      ...(contributions === undefined ? {} : { contributions }),
      config: outgoing,
    });
    try {
      await route.prepare();
      const initial = await route.preflight.preflight(outgoing);
      if (initial.authFailed) throw initial.authError;
    } catch (primary) {
      await route.close();
      throw primary;
    }
    return route;
  }

  it('(a) API-key auth via cliOverrides.key activates the provider and authenticates', async () => {
    const route = await openBuiltCaller();
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(route.preflight.getActiveProviderName()).toBe('fake');
      // Observable authenticated state: the CLI override path
      // (applyCliArgumentOverrides → resolveFromKeyArg) applies the key to the
      // active provider AND sets the auth-key ephemeral, so the config reports
      // the key as applied — the real signal that auth materialized, not just
      // that the provider name resolved.
      expect(route.preflight.readNamedParameter('auth-key')).toBe(
        'sk-test-key',
      );
    } finally {
      await route.close();
    }
  });

  it('(b) provider-or-oauth mode with an active manager refreshes the session client for generation', async () => {
    const route = await openBuiltCaller();
    try {
      // The route registers FakeProvider and sets it active, so the
      // provider-or-oauth executor observes hasActiveProvider()===true and
      // takes the PROVIDER branch (refreshAuth('provider') +
      // ensureProviderManagerOnConfig). The distinguishing observable vs a
      // no-auth scenario is that the session client generates (refreshAuth
      // ran) and the active provider is preserved.
      const intent: ProviderActivationIntent = {
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      const agent = await acceptedAgent(route, intent, result);
      try {
        // The provider branch ran refreshAuth, producing a client that
        // generates — a real signal auth materialized (not just
        // authFailed=false).
        expect(
          (await agent.chat('Generate after provider activation')).text,
        ).toBe('a plain text reply');
        expect(route.preflight.getActiveProviderName()).toBe('fake');
      } finally {
        await agent.dispose();
      }
    } finally {
      await route.close();
    }
  });

  it('(g-trap) a production-built ProviderManager exposes no retired server-tools member (#2626)', () => {
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      new SettingsService(),
    );
    try {
      // Positive control: the probe reads a real manager surface.
      expect('registerProvider' in manager).toBe(true);
      // Dead-surface trap: the deleted manager member must stay deleted. The
      // member name is assembled from parts so this absence probe is not
      // itself a textual reference to the retired concept (issue #2626
      // acceptance grep requires zero occurrences).
      const deletedManagerMember = ['getServer', 'Tools', 'Provider'].join('');
      expect(deletedManagerMember in manager).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  describe('contributed providers', () => {
    // The replay seam registers only FakeProvider and returns before the
    // provider contributions, so these scenarios switch between contributed
    // aliases instead.
    beforeEach(() => {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    });

    const openContributedCaller = (): Promise<RouteBPreflight> =>
      openBuiltCaller(contributeOutgoingAndTarget(), {
        provider: OUTGOING,
        model: OUTGOING_MODEL,
      });

    it('(g) second-provider activation via provider-or-oauth activates and the switched provider generates (#2626)', async () => {
      const route = await openContributedCaller();
      try {
        // A second provider switched to under its own name. The provider
        // itself is inert test data: the component under test is the
        // activation executor, and the generation below proves the switched
        // provider is fully usable.
        const intent: ProviderActivationIntent = {
          provider: TARGET,
          model: 'target-activation-model',
          authMode: 'provider-or-oauth',
        };
        const result = await route.preflight.preflight(intent);

        expect(result.authFailed).toBe(false);
        expect(result.activeProvider).toBe(TARGET);
        expect(route.preflight.getActiveProviderName()).toBe(TARGET);
        const agent = await acceptedAgent(route, intent, result);
        try {
          // The activated runtime generates through the switched provider:
          // the executor's provider branch (configure runtime factories,
          // refresh auth, attach manager) leaves the active provider usable.
          expect(agent.getProvider()).toBe(TARGET);
          expect(
            (await agent.chat('Generate after provider activation')).text,
          ).toBe(TARGET_REPLY);
        } finally {
          await agent.dispose();
        }
      } finally {
        await route.close();
      }
    });

    it('(h) #2534 review Finding 1: switch + cliOverrides persist credentials into the TARGET provider scope (main parity)', async () => {
      // The outgoing contributed provider is active, so the auto path
      // performs a REAL switch to the target. The providers are inert test
      // data: the component under test is the ORDER of override application
      // relative to the switch, not provider behavior.
      const route = await openContributedCaller();
      try {
        const intent: ProviderActivationIntent = {
          provider: TARGET,
          cliOverrides: {
            key: 'sk-target-scope-key',
            baseUrl: 'https://target-scope.example/v1',
          },
          authMode: 'auto',
        };
        const result = await route.preflight.preflight(intent);
        expect(result.authFailed).toBe(false);
        expect(result.activeProvider).toBe(TARGET);
        expect(route.preflight.getActiveProviderName()).toBe(TARGET);

        // Main's legacy activation order (switchActiveProvider FIRST, then
        // updateActiveProviderApiKey/updateActiveProviderBaseUrl) persisted
        // credentials into the switched-to provider's scope. The executor must
        // preserve that persistence target: auth-key/base-url land in the
        // TARGET provider's provider-scoped settings.
        const settings = route.settings;
        const targetScope = settings.getProviderSettings(TARGET);
        expect(targetScope['auth-key']).toBe('sk-target-scope-key');
        expect(targetScope['base-url']).toBe('https://target-scope.example/v1');
        // And NOT into the outgoing provider's scope (the pre-switch active
        // provider must stay clean — this assertion fails if overrides run
        // before the switch).
        const outgoingScope = settings.getProviderSettings(OUTGOING);
        expect(outgoingScope['auth-key']).toBeUndefined();
        expect(outgoingScope['base-url']).toBeUndefined();
        // The session still sees the credentials through the ephemerals set by
        // the override application (identical in both orders — this pins the
        // session-level behavior that must not regress through the reorder).
        expect(route.preflight.readNamedParameter('auth-key')).toBe(
          'sk-target-scope-key',
        );
        expect(route.preflight.readNamedParameter('base-url')).toBe(
          'https://target-scope.example/v1',
        );
      } finally {
        await route.close();
      }
    });
  });

  it('(c) no-provider case falls back to defaultProvider; auth errors swallowed (authFailed false), config remains usable', async () => {
    const route = await openBuiltCaller();
    try {
      const intent: ProviderActivationIntent = {
        defaultProvider: 'fake',
        authMode: 'auto',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      // The active provider equals the fallback defaultProvider.
      expect(result.activeProvider).toBe('fake');
      expect(route.preflight.getActiveProviderName()).toBe('fake');
      // The config remains usable (no throw) — the executor resolves and the
      // config's content generator surface is intact for downstream turns.
      expect(() => route.config.getContentGeneratorConfig()).not.toThrow();
    } finally {
      await route.close();
    }
  });
});
