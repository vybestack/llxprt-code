/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeHookDefinitions } from './hook-initialization.js';
/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
 * @requirement:HOOK-001,HOOK-003,HOOK-004,HOOK-005,HOOK-006,HOOK-007,HOOK-008,HOOK-142
 * @pseudocode:analysis/pseudocode/01-hook-system-lifecycle.md
 */

import type {
  HookDefinitionConfiguration,
  HookSessionRuntime,
} from './hook-configuration.js';
import { HookRegistry, type HookRegistryEntry } from './hookRegistry.js';
import { HookPlanner } from './hookPlanner.js';
import { HookRunner } from './hookRunner.js';
import { HookAggregator, type AggregatedHookResult } from './hookAggregator.js';
import {
  HookEventHandler,
  type HookExecutionOwner,
} from './hookEventHandler.js';
import { HookSystemNotInitializedError } from './errors.js';
import { DebugLogger } from '../debug/index.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { NotificationType } from './types.js';
import {
  type DefaultHookOutput,
  type SessionStartSource,
  type SessionEndReason,
  type PreCompressTrigger,
  type McpContext,
  BeforeModelHookOutput,
  AfterModelHookOutput,
  BeforeToolSelectionHookOutput,
} from './types.js';
import type { HookLLMRequest, HookLLMResponse } from './hookTranslator.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:system');

/**
 * HookSystem is the central coordinator for all hook infrastructure.
 * It owns single shared instances of HookRegistry, HookPlanner, HookRunner,
 * HookAggregator, and HookEventHandler, reused across all event fires.
 *
 * @requirement:HOOK-001 - Created lazily on first call to Config.getHookSystem()
 * @requirement:HOOK-003 - Calls HookRegistry.initialize() to load hooks from config
 * @requirement:HOOK-005 - Throws HookSystemNotInitializedError if accessed before initialize()
 * @requirement:HOOK-006 - Exposes getRegistry(), getEventHandler() as public accessors
 * @requirement:HOOK-007 - Trigger functions obtain components from HookSystem, never construct new ones
 * @requirement:HOOK-008 - First hook event fires initialize() before delegating to event handler
 * @requirement:HOOK-142 - Importable from packages/core/src/hooks/hookSystem.ts
 */
export class HookSystem {
  private readonly session: HookSessionRuntime;
  private readonly registry: HookRegistry;
  private readonly planner: HookPlanner;
  private readonly runner: HookRunner;
  private readonly aggregator: HookAggregator;
  private eventHandler: HookEventHandler | null = null;
  private initializationPromise: Promise<void> | undefined;
  private initializationGeneration = 0;
  private readonly initializationSignals = new Map<
    number,
    AbortSignal | undefined
  >();
  private lifecycleGeneration = 0;
  private readonly disposalController = new AbortController();
  private projectController = new AbortController();
  private readonly accepted = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;
  private readonly unsubscribeTrustPolicy: () => void;
  private readonly unsubscribeTrustTransition: () => void;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HSYS-001
   */
  private readonly messageBus:
    | Pick<MessageBus, 'subscribe' | 'publish'>
    | undefined;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HSYS-001
   */
  private readonly injectedDebugLogger: DebugLogger | undefined;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HSYS-001
   */
  constructor(
    readConfiguration: () => HookDefinitionConfiguration,
    session: HookSessionRuntime,
    messageBus?: Pick<MessageBus, 'subscribe' | 'publish'>,
    injectedDebugLogger?: DebugLogger,
  ) {
    this.session = session;
    this.messageBus = messageBus;
    this.injectedDebugLogger = injectedDebugLogger;
    // Create infrastructure components but don't initialize yet
    // @requirement:HOOK-006 - Own single shared instances
    this.registry = new HookRegistry(
      readConfiguration,
      session.isTrustedFolder,
    );
    this.planner = new HookPlanner(this.registry);
    this.runner = new HookRunner(
      session.process,
      session.isTrustedFolder,
      () => this.projectController.signal,
    );
    this.aggregator = new HookAggregator();
    this.unsubscribeTrustPolicy = session.onTrustPolicyChanged((trusted) => {
      if (!trusted)
        this.projectController.abort(
          new Error('Workspace hook trust withdrawn'),
        );
      else this.projectController = new AbortController();
    });
    this.unsubscribeTrustTransition = session.onTrustTransition(async () => {
      await Promise.allSettled([...this.accepted]);
      if (this.lifecycleGeneration > 0) return;
      try {
        await this.initialize();
      } catch (error) {
        if (
          !this.disposalController.signal.aborted ||
          error !== this.disposalController.signal.reason
        )
          throw error;
      }
    });
  }

  /**
   * Initialize the hook system. Must be called before getRegistry() or getEventHandler().
   * Can be called multiple times to reload hooks from config.
   *
   * WARNING: Not safe for concurrent calls. Ensure initialize() completes before
   * calling again. JavaScript is single-threaded but async, so callers must
   * await each initialize() call before starting another.
   *
   * @requirement:HOOK-003 - Calls HookRegistry.initialize() to load hooks from config
   * @requirement:HOOK-008 - Called by trigger functions on first event fire
   */
  initialize(signal?: AbortSignal): Promise<void> {
    if (this.lifecycleGeneration > 0) {
      return Promise.reject(new Error('HookSystem has been disposed.'));
    }
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason);
    }
    const generation = ++this.initializationGeneration;
    this.initializationSignals.set(generation, signal);
    if (this.initializationPromise !== undefined) {
      return this.initializationPromise;
    }
    const initialization = this.runInitializationGenerations().finally(() => {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = undefined;
      }
    });
    this.initializationPromise = initialization;
    return initialization;
  }

  private async runInitializationGenerations(): Promise<void> {
    let completedGeneration = 0;
    while (completedGeneration < this.initializationGeneration) {
      const generation = this.initializationGeneration;
      const requestedSignal = this.initializationSignals.get(generation);
      const signal = requestedSignal
        ? AbortSignal.any([requestedSignal, this.disposalController.signal])
        : this.disposalController.signal;
      try {
        await this.initializeGeneration(signal);
        completedGeneration = generation;
      } finally {
        this.deleteInitializationSignalsThrough(generation);
      }
    }
  }

  private deleteInitializationSignalsThrough(generation: number): void {
    for (const queuedGeneration of this.initializationSignals.keys()) {
      if (queuedGeneration <= generation) {
        this.initializationSignals.delete(queuedGeneration);
      }
    }
  }

  private async initializeGeneration(signal?: AbortSignal): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration;
    if (lifecycleGeneration > 0) {
      throw new Error('HookSystem has been disposed.');
    }
    signal?.throwIfAborted();
    debugLogger.debug('Initializing HookSystem');
    await initializeHookDefinitions(
      (initializationSignal) => this.registry.initialize(initializationSignal),
      signal ?? this.disposalController.signal,
    );
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      throw new Error('HookSystem has been disposed.');
    }
    signal?.throwIfAborted();
    this.eventHandler ??= new HookEventHandler(
      this.session,
      this.registry,
      this.planner,
      this.runner,
      this.aggregator,
      this.messageBus,
      this.injectedDebugLogger,
    );

    const totalHooks = this.registry.getAllHooks().length;
    debugLogger.log(
      `HookSystem initialized with ${totalHooks} registered hook(s)`,
    );
  }

  /**
   * Get the hook registry.
   * @throws {HookSystemNotInitializedError} if called before initialize()
   * @requirement:HOOK-005,HOOK-006
   */
  getRegistry(): HookRegistry {
    return this.registry;
  }

  /**
   * Get the hook event handler.
   * @throws {HookSystemNotInitializedError} if called before initialize()
   * @requirement:HOOK-005,HOOK-006
   */
  getEventHandler(): HookEventHandler {
    if (!this.eventHandler) {
      throw new HookSystemNotInitializedError(
        'Cannot access HookEventHandler before HookSystem is initialized',
      );
    }
    return this.eventHandler;
  }

  /**
   * Check if the hook system is initialized.
   */
  isInitialized(): boolean {
    return this.eventHandler !== null;
  }

  /**
   * Enable or disable a specific hook by ID.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P05
   * @requirement DELTA-HSYS-002
   * @pseudocode message-bus-integration.md lines 30-36
   */
  setHookEnabled(hookId: string, enabled: boolean): void {
    this.registry.setHookEnabled(hookId, enabled);
  }

  /**
   * Return all registered hook definitions.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P05
   * @requirement DELTA-HSYS-002
   * @pseudocode message-bus-integration.md lines 30-36
   */
  getAllHooks(): HookRegistryEntry[] {
    return this.registry.getAllHooks();
  }

  // --- Convenience wrappers delegating to HookEventHandler ---

  /**
   * Fire BeforeTool event.
   * Wrapper for getEventHandler().fireBeforeToolEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireBeforeToolEvent(
    toolName: string,
    toolInput: Record<string, unknown>,
    mcpContext?: McpContext,
    owner?: HookExecutionOwner,
  ): Promise<DefaultHookOutput | undefined> {
    return this.admit(owner, async (handler, owner) =>
      handler.fireBeforeToolEvent(toolName, toolInput, mcpContext, owner),
    );
  }

  /**
   * Fire AfterTool event.
   * Wrapper for getEventHandler().fireAfterToolEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireAfterToolEvent(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolResponse: Record<string, unknown>,
    mcpContext?: McpContext,
    owner?: HookExecutionOwner,
  ): Promise<DefaultHookOutput | undefined> {
    return this.admit(owner, async (handler, owner) =>
      handler.fireAfterToolEvent(
        toolName,
        toolInput,
        toolResponse,
        mcpContext,
        owner,
      ),
    );
  }

  /**
   * Fire BeforeModel event.
   * Returns a typed BeforeModelHookOutput, or undefined if no hook output.
   * Errors are caught and logged; hooks are fail-open.
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   */
  async fireBeforeModelEvent(
    request: Omit<HookLLMRequest, 'version'>,
    owner?: HookExecutionOwner,
  ): Promise<BeforeModelHookOutput | undefined> {
    return this.admit(owner, async (handler, owner) => {
      try {
        const result = await handler.fireBeforeModelEvent(request, owner);
        if (result.finalOutput) {
          return new BeforeModelHookOutput(result.finalOutput);
        }
        return undefined;
      } catch (error) {
        debugLogger.debug('BeforeModel hook failed (non-blocking):', error);
        return undefined;
      }
    });
  }

  /**
   * Fire AfterModel event.
   * Returns a typed AfterModelHookOutput, or undefined if no hook output.
   * Errors are caught and logged; hooks are fail-open.
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   */
  async fireAfterModelEvent(
    request: Omit<HookLLMRequest, 'version'>,
    response: Omit<HookLLMResponse, 'version'>,
    owner?: HookExecutionOwner,
  ): Promise<AfterModelHookOutput | undefined> {
    return this.admit(owner, async (handler, owner) => {
      try {
        const result = await handler.fireAfterModelEvent(
          request,
          response,
          owner,
        );
        if (result.finalOutput) {
          return new AfterModelHookOutput(result.finalOutput);
        }
        return undefined;
      } catch (error) {
        debugLogger.debug('AfterModel hook failed (non-blocking):', error);
        return undefined;
      }
    });
  }

  /**
   * Fire BeforeToolSelection event.
   * Returns a typed BeforeToolSelectionHookOutput, or undefined if no hook output.
   * Errors are caught and logged; hooks are fail-open.
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   */
  async fireBeforeToolSelectionEvent(
    request: Omit<HookLLMRequest, 'version'>,
    owner?: HookExecutionOwner,
  ): Promise<BeforeToolSelectionHookOutput | undefined> {
    return this.admit(owner, async (handler, owner) => {
      try {
        const result = await handler.fireBeforeToolSelectionEvent(
          request,
          owner,
        );
        if (result.finalOutput) {
          return new BeforeToolSelectionHookOutput(result.finalOutput);
        }
        return undefined;
      } catch (error) {
        debugLogger.debug(
          'BeforeToolSelection hook failed (non-blocking):',
          error,
        );
        return undefined;
      }
    });
  }

  /**
   * Fire SessionStart event.
   * Wrapper for getEventHandler().fireSessionStartEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireSessionStartEvent(
    context: { source: SessionStartSource },
    owner?: HookExecutionOwner,
  ): Promise<AggregatedHookResult> {
    return this.admit(owner, async (handler, owner) =>
      handler.fireSessionStartEvent(context, owner),
    );
  }

  /**
   * Fire SessionEnd event.
   * Wrapper for getEventHandler().fireSessionEndEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireSessionEndEvent(
    context: { reason: SessionEndReason },
    owner?: HookExecutionOwner,
  ): Promise<AggregatedHookResult> {
    return this.admit(owner, async (handler, owner) =>
      handler.fireSessionEndEvent(context, owner),
    );
  }

  /**
   * Fire PreCompress event.
   * Wrapper for getEventHandler().firePreCompressEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async firePreCompressEvent(
    context: {
      trigger: PreCompressTrigger;
    },
    owner?: HookExecutionOwner,
  ): Promise<AggregatedHookResult> {
    return this.admit(owner, (handler, execution) =>
      handler.firePreCompressEvent(context, execution),
    );
  }

  /**
   * Fire BeforeAgent event.
   * Wrapper for getEventHandler().fireBeforeAgentEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireBeforeAgentEvent(
    context: {
      prompt: string;
    },
    owner?: HookExecutionOwner,
  ): Promise<AggregatedHookResult> {
    return this.admit(owner, (handler, execution) =>
      handler.fireBeforeAgentEvent(context, execution),
    );
  }

  /**
   * Fire AfterAgent event.
   * Wrapper for getEventHandler().fireAfterAgentEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireAfterAgentEvent(
    context: {
      prompt: string;
      prompt_response: string;
      stop_hook_active: boolean;
    },
    owner?: HookExecutionOwner,
  ): Promise<AggregatedHookResult> {
    return this.admit(owner, (handler, execution) =>
      handler.fireAfterAgentEvent(context, execution),
    );
  }

  /**
   * Fire Notification event.
   * Wrapper for getEventHandler().fireNotificationEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireNotificationEvent(
    type: NotificationType,
    message: string,
    details: Record<string, unknown>,
    owner?: HookExecutionOwner,
  ): Promise<AggregatedHookResult> {
    return this.admit(owner, async (handler, owner) =>
      handler.fireNotificationEvent(type, message, details, owner),
    );
  }

  /**
   * Dispose the HookSystem, releasing any held resources.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HEVT-004
   */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.lifecycleGeneration++;
    this.initializationGeneration++;
    this.disposalController.abort(new Error('HookSystem has been disposed.'));
    this.initializationSignals.clear();
    this.unsubscribeTrustPolicy();
    this.unsubscribeTrustTransition();
    const accepted = [...this.accepted];
    this.closing = this.joinDisposal(accepted);
    return this.closing;
  }

  private async joinDisposal(
    accepted: ReadonlyArray<Promise<unknown>>,
  ): Promise<void> {
    const results = await Promise.allSettled([
      ...accepted,
      ...(this.initializationPromise === undefined
        ? []
        : [this.initializationPromise]),
    ]);
    const handler = await Promise.allSettled([this.eventHandler?.dispose()]);
    this.eventHandler = null;
    const failures = [...results, ...handler].flatMap((result) =>
      result.status === 'rejected' &&
      result.reason !== this.disposalController.signal.reason
        ? [result.reason]
        : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Hook shutdown failed');
  }

  private admit<T>(
    owner: HookExecutionOwner | undefined,
    operation: (
      handler: HookEventHandler,
      owner: HookExecutionOwner,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.lifecycleGeneration > 0)
      return Promise.reject(new Error('HookSystem has been disposed.'));
    const signal =
      owner?.signal === undefined
        ? this.disposalController.signal
        : AbortSignal.any([owner.signal, this.disposalController.signal]);
    const execution: HookExecutionOwner = {
      sessionId: owner?.sessionId ?? this.session.sessionId,
      transcriptPath: owner?.transcriptPath ?? this.session.transcriptPath,
      signal,
    };
    const pending = operation(this.getEventHandler(), execution);
    this.accepted.add(pending);
    void pending.then(
      () => this.accepted.delete(pending),
      () => this.accepted.delete(pending),
    );
    return pending;
  }
}
