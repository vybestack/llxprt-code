/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { CredentialProxyServer } from '../../../../../providers/src/auth/proxy/credential-proxy-server.js';
import {
  InMemoryTokenStore,
  InMemoryProviderKeyStorage,
} from '../../../../../providers/src/auth/proxy/__tests__/credential-proxy-server-helpers.js';
import { FakeProvider } from '../../../../../providers/src/fake/FakeProvider.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { AgentClient } from '../../../core/client.js';
import {
  captureAgentAdoption as fromConfig,
  fixtureAgentResources,
} from './agent-resource-capture.js';
import type { Agent } from '../../agent.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../core/subagent-cleanup.js';

export function generationGate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export class GenerationClient extends AgentClient {
  initialized = 0;
  disposed = 0;
  initializing: (() => Promise<void>) | undefined;
  initializedEffect: (() => void) | undefined;
  disposing: (() => Promise<void>) | undefined;
  override async initialize(config: ContentGeneratorConfig): Promise<void> {
    this.initialized += 1;
    await this.initializing?.();
    await super.initialize(config);
    this.initializedEffect?.();
  }
  override async dispose(): Promise<void> {
    this.disposed += 1;
    await this.disposing?.();
    await super.dispose();
  }
}

export class GenerationProvider extends FakeProvider {
  requests: GenerateChatOptions[] = [];
  generating: ((request: GenerateChatOptions) => Promise<void>) | undefined;
  override async *generateChatCompletion(
    options: GenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    if (Array.isArray(options))
      throw new Error('Expected owned request options');
    this.requests = [...this.requests, options];
    await this.generating?.(options);
    yield* super.generateChatCompletion(options);
  }
}

export async function withGenerationOwner(
  run: (
    owner: Agent,
    clients: GenerationClient[],
    provider: GenerationProvider,
    settings: SessionSettingsOwner,
  ) => Promise<void>,
  providerName = 'gemini',
  acquired?: (client: GenerationClient, index: number) => void,
  prepareTokenizer?: () => Promise<void>,
  borrowPrimary = false,
): Promise<readonly unknown[]> {
  const fixture = await GenerationOwnerFixture.create(
    providerName,
    acquired,
    prepareTokenizer,
  );
  return fixture.run(run, borrowPrimary);
}

class GenerationOwnerFixture {
  private source:
    | Awaited<ReturnType<typeof createGenerationSource>>
    | undefined;
  private session!: ReturnType<typeof createGenerationSession>;
  private workspace!: Awaited<ReturnType<typeof createGenerationWorkspace>>;
  private provider!: Awaited<ReturnType<typeof createGenerationProvider>>;
  private inputs!: ReturnType<typeof createGenerationClientInputs>;
  private owner: Agent | undefined;
  private readonly cleanup: Array<() => void | Promise<void>> = [];

  static async create(
    providerName: string,
    acquired: Parameters<typeof withGenerationOwner>[2],
    prepareTokenizer: Parameters<typeof withGenerationOwner>[3],
  ): Promise<GenerationOwnerFixture> {
    const fixture = new GenerationOwnerFixture();
    try {
      await fixture.acquire(providerName, acquired, prepareTokenizer);
      return fixture;
    } catch (primary) {
      return cleanupAfterFailure(primary, () => fixture.release());
    }
  }

  private async acquire(
    providerName: string,
    acquired: Parameters<typeof withGenerationOwner>[2],
    prepareTokenizer: Parameters<typeof withGenerationOwner>[3],
  ): Promise<void> {
    this.source = await createGenerationSource();
    this.session = createGenerationSession(this.source.directory, providerName);
    this.cleanup.unshift(() => this.session.config.dispose());
    this.cleanup.unshift(() => this.session.settingsOwner.dispose());
    this.workspace = await createGenerationWorkspace(this.session.config);
    this.cleanup.unshift(() => this.workspace.dispose());
    this.provider = await createGenerationProvider(
      this.session.config,
      this.session.settings,
      this.session.settingsOwner,
      this.source.fixture,
      this.source.directory,
      providerName,
    );
    this.cleanup.unshift(() => this.provider.credentials.stop());
    this.cleanup.unshift(() => this.provider.manager.dispose());
    this.inputs = createGenerationClientInputs(
      this.provider.manager,
      acquired,
      prepareTokenizer,
    );
    this.owner = await this.adopt();
  }

  private adopt(borrowed?: GenerationClient): Promise<Agent> {
    return fromConfig(
      this.session.config,
      this.session.settings,
      {},
      this.session.settingsOwner,
      this.provider.manager,
      undefined,
      undefined,
      this.workspace,
      undefined,
      borrowed,
      undefined,
      borrowed === undefined
        ? this.inputs.primaryTokenizer
        : this.inputs.tokenizer,
      createRuntimeContentGeneratorFactory(),
      this.inputs.constructionInputs(),
      undefined,
      this.provider.authority,
    );
  }

  async run(
    run: Parameters<typeof withGenerationOwner>[0],
    borrowPrimary: boolean,
  ): Promise<readonly unknown[]> {
    const owner = this.owner;
    if (owner === undefined)
      throw new Error('Generation owner was not acquired');
    let selected = owner;
    try {
      if (borrowPrimary) {
        const primary = fixtureAgentResources(owner).publishedClient(owner);
        if (
          !(primary instanceof GenerationClient) ||
          primary !== this.inputs.clients[1]
        )
          throw new Error(
            'Generation fixture primary differs from the published native receiver',
          );
        // Borrowed admission requires a live conversation, not only a configured client.
        await primary.startChat();
        selected = await this.adopt(primary);
      }
    } catch (primary) {
      return cleanupAfterFailure(primary, () => this.release());
    }
    this.inputs.admit();
    return runGenerationScenario(
      run,
      selected,
      this.inputs.clients,
      this.provider.provider,
      this.session.settingsOwner,
      [],
      () => this.release(selected),
    );
  }

  private async release(alreadyDisposed?: Agent): Promise<void> {
    await runCleanupSteps([
      ...(this.owner === undefined || this.owner === alreadyDisposed
        ? []
        : [() => this.owner?.dispose()]),
      ...this.cleanup,
      () => this.source?.restore(),
    ]);
  }
}

async function createGenerationSource(): Promise<{
  directory: string;
  fixture: string;
  restore: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'generation-owner-'));
  const fixture = fileURLToPath(
    new URL('../fixtures/multi-turn-text.jsonl', import.meta.url),
  );
  const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = fixture;
  return {
    directory,
    fixture,
    restore: async (): Promise<void> => {
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function createGenerationSession(
  directory: string,
  providerName: string,
): {
  config: Config;
  settings: SettingsService;
  settingsOwner: SessionSettingsOwner;
} {
  const config = createGenerationConfig(directory, providerName);
  const settings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.initializeProviderSelection(providerName, 'primary-model');
  settingsOwner.bindTelemetry(config);
  return { config, settings, settingsOwner };
}

async function createGenerationWorkspace(
  config: Config,
): ReturnType<typeof buildTestMcpRuntime> {
  const policy = new RuntimePolicyOwner(config);
  return buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
  );
}

function createGenerationClientInputs(
  manager: ProviderManager,
  acquired: Parameters<typeof withGenerationOwner>[2],
  prepareTokenizer: Parameters<typeof withGenerationOwner>[3],
): {
  clients: GenerationClient[];
  tokenizer: ReturnType<typeof configureProviderTokenizer>;
  primaryTokenizer: ReturnType<typeof configureProviderTokenizer>;
  constructionInputs: () => NonNullable<Parameters<typeof fromConfig>[13]>;
  admit: () => void;
} {
  const tokenizer = configureProviderTokenizer(manager);
  const clients: GenerationClient[] = [];
  let admitted = false;
  return {
    clients,
    tokenizer,
    primaryTokenizer: {
      ...tokenizer,
      prepareTokenizer: async (selectedProvider, selectedModel) => {
        if (admitted && prepareTokenizer !== undefined)
          await prepareTokenizer();
        else
          await tokenizer.prepareTokenizer?.(selectedProvider, selectedModel);
      },
    },
    constructionInputs: () => ({
      agentClientFactory: generationClientFactory(clients, acquired),
      taskToolRegistration: (registration) => registration,
    }),
    admit: (): void => {
      admitted = true;
    },
  };
}

async function runGenerationScenario(
  run: Parameters<typeof withGenerationOwner>[0],
  owner: Agent,
  clients: GenerationClient[],
  provider: GenerationProvider,
  settingsOwner: SessionSettingsOwner,
  cleanup: ReadonlyArray<() => void | Promise<void>>,
  restore: () => Promise<void>,
): Promise<readonly unknown[]> {
  const cleanupFailures: unknown[] = [];
  const release = (): Promise<void> =>
    runCleanupSteps([
      async () => {
        try {
          await owner.dispose();
        } catch (error) {
          cleanupFailures.push(error);
        }
      },
      ...cleanup,
      restore,
    ]);
  try {
    await run(owner, clients, provider, settingsOwner);
  } catch (primary) {
    return cleanupAfterFailure(primary, release);
  }
  await release();
  return cleanupFailures;
}

export const generationRecording = {
  transcriptPath: (): undefined => undefined,
  persistSemanticMediaPurge: async (): Promise<void> => {},
};

function createGenerationConfig(
  directory: string,
  providerName: string,
): Config {
  return new Config(
    toConfigParameters({
      provider: providerName,
      model: 'primary-model',
      sessionId: 'generation-owner',
      workingDir: directory,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
    }),
  );
}

function generationClientFactory(
  clients: GenerationClient[],
  acquired: ((client: GenerationClient, index: number) => void) | undefined,
): AgentClientFactory {
  return (
    selectedConfig,
    state,
    readInstructions,
    store,
    paths,
    instructions,
  ) => {
    if (
      readInstructions === undefined ||
      store === undefined ||
      paths === undefined
    )
      throw new Error('Missing generation client construction binding');
    const client = new GenerationClient(
      selectedConfig,
      state,
      readInstructions,
      store,
      paths,
      undefined,
      undefined,
      instructions,
    );
    clients.push(client);
    acquired?.(client, clients.length - 1);
    return client;
  };
}

async function createGenerationProvider(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  fixture: string,
  directory: string,
  providerName: string,
): Promise<{
  manager: ProviderManager;
  provider: GenerationProvider;
  credentials: CredentialProxyServer;
  authority: CredentialAuthority;
}> {
  const credentials = new CredentialProxyServer({
    tokenStore: new InMemoryTokenStore(),
    providerKeyStorage: new InMemoryProviderKeyStorage(),
  });
  let manager: ProviderManager | undefined;
  try {
    const authority = new CredentialAuthority(await credentials.start());
    manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      undefined,
      authority,
      settingsOwner,
    );
    const provider = new GenerationProvider(fixture, directory);
    provider.name = providerName;
    manager.registerProvider(provider);
    manager.setActiveProvider(providerName);
    return { manager, provider, credentials, authority };
  } catch (primary) {
    return cleanupAfterFailure(primary, () =>
      runCleanupSteps([() => manager?.dispose(), () => credentials.stop()]),
    );
  }
}
