import { randomUUID } from 'node:crypto';

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

  /**
   * The parent agent's runtimeId when this runtime belongs to a subagent.
   * `undefined` for the main agent so it serialises as `null` in token-usage
   * records. @issue #3130
   */
  readonly parentRuntimeId?: string;

  /**
   * The subagent's display name when this runtime belongs to a subagent.
   * `undefined` for the main agent so it serialises as `null` in token-usage
   * records. @issue #3130
   */
  readonly subagentName?: string;
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
  parentRuntimeId?: string;
  subagentName?: string;
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
  parentRuntimeId?: string;
  subagentName?: string;
  version: number; // Schema version for future migrations
}

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
    params.sessionId !== undefined && params.sessionId !== ''
      ? params.sessionId
      : `session-${randomUUID()}`;

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
    updatedAt: Date.now(),
    parentRuntimeId: params.parentRuntimeId,
    subagentName: params.subagentName,
  });

  return state;
}

/**
 * Deep freeze helper for immutable objects
 */
function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (typeof value === 'object' && value !== null) {
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
 * Validates updates and enforces a monotonic updatedAt.
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
  if (
    updates.provider !== undefined &&
    (!updates.provider || typeof updates.provider !== 'string')
  ) {
    throw new RuntimeStateError(RuntimeStateErrorCode.PROVIDER_INVALID, {
      provider: updates.provider,
    });
  }

  if (
    updates.model !== undefined &&
    (!updates.model || typeof updates.model !== 'string')
  ) {
    throw new RuntimeStateError(RuntimeStateErrorCode.MODEL_INVALID, {
      model: updates.model,
    });
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

  return newState;
}

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-002.3
 * @pseudocode runtime-state.md lines 252-278
 *
 * Batch update for atomic multi-field changes (e.g., provider switch).
 * All updates validated together.
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
    parentRuntimeId: state.parentRuntimeId,
    subagentName: state.subagentName,
    version: 1, // Schema version (line 341)
  });
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
