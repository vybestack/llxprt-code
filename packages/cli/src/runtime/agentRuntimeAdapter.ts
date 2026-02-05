/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002
 * @pseudocode cli-runtime-adapter.md lines 44-688
 *
 * CLI Runtime Adapter - bridges CLI commands and AgentRuntimeState abstraction.
 * Phase 08: GREEN implementation to make all TDD tests pass.
 */

import type {
  Config,
  AgentRuntimeState,
  RuntimeStateParams,
  RuntimeStateSnapshot,
  RuntimeStateChangedEvent,
  UnsubscribeFunction,
} from '@vybestack/llxprt-code-core';
import {
  createAgentRuntimeState,
  updateAgentRuntimeState,
  subscribeToAgentRuntimeState,
  getAgentRuntimeStateSnapshot,
} from '@vybestack/llxprt-code-core';

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.1
 * @pseudocode cli-runtime-adapter.md lines 51-88
 *
 * AgentRuntimeAdapter manages the foreground agent runtime state and provides
 * a stable API for CLI commands and helpers. It bridges AgentRuntimeState with
 * legacy Config for UI compatibility during the migration.
 */
export class AgentRuntimeAdapter {
  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 52-54
   */
  private runtimeState: AgentRuntimeState;
  private legacyConfig: Config;
  private runtimeId: string;
  private unsubscribe: UnsubscribeFunction | null = null;

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 56-75
   *
   * Creates a new adapter instance.
   */
  constructor(initialState: AgentRuntimeState, legacyConfig: Config) {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 62-74
    this.runtimeState = initialState;
    this.legacyConfig = legacyConfig;
    this.runtimeId = initialState.runtimeId;

    // Mirror initial state to config
    this.mirrorStateToConfig(initialState);

    // Subscribe to runtime state changes
    this.unsubscribe = subscribeToAgentRuntimeState(
      this.runtimeId,
      this.handleStateChange.bind(this),
    );
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 76-87
   *
   * Handles runtime state change events.
   */
  private handleStateChange(event: RuntimeStateChangedEvent): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 76-87

    // When runtime state is updated (either by us or externally), this handler is called.
    // We need to reconstruct the AgentRuntimeState object from the snapshot since we don't
    // have direct access to the runtime state registry.

    // For Phase 08, we reconstruct the state from the snapshot
    // The snapshot has all the fields we need except it's frozen for safety
    // We create a new runtime state object with these values
    const snapshot = event.snapshot;

    // Recreate the runtime state object from the snapshot
    // We do this by creating a new object with the same shape as AgentRuntimeState
    const newState = Object.freeze({
      runtimeId: snapshot.runtimeId,
      provider: snapshot.provider,
      model: snapshot.model,
      baseUrl: snapshot.baseUrl,
      proxyUrl: snapshot.proxyUrl,
      modelParams: snapshot.modelParams
        ? Object.freeze({ ...snapshot.modelParams })
        : undefined,
      sessionId: snapshot.sessionId,
      updatedAt: snapshot.updatedAt,
    }) as AgentRuntimeState;

    // Update our local reference
    this.runtimeState = newState;

    // Mirror to Config for UI components
    this.mirrorStateToConfig(this.runtimeState);
  }

  // ============================================================================
  // Read Operations (Synchronous Getters)
  // ============================================================================

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 199-203
   *
   * Returns the current provider name.
   */
  getProvider(): string {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 199-203
    return this.runtimeState.provider;
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 205-206
   *
   * Returns the current model name.
   */
  getModel(): string {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 205-206
    return this.runtimeState.model;
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 211-212
   *
   * Returns the current session ID.
   */
  getSessionId(): string {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 211-212
    return this.runtimeState.sessionId;
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 214-215
   *
   * Returns the current base URL.
   */
  getBaseUrl(): string | undefined {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 214-215
    return this.runtimeState.baseUrl;
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 217-218
   *
   * Returns the current runtime state.
   */
  getRuntimeState(): AgentRuntimeState {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 217-218
    return this.runtimeState;
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-001.3
   * @pseudocode cli-runtime-adapter.md lines 220-221
   *
   * Returns a sanitized snapshot for diagnostics.
   */
  getSnapshot(): RuntimeStateSnapshot {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 220-221
    return getAgentRuntimeStateSnapshot(this.runtimeState);
  }

  // ============================================================================
  // Write Operations (Single Field Updates)
  // ============================================================================

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 227-249
   *
   * Sets the provider and updates default model.
   */
  setProvider(providerName: string): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 227-249

    // Validate provider exists
    const providerManager = this.legacyConfig.getProviderManager();
    if (!providerManager) {
      throw new Error('Provider manager not initialized');
    }

    const provider = (
      providerManager as unknown as {
        getProviderByName: (
          name: string,
        ) => { getDefaultModel: () => string } | undefined;
      }
    ).getProviderByName(providerName);
    if (!provider) {
      const available = providerManager.listProviders().join(', ');
      throw new Error(
        `Provider '${providerName}' not found. Available providers: ${available}`,
      );
    }

    // Get default model for provider
    const defaultModel = provider.getDefaultModel();

    // Batch update: provider + model + clear baseUrl
    const updates: Partial<RuntimeStateParams> = {
      provider: providerName,
      model: defaultModel,
      baseUrl: undefined,
    };

    // Update runtime state
    this.runtimeState = updateAgentRuntimeState(this.runtimeState, updates);

    // Mirror to config
    this.mirrorStateToConfig(this.runtimeState);
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 250-256
   *
   * Sets the model name.
   */
  setModel(modelName: string): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 250-256

    const updates: Partial<RuntimeStateParams> = { model: modelName };
    this.runtimeState = updateAgentRuntimeState(this.runtimeState, updates);
    this.mirrorStateToConfig(this.runtimeState);
  }

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 266-272
   *
   * Sets the base URL.
   */
  setBaseUrl(baseUrl: string): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 266-272

    const updates: Partial<RuntimeStateParams> = { baseUrl };
    this.runtimeState = updateAgentRuntimeState(this.runtimeState, updates);
    this.mirrorStateToConfig(this.runtimeState);
  }

  // ============================================================================
  // Batch Write Operations (Atomic Multi-Field Updates)
  // ============================================================================

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 280-316
   *
   * Atomically switches provider with optional model and settings.
   */
  switchProvider(
    providerName: string,
    options?: { model?: string; clearSettings?: boolean },
  ): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 280-316

    // Validate provider
    const providerManager = this.legacyConfig.getProviderManager();
    if (!providerManager) {
      throw new Error('Provider manager not initialized');
    }

    const provider = (
      providerManager as unknown as {
        getProviderByName: (
          name: string,
        ) => { getDefaultModel: () => string } | undefined;
      }
    ).getProviderByName(providerName);
    if (!provider) {
      const available = providerManager.listProviders().join(', ');
      throw new Error(
        `Provider '${providerName}' not found. Available providers: ${available}`,
      );
    }

    // Determine model (explicit or default)
    const targetModel = options?.model || provider.getDefaultModel();

    // Build batch update
    const updates: Partial<RuntimeStateParams> = {
      provider: providerName,
      model: targetModel,
      baseUrl: undefined, // Clear custom base URL
    };

    // Clear provider-specific ephemeral settings in config
    if (options?.clearSettings !== false) {
      this.legacyConfig.setEphemeralSetting('base-url', undefined);
      this.legacyConfig.setEphemeralSetting('activeProvider', undefined);
    }

    // Atomic update with config mirror
    this.runtimeState = updateAgentRuntimeState(this.runtimeState, updates);
    this.mirrorStateToConfig(this.runtimeState);
  }

  // ============================================================================
  // Config Mirroring (Phase 5 Compatibility)
  // ============================================================================

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.3
   * @pseudocode cli-runtime-adapter.md lines 329-351
   *
   * Mirrors runtime state to legacy Config for UI compatibility.
   */
  private mirrorStateToConfig(state: AgentRuntimeState): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 329-351

    // Mirror core fields
    this.legacyConfig.setProvider(state.provider);
    this.legacyConfig.setModel(state.model);

    // Mirror connection settings
    if (state.baseUrl) {
      this.legacyConfig.setEphemeralSetting('base-url', state.baseUrl);
    } else {
      this.legacyConfig.setEphemeralSetting('base-url', undefined);
    }

    // Note: Config doesn't have setProxy, proxy is read-only

    // Mirror model params as ephemeral settings
    if (state.modelParams) {
      for (const [key, value] of Object.entries(state.modelParams)) {
        this.legacyConfig.setEphemeralSetting(key, value);
      }
    }

    // Note: Session ID is immutable, not mirrored
    // Note: Auth payload is sensitive, not mirrored directly
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * @plan PLAN-20251027-STATELESS5.P08
   * @requirement REQ-STAT5-002.1
   * @pseudocode cli-runtime-adapter.md lines 597-609
   *
   * Cleans up adapter resources and unsubscribes from events.
   */
  dispose(): void {
    // @plan PLAN-20251027-STATELESS5.P08
    // @pseudocode cli-runtime-adapter.md lines 597-609

    // Unsubscribe from runtime state events
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

// ============================================================================
// Global Adapter Registry (Bootstrap Support)
// ============================================================================

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.1
 * @pseudocode cli-runtime-adapter.md lines 366-376
 *
 * Global adapter instance for CLI runtime helpers.
 */
let globalRuntimeAdapter: AgentRuntimeAdapter | null = null;

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.1
 * @pseudocode cli-runtime-adapter.md lines 366-376
 *
 * Sets the global runtime adapter (called during CLI bootstrap).
 */
export function setRuntimeAdapter(adapter: AgentRuntimeAdapter): void {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 366-376
  globalRuntimeAdapter = adapter;
}

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.1
 * @pseudocode cli-runtime-adapter.md lines 366-376
 *
 * Gets the global runtime adapter (used by CLI helpers).
 */
export function getRuntimeAdapter(): AgentRuntimeAdapter {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 369-375
  if (!globalRuntimeAdapter) {
    throw new Error(
      'Runtime adapter not initialized. Call setRuntimeAdapter() during bootstrap.',
    );
  }
  return globalRuntimeAdapter;
}

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.1
 *
 * Resets the global runtime adapter (for testing).
 */
export function resetRuntimeAdapter(): void {
  globalRuntimeAdapter = null;
}

// ============================================================================
// CLI Bootstrap Functions
// ============================================================================

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.2
 * @pseudocode cli-runtime-adapter.md lines 101-132
 *
 * CLI flags for runtime state initialization.
 */
export interface CliFlags {
  provider?: string;
  model?: string;
  key?: string;
  keyfile?: string;
  set?: Array<[string, string]>;
  profileLoad?: string;
  [key: string]: unknown;
}

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.2
 * @pseudocode cli-runtime-adapter.md lines 138-186
 *
 * Resolves runtime state parameters from CLI flags and config.
 */
export function resolveRuntimeStateFromFlags(
  flags: CliFlags,
  config: Config,
): RuntimeStateParams {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 138-186

  // Start with config defaults
  const params: RuntimeStateParams = {
    runtimeId: 'foreground-agent',
    provider: config.getProvider() || 'gemini',
    model: config.getModel(),
    sessionId: config.getSessionId(),
    proxyUrl: config.getProxy(),
  };

  // Override with CLI flags (precedence: flags > config)
  if (flags.provider) {
    params.provider = flags.provider;
  }

  if (flags.model) {
    params.model = flags.model;
  }

  if (flags.set) {
    // Process --set flags (e.g., --set base-url=...)
    for (const [key, value] of flags.set) {
      if (key === 'base-url') {
        params.baseUrl = value;
      } else {
        // Model params
        params.modelParams = params.modelParams || {};
        params.modelParams[key] = value;
      }
    }
  }

  // Note: profileLoad would be handled here in future phases

  return params;
}

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.2
 * @pseudocode cli-runtime-adapter.md lines 101-132
 *
 * Bootstrap result containing adapter and client.
 */
export interface BootstrapResult {
  adapter: AgentRuntimeAdapter;
  client: unknown; // GeminiClient - will be typed properly in future phases
}

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.2
 * @pseudocode cli-runtime-adapter.md lines 101-132
 *
 * Bootstraps the foreground agent runtime from CLI flags.
 */
export async function bootstrapForegroundAgent(
  cliFlags: CliFlags,
  config: Config,
): Promise<BootstrapResult> {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 101-132

  // Phase A: Resolve runtime state from flags and config
  const runtimeStateParams = resolveRuntimeStateFromFlags(cliFlags, config);

  // Phase B: Create runtime state
  const runtimeState = createAgentRuntimeState(runtimeStateParams);

  // Phase C: Create adapter
  const adapter = new AgentRuntimeAdapter(runtimeState, config);

  // Phase D & E: Create history service and GeminiClient (stub for now)
  const client = {}; // Stub - will be implemented in future phases

  return { adapter, client };
}

// ============================================================================
// Helper Functions (Delegate to Adapter)
// ============================================================================

/**
 * @plan PLAN-20251027-STATELESS5.P08
 * @requirement REQ-STAT5-002.1
 * @pseudocode cli-runtime-adapter.md lines 378-398
 *
 * Legacy helper functions that delegate to the global adapter.
 */

export function setRuntimeProvider(providerName: string): void {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 378-381
  const adapter = getRuntimeAdapter();
  adapter.setProvider(providerName);
}

export function getRuntimeProvider(): string {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 383-386
  const adapter = getRuntimeAdapter();
  return adapter.getProvider();
}

export function setRuntimeModel(modelName: string): void {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 388-390
  const adapter = getRuntimeAdapter();
  adapter.setModel(modelName);
}

export function getRuntimeModel(): string {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 392-394
  const adapter = getRuntimeAdapter();
  return adapter.getModel();
}

export function switchRuntimeProvider(
  providerName: string,
  model?: string,
): void {
  // @plan PLAN-20251027-STATELESS5.P08
  // @pseudocode cli-runtime-adapter.md lines 396-398
  const adapter = getRuntimeAdapter();
  adapter.switchProvider(providerName, { model });
}
