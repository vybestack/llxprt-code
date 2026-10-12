/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { MessageBus } from '@vybestack/llxprt-code-core';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';

import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderActivationResult } from './providerActivationExecutor.js';
import type {
  ProviderActivationIntent,
  FromConfigOptions,
} from './config-types.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { AgentBootstrapError } from './agentBootstrap.js';

export type ActivationPreflightToken = Readonly<object>;
export type AgentActivationPreflightResult = ProviderActivationResult & {
  readonly token?: ActivationPreflightToken;
};
export interface AgentActivationOperation {
  readonly oauthManager?: OAuthManager;
  readonly messageBus?: MessageBus;
  readonly tokenizerFactory?: SessionClientOwner['tokenizerFactory'];
  readonly contentGeneratorFactory?: SessionClientOwner['contentGeneratorFactory'];
  readonly providerFileLifecycle?: ProviderFileLifecycle;
  readonly workspaceTrust: WorkspaceTrustControlPort;
  readonly trustCleanup: (() => Promise<void>) | undefined;
  readonly workspaceDefinitions: WorkspaceDefinitionOwner;
  readonly workspaceFilesystem: WorkspaceFilesystemOwner;
  readonly workspaceMemory: WorkspaceMemoryOwner;
  readonly workspaceMemoryOwnership: 'borrowed' | 'transferred';
  preflight(
    intent: ProviderActivationIntent,
  ): Promise<AgentActivationPreflightResult>;
  dispose(): void | Promise<void>;
  takeMediaOwner(config: Config): SessionMediaOwner | undefined;
  readonly sessionClient: {
    runImageOperation: SessionClientOwner['runImageOperation'];
    workspaceDirectories(): readonly string[];
    getAgentClient(): ReturnType<SessionClientOwner['getAgentClient']>;
    refreshAuth(authMethod?: string): Promise<void>;
  };
  takeSessionClient(config: Config): SessionClientOwner;
  takeSettingsOwner(settings: SettingsService): SessionSettingsOwner;
  readonly settingsOwnerOwnership: 'borrowed' | 'transferred';
}
export interface ActivationPreflight {
  readonly operation: AgentActivationOperation;
  readonly token: ActivationPreflightToken;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalProviderActivationIntent(
  intent: ProviderActivationIntent,
): string {
  const overrides = intent.cliOverrides;
  return JSON.stringify(
    normalize({
      ...intent,
      provider: intent.provider ?? '',
      defaultProvider: intent.defaultProvider ?? '',
      model: intent.model ?? '',
      authMode: intent.authMode ?? 'auto',
      authMethod: intent.authMethod ?? '',
      providerSwitchPolicy: intent.providerSwitchPolicy ?? 'strict',
      cliOverrides:
        overrides === undefined
          ? undefined
          : {
              ...overrides,
              set:
                overrides.set === undefined
                  ? undefined
                  : [...overrides.set].sort(),
            },
    }),
  );
}

export class AgentActivationBootstrap implements AgentActivationOperation {
  readonly #config: Config;
  readonly #manager: RuntimeProviderManager | undefined;
  readonly #execute: (
    intent: ProviderActivationIntent,
  ) => Promise<ProviderActivationResult>;
  #mediaOwner: SessionMediaOwner | undefined;
  #ownsSessionClient = true;
  #ownsSettings = true;
  #ownsMemory: boolean;
  #attempt = 0;
  #disposed = false;
  #closing: Promise<void> | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #receipt:
    | {
        token: ActivationPreflightToken;
        fingerprint: string;
        result: ProviderActivationResult;
      }
    | undefined;

  readonly sessionClient: AgentActivationOperation['sessionClient'];
  get tokenizerFactory(): SessionClientOwner['tokenizerFactory'] {
    return this.ownedSessionClient.tokenizerFactory;
  }
  get contentGeneratorFactory(): SessionClientOwner['contentGeneratorFactory'] {
    return this.ownedSessionClient.contentGeneratorFactory;
  }
  get providerFileLifecycle(): ProviderFileLifecycle | undefined {
    const files = this.ownedSessionClient.providerFiles;
    if (files === undefined) return undefined;
    if (!(files instanceof ProviderFileLifecycle))
      throw new Error('Preflight requires its selected provider file owner');
    return files;
  }

  constructor(
    config: Config,
    manager: RuntimeProviderManager | undefined,
    execute: (
      intent: ProviderActivationIntent,
    ) => Promise<ProviderActivationResult>,
    mediaOwner: SessionMediaOwner | undefined,
    private readonly ownedSessionClient: SessionClientOwner,
    readonly workspaceFilesystem: WorkspaceFilesystemOwner,
    readonly workspaceMemory: WorkspaceMemoryOwner,
    private ownsFilesystem: boolean,
    private readonly settingsOwner: SessionSettingsOwner,
    readonly settingsOwnerOwnership: 'borrowed' | 'transferred' = 'transferred',
    readonly workspaceDefinitions: WorkspaceDefinitionOwner,
    private ownsDefinitions: boolean,
    readonly workspaceTrust: WorkspaceTrustControlPort,
    readonly trustCleanup: (() => Promise<void>) | undefined = undefined,
    readonly oauthManager?: OAuthManager,
    readonly messageBus?: MessageBus,
    readonly workspaceMemoryOwnership:
      | 'borrowed'
      | 'transferred' = ownsFilesystem ? 'transferred' : 'borrowed',
  ) {
    this.#ownsMemory = workspaceMemoryOwnership === 'transferred';
    this.sessionClient = {
      workspaceDirectories: () => workspaceFilesystem.paths.directories(),
      getAgentClient: () => ownedSessionClient.getAgentClient(),
      refreshAuth: (method) => ownedSessionClient.refreshAuth(method),
      runImageOperation: (input) => ownedSessionClient.runImageOperation(input),
    };
    this.#mediaOwner = mediaOwner;
    this.#config = config;
    this.#manager = manager;
    this.#execute = execute;
  }

  preflight(
    intent: ProviderActivationIntent,
  ): Promise<AgentActivationPreflightResult> {
    const attempt = ++this.#attempt;
    this.#receipt = undefined;
    const captured = structuredClone(intent);
    const fingerprint = canonicalProviderActivationIntent(captured);
    const pending = this.#tail.then(
      async (): Promise<AgentActivationPreflightResult> => {
        if (this.#disposed)
          return {
            authFailed: true,
            infoMessages: [],
            authError: new AgentBootstrapError(
              'Activation bootstrap is disposed',
            ),
          };
        let result: ProviderActivationResult;
        try {
          result = await this.#execute(captured);
        } catch (authError) {
          result = { authFailed: true, infoMessages: [], authError };
        }
        if (result.authFailed || !this.#isCurrent(attempt)) return result;
        const token = Object.freeze({});
        this.#receipt = { token, fingerprint, result };
        return { ...result, token };
      },
    );
    this.#tail = pending;
    return pending;
  }

  #isCurrent(attempt: number): boolean {
    return !this.#disposed && attempt === this.#attempt;
  }

  dispose(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#disposed = true;
    ++this.#attempt;
    this.#receipt = undefined;
    if (this.ownsDefinitions) this.workspaceDefinitions.closeAdmission();
    const memoryClosing = this.#ownsMemory
      ? this.workspaceMemory.dispose()
      : undefined;
    void memoryClosing?.catch(() => undefined);
    this.#closing = this.#tail.then(async () => {
      const client = this.#ownsSessionClient
        ? this.ownedSessionClient
        : undefined;
      const memoryCleanup = await Promise.allSettled([memoryClosing]);
      const clientCleanup = await Promise.allSettled([client?.dispose()]);
      const mediaCleanup = await Promise.allSettled([
        this.ownsDefinitions ? this.workspaceDefinitions.dispose() : undefined,
        this.#mediaOwner?.dispose(),
        this.ownsFilesystem ? this.trustCleanup?.() : undefined,
        this.ownsFilesystem ? this.workspaceFilesystem.dispose() : undefined,
      ]);
      const failures = [
        ...clientCleanup,
        ...memoryCleanup,
        ...mediaCleanup,
      ].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (this.#ownsSettings && this.settingsOwnerOwnership === 'transferred') {
        const settingsCleanup = await Promise.allSettled([
          this.settingsOwner.dispose(),
        ]);
        for (const result of settingsCleanup)
          if (result.status === 'rejected') failures.push(result.reason);
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Activation owner cleanup failed');
    });
    return this.#closing;
  }

  takeSettingsOwner(settings: SettingsService): SessionSettingsOwner {
    if (this.#disposed || !this.#ownsSettings)
      throw new AgentBootstrapError(
        'Session settings ownership is unavailable',
      );
    this.settingsOwner.assertSettingsIdentity(settings);
    this.#ownsSettings = false;
    return this.settingsOwner;
  }

  takeSessionClient(config: Config): SessionClientOwner {
    if (config !== this.#config)
      throw new AgentBootstrapError(
        'Session client belongs to a different Config',
      );
    if (!this.#ownsSessionClient)
      throw new AgentBootstrapError(
        'Session client ownership was already transferred',
      );
    this.#ownsSessionClient = false;
    this.ownsFilesystem = false;
    this.ownsDefinitions = false;
    this.#ownsMemory = false;
    return this.ownedSessionClient;
  }

  takeMediaOwner(config: Config): SessionMediaOwner | undefined {
    if (config !== this.#config)
      throw new AgentBootstrapError(
        'Media ownership belongs to a different Config',
      );
    const owner = this.#mediaOwner;
    this.#mediaOwner = undefined;
    return owner;
  }

  static validate(
    preflight: ActivationPreflight,
    config: Config,
    intent: ProviderActivationIntent | undefined,
    manager: RuntimeProviderManager | undefined,
  ): void {
    const operation = preflight.operation;
    if (
      !(operation instanceof AgentActivationBootstrap) ||
      !(#config in operation)
    )
      throw new AgentBootstrapError('Invalid activation bootstrap operation');
    if (
      operation.#disposed ||
      operation.#receipt === undefined ||
      operation.#receipt.token !== preflight.token
    )
      throw new AgentBootstrapError(
        'Activation preflight token is invalid or already consumed',
      );
    if (operation.#config !== config)
      throw new AgentBootstrapError(
        'Activation preflight belongs to a different Config',
      );
    if (operation.#manager !== manager)
      throw new AgentBootstrapError(
        'Activation preflight belongs to a different ProviderManager',
      );
    if (
      intent === undefined ||
      operation.#receipt.fingerprint !==
        canonicalProviderActivationIntent(intent)
    )
      throw new AgentBootstrapError(
        'Activation preflight intent mismatch or missing activation intent',
      );
  }

  static consume(
    preflight: ActivationPreflight,
    config: Config,
    intent: ProviderActivationIntent,
    manager: RuntimeProviderManager | undefined,
  ): ProviderActivationResult {
    AgentActivationBootstrap.validate(preflight, config, intent, manager);
    const operation = preflight.operation;
    if (
      !(operation instanceof AgentActivationBootstrap) ||
      operation.#receipt === undefined
    )
      throw new AgentBootstrapError('Invalid activation bootstrap operation');
    const result = operation.#receipt.result;
    operation.#disposed = true;
    ++operation.#attempt;
    operation.#receipt = undefined;
    return result;
  }

  static async close(operation: AgentActivationOperation): Promise<void> {
    if (operation instanceof AgentActivationBootstrap && #config in operation) {
      await operation.dispose();
    }
  }
}

export function assertPreflightOwners(options: FromConfigOptions): void {
  const preflight = options.activationPreflight?.operation;
  if (preflight === undefined) return;
  if (options.imageOperation !== undefined)
    throw new AgentBootstrapError(
      'Preflight image operations cannot be replaced during adoption',
    );
  for (const [supplied, retained] of [
    [options.oauthManager, preflight.oauthManager],
    [options.messageBus, preflight.messageBus],
    [options.tokenizerFactory, preflight.tokenizerFactory],
    [options.contentGeneratorFactory, preflight.contentGeneratorFactory],
    [options.providerFileLifecycle, preflight.providerFileLifecycle],
  ]) {
    if (
      supplied !== undefined &&
      retained !== undefined &&
      supplied !== retained
    )
      throw new AgentBootstrapError(
        'Preflight owners cannot be replaced during adoption',
      );
  }
}
