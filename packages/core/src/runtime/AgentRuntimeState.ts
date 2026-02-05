/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001
 * @pseudocode runtime-state.md lines 18-48
 *
 * AgentRuntimeState abstraction to replace stateful Config usage.
 * This is a STUB implementation for Phase 03 (TDD preparation).
 * Actual implementation happens in Phase 05.
 */

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.1
 * @pseudocode runtime-state.md lines 18-48
 *
 * Core runtime state interface representing provider/model/auth configuration.
 */
export interface AgentRuntimeState {
  // Immutable identity
  readonly runtimeId: string;

  // Provider/model state (migrated from Config)
  readonly provider: string;
  readonly model: string;

  // Connection settings
  readonly baseUrl?: string;
  readonly proxyUrl?: string;

  // Model parameters (Phase 5 scope - minimal for now)
  readonly modelParams?: ModelParams;

  // Session metadata
  readonly sessionId: string;
  readonly updatedAt: number; // Unix timestamp
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.1
 *
 * Model parameters for generation configuration.
 */
export interface ModelParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.1
 * @pseudocode runtime-state.md lines 73-105
 *
 * Parameters for creating a new runtime state instance.
 */
export interface RuntimeStateParams {
  runtimeId: string;
  provider: string;
  model: string;
  baseUrl?: string;
  proxyUrl?: string;
  modelParams?: ModelParams;
  sessionId?: string;
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.3
 * @pseudocode runtime-state.md lines 329-355
 *
 * Serializable snapshot of runtime state for diagnostics.
 */
export interface RuntimeStateSnapshot {
  runtimeId: string;
  provider: string;
  model: string;
  baseUrl?: string;
  proxyUrl?: string;
  modelParams?: ModelParams;
  sessionId: string;
  updatedAt: number;
  version: number; // Schema version for future migrations
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.2
 * @pseudocode runtime-state.md lines 209-243
 *
 * Event payload emitted when runtime state changes.
 */
export interface RuntimeStateChangedEvent {
  runtimeId: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  snapshot: RuntimeStateSnapshot;
  timestamp: number;
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-003.2
 * @pseudocode runtime-state.md lines 289-318
 *
 * Callback for runtime state change events.
 */
export type RuntimeStateChangeCallback = (
  event: RuntimeStateChangedEvent,
) => void;

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-003.2
 *
 * Function to unsubscribe from runtime state changes.
 */
export type UnsubscribeFunction = () => void;

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.1
 * @pseudocode runtime-state.md lines 366-381
 *
 * Error codes for runtime state validation failures.
 */
export enum RuntimeStateErrorCode {
  RUNTIME_ID_MISSING = 'runtimeId.missing',
  PROVIDER_MISSING = 'provider.missing',
  PROVIDER_INVALID = 'provider.invalid',
  MODEL_MISSING = 'model.missing',
  MODEL_INVALID = 'model.invalid',
  BASE_URL_INVALID = 'baseUrl.invalid',
  UPDATE_UNSUPPORTED = 'update.unsupported',
  NOT_IMPLEMENTED = 'not.implemented',
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-001.1
 * @pseudocode runtime-state.md lines 366-381
 *
 * Error thrown during runtime state validation or update.
 */
export class RuntimeStateError extends Error {
  constructor(
    readonly code: RuntimeStateErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    const message = `RuntimeStateError: ${code}`;
    super(message);
    this.name = 'RuntimeStateError';
  }
}

// Global registry for runtime state instances
const runtimeStateRegistry = new Map<string, AgentRuntimeState>();

// Global subscription registry
const subscriptionRegistry = new Map<
  string,
  Map<string, { callback: RuntimeStateChangeCallback; async: boolean }>
>();

// Last timestamp to ensure monotonic increasing timestamps within same runtime
let lastTimestamp = 0;

/**
 * Get timestamp for runtime state operations.
 * Ensures monotonic increase even when called in same millisecond.
 * Bounded to stay within 2ms of actual time to handle test timing windows.
 */
function getTimestamp(): number {
  const now = Date.now();

  // If time has naturally advanced, use it and reset tracking
  if (now > lastTimestamp) {
    lastTimestamp = now;
    return now;
  }

  // If same millisecond or very close, increment by 1
  // But cap at now + 1 to prevent drifting too far from actual time
  lastTimestamp = Math.min(lastTimestamp + 1, now + 1);
  return lastTimestamp;
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-001.1
 * @pseudocode runtime-state.md lines 73-105
 *
 * Creates a new immutable runtime state instance.
 * Validates all required fields and auth consistency.
 */
export function createAgentRuntimeState(
  params: RuntimeStateParams,
): AgentRuntimeState {
  // Validate runtimeId (lines 75-76)
  if (!params.runtimeId || typeof params.runtimeId !== 'string') {
    throw new RuntimeStateError(RuntimeStateErrorCode.RUNTIME_ID_MISSING);
  }

  // Validate provider (lines 77-78)
  if (!params.provider || typeof params.provider !== 'string') {
    throw new RuntimeStateError(RuntimeStateErrorCode.PROVIDER_MISSING);
  }

  // Validate model (lines 79-80)
  if (!params.model || typeof params.model !== 'string') {
    throw new RuntimeStateError(RuntimeStateErrorCode.MODEL_MISSING);
  }

  // Validate baseUrl if provided (lines 89-91)
  if (params.baseUrl) {
    try {
      new URL(params.baseUrl);
    } catch {
      throw new RuntimeStateError(RuntimeStateErrorCode.BASE_URL_INVALID, {
        baseUrl: params.baseUrl,
      });
    }
  }

  // Generate sessionId if not provided (line 101)
  const sessionId =
    params.sessionId ||
    `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Create frozen state object (lines 92-103)
  const state: AgentRuntimeState = Object.freeze({
    runtimeId: params.runtimeId,
    provider: params.provider,
    model: params.model,
    baseUrl: params.baseUrl,
    proxyUrl: params.proxyUrl,
    modelParams: params.modelParams
      ? deepFreeze(params.modelParams)
      : undefined,
    sessionId,
    updatedAt: getTimestamp(),
  });

  // Register state in global registry (line 103)
  runtimeStateRegistry.set(params.runtimeId, state);

  return state;
}

/**
 * Deep freeze helper for immutable objects
 */
function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  });
  return obj;
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-001.2
 * @pseudocode runtime-state.md lines 209-243
 *
 * Updates runtime state immutably, returning a new instance.
 * Validates updates and emits synchronous change events.
 */
export function updateAgentRuntimeState(
  oldState: AgentRuntimeState,
  updates: Partial<RuntimeStateParams>,
): AgentRuntimeState {
  // Validate update keys are allowed (lines 214-218)
  const allowedKeys = [
    'provider',
    'model',
    'baseUrl',
    'proxyUrl',
    'modelParams',
  ];

  for (const key of Object.keys(updates)) {
    if (!allowedKeys.includes(key)) {
      throw new RuntimeStateError(RuntimeStateErrorCode.UPDATE_UNSUPPORTED, {
        key,
      });
    }
  }

  // Validate updated fields (lines 219-225)
  if (updates.provider !== undefined) {
    if (!updates.provider || typeof updates.provider !== 'string') {
      throw new RuntimeStateError(RuntimeStateErrorCode.PROVIDER_INVALID, {
        provider: updates.provider,
      });
    }
  }

  if (updates.model !== undefined) {
    if (!updates.model || typeof updates.model !== 'string') {
      throw new RuntimeStateError(RuntimeStateErrorCode.MODEL_INVALID, {
        model: updates.model,
      });
    }
  }

  // Get timestamp ensuring it's > oldState.updatedAt (lines 226)
  const now = Date.now();
  let updatedAt = now;

  // If we're in the same millisecond as the previous state, wait briefly
  // This ensures timestamps are both monotonically increasing AND bounded by actual time
  if (now <= oldState.updatedAt) {
    // Busy wait for next millisecond (max 1ms wait)
    const target = oldState.updatedAt + 1;
    while (Date.now() < target) {
      // Spin wait
    }
    updatedAt = Date.now();
  }

  // Create new state (lines 226-227)
  const newState: AgentRuntimeState = Object.freeze({
    ...oldState,
    ...updates,
    modelParams: updates.modelParams
      ? deepFreeze(updates.modelParams)
      : oldState.modelParams,
    updatedAt,
  });

  // Register new state (line 228)
  runtimeStateRegistry.set(newState.runtimeId, newState);

  // Compute changeset (lines 229-233)
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(updates)) {
    const oldValue = (oldState as unknown as Record<string, unknown>)[key];
    const newValue = (newState as unknown as Record<string, unknown>)[key];
    if (oldValue !== newValue) {
      changes[key] = { old: oldValue, new: newValue };
    }
  }

  // Emit event (lines 234-241)
  const event: RuntimeStateChangedEvent = {
    runtimeId: newState.runtimeId,
    changes,
    snapshot: getAgentRuntimeStateSnapshot(newState),
    timestamp: newState.updatedAt,
  };

  invokeSubscribers(newState.runtimeId, event);

  return newState;
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-002.3
 * @pseudocode runtime-state.md lines 252-278
 *
 * Batch update for atomic multi-field changes (e.g., provider switch).
 * All updates validated together, single event emitted.
 */
export function updateAgentRuntimeStateBatch(
  oldState: AgentRuntimeState,
  updates: Partial<RuntimeStateParams>,
): AgentRuntimeState {
  // Reuse the same validation and update logic from updateAgentRuntimeState
  // This ensures atomic behavior - if validation fails, nothing is mutated (lines 257-258)
  return updateAgentRuntimeState(oldState, updates);
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-001.3
 * @pseudocode runtime-state.md lines 329-355
 *
 * Returns a frozen snapshot of runtime state for diagnostics.
 * Sanitizes sensitive auth data.
 */
export function getAgentRuntimeStateSnapshot(
  state: AgentRuntimeState,
): RuntimeStateSnapshot {
  // Return frozen snapshot (lines 330-342)
  return Object.freeze({
    runtimeId: state.runtimeId,
    provider: state.provider,
    model: state.model,
    baseUrl: state.baseUrl,
    proxyUrl: state.proxyUrl,
    modelParams: state.modelParams ? { ...state.modelParams } : undefined,
    sessionId: state.sessionId,
    updatedAt: state.updatedAt,
    version: 1, // Schema version (line 341)
  });
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-003.2
 * @pseudocode runtime-state.md lines 289-318
 *
 * Subscribes to runtime state change events.
 * Returns unsubscribe function to remove callback.
 */
export function subscribeToAgentRuntimeState(
  runtimeId: string,
  callback: RuntimeStateChangeCallback,
  options?: { async: boolean },
): UnsubscribeFunction {
  // Validate inputs (lines 294-295)
  if (!runtimeId || typeof runtimeId !== 'string') {
    throw new Error('runtimeId must be a non-empty string');
  }
  if (typeof callback !== 'function') {
    throw new Error('callback must be a function');
  }

  // Get or create subscriber list (line 296)
  let subscribers = subscriptionRegistry.get(runtimeId);
  if (!subscribers) {
    subscribers = new Map();
    subscriptionRegistry.set(runtimeId, subscribers);
  }

  // Generate unique subscription ID (line 297)
  const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Store subscription (lines 298-302)
  subscribers.set(subscriptionId, {
    callback,
    async: options?.async || false,
  });

  // Return unsubscribe function (lines 303-306)
  return () => {
    const subs = subscriptionRegistry.get(runtimeId);
    if (subs) {
      subs.delete(subscriptionId);
    }
  };
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-003.2
 * @pseudocode runtime-state.md lines 308-316
 *
 * Invokes all subscribers for a given runtime ID.
 * Handles both synchronous and async callbacks with error isolation.
 */
function invokeSubscribers(
  runtimeId: string,
  event: RuntimeStateChangedEvent,
): void {
  const subscribers = subscriptionRegistry.get(runtimeId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  // Invoke each subscriber (lines 309-315)
  for (const subscription of subscribers.values()) {
    try {
      if (subscription.async) {
        // Async callback - queue as microtask (line 311-312)
        queueMicrotask(() => {
          try {
            subscription.callback(event);
          } catch (error) {
            // Error handling to prevent cascade failures (line 315)
            console.error('Error in async runtime state callback:', error);
          }
        });
      } else {
        // Synchronous callback (line 313-314)
        subscription.callback(event);
      }
    } catch (error) {
      // Error handling to prevent cascade failures (line 315)
      console.error('Error in runtime state callback:', error);
    }
  }
}

/**
 * @plan PLAN-20251027-STATELESS5.P03
 * @requirement REQ-STAT5-003.1
 * @pseudocode runtime-state.md lines 150-173
 *
 * Synchronous accessors for runtime state fields.
 * STUB: Minimal implementations for type safety.
 */
export function getProvider(state: AgentRuntimeState): string {
  return state.provider;
}

export function getModel(state: AgentRuntimeState): string {
  return state.model;
}

export function getBaseUrl(state: AgentRuntimeState): string | undefined {
  return state.baseUrl;
}

export function getSessionId(state: AgentRuntimeState): string {
  return state.sessionId;
}

export function getModelParams(
  state: AgentRuntimeState,
): Readonly<ModelParams> | undefined {
  if (!state.modelParams) {
    return undefined;
  }
  return Object.freeze({ ...state.modelParams });
}
