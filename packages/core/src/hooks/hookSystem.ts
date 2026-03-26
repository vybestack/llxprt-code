/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
 * @requirement:HOOK-001,HOOK-003,HOOK-004,HOOK-005,HOOK-006,HOOK-007,HOOK-008,HOOK-142
 * @pseudocode:analysis/pseudocode/01-hook-system-lifecycle.md
 */

import type { Config } from '../config/config.js';
import { HookRegistry, type HookRegistryEntry } from './hookRegistry.js';
import { HookPlanner } from './hookPlanner.js';
import { HookRunner } from './hookRunner.js';
import { HookAggregator, type AggregatedHookResult } from './hookAggregator.js';
import { HookEventHandler } from './hookEventHandler.js';
import { HookSystemNotInitializedError } from './errors.js';
import { DebugLogger } from '../debug/index.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  type DefaultHookOutput,
  type SessionStartSource,
  type SessionEndReason,
  type PreCompressTrigger,
  type McpContext,
  NotificationType,
  BeforeModelHookOutput,
  AfterModelHookOutput,
  BeforeToolSelectionHookOutput,
} from './types.js';

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
  private readonly config: Config;
  private readonly registry: HookRegistry;
  private readonly planner: HookPlanner;
  private readonly runner: HookRunner;
  private readonly aggregator: HookAggregator;
  private eventHandler: HookEventHandler | null = null;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HSYS-001
   */
  private readonly messageBus: MessageBus | undefined;

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
    config: Config,
    messageBus?: MessageBus,
    injectedDebugLogger?: DebugLogger,
  ) {
    this.config = config;
    this.messageBus = messageBus;
    this.injectedDebugLogger = injectedDebugLogger;
    // Create infrastructure components but don't initialize yet
    // @requirement:HOOK-006 - Own single shared instances
    this.registry = new HookRegistry(config);
    this.planner = new HookPlanner(this.registry);
    this.runner = new HookRunner(config);
    this.aggregator = new HookAggregator();
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
  async initialize(): Promise<void> {
    debugLogger.debug('Initializing HookSystem');

    // Dispose old event handler to prevent MessageBus subscription leaks.
    // LLxprt enhancement: Upstream Gemini doesn't need this because their
    // HookEventHandler doesn't subscribe to MessageBus. LLxprt added MessageBus
    // integration in PLAN-20250218-HOOKSYSTEM.P03 (DELTA-HEVT-001).
    // Without disposal, each re-init creates a new subscription without
    // unsubscribing the old one, causing memory leaks.
    this.dispose();

    // Initialize the registry (loads hooks from config)
    await this.registry.initialize();

    // Create the event handler now that registry is ready,
    // forwarding injected dependencies per DELTA-HSYS-001
    this.eventHandler = new HookEventHandler(
      this.config,
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
  ): Promise<DefaultHookOutput | undefined> {
    return this.getEventHandler().fireBeforeToolEvent(
      toolName,
      toolInput,
      mcpContext,
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
  ): Promise<DefaultHookOutput | undefined> {
    return this.getEventHandler().fireAfterToolEvent(
      toolName,
      toolInput,
      toolResponse,
      mcpContext,
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
    llmRequest: unknown,
  ): Promise<BeforeModelHookOutput | undefined> {
    try {
      const result =
        await this.getEventHandler().fireBeforeModelEvent(llmRequest);
      if (result.finalOutput) {
        return new BeforeModelHookOutput(result.finalOutput);
      }
      return undefined;
    } catch (error) {
      debugLogger.debug('BeforeModel hook failed (non-blocking):', error);
      return undefined;
    }
  }

  /**
   * Fire AfterModel event.
   * Returns a typed AfterModelHookOutput, or undefined if no hook output.
   * Errors are caught and logged; hooks are fail-open.
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   */
  async fireAfterModelEvent(
    llmRequest: unknown,
    llmResponse: unknown,
  ): Promise<AfterModelHookOutput | undefined> {
    try {
      const result = await this.getEventHandler().fireAfterModelEvent(
        llmRequest,
        llmResponse,
      );
      if (result.finalOutput) {
        return new AfterModelHookOutput(result.finalOutput);
      }
      return undefined;
    } catch (error) {
      debugLogger.debug('AfterModel hook failed (non-blocking):', error);
      return undefined;
    }
  }

  /**
   * Fire BeforeToolSelection event.
   * Returns a typed BeforeToolSelectionHookOutput, or undefined if no hook output.
   * Errors are caught and logged; hooks are fail-open.
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   */
  async fireBeforeToolSelectionEvent(
    llmRequest: unknown,
  ): Promise<BeforeToolSelectionHookOutput | undefined> {
    try {
      const result =
        await this.getEventHandler().fireBeforeToolSelectionEvent(llmRequest);
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
  }

  /**
   * Fire SessionStart event.
   * Wrapper for getEventHandler().fireSessionStartEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireSessionStartEvent(context: {
    source: SessionStartSource;
  }): Promise<AggregatedHookResult> {
    return this.getEventHandler().fireSessionStartEvent(context);
  }

  /**
   * Fire SessionEnd event.
   * Wrapper for getEventHandler().fireSessionEndEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireSessionEndEvent(context: {
    reason: SessionEndReason;
  }): Promise<AggregatedHookResult> {
    return this.getEventHandler().fireSessionEndEvent(context);
  }

  /**
   * Fire PreCompress event.
   * Wrapper for getEventHandler().firePreCompressEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async firePreCompressEvent(context: {
    trigger: PreCompressTrigger;
  }): Promise<AggregatedHookResult> {
    return this.getEventHandler().firePreCompressEvent(context);
  }

  /**
   * Fire BeforeAgent event.
   * Wrapper for getEventHandler().fireBeforeAgentEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireBeforeAgentEvent(context: {
    prompt: string;
  }): Promise<AggregatedHookResult> {
    return this.getEventHandler().fireBeforeAgentEvent(context);
  }

  /**
   * Fire AfterAgent event.
   * Wrapper for getEventHandler().fireAfterAgentEvent().
   *
   * @requirement:HOOK-006 - Simplifies caller code by removing getEventHandler() boilerplate
   * @throws {HookSystemNotInitializedError} if called before initialize()
   */
  async fireAfterAgentEvent(context: {
    prompt: string;
    prompt_response: string;
    stop_hook_active: boolean;
  }): Promise<AggregatedHookResult> {
    return this.getEventHandler().fireAfterAgentEvent(context);
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
  ): Promise<AggregatedHookResult> {
    return this.getEventHandler().fireNotificationEvent(type, message, details);
  }

  /**
   * Dispose the HookSystem, releasing any held resources.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HEVT-004
   */
  dispose(): void {
    this.eventHandler?.dispose();
  }
}
