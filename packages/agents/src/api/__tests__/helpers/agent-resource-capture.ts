import { capturedActivation } from './activation-acquisition-capture.js';
import { capturedSessionClient } from './session-client-capture.js';
import {
  MessageBusType,
  type MessageBusMessage,
} from '@vybestack/llxprt-code-policy';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { SessionToolCatalogOwner } from '../../../session/session-tool-catalog-owner.js';
import type { TaskLaunchOwner } from '../../../session/task-launch-owner.js';
import type { ShellJobOwner } from '../../../session/shell-job-owner.js';
import { spyOn } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { OwnershipRecord } from '../../agentBootstrap.js';
import * as agentBootstrap from '../../agentBootstrap.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { Agent } from '../../agent.js';
import type { AgentConfig } from '../../config-types.js';
import { adoptFixture as fromConfig } from './adoption-fixture.js';
import { createAgent } from '../../createAgent.js';
import {
  createAgentRuntimeFactoryBindings,
  type AgentRuntimeFactoryBindings,
} from '../../runtimeFactories.js';

const resourcesByAgent = new WeakMap<object, AgentResourceCapture>();

export class AgentResourceCapture {
  readonly clients: AgentClientContract[] = [];
  readonly sessionOwners: SessionClientOwner[] = [];
  taskOwner: TaskLaunchOwner | undefined;
  shellOwner: ShellJobOwner | undefined;
  private sequenceReceiver: AgentClientContract | undefined;
  private capturedSettings: SessionSettingsOwner | undefined;
  get settingsOwner(): SessionSettingsOwner {
    if (this.capturedSettings === undefined)
      throw new Error('No settings owner reached actual telemetry binding');
    return this.capturedSettings;
  }
  private capturedOwnership: OwnershipRecord | undefined;
  get ownership(): OwnershipRecord {
    if (this.capturedOwnership === undefined)
      throw new Error('No ownership record reached actual facade construction');
    return this.capturedOwnership;
  }
  private static readonly construction =
    new AsyncLocalStorage<AgentResourceCapture>();
  private static activeConstructions = 0;
  private static restoreConstruction: (() => void) | undefined;

  private readonly providerSettings = new Map<
    RuntimeProviderManager,
    SettingsService
  >();
  get settingsService(): SettingsService {
    const settings = this.providerSettings.get(this.manager);
    if (settings === undefined)
      throw new Error(
        'No settings service reached the acquired manager binding',
      );
    return settings;
  }
  private static observeProviderContext(): { mockRestore(): void } {
    const bind = ProviderManager.prototype.setRuntimeContext;
    return spyOn(
      ProviderManager.prototype,
      'setRuntimeContext',
    ).mockImplementation(function (this: ProviderManager, ...args) {
      bind.call(this, ...args);
      const capture = AgentResourceCapture.construction.getStore();
      if (capture !== undefined) {
        const settings = args[2];
        if (!(settings instanceof SettingsService))
          throw new Error('Expected the actual manager settings service');
        capture.providerSettings.set(this, settings);
      }
    });
  }
  private static observeChildExecution(): { mockRestore(): void } {
    const bind = SessionToolCatalogOwner.prototype.bindChildExecution;
    return spyOn(
      SessionToolCatalogOwner.prototype,
      'bindChildExecution',
    ).mockImplementation(function (this: SessionToolCatalogOwner, ...args) {
      const result = bind.call(this, ...args);
      const capture = AgentResourceCapture.construction.getStore();
      if (capture !== undefined) {
        capture.taskOwner = args[1];
        capture.shellOwner = args[2];
      }
      return result;
    });
  }
  private static observeConstruction(): () => void {
    const childExecution = AgentResourceCapture.observeChildExecution();
    const providerContext = AgentResourceCapture.observeProviderContext();
    const createSession = SessionClientOwner.create;
    const sessionCapture = spyOn(
      SessionClientOwner,
      'create',
    ).mockImplementation(async (...args) => {
      const owner = await createSession(...args);
      AgentResourceCapture.construction.getStore()?.sessionOwners.push(owner);
      return owner;
    });
    const subscribe = MessageBus.prototype.subscribe;
    const busCapture = spyOn(
      MessageBus.prototype,
      'subscribe',
    ).mockImplementation(function <T extends MessageBusMessage>(
      this: MessageBus,
      type: MessageBusType,
      listener: (message: T) => void,
    ) {
      const capture = AgentResourceCapture.construction.getStore();
      if (
        capture !== undefined &&
        type === MessageBusType.HOOK_EXECUTION_REQUEST
      )
        capture.capturedBus = this;
      return subscribe.bind(this)<T>(type, listener);
    });
    const bind = SessionSettingsOwner.prototype.bindTelemetry;
    const settingsCapture = spyOn(
      SessionSettingsOwner.prototype,
      'bindTelemetry',
    ).mockImplementation(function (this: SessionSettingsOwner, ...args) {
      const result = bind.call(this, ...args);
      const capture = AgentResourceCapture.construction.getStore();
      if (capture !== undefined) capture.capturedSettings = this;
      return result;
    });
    const record = agentBootstrap.recordOwnership;
    const ownershipCapture = spyOn(
      agentBootstrap,
      'recordOwnership',
    ).mockImplementation((...args) => {
      const owned = record(...args);
      const capture = AgentResourceCapture.construction.getStore();
      if (capture !== undefined) capture.capturedOwnership = owned;
      return owned;
    });
    return () => {
      ownershipCapture.mockRestore();
      settingsCapture.mockRestore();
      busCapture.mockRestore();
      sessionCapture.mockRestore();
      providerContext.mockRestore();
      childExecution.mockRestore();
    };
  }

  async construct(build: () => Promise<Agent>): Promise<Agent> {
    if (AgentResourceCapture.activeConstructions++ === 0)
      AgentResourceCapture.restoreConstruction =
        AgentResourceCapture.observeConstruction();
    try {
      return await AgentResourceCapture.construction.run(this, build);
    } finally {
      if (--AgentResourceCapture.activeConstructions === 0) {
        AgentResourceCapture.restoreConstruction?.();
        AgentResourceCapture.restoreConstruction = undefined;
      }
    }
  }
  publishedClient(agent: {
    getCurrentSequenceModel(): string | null;
  }): AgentClientContract {
    this.sequenceReceiver = undefined;
    agent.getCurrentSequenceModel();
    return this.requireSequenceReceiver();
  }
  private requireSequenceReceiver(): AgentClientContract {
    const receiver = this.sequenceReceiver;
    if (receiver === undefined)
      throw new Error(
        'No retained client received the actual sequence-model observation',
      );
    return receiver;
  }
  readonly historyReaders: AgentClientContract[] = [];
  async readObservedHistory(agent: Agent): ReturnType<Agent['getHistory']> {
    const captures = this.clients.map((client) => {
      const read = client.getHistory;
      return spyOn(client, 'getHistory').mockImplementation(async () => {
        const history = await read.call(client);
        this.historyReaders.push(client);
        return history;
      });
    });
    try {
      return await agent.getHistory();
    } finally {
      for (const capture of captures) capture.mockRestore();
    }
  }

  private readonly invocations = new Map<
    AgentClientContract,
    Parameters<AgentClientContract['bindProviderInvocation']>[0]
  >();
  prepareInvocation(
    agent: Agent,
    ...args: Parameters<
      Parameters<AgentClientContract['bindProviderInvocation']>[0]
    >
  ) {
    const invocation = this.invocations.get(this.publishedClient(agent));
    if (invocation === undefined)
      throw new Error('No invocation capability reached actual client binding');
    return invocation(...args);
  }
  private capturedBus: MessageBus | undefined;
  get messageBus(): MessageBus {
    if (this.capturedBus === undefined)
      throw new Error('No session bus reached actual tool construction');
    return this.capturedBus;
  }
  private capturedConfig: Config | undefined;
  private capturedManager: RuntimeProviderManager | undefined;
  private capturedTelemetry: RootTelemetry | undefined;

  bindAgent(agent: Agent): void {
    resourcesByAgent.set(agent, this);
  }

  get config(): Config {
    if (this.capturedConfig === undefined)
      throw new Error('No Config reached the real client factory');
    return this.capturedConfig;
  }

  get manager(): RuntimeProviderManager {
    if (this.capturedManager === undefined)
      throw new Error('No manager reached the real client binding');
    return this.capturedManager;
  }

  get telemetry(): RootTelemetry {
    if (this.capturedTelemetry === undefined)
      throw new Error('No telemetry reached the real client binding');
    return this.capturedTelemetry;
  }

  private observeFactoryResult(client: AgentClientContract | undefined): void {
    if (client !== undefined) {
      this.clients.push(client);
      this.observe(client);
    }
  }
  observe(client: AgentClientContract): void {
    const bindInvocation = client.bindProviderInvocation;
    client.bindProviderInvocation = (prepare) => {
      bindInvocation.call(client, prepare);
      this.invocations.set(client, prepare);
    };
    const getSequence = client.getCurrentSequenceModel;
    client.getCurrentSequenceModel = () => {
      this.sequenceReceiver = client;
      return getSequence.call(client);
    };
    const assertConfig = client.assertConfig;
    client.assertConfig = (config) => {
      assertConfig.call(client, config);
      this.capturedConfig = config;
    };
    const assertProvider = client.assertProviderManager;
    client.assertProviderManager = (manager) => {
      assertProvider.call(client, manager);
      this.capturedManager = manager;
    };
    const bindProvider = client.bindProviderSelection;
    if (bindProvider !== undefined) {
      client.bindProviderSelection = (selection, manager) => {
        bindProvider.call(client, selection, manager);
        this.capturedManager = manager;
      };
    }
    const bindTelemetry = client.bindTelemetry;
    client.bindTelemetry = (telemetry, diagnostics) => {
      bindTelemetry.call(client, telemetry, diagnostics);
      this.capturedTelemetry = telemetry;
    };
  }

  factories(
    supplied: AgentConfig['runtimeFactoryBindings'],
  ): AgentRuntimeFactoryBindings {
    const factories = supplied ?? createAgentRuntimeFactoryBindings();
    return {
      ...factories,
      taskToolRegistration: (registration) => {
        const selected = factories.taskToolRegistration(registration);
        return {
          ...selected,
          buildArgs: () => {
            const args = selected.buildArgs();
            const dependencies = args[1];
            if (
              typeof dependencies === 'object' &&
              dependencies !== null &&
              'messageBus' in dependencies &&
              dependencies.messageBus instanceof MessageBus
            )
              this.capturedBus = dependencies.messageBus;
            return args;
          },
        };
      },
      agentClientFactory: (...args) => {
        const client = factories.agentClientFactory(...args);
        this.capturedConfig = args[0];
        this.observeFactoryResult(client);
        return client;
      },
    };
  }
}

export function fixtureAgentResources(agent: object): AgentResourceCapture {
  const captured = resourcesByAgent.get(agent);
  if (captured === undefined)
    throw new Error('Agent has no construction-local resource capture');
  return captured;
}

export async function captureAgentAdoption(
  ...args: Parameters<typeof fromConfig>
): Promise<Agent> {
  const capture = new AgentResourceCapture();
  const preflight = args[8];
  const borrowed =
    args[9] ??
    (preflight === undefined
      ? undefined
      : capturedSessionClient(capturedActivation(preflight.operation).owner));
  if (borrowed !== undefined) {
    capture.observe(borrowed);
    capture.clients.push(borrowed);
  }
  args[13] = capture.factories(args[13]);
  const agent = await capture.construct(() => fromConfig(...args));
  capture.bindAgent(agent);
  return agent;
}

export async function captureAgentCreation(
  config: AgentConfig,
): Promise<Agent> {
  const capture = new AgentResourceCapture();
  const agent = await capture.construct(() =>
    createAgent({
      ...config,
      runtimeFactoryBindings: capture.factories(config.runtimeFactoryBindings),
    }),
  );
  capture.bindAgent(agent);
  return agent;
}
