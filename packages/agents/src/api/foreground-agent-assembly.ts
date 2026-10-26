import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';

import {
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type WorkspaceDefinitionOwner,
  type WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';

import { type WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { type WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { type SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';

import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';

import {
  createStableDisplayCallbacks,
  recordOwnership,
  type StableDisplayCallbacksHolder,
} from './agentBootstrap.js';
import {
  assembleShellOwner,
  publishLeafFacade,
  type FacadeConstruction,
  type FacadeParsedConfig,
  type LeafFacadeValues,
} from './agent-facade.js';
import type { Agent } from './agent.js';
import { type AgentSchedulerHandle } from './config-types.js';

import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export class ForegroundAssembly {
  protected config!: Config;
  readonly #constructionCancellation = new AbortController();

  protected closeConstructionAdmission(): void {
    this.#constructionCancellation.abort();
  }
  protected mediaOwner: SessionMediaOwner | undefined;
  protected ownsSessionClient = true;
  protected ownsSettings = true;
  protected ownsMemory = false;
  protected providerFileLifecycle!: ProviderFileLifecycle | undefined;
  protected ownedSessionClient!: SessionClientOwner;
  protected workspaceFilesystem!: WorkspaceFilesystemOwner;
  protected workspaceMemory!: WorkspaceMemoryOwner;
  protected ownsFilesystem!: boolean;
  protected settingsOwner!: SessionSettingsOwner;
  protected settingsOwnerOwnership!: 'borrowed' | 'transferred';
  protected workspaceDefinitions!: WorkspaceDefinitionOwner;
  protected ownsDefinitions!: boolean;
  protected workspaceTrust!: WorkspaceTrustControlPort;
  protected trustCleanup!: (() => Promise<void>) | undefined;
  protected oauthManager!: OAuthManager | undefined;
  protected messageBus!: MessageBus | undefined;
  protected workspaceMemoryOwnership!: 'borrowed' | 'transferred';
  protected foregroundMcp: McpRuntimeOwner | undefined;
  protected foregroundSettings!: SettingsService;
  protected foregroundManager!: RuntimeProviderManager;
  protected foregroundOAuth!: OAuthManager;
  protected releaseForegroundProviders!: () => Promise<void>;
  protected assertConstructionOpen(): void {
    this.#constructionCancellation.signal.throwIfAborted();
  }
  protected async finishForeground(): Promise<Agent> {
    const handles: AgentSchedulerHandle[] = [];
    const provider =
      this.foregroundManager.getActiveProviderName() ??
      this.config.getProvider() ??
      '';
    const model =
      this.settingsOwner.readSelectedModel() ?? this.config.getModel();
    await this.ownedSessionClient.tokenizerFactory.prepareTokenizer?.(
      provider,
      model,
    );
    this.assertConstructionOpen();
    return this.#acquireFacade(
      { provider, model },
      admittedEndpoint(this.foregroundSettings, provider),
      handles,
      resolveSchedulerFactory(false, undefined, handles),
    );
  }
  async #acquireFacade(
    parsed: FacadeParsedConfig,
    baseUrl: string | undefined,
    handles: AgentSchedulerHandle[],
    scheduler: SchedulerConstruction | undefined,
  ): Promise<Agent> {
    const tasks = assembleTaskOwner(this.foregroundSettings, undefined);
    const shell = assembleShellOwner(this.foregroundSettings);
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: {} };
      this.ownedSessionClient.toolCatalog.bindChildExecution(
        child,
        tasks,
        shell,
      );
      this.ownedSessionClient.initializeExecution(
        withChildToolDisplay(
          scheduler ?? ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        undefined,
        createStableDisplayCallbacks(editors, display),
      );
      return this.#publish({
        parsed,
        baseUrl,
        handles,
        tasks,
        shell,
        child,
        editors,
        display,
      });
    } catch (primary) {
      return cleanupFailedShellBootstrap(primary, tasks, shell);
    }
  }
  #publish(construction: FacadeConstruction): Agent {
    if (this.foregroundMcp === undefined)
      throw new Error('Foreground facade is not acquired');
    this.ownedSessionClient.initializeConversation();
    return publishLeafFacade(
      this.foregroundMcp,
      this.config,
      this.ownedSessionClient,
      this.settingsOwner,
      this.mediaOwner,
      this.foregroundSettings,
      this.foregroundManager,
      this.foregroundOAuth,
      construction,
      facadeInputsForForeground(
        this.foregroundMcp,
        this.config,
        this.releaseForegroundProviders,
        construction.handles,
      ),
    );
  }
}

function facadeInputsForForeground(
  runtime: McpRuntimeOwner,
  config: Config,
  releaseProviders: () => Promise<void>,
  handles: AgentSchedulerHandle[],
): LeafFacadeValues {
  return {
    runtimeId: config.getSessionId(),
    readRuntimeKind: () =>
      config.isInteractive() ? 'cli-interactive' : 'agent',
    ownership: recordOwnership({
      runtimeHandle: { cleanup: releaseProviders },
      injectedSchedulerHandles: handles,
      configOwnership: 'agent',
      disposeMcpRuntime: () => runtime.dispose(),
    }),
    sessionIdentityOwnership: 'config',
    onOAuthPrompt: undefined,
    closeRuntime: releaseProviders,
    awaitMcpDiscovery: () => runtime.awaitDiscovery(),
    closeMcpAdmission: () => runtime.closeAdmission(),
  };
}
