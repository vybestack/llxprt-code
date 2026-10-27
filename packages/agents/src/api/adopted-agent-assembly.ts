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
import { cleanupProviderScope } from '../session/session-client-cleanup.js';
import { acquireSessionClient } from '../session/session-client-binding.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import { type Agent } from './agent.js';
import {
  AgentBootstrapError,
  generateRuntimeId,
  recordOwnership,
  validateAgentRuntimeId,
} from './agentBootstrap.js';
import {
  FromConfigValidatableSchema,
  type AgentAdoptionIntent,
  type AgentSchedulerHandle,
} from './config-types.js';
import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import {
  type FacadeParsedConfig,
  type LeafFacadeValues,
} from './agent-facade.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';
import {
  ForegroundAssembly,
  type ForegroundPreflightSettings,
  type ForegroundPreflightTransfer,
} from './foreground-agent-assembly.js';
import type {
  PreflightAuthInput,
  PreflightProviderInput,
} from './activationPreflightState.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type {
  AdoptedMcpPort,
  McpTeardownPort,
  SessionWorkspaceReadsPort,
} from './mcpRuntimePorts.js';
import { assembleModelSelection } from './model-selection.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import { acquireAdoptedMedia } from './session-image-assembly.js';
import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';

export interface AdoptedProviderResources {
  manager: RuntimeProviderManager;
  oauth: OAuthManager;
}

/** The publication the adopted assembly needs from the operation that owns it. */
export interface AdoptionLifecyclePort {
  validateIdentity(): void;
  publish(agent: Agent): Promise<Agent>;
}

/** The caller-owned values the `fromConfig` path adopts. */
export interface AdoptionSessionInput {
  config: Config;
  settingsService: SettingsService;
  intent: AgentAdoptionIntent;
  credentialAuthority: CredentialAuthority;
}

/**
 * The construction steps the preflight drives on the assembly that finishes the
 * foreground it hands over.
 */
export interface ForegroundAdoptionView {
  assertOpen(): void;
  closeConstructionAdmission(): void;
  acceptPreflightTransfer(
    transfer: ForegroundPreflightTransfer,
    settings: ForegroundPreflightSettings,
    providers: PreflightProviderInput,
    auth: PreflightAuthInput,
  ): void;
  finishForeground(): Promise<Agent>;
}

/**
 * Adopts the caller's session. It acquires the adopted owners, hands them to the
 * concrete foreground it holds, and keeps nothing of its own after publication.
 */
export class AdoptedAgentAssembly implements ForegroundAdoptionView {
  readonly #config: Config;
  #adoption: AdoptionSessionInput | undefined;
  #lifecycle: AdoptionLifecyclePort | undefined;
  #settingsService!: SettingsService;
  #intent!: AgentAdoptionIntent;
  #mcp!: AdoptedMcpPort;
  #media: SessionMediaOwner | undefined;
  #selectedSettings!: SessionSettingsOwner;
  #files!: ProviderFileLifecycle;
  #tokenizer!: RuntimeTokenizerFactory;
  #content!: RuntimeContentGeneratorFactory<ContentGenerator>;
  #runtimeId!: string;
  #authority!: CredentialAuthority;
  #oAuthBus!: MessageBus;
  #providers!: AdoptedProviderResources;
  #client!: SessionClientOwner;
  #foreground: ForegroundAssembly | undefined;
  #agent!: Agent;
  readonly #release = new AcquisitionRelease();
  readonly #construction = new AbortController();

  private constructor(config: Config) {
    this.#config = config;
  }

  /** The `fromConfig` path: the assembly acquires and publishes the adopted agent. */
  static forAdoption(
    input: AdoptionSessionInput,
    lifecycle: AdoptionLifecyclePort,
  ): AdoptedAgentAssembly {
    const assembly = new AdoptedAgentAssembly(input.config);
    assembly.#adoption = input;
    assembly.#lifecycle = lifecycle;
    return assembly;
  }

  /** The preflight path: the assembly finishes the foreground it is handed. */
  static forPreflight(config: Config): AdoptedAgentAssembly {
    return new AdoptedAgentAssembly(config);
  }

  assertOpen(): void {
    this.#construction.signal.throwIfAborted();
  }

  closeConstructionAdmission(): void {
    this.#construction.abort();
  }

  acceptPreflightTransfer(
    transfer: ForegroundPreflightTransfer,
    settings: ForegroundPreflightSettings,
    providers: PreflightProviderInput,
    auth: PreflightAuthInput,
  ): void {
    this.#foreground = new ForegroundAssembly(
      this.#config,
      transfer,
      settings,
      providers,
      auth,
      this.#construction.signal,
    );
  }

  finishForeground(): Promise<Agent> {
    return this.#requireForeground().finishForeground();
  }

  async assembleAdoption(): Promise<Agent> {
    const adoption = this.#adoption;
    const lifecycle = this.#lifecycle;
    if (adoption === undefined || lifecycle === undefined)
      throw new Error('Adoption construction requires its adoption input');
    this.#settingsService = adoption.settingsService;
    this.#intent = adoption.intent;
    try {
      lifecycle.validateIdentity();
      const runtimeId = this.#adoptValidateIntent();
      await this.#adoptAdoptConfig(runtimeId, adoption.credentialAuthority);
      return await lifecycle.publish(this.#agent);
    } finally {
      this.#adoption = undefined;
      this.#lifecycle = undefined;
    }
  }

  #requireForeground(): ForegroundAssembly {
    const foreground = this.#foreground;
    if (foreground === undefined)
      throw new AgentBootstrapError('Foreground is not acquired');
    return foreground;
  }

  #adoptValidateIntent(): string {
    FromConfigValidatableSchema.parse({
      sessionId: this.#intent.sessionId,
      activation: this.#intent.activation,
    });
    const runtimeId = this.#intent.sessionId ?? generateRuntimeId();
    validateAgentRuntimeId(runtimeId);
    return runtimeId;
  }

  #adoptConstructMcp(): Promise<AdoptedMcpPort> {
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
        config: this.#config,
        managerFactory: McpClientManager,
        extensionLoader: { kind: 'none' },
        policy: { kind: 'none' },
        lsp: { kind: 'none' },
        filesystem: { kind: 'none' },
        filesystemService: { kind: 'none' },
        memory: { kind: 'none' },
        definitions: { kind: 'none' },
        trust: { kind: 'none' },
        ide: { kind: 'none' },
      },
      {
        emitFeedback: feedback,
        skillOperations: {
          kind: 'supplied',
          capability: DEFAULT_SKILL_OPERATIONS,
        },
        mcpSettings: { kind: 'none' },
      },
    );
  }

  async #adoptAdoptConfig(
    runtimeId: string,
    authority: CredentialAuthority,
  ): Promise<void> {
    this.#runtimeId = runtimeId;
    this.#authority = authority;
    this.#mcp = await this.#adoptConstructMcp();
    try {
      this.#media = acquireAdoptedMedia(this.#config);
      const manager = this.#adoptAcquireProviders();
      const oauth = this.#adoptAcquireOAuth(manager);
      this.#providers = { manager, oauth };
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.#release.rollback(),
        () => this.#mcp.dispose(),
        this.#media === undefined
          ? undefined
          : this.#media.dispose.bind(this.#media),
        undefined,
      );
    }
    await this.#adoptComplete();
  }

  #adoptAcquireProviders(): RuntimeProviderManager {
    const settingsOwner = new SessionSettingsOwner(this.#settingsService);
    this.#selectedSettings = settingsOwner;
    this.#release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.bindTelemetry(this.#config);
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
      proxy: this.#config.getProxy(),
    });
    this.#files = files;
    const scope = this.#config.getSessionId();
    for (const id of this.#runtimeId === scope
      ? [scope]
      : [this.#runtimeId, scope])
      this.#release.acquire('files', () => releaseAdoptedFileScope(files, id));
    return acquireAdoptedProviderManager(
      this.#config,
      this.#release,
      files,
      this.#settingsService,
      settingsOwner,
      this.#authority,
      this.#runtimeId,
    );
  }

  #adoptAcquireOAuth(manager: RuntimeProviderManager): OAuthManager {
    this.#tokenizer = configureProviderTokenizer(manager, undefined);
    this.#content = createRuntimeContentGeneratorFactory();
    this.#oAuthBus = this.#mcp.messageBus;
    return acquireAdoptedOAuth(
      this.#config,
      this.#release,
      manager,
      this.#authority,
      this.#settingsService,
      this.#oAuthBus,
      this.#runtimeId,
    );
  }

  async #adoptComplete(): Promise<void> {
    let client: SessionClientOwner | undefined;
    try {
      this.#client = await acquireAdoptedSession(
        this.#config,
        this.#intent,
        this.#selectedSettings,
        this.#media,
        this.#settingsService,
        this.#providers.manager,
        this.#providers.oauth,
        this.#content,
        this.#tokenizer,
        this.#files,
        this.#mcp,
        this.#authority,
      );
      client = this.#client;
      await this.#adoptInitializeSession();
      await this.#adoptFinalize();
    } catch (primary) {
      await cleanupFailedAdoption(
        primary,
        () => this.#release.close(),
        () => this.#mcp.dispose(),
        this.#media === undefined
          ? undefined
          : this.#media.dispose.bind(this.#media),
        client?.dispose.bind(client),
      );
    }
  }

  async #adoptInitializeSession(): Promise<void> {
    const client = this.#client;
    const bindings = adoptedClientBindings(
      this.#files,
      this.#providers.oauth,
      this.#config.getSessionId(),
    );
    client.clients.bindProviderFiles(
      bindings.files,
      bindings.retryOperations,
      bindings.cleanupScope,
    );
    client.bindInteractiveAuthRequests(bindings.interactiveAuth);
    client.bindMcpRuntime(
      this.#mcp,
      this.#mcp.profileDefinitions,
      this.#mcp.subagentDefinitions,
    );
    if (!client.hasHookComposition()) client.bindHooks();
    await activateAdoptedProviders(
      this.#config,
      this.#selectedSettings,
      this.#providers.manager,
      this.#providers.oauth,
      this.#settingsService,
      this.#tokenizer,
      this.#runtimeId,
    );
    await this.#mcp.initialize();
    await client.initializeTools();
  }

  async #adoptFinalize(): Promise<void> {
    await activateAdoptedSession(
      this.#config,
      this.#intent,
      this.#client,
      this.#settingsService,
      this.#providers.manager,
      this.#providers.oauth,
      this.#selectedSettings,
    );
    const parsed: FacadeParsedConfig = {
      provider:
        this.#providers.manager.getActiveProviderName() ??
        this.#config.getProvider() ??
        '',
      model:
        this.#selectedSettings.readSelectedModel() ?? this.#config.getModel(),
      ...(this.#intent.sessionId === undefined
        ? {}
        : { sessionId: this.#intent.sessionId }),
    };
    await this.#tokenizer.prepareTokenizer?.(parsed.provider, parsed.model);
    const handles: AgentSchedulerHandle[] = [];
    this.#foreground = this.#createForeground();
    this.assertOpen();
    this.#agent = await this.#foreground.publish({
      parsed,
      baseUrl: admittedEndpoint(this.#settingsService, parsed.provider),
      handles,
      scheduler: resolveSchedulerFactory(false, undefined, handles),
      leaf: facadeInputsForAdopted(
        this.#mcp,
        this.#release,
        this.#runtimeId,
        handles,
      ),
    });
  }

  #createForeground(): ForegroundAssembly {
    return new ForegroundAssembly(
      this.#config,
      {
        mcp: this.#mcp,
        mediaOwner: this.#media,
        sessionClient: this.#client,
        release: closeReleaseScope(this.#release),
      },
      { settingsOwner: this.#selectedSettings },
      { settings: this.#settingsService, manager: this.#providers.manager },
      { oauth: this.#providers.oauth },
      this.#construction.signal,
    );
  }
}

/**
 * The provider-file and interactive-auth callbacks the session client keeps for
 * its whole life. Built from owner values at module level so no closure handed
 * to the client shares a scope with the assembly.
 */
function adoptedClientBindings(
  files: ProviderFileLifecycle,
  oauth: OAuthManager,
  mainScope: string,
): {
  files: ProviderFileLifecycle;
  retryOperations: Parameters<
    SessionClientOwner['clients']['bindProviderFiles']
  >[1];
  cleanupScope: Parameters<
    SessionClientOwner['clients']['bindProviderFiles']
  >[2];
  interactiveAuth: Parameters<
    SessionClientOwner['bindInteractiveAuthRequests']
  >[0];
} {
  return {
    files,
    retryOperations: (provider) => oauth.composeRetryOperations(provider),
    cleanupScope: (scope) =>
      scope === mainScope
        ? Promise.resolve()
        : cleanupProviderScope(files, scope),
    interactiveAuth: (prompt) => oauth.requestInteractiveAuth(prompt),
  };
}

/** The one close capability for a release scope, created outside any asset. */
function closeReleaseScope(release: AcquisitionRelease): () => Promise<void> {
  return () => release.close();
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
  mcp: SessionWorkspaceReadsPort,
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
    {
      config,
      messageBus: undefined,
      workspacePaths: mcp.workspacePaths,
      readInstructions: mcp.readInstructions,
      imageOperation: undefined,
    },
    { settings: settingsService, settingsOwner: selectedSettings },
    manager,
    oauth,
    {
      contentGeneratorFactory: content,
      tokenizerFactory: tokenizer,
      providerFiles: files,
      mediaStore: store,
      authority,
      clientFactory: undefined,
    },
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
    () => client.clients.refreshAuth(),
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
      (method) => client.clients.refreshAuth(method),
      assembleModelSelection(selectedSettings),
    );
    if (result.authFailed) {
      const underlying = result.authError;
      throw new AgentBootstrapError(
        `fromConfig activation failed: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
        { cause: underlying },
      );
    }
  } else if (!client.clients.conversationBinding.isClientInitialized()) {
    await client.clients.refreshAuth(undefined);
  }
}

function facadeInputsForAdopted(
  runtime: McpTeardownPort,
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
