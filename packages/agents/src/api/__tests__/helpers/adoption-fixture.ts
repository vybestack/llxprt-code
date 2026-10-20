import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentRuntimeFactoryBindings,
  Config,
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  TokenStore,
  WorkspaceDefinitionOwner,
  WorkspaceIdePort,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { type TokenStorage } from '@vybestack/llxprt-code-mcp';
import type { McpHostServices } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import { type ActivationPreflight } from '../../activationPreflightState.js';
import { AgentActivationBootstrap } from '../../activationPreflightState.js';
import type { Agent } from '../../agent.js';
import type {
  AgentAdoptionIntent,
  AgentConfig,
  AgentSchedulerFactory,
  ApprovalHandler,
  EditorCallbacks,
  OAuthPromptHandler,
} from '../../config-types.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { type SessionImageSelection } from '../../session-image-assembly.js';

import type { PrepareSessionTools } from '../../fromConfig.js';
class AdoptionFixture extends AgentActivationBootstrap {
  static construct(
    ...args: Parameters<AdoptionFixture['configure']>
  ): Promise<Agent> {
    const operation = this.selectAdoptionOwner(args[0], args[8]);
    return AdoptionFixture.prototype.configure.call(operation, ...args);
  }
  configure(
    config: Config,
    settingsService: SettingsService,
    intent: AgentAdoptionIntent = {},
    settingsOwner?: SessionSettingsOwner | undefined,
    providerManager?: RuntimeProviderManager | undefined,
    oauthManager?: OAuthManager | undefined,
    messageBus?: MessageBus | undefined,
    mcpRuntime?: McpRuntimeOwner | undefined,
    activationPreflight?: ActivationPreflight | undefined,
    agentClient?: AgentClientContract | undefined,
    providerFileLifecycle?: ProviderFileLifecycle | undefined,
    tokenizerFactory?: RuntimeTokenizerFactory | undefined,
    contentGeneratorFactory?: RuntimeContentGeneratorFactory<ContentGenerator>,
    runtimeFactoryBindings?: AgentRuntimeFactoryBindings | undefined,
    tokenStore?: TokenStore | undefined,
    credentialAuthority?: CredentialAuthority | undefined,
    policyOwner?: RuntimePolicyOwner | undefined,
    trustPort?: WorkspaceTrustControlPort | undefined,
    idePort?: WorkspaceIdePort | undefined,
    hookOwner?: SessionHookOwner | undefined,
    definitionOwner?: WorkspaceDefinitionOwner | undefined,
    filesystemOwner?: WorkspaceFilesystemOwner | undefined,
    lspOwner?: WorkspaceLspOwner | undefined,
    memoryOwner?: AgentConfig['memoryOwner'] | undefined,
    asyncTaskManager?: AsyncTaskManager | undefined,
    mcpHost?: Partial<McpHostServices> | undefined,
    mcpTokenStorage?: TokenStorage | undefined,
    githubBrokerClient?: GitHubBrokerClient | undefined,
    disposeGitHubBroker?: (() => Promise<void>) | undefined,
    imageOperation?: SessionImageSelection['imageOperation'] | undefined,
    onApproval?: ApprovalHandler | undefined,
    onOAuthPrompt?: OAuthPromptHandler | undefined,
    editorCallbacks?: EditorCallbacks | undefined,
    prepareSessionTools?: PrepareSessionTools,
    toolSchedulerFactory?: AgentSchedulerFactory | undefined,
    skillPolicy?: WorkspaceSkillAssemblyOperations['reloadPolicy'],
    registerSkillTools?: WorkspaceSkillAssemblyOperations['registerTools'],
  ): Promise<Agent> {
    this.adoptionConfig = config;
    this.adoptSettingsService = settingsService;
    this.adoptIntent = intent;
    this.adoptSettingsOwner = settingsOwner;
    this.adoptProviderManager = providerManager;
    this.adoptOauthManager = oauthManager;
    this.adoptMessageBus = messageBus;
    this.adoptMcpRuntime = mcpRuntime;
    this.adoptActivationPreflight = activationPreflight;
    this.adoptAgentClient = agentClient;
    this.adoptProviderFileLifecycle = providerFileLifecycle;
    this.adoptTokenizerFactory = tokenizerFactory;
    this.adoptContentGeneratorFactory = contentGeneratorFactory;
    this.adoptRuntimeFactoryBindings = runtimeFactoryBindings;
    this.adoptTokenStore = tokenStore;
    this.adoptCredentialAuthority = credentialAuthority;
    this.adoptPolicyOwner = policyOwner;
    this.adoptTrustPort = trustPort;
    this.adoptIdePort = idePort;
    this.adoptHookOwner = hookOwner;
    this.adoptDefinitionOwner = definitionOwner;
    this.adoptFilesystemOwner = filesystemOwner;
    this.adoptLspOwner = lspOwner;
    this.adoptMemoryOwner = memoryOwner;
    this.adoptAsyncTaskManager = asyncTaskManager;
    this.adoptMcpHost = mcpHost;
    this.adoptMcpTokenStorage = mcpTokenStorage;
    this.adoptGithubBrokerClient = githubBrokerClient;
    this.adoptDisposeGitHubBroker = disposeGitHubBroker;
    this.adoptImageOperation = imageOperation;
    this.adoptOnApproval = onApproval;
    this.adoptOnOAuthPrompt = onOAuthPrompt;
    this.adoptEditorCallbacks = editorCallbacks;
    this.adoptPrepareSessionTools = prepareSessionTools;
    this.adoptToolSchedulerFactory = toolSchedulerFactory;
    this.adoptSkillPolicy = skillPolicy;
    this.adoptRegisterSkillTools = registerSkillTools;
    return this.beginAdoption();
  }
}
export function adoptFixture(
  ...args: Parameters<typeof AdoptionFixture.construct>
): Promise<Agent> {
  return AdoptionFixture.construct(...args);
}
