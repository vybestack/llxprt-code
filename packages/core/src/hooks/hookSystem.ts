/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
 * @requirement:HOOK-001,HOOK-003,HOOK-004,HOOK-005,HOOK-006,HOOK-007,HOOK-008,HOOK-009,HOOK-142
 * @pseudocode:analysis/pseudocode/01-hook-system-lifecycle.md
 */

import type { Config } from '../config/config.js';
import { HookRegistry, type HookRegistryEntry } from './hookRegistry.js';
import { HookPlanner } from './hookPlanner.js';
import { HookRunner } from './hookRunner.js';
import { HookAggregator } from './hookAggregator.js';
import { HookEventHandler } from './hookEventHandler.js';
import { HookSystemNotInitializedError } from './errors.js';
import { DebugLogger } from '../debug/index.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:system');

/**
 * Status information for the HookSystem
 * @requirement:HOOK-009
 */
export interface HookSystemStatus {
  initialized: boolean;
  totalHooks: number;
}

/**
 * HookSystem is the central coordinator for all hook infrastructure.
 * It owns single shared instances of HookRegistry, HookPlanner, HookRunner,
 * HookAggregator, and HookEventHandler, reused across all event fires.
 *
 * @requirement:HOOK-001 - Created lazily on first call to Config.getHookSystem()
 * @requirement:HOOK-003 - Calls HookRegistry.initialize() at most once per Config lifetime
 * @requirement:HOOK-004 - Returns immediately on subsequent initialize() calls
 * @requirement:HOOK-005 - Throws HookSystemNotInitializedError if accessed before initialize()
 * @requirement:HOOK-006 - Exposes getRegistry(), getEventHandler(), getStatus() as public accessors
 * @requirement:HOOK-007 - Trigger functions obtain components from HookSystem, never construct new ones
 * @requirement:HOOK-008 - First hook event fires initialize() before delegating to event handler
 * @requirement:HOOK-009 - getStatus() reports { initialized: boolean; totalHooks: number }
 * @requirement:HOOK-142 - Importable from packages/core/src/hooks/hookSystem.ts
 */
export class HookSystem {
  private readonly config: Config;
  private readonly registry: HookRegistry;
  private readonly planner: HookPlanner;
  private readonly runner: HookRunner;
  private readonly aggregator: HookAggregator;
  private eventHandler: HookEventHandler | null = null;
  private initialized = false;

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
    this.runner = new HookRunner();
    this.aggregator = new HookAggregator();
  }

  /**
   * Initialize the hook system. Must be called before getRegistry() or getEventHandler().
   * Safe to call multiple times - subsequent calls are no-ops.
   *
   * @requirement:HOOK-003 - Calls HookRegistry.initialize() at most once
   * @requirement:HOOK-004 - Returns immediately on subsequent calls
   * @requirement:HOOK-008 - Called by trigger functions on first event fire
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      debugLogger.debug('HookSystem already initialized, skipping');
      return;
    }

    debugLogger.debug('Initializing HookSystem');

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

    this.initialized = true;

    const status = this.getStatus();
    debugLogger.log(
      `HookSystem initialized with ${status.totalHooks} registered hook(s)`,
    );
  }

  /**
   * Get the hook registry.
   * @throws {HookSystemNotInitializedError} if called before initialize()
   * @requirement:HOOK-005,HOOK-006
   */
  getRegistry(): HookRegistry {
    if (!this.initialized) {
      throw new HookSystemNotInitializedError(
        'Cannot access HookRegistry before HookSystem is initialized',
      );
    }
    return this.registry;
  }

  /**
   * Get the hook event handler.
   * @throws {HookSystemNotInitializedError} if called before initialize()
   * @requirement:HOOK-005,HOOK-006
   */
  getEventHandler(): HookEventHandler {
    if (!this.initialized || !this.eventHandler) {
      throw new HookSystemNotInitializedError(
        'Cannot access HookEventHandler before HookSystem is initialized',
      );
    }
    return this.eventHandler;
  }

  /**
   * Get the current status of the hook system.
   * @requirement:HOOK-009
   */
  getStatus(): HookSystemStatus {
    return {
      initialized: this.initialized,
      totalHooks: this.initialized ? this.registry.getAllHooks().length : 0,
    };
  }

  /**
   * Check if the hook system is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Enable or disable a specific hook by ID.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P05
   * @requirement DELTA-HSYS-002
   * @pseudocode message-bus-integration.md lines 30-36
   */
  setHookEnabled(hookId: string, enabled: boolean): void {
    if (!this.initialized) {
      return;
    }
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
    if (!this.initialized) {
      return [];
    }
    return this.registry.getAllHooks();
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
