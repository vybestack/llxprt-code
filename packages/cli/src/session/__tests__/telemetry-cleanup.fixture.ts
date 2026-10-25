/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { OwnedCredentialFixture } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import {
  runNonInteractive,
  buildNonInteractiveActivationIntent,
} from '../../__tests__/noninteractive-run-fixture.js';
import { LoadedSettings } from '../../config/settings.js';

const FAILING_ALIAS = 'failing-local';

class FailingLocalProvider extends OpenAIProvider {
  constructor() {
    super('test-key', 'http://failing-local.invalid/v1');
  }

  protected override async *generateChatCompletionWithOptions(
    _options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'accepted before primary failure' }],
    };
    throw new Error('local provider primary failure');
  }
}

function contributeFailingProvider(): ProviderContributionRegistry {
  const providerId = `${FAILING_ALIAS}-provider`;
  return buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry) => {
              const provider = new FailingLocalProvider();
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [
              {
                alias: FAILING_ALIAS,
                config: {
                  baseProvider: providerId,
                  'base-url': 'http://failing-local.invalid/v1',
                  'requires-auth': false,
                  defaultModel: 'fake-model',
                  staticModels: [{ id: 'fake-model', name: 'Fake model' }],
                },
              },
            ],
          },
        ],
      },
    },
  ]);
}

/**
 * Wraps the credential authority so the first close of the token store the
 * OAuth owner acquires closes the real transport and then fails, which is how
 * a token-store retirement failure reaches the owner's disposal.
 */
function failingOAuthRetirement(
  base: CredentialAuthority,
): CredentialAuthority {
  return new (class extends CredentialAuthority {
    override createProviderKeyStorage(): ReturnType<
      CredentialAuthority['createProviderKeyStorage']
    > {
      return base.createProviderKeyStorage();
    }
    override createGitHubBrokerSocketClient(): ReturnType<
      CredentialAuthority['createGitHubBrokerSocketClient']
    > {
      return base.createGitHubBrokerSocketClient();
    }
    override createTokenStore(): TokenStore {
      const store = base.createTokenStore();
      if (!(store instanceof ProxyTokenStore))
        throw new TypeError('Expected a proxy token store');
      const client = store.getClient();
      const close = client.close.bind(client);
      let failed = false;
      client.close = (): void => {
        close();
        if (failed) return;
        failed = true;
        throw new Error('oauth cleanup failed');
      };
      return store;
    }
  })();
}

export function cleanupLeaves(error: unknown): string[] {
  if (
    error instanceof Error &&
    'errors' in error &&
    Array.isArray(error.errors)
  ) {
    return error.errors.flatMap((nested: unknown) => cleanupLeaves(nested));
  }
  return [String(error)];
}

async function verifyBorrowedTelemetry(
  settingsOwner: SessionSettingsOwner,
  primary: boolean,
  outfile: string,
): Promise<void> {
  if (primary) rmSync(outfile, { recursive: true });
  settingsOwner.telemetry.events.record(() => ({
    body: 'caller root survives facade release',
  }));
  await settingsOwner.telemetry.flush();
  if (
    !readFileSync(outfile, 'utf8').includes(
      'caller root survives facade release',
    )
  )
    throw new Error(
      'Caller-owned telemetry retired during direct Agent disposal',
    );
}

interface CleanupRoot {
  readonly route: RouteBPreflight;
  readonly settingsOwner: SessionSettingsOwner;
  readonly close: () => Promise<void>;
}

async function openCleanupRoot(
  primary: boolean,
  outfile: string,
  credentials: OwnedCredentialFixture,
): Promise<CleanupRoot> {
  const route = await openRouteBPreflight({
    authority: failingOAuthRetirement(credentials.authority),
    ...(primary ? { contributions: contributeFailingProvider() } : {}),
    config: {
      provider: primary ? FAILING_ALIAS : 'fake',
      sessionId: 'public-cli-cleanup',
      model: 'fake-model',
      tools: [],
      coreTools: [],
      mcpEnabled: false,
      extensionsEnabled: false,
      interactive: false,
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
      telemetry: { enabled: true, outfile, logPrompts: false },
    },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  const close = (): Promise<void> =>
    runCleanupSteps([() => route.close(), () => settingsOwner.dispose()]);
  try {
    for (const [key, value] of Object.entries(
      route.config.getInitialSettings(),
    ))
      route.settings.set(key, value);
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
  } catch (setupFailure) {
    await cleanupAfterFailure(setupFailure, close);
  }
  return { route, settingsOwner, close };
}

async function exerciseCleanup(
  primary: boolean,
  directory: string,
  outfile: string,
  credentials: OwnedCredentialFixture,
): Promise<void> {
  const { route, settingsOwner, close } = await openCleanupRoot(
    primary,
    outfile,
    credentials,
  );
  const settingFile = {
    path: join(directory, 'settings.json'),
    settings: {},
  };
  const settings = new LoadedSettings(
    settingFile,
    settingFile,
    settingFile,
    settingFile,
    true,
  );
  if (primary) {
    rmSync(outfile, { force: true });
    mkdirSync(outfile);
  }
  let failure: unknown;
  try {
    await runNonInteractive({
      config: route.config,
      settings,
      input: 'exercise public CLI cleanup',
      prompt_id: 'cleanup-proof',
      runtimeSettings: settingsOwner,
      hasActiveProvider: () => route.preflight.hasActiveProvider(),
      isTrustedFolder: () => route.trust.isTrustedFolder(),
      acquireAgent: () =>
        route.createAgent(
          buildNonInteractiveActivationIntent(route.config, settings),
        ),
    });
  } catch (error) {
    failure = error;
  }
  try {
    await verifyBorrowedTelemetry(settingsOwner, primary, outfile);
  } finally {
    await runCleanupSteps([close]);
  }
  if (failure !== undefined) throw failure;
}

export async function runCleanupFailure(primary: boolean): Promise<void> {
  const credentials = await OwnedCredentialFixture.create();
  const directory = mkdtempSync(join(tmpdir(), 'public-cli-cleanup-'));
  const outfile = join(directory, 'caller-root.jsonl');
  const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  if (!primary)
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
        import.meta.url,
      ),
    );
  try {
    await exerciseCleanup(primary, directory, outfile, credentials);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    try {
      await credentials.dispose();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

const entrypoint = import.meta;
if ('main' in entrypoint && entrypoint.main === true) {
  try {
    await runCleanupFailure(true);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(cleanupLeaves(error).join('\n') + '\n');
    process.exitCode = 1;
  }
}
