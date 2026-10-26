/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  ContentGenerator,
  MessageBus,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  McpClientManager,
} from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  HostCredentialOwner,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createOwnerAuthCacheInvalidator,
  createOwnedTokenStoreClose,
  createOwnerOAuthManager,
  createOAuthProfileReads,
  createRuntimeContentGeneratorFactory,
  createSessionAuthPolicyReader,
  NodeFileSystem,
  populateProviderManager,
} from '@vybestack/llxprt-code-providers/composition.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { type SettingsService } from '@vybestack/llxprt-code-settings';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { type SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
import { acquireSessionClient } from '../session/session-client-binding.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';
import { type Agent } from './agent.js';
import {
  AgentBootstrapError,
  createStableDisplayCallbacks,
  generateRuntimeId,
  recordOwnership,
  validateAgentRuntimeId,
  type StableDisplayCallbacksHolder,
} from './agentBootstrap.js';
import {
  FromConfigValidatableSchema,
  type AgentAdoptionIntent,
  type AgentSchedulerHandle,
} from './config-types.js';
import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import {
  assembleShellOwner,
  publishLeafFacade,
  type FacadeParsedConfig,
  type LeafFacadeValues,
} from './agent-facade.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import { ForegroundAssembly } from './foreground-agent-assembly.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleModelSelection } from './model-selection.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import { acquireAdoptedMedia } from './session-image-assembly.js';
import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';

export interface AdoptedProviderResources {
  manager: RuntimeProviderManager;
  oauth: OAuthManager;
}

export abstract class AdoptedAgentAssembly extends ForegroundAssembly {
  protected constructor(config?: Config) {
    super();
    if (config !== undefined) this.config = config;
  }
  protected abstract validateAdoptionIdentity(): void;
  protected abstract publishAdoptedAgent(agent: Agent): Promise<Agent>;
  protected adoptSettingsService!: SettingsService;
  protected adoptIntent!: AgentAdoptionIntent;
  protected adoptCredentialAuthority!: CredentialAuthority | undefined;
  protected adoptMcp!: McpRuntimeOwner;
  protected adoptMedia: SessionMediaOwner | undefined;
  protected adoptSelectedSettings!: SessionSettingsOwner;
  protected adoptFiles!: ProviderFileLifecycle;
  protected adoptTokenizer!: RuntimeTokenizerFactory;
  protected adoptContent!: RuntimeContentGeneratorFactory<ContentGenerator>;
  protected adoptRuntimeId!: string;
  protected adoptAuthority!: CredentialAuthority;
  protected adoptOAuthBus!: MessageBus;
  #providers!: AdoptedProviderResources;
  #client!: SessionClientOwner;
  protected async assembleAdoption(): Promise<Agent> {
    this.validateAdoptionIdentity();
    const runtimeId = this.#adoptValidateIntent();
    const credentialAuthority =
      this.adoptCredentialAuthority ??
      new HostCredentialOwner(process.env).authority;
    await this.#adoptAdoptConfig(runtimeId, credentialAuthority);
    return this.publishAdoptedAgent(this.#adoptAgent);
  }
  #adoptValidateIntent(): string {
    FromConfigValidatableSchema.parse({
      sessionId: this.adoptIntent.sessionId,
      activation: this.adoptIntent.activation,
    });
    const runtimeId = this.adoptIntent.sessionId ?? generateRuntimeId();
    validateAgentRuntimeId(runtimeId);
    return runtimeId;
  }
  #adoptConstructMcp(): Promise<McpRuntimeOwner> {
    const feedback = defaultFeedbackSink;
    return McpRuntimeOwner.create(
      {
        oauth: {
          getAuthProviderFactory: undefined,
          tokenStorage: new MCPOAuthTokenStorage(
            new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
          ),
          openBrowser: openBrowserSecurely,
        },
        config: this.config,
        managerFactory: McpClientManager,
        extensionLoader: undefined,
        policy: undefined,
        lspOwner: undefined,
        lspOwnership: 'runtime',
        filesystemOwner: undefined,
        filesystemOwnership: 'runtime',
        filesystemService: undefined,
        memoryOwner: undefined,
        definitionOwner: undefined,
        definitionOwnership: 'runtime',
        trustPort: undefined,
        trustCleanup: undefined,
        idePort: undefined,
      },
      {
        emitFeedback: feedback,
        skillOperations: DEFAULT_SKILL_OPERATIONS,
        mcpSettings: undefined,
      },
    );
  }
  #adoptAgent!: Agent;
  protected readonly adoptRelease = new AcquisitionRelease();
  async #adoptAdoptConfig(
    runtimeId: string,
    authority: CredentialAuthority,
  ): Promise<void> {
    this.adoptRuntimeId = runtimeId;
    this.adoptAuthority = authority;
    this.adoptMcp = await this.#adoptConstructMcp();
    try {
      this.adoptMedia = acquireAdoptedMedia(this.config);
      const manager = this.#adoptAcquireProviders();
      const oauth = this.#adoptAcquireOAuth(manager);
      this.#providers = { manager, oauth };
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.adoptRelease.rollback(),
        () => this.adoptMcp.dispose(),
        this.adoptMedia === undefined
          ? undefined
          : this.adoptMedia.dispose.bind(this.adoptMedia),
        undefined,
      );
    }
    await this.#adoptComplete();
  }
  #adoptAcquireProviders(): RuntimeProviderManager {
    const settingsOwner = new SessionSettingsOwner(this.adoptSettingsService);
    this.adoptSelectedSettings = settingsOwner;
    this.adoptRelease.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(this.config);
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
      proxy: this.config.getProxy(),
    });
    this.adoptFiles = files;
    const scope = this.config.getSessionId();
    for (const id of this.adoptRuntimeId === scope
      ? [scope]
      : [this.adoptRuntimeId, scope])
      this.adoptRelease.acquire('files', () =>
        releaseAdoptedFileScope(files, id),
      );
    return acquireAdoptedProviderManager(
      this.config,
      this.adoptRelease,
      files,
      this.adoptSettingsService,
      settingsOwner,
      this.adoptAuthority,
      this.adoptRuntimeId,
    );
  }
  #adoptAcquireOAuth(manager: RuntimeProviderManager): OAuthManager {
    this.adoptTokenizer = configureProviderTokenizer(manager, undefined);
    this.adoptContent = createRuntimeContentGeneratorFactory();
    this.adoptOAuthBus = this.adoptMcp.messageBus;
    return acquireAdoptedOAuth(
      this.config,
      this.adoptRelease,
      manager,
      this.adoptAuthority,
      this.adoptSettingsService,
      this.adoptOAuthBus,
      this.adoptRuntimeId,
    );
  }
  async #adoptComplete(): Promise<void> {
    let client: SessionClientOwner | undefined;
    try {
      this.#client = await acquireAdoptedSession(
        this.config,
        this.adoptIntent,
        this.adoptSelectedSettings,
        this.adoptMedia,
        this.adoptSettingsService,
        this.#providers.manager,
        this.#providers.oauth,
        this.adoptContent,
        this.adoptTokenizer,
        this.adoptFiles,
        this.adoptMcp,
        this.adoptAuthority,
      );
      client = this.#client;
      await this.#adoptInitializeSession();
      await this.#adoptFinalize();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.adoptRelease.close(),
        () => this.adoptMcp.dispose(),
        this.adoptMedia === undefined
          ? undefined
          : this.adoptMedia.dispose.bind(this.adoptMedia),
        client?.dispose.bind(client),
      );
    }
  }
  async #adoptInitializeSession(): Promise<void> {
    const client = this.#client;
    const mainScope = this.config.getSessionId();
    client.bindProviderFiles(
      this.adoptFiles,
      (provider) => this.#providers.oauth.composeRetryOperations(provider),
      (scope) =>
        scope === mainScope
          ? Promise.resolve()
          : cleanupProviderScope(this.adoptFiles, scope),
    );
    client.bindInteractiveAuthRequests((prompt) =>
      this.#providers.oauth.requestInteractiveAuth(prompt),
    );
    client.bindMcpRuntime(
      this.adoptMcp,
      this.adoptMcp.profileDefinitions,
      this.adoptMcp.subagentDefinitions,
    );
    if (!client.hasHookComposition()) client.bindHooks();
    await activateAdoptedProviders(
      this.config,
      this.adoptSelectedSettings,
      this.#providers.manager,
      this.#providers.oauth,
      this.adoptSettingsService,
      this.adoptTokenizer,
      this.adoptRuntimeId,
    );
    await this.adoptMcp.initialize();
    await client.initializeTools();
  }
  async #adoptFinalize(): Promise<void> {
    await activateAdoptedSession(
      this.config,
      this.adoptIntent,
      this.#client,
      this.adoptSettingsService,
      this.#providers.manager,
      this.#providers.oauth,
      this.adoptSelectedSettings,
    );
    const parsed = {
      provider:
        this.#providers.manager.getActiveProviderName() ??
        this.config.getProvider() ??
        '',
      model:
        this.adoptSelectedSettings.readSelectedModel() ??
        this.config.getModel(),
      ...(this.adoptIntent.sessionId === undefined
        ? {}
        : { sessionId: this.adoptIntent.sessionId }),
    };
    await this.adoptTokenizer.prepareTokenizer?.(parsed.provider, parsed.model);
    const handles: AgentSchedulerHandle[] = [];
    const scheduler = resolveSchedulerFactory(false, undefined, handles);
    this.assertConstructionOpen();
    this.#adoptAgent = await this.#adoptAcquireFacade(
      parsed,
      { baseUrl: admittedEndpoint(this.adoptSettingsService, parsed.provider) }
        .baseUrl,
      handles,
      scheduler,
    );
  }
  async #adoptAcquireFacade(
    parsed: FacadeParsedConfig,
    baseUrl: string | undefined,
    handles: AgentSchedulerHandle[],
    scheduler: SchedulerConstruction | undefined,
  ): Promise<Agent> {
    const tasks = assembleTaskOwner(this.adoptSettingsService, undefined);
    const shell = assembleShellOwner(this.adoptSettingsService);
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: {} };
      this.#client.toolCatalog.bindChildExecution(child, tasks, shell);
      this.#client.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        undefined,
        createStableDisplayCallbacks(editors, display),
      );
      this.#client.initializeConversation();
      const construction = {
        parsed,
        baseUrl,
        handles,
        tasks,
        shell,
        child,
        editors,
        display,
      };
      return publishLeafFacade(
        this.adoptMcp,
        this.config,
        this.#client,
        this.adoptSelectedSettings,
        this.adoptMedia,
        this.adoptSettingsService,
        this.#providers.manager,
        this.#providers.oauth,
        construction,
        facadeInputsForAdopted(
          this.adoptMcp,
          this.adoptRelease,
          this.adoptRuntimeId,
          handles,
        ),
      );
    } catch (primary) {
      return cleanupFailedShellBootstrap(primary, tasks, shell);
    }
  }
}

function acquireAdoptedProviderManager(
  config: Config,
  release: AcquisitionRelease,
  files: ProviderFileLifecycle,
  settingsService: SettingsService,
  selectedSettings: SessionSettingsOwner,
  authority: CredentialAuthority,
  runtimeId: string,
): RuntimeProviderManager {
  const network = new OwnedFetch(config.getProxy());
  release.beforeRelease(() => network.closeAdmissionAndAbort());
  release.acquire('network', () => network.dispose());
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    files,
    settingsService,
    config,
    adoptionProviderContext(runtimeId),
    undefined,
    selectedSettings,
  );
  manager.bindNetworkFetch(network.fetch);
  release.acquire('manager', () => manager.dispose());
  const storage = authority.createProviderKeyStorage();
  release.acquire('manager', () => storage.close());
  manager.bindProviderKeyStorage(storage);
  return manager;
}

function acquireAdoptedOAuth(
  config: Config,
  release: AcquisitionRelease,
  manager: RuntimeProviderManager,
  authority: CredentialAuthority,
  settingsService: SettingsService,
  bus: MessageBus,
  runtimeId: string,
): OAuthManager {
  const requestFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => manager.fetchNetwork(input, init);
  const store = authority.createTokenStore();
  release.acquire('tokens', createOwnedTokenStoreClose(store));
  const oauth = createOwnerOAuthManager(
    store,
    createFileOAuthSettingsProvider(),
    bus,
    createOAuthProfileReads(config.profileDirectory),
    createSessionAuthPolicyReader(settingsService),
    () => ({ runtimeId, runtimeKind: 'agent' }),
    undefined,
    createOwnerAuthCacheInvalidator((name) => manager.getProviderByName(name)),
    requestFetch,
  );
  release.acquire('oauth', () => oauth.dispose());
  return oauth;
}

async function activateAdoptedProviders(
  config: Config,
  selectedSettings: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  settingsService: SettingsService,
  tokenizer: RuntimeTokenizerFactory,
  runtimeId: string,
): Promise<void> {
  await selectedSettings.startTelemetry(config);
  manager.setRetryOperationsFactory?.((providerName, profileId) =>
    oauth.composeRetryOperations(
      providerName,
      profileId ? { profileId } : undefined,
    ),
  );
  manager.setRuntimeContext(
    adoptionProviderContext(runtimeId),
    selectedSettings,
    settingsService,
    config,
  );
  if (!(manager instanceof ProviderManager))
    throw new Error('Owned provider population requires its concrete manager');
  populateProviderManager(
    manager,
    oauth,
    oauth.getTokenStore(),
    settingsService,
    new NodeFileSystem(),
    config,
    undefined,
    undefined,
    false,
    false,
    process.env.LLXPRT_FAKE_RESPONSES,
  );
  manager.setTokenizerFactory(tokenizer);
  manager.setConfig(config);
}

function adoptionProviderContext(runtimeId: string) {
  return createProviderRuntimeContext({
    runtimeId,
    runtimeKind: 'agent',
    metadata: { source: 'cli-isolated-runtime-factory' },
  });
}

async function acquireAdoptedSession(
  config: Config,
  intent: AgentAdoptionIntent,
  selectedSettings: SessionSettingsOwner,
  media: SessionMediaOwner | undefined,
  settingsService: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  content: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizer: RuntimeTokenizerFactory,
  files: ProviderFileLifecycle,
  mcp: McpRuntimeOwner,
  authority: CredentialAuthority,
): Promise<SessionClientOwner> {
  selectedSettings.initializeProviderSelection(
    intent.activation?.provider ?? config.getProvider(),
    intent.activation?.model ?? config.getModel(),
  );
  const store = media?.store;
  if (store === undefined)
    throw new AgentBootstrapError(
      'Missing explicit session client media store',
    );
  return acquireSessionClient(
    config,
    settingsService,
    selectedSettings,
    manager,
    oauth,
    content,
    tokenizer,
    files,
    store,
    undefined,
    mcp.readInstructions,
    mcp.workspacePaths,
    authority,
  );
}

async function activateAdoptedSession(
  config: Config,
  intent: AgentAdoptionIntent,
  client: SessionClientOwner,
  settingsService: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  selectedSettings: SessionSettingsOwner,
): Promise<void> {
  const switchProvider = assembleProviderSwitch(
    config,
    settingsService,
    manager,
    oauth,
    () => 'agent',
    () => client.refreshAuth(),
    selectedSettings,
  );
  const activation = intent.activation;
  if (activation !== undefined) {
    const result = await executeProviderActivation(
      config,
      activation,
      switchProvider,
      settingsService,
      manager,
      (method) => client.refreshAuth(method),
      assembleModelSelection(selectedSettings),
    );
    if (result.authFailed) {
      const underlying = result.authError;
      throw new AgentBootstrapError(
        `fromConfig activation failed: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
        { cause: underlying },
      );
    }
  } else if (!client.isClientInitialized()) {
    await client.refreshAuth(undefined);
  }
}

function facadeInputsForAdopted(
  runtime: McpRuntimeOwner,
  release: AcquisitionRelease,
  runtimeId: string,
  handles: AgentSchedulerHandle[],
): LeafFacadeValues {
  const closeRuntime = (): Promise<void> => release.close();
  const ownership = recordOwnership({
    runtimeHandle: { cleanup: closeRuntime },
    injectedSchedulerHandles: handles,
    configOwnership: 'caller',
    disposeMcpRuntime: () => runtime.dispose(),
  });
  return {
    runtimeId,
    readRuntimeKind: () => 'agent',
    ownership,
    sessionIdentityOwnership: 'facade',
    onOAuthPrompt: undefined,
    closeRuntime,
    awaitMcpDiscovery: () => {
      if (ownership.disposed) throw new Error('MCP facade is closed');
      return runtime.awaitDiscovery();
    },
    closeMcpAdmission: () => runtime.closeAdmission(),
  };
}
