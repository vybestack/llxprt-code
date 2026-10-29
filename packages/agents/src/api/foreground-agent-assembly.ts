/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';

import { type Config } from '@vybestack/llxprt-code-core';

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
  type FacadeConstruction,
  type FacadeParsedConfig,
  type LeafFacadeValues,
} from './agent-facade.js';
import type { Agent } from './agent.js';
import { type AgentSchedulerHandle } from './config-types.js';

import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import type { McpTeardownPort, PublishedMcpPort } from './mcpRuntimePorts.js';
import type { PreflightProviderInput } from './activationPreflightState.js';

/** The runtime owners the foreground is handed once, exactly. */
export interface ForegroundPreflightTransfer {
  mcp: PublishedMcpPort;
  session: {
    prepareTokenizer(provider: string, model: string): Promise<void>;
    bindChildExecution: SessionClientOwner['toolCatalog']['bindChildExecution'];
    initializeExecution: SessionClientOwner['clients']['initializeExecution'];
    initializeConversation(): void;
    publish(construction: FacadeConstruction, leaf: LeafFacadeValues): Agent;
  };
  release(): Promise<void>;
}

/** The session settings owner the foreground is handed once. */
export interface ForegroundPreflightSettings {
  settingsOwner: SessionSettingsOwner;
}

/** The values a publication reads once, prepared by the construction path. */
export interface ForegroundPublication {
  parsed: FacadeParsedConfig;
  baseUrl: string | undefined;
  handles: AgentSchedulerHandle[];
  scheduler: SchedulerConstruction | undefined;
  leaf: LeafFacadeValues;
}

/**
 * The concrete foreground: it acquires nothing of its own, publishes the agent
 * from the owners it is handed, and keeps no live control afterwards.
 */
export class ForegroundAssembly {
  readonly #config: Config;
  readonly #transfer: ForegroundPreflightTransfer;
  readonly #settings: ForegroundPreflightSettings;
  readonly #providers: PreflightProviderInput;
  readonly #construction: AbortSignal;

  constructor(
    config: Config,
    transfer: ForegroundPreflightTransfer,
    settings: ForegroundPreflightSettings,
    providers: PreflightProviderInput,
    construction: AbortSignal,
  ) {
    this.#config = config;
    this.#transfer = transfer;
    this.#settings = settings;
    this.#providers = providers;
    this.#construction = construction;
  }

  async finishForeground(): Promise<Agent> {
    const handles: AgentSchedulerHandle[] = [];
    const provider =
      this.#providers.manager.getActiveProviderName() ??
      this.#config.getProvider() ??
      '';
    const model =
      this.#settings.settingsOwner.readSelectedModel() ??
      this.#config.getModel();
    await this.#transfer.session.prepareTokenizer(provider, model);
    this.#construction.throwIfAborted();
    return this.publish({
      parsed: { provider, model },
      baseUrl: admittedEndpoint(this.#providers.settings, provider),
      handles,
      scheduler: resolveSchedulerFactory(false, undefined, handles),
      leaf: facadeInputsForForeground(
        this.#transfer.mcp,
        this.#config,
        this.#transfer.release,
        handles,
      ),
    });
  }

  async publish(publication: ForegroundPublication): Promise<Agent> {
    const { session } = this.#transfer;
    const tasks = assembleTaskOwner(this.#providers.settings, undefined);
    const shell = assembleShellOwner(this.#providers.settings);
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: {} };
      session.bindChildExecution(child, tasks, shell);
      session.initializeExecution(
        withChildToolDisplay(
          publication.scheduler ??
            ((options) => new CoreToolScheduler(options)),
          child,
          tasks,
          shell,
        ),
        undefined,
        createStableDisplayCallbacks(editors, display),
      );
      session.initializeConversation();
      return session.publish(
        {
          parsed: publication.parsed,
          baseUrl: publication.baseUrl,
          handles: publication.handles,
          tasks,
          shell,
          child,
          editors,
          display,
        },
        publication.leaf,
      );
    } catch (primary) {
      return cleanupFailedShellBootstrap(primary, tasks, shell);
    }
  }
}

function facadeInputsForForeground(
  runtime: McpTeardownPort,
  config: Config,
  releaseProviders: () => Promise<void>,
  handles: AgentSchedulerHandle[],
): LeafFacadeValues {
  return {
    runtimeId: config.getSessionId(),
    readRuntimeKind: () =>
      config.isInteractive() ? 'cli-interactive' : 'agent',
    ownership: recordOwnership({
      injectedSchedulerHandles: handles,
      disposeMcpRuntime: () => runtime.dispose(),
    }),
    sessionIdentityOwnership: 'config',
    onOAuthPrompt: undefined,
    closeRuntime: releaseProviders,
    awaitMcpDiscovery: () => runtime.awaitDiscovery(),
    closeMcpAdmission: () => runtime.closeAdmission(),
  };
}
