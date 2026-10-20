import { adoptFixture as fromConfig } from '../../../../agents/src/api/__tests__/helpers/adoption-fixture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from '../../../../agents/src/api/__tests__/helpers/session-client-capture.js';

import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { McpRuntimeOwner } from '../../../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { OwnedCredentialFixture } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import type { AgentRuntimeFactoryBindings } from '../../../../agents/src/api/runtimeFactories.js';
import { createAgentRuntimeFactoryBindings } from '../../../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import type {
  AgentConfig,
  ProviderActivationIntent,
} from '../../../../agents/src/api/config-types.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MemoryTokenStore } from '../../../../agents/src/api/__tests__/helpers/provider-auth-fixtures.js';
import { fixturesDir } from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  runNonInteractive,
  buildNonInteractiveActivationIntent,
} from '../../__tests__/noninteractive-run-fixture.js';
import { LoadedSettings } from '../../config/settings.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

class FailingOAuthRelease extends OAuthManager {
  override async dispose(): Promise<void> {
    throw new Error('oauth cleanup failed');
  }
}

class FailingLocalProvider extends FakeProvider {
  override async *generateChatCompletion(): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'accepted before primary failure' }],
    };
    throw new Error('local provider primary failure');
  }
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

class TelemetryCleanup {
  private readonly rollbackSteps: Array<() => void | Promise<void>> = [];
  #config!: Config;
  #settings!: SettingsService;
  #settingsOwner!: SessionSettingsOwner;
  #policy!: RuntimePolicyOwner;
  #mcp!: McpRuntimeOwner;
  #manager!: ReturnType<typeof acquirePreferredProviderManager>;
  #owner!: SessionClientOwner;
  #close!: () => Promise<void>;
  #factories!: AgentRuntimeFactoryBindings;
  #release!: AcquisitionRelease;
  #files!: ProviderFileLifecycle;
  #runtimeId!: string;
  #oAuth!: ReturnType<typeof acquirePreferredOAuth>;
  #tokenizer!: ReturnType<typeof configureProviderTokenizer>;
  #content!: ReturnType<typeof createRuntimeContentGeneratorFactory>;
  constructor(private readonly credentials: OwnedCredentialFixture) {}
  private async openCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const acquiredDirectory = await mkdtemp(join(tmpdir(), 'caller-adoption-'));
    this.rollbackSteps.push(() =>
      rm(acquiredDirectory, { recursive: true, force: true }),
    );
    const directory = await realpath(acquiredDirectory);
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    this.#config = new Config(parameters);
    this.rollbackSteps.push(() => this.#config.dispose());
    this.#factories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    this.#settings = new SettingsService();
    for (const [key, value] of Object.entries(
      this.#config.getInitialSettings(),
    ))
      this.#settings.set(key, value);
    this.#policy = new RuntimePolicyOwner(this.#config);
    this.rollbackSteps.push(() => this.#policy.dispose());
    injectConfirmationForcingPolicy(this.#policy.session.confirmation);
    this.#mcp = await buildTestMcpRuntime(
      this.#config,
      this.#policy.session.messageBus,
      overrides,
      extensionLoader,
      this.#policy,
      skillOperations,
    );
    this.rollbackSteps.push(() => this.#mcp.dispose());
    this.acquireCallerProviders();
    await this.complete(directory, previousReplay, selection.activation);
  }
  private async complete(
    directory: string,
    previousReplay: string | undefined,
    activation: ProviderActivationIntent | undefined,
  ): Promise<void> {
    const media = new SessionMediaOwner(
      this.#config.projectTempDir,
      1024 * 1024 * 1024,
    );
    this.rollbackSteps.push(() => media.dispose());
    this.#owner = await createCapturedSessionOwner(
      this.#config,
      assembleTaskSchemaPolicy(this.#settings),
      this.#manager,
      this.#factories.agentClientFactory,
      media.store,
      this.#mcp.readInstructions,
      this.#mcp.workspacePaths,
      this.#settingsOwner,
      this.#content,
      this.#tokenizer,
    );
    this.rollbackSteps.push(() => this.#owner.dispose());
    this.#owner.bindMcpRuntime(this.#mcp);
    this.#owner.bindProviderFiles(this.#files, (provider) =>
      this.#oAuth.composeRetryOperations(provider),
    );
    this.#owner.bindHooks();
    this.#close = settleEngineRelease.bind(
      undefined,
      [
        () => this.#owner.dispose(),
        () => this.#release.close(),
        () => media.dispose(),
        () => this.#mcp.dispose(),
        () => this.#policy.dispose(),
        () => this.#config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );

    await preparePreferredProviderCompletion(
      this.#config,
      this.#settings,
      this.#settingsOwner,
      this.#manager,
      this.#oAuth,
      this.#runtimeId,
      this.#tokenizer,
      undefined,
    );

    await this.#mcp.initialize();

    await this.activateCallerClient(activation);
  }

  private acquireCallerProviders(): void {
    this.#runtimeId = 'caller-' + randomUUID();
    this.#release = new AcquisitionRelease();
    this.rollbackSteps.push(() => this.#release.rollback());
    this.#settingsOwner = new SessionSettingsOwner(this.#settings);
    this.#release.acquire('settings', () => this.#settingsOwner.dispose());
    this.#settingsOwner.initializeProviderSelection(
      this.#config.getProvider(),
      this.#config.getModel(),
    );
    this.#settingsOwner.bindTelemetry(this.#config);
    this.#files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [this.#runtimeId, this.#config.getSessionId()])
      this.#release.acquire('files', () =>
        releaseAdoptedFileScope(this.#files, scope),
      );
    this.#manager = acquirePreferredProviderManager(
      this.#config,
      this.#settings,
      this.#settingsOwner,
      this.#files,
      this.#runtimeId,
      this.credentials.authority,
      this.#release,
    );
    const factoriesTokenizer = configureProviderTokenizer(this.#manager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    this.#tokenizer = factoriesTokenizer;
    this.#content = factoriesContent;
    this.#oAuth = acquirePreferredOAuth(
      undefined,
      this.#policy.session.messageBus,
      this.#config,
      this.#settings,
      this.#manager,
      this.#runtimeId,
      this.#mcp.profileDefinitions,
      this.credentials.authority,
      this.#release,
      undefined,
    );
  }
  private async activateCallerClient(
    intent: ProviderActivationIntent = {
      provider: this.#config.getProvider(),
      model: this.#config.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      this.#config,
      intent,
      assembleProviderSwitch(
        this.#config,
        this.#settings,
        this.#manager,
        this.#oAuth,
        () => 'agent',
        () => this.#owner.refreshAuth(),
        this.#settingsOwner,
      ),
      this.#settings,
      this.#manager,
      (method) => this.#owner.refreshAuth(method),
      assembleModelSelection(this.#settingsOwner),
    );
    requireCallerActivation(activation);
    await this.#owner.initializeTools();
    await capturedSessionClient(this.#owner).startChat();
  }
  private prepareCleanupFailure(directory: string, outfile: string): void {
    this.#manager.registerProvider(
      new FailingLocalProvider(
        join(fixturesDir, 'plain-text.jsonl'),
        directory,
      ),
    );
    this.#manager.setActiveProvider('fake');
    unlinkSync(outfile);
    mkdirSync(outfile);
  }
  private async exerciseCleanup(
    primary: boolean,
    directory: string,
    outfile: string,
  ): Promise<void> {
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
    if (primary) this.prepareCleanupFailure(directory, outfile);
    const directPolicy = new RuntimePolicyOwner(this.#config);
    let failure: unknown;
    try {
      await runNonInteractive({
        config: this.#config,
        settings,
        input: 'exercise public CLI cleanup',
        prompt_id: 'cleanup-proof',
        runtimeSettings: this.#settingsOwner,
        hasActiveProvider: () => this.#manager.hasActiveProvider(),
        isTrustedFolder: () => directPolicy.trust.isTrustedFolder(),
        acquireAgent: () =>
          fromConfig(
            this.#config,
            this.#settings,
            {
              sessionId: this.#config.getSessionId(),
              sessionIdentityOwnership: 'config',
              activation: buildNonInteractiveActivationIntent(
                this.#config,
                settings,
              ),
              mcpOwnership: 'agent',
            },
            this.#settingsOwner,
            this.#manager,
            new FailingOAuthRelease(new MemoryTokenStore()),
            directPolicy.session.messageBus,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            this.credentials.authority,
            directPolicy,
          ),
      });
    } catch (error) {
      failure = error;
    }
    try {
      await this.verifyBorrowedTelemetry(primary, outfile);
    } finally {
      try {
        await runCleanupSteps([() => directPolicy.dispose(), this.#close]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
    if (failure !== undefined) throw failure;
  }
  private async verifyBorrowedTelemetry(
    primary: boolean,
    outfile: string,
  ): Promise<void> {
    if (primary) rmSync(outfile, { recursive: true });
    this.#settingsOwner.telemetry.events.record(() => ({
      body: 'caller root survives facade release',
    }));
    await this.#settingsOwner.telemetry.flush();
    if (
      !readFileSync(outfile, 'utf8').includes(
        'caller root survives facade release',
      )
    )
      throw new Error(
        'Caller-owned telemetry retired during direct Agent disposal',
      );
  }
  async run(primary: boolean): Promise<void> {
    const directory = mkdtempSync(join(tmpdir(), 'public-cli-cleanup-'));
    const outfile = join(directory, 'caller-root.jsonl');
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    try {
      try {
        await this.openCaller('plain-text.jsonl', {
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
        });
      } catch (primary) {
        await cleanupAfterFailure(primary, () =>
          settleEngineRelease(
            [...this.rollbackSteps].reverse(),
            previousReplay,
          ),
        );
      }
      await this.exerciseCleanup(primary, directory, outfile);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
export async function runCleanupFailure(primary: boolean): Promise<void> {
  const credentials = await OwnedCredentialFixture.create();
  try {
    await new TelemetryCleanup(credentials).run(primary);
  } finally {
    await credentials.dispose();
  }
}

if (import.meta.main) {
  try {
    await runCleanupFailure(true);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(cleanupLeaves(error).join('\n') + '\n');
    process.exitCode = 1;
  }
}

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
