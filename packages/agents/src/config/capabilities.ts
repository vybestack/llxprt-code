/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow capability interfaces over core's `Config`.
 *
 * Each interface names the members one use case actually reads, so a consumer
 * depends on two or three members rather than the ~349 the compiler reports on
 * `Config`. Core's `Config` satisfies every one of these structurally, so
 * composition roots keep passing it unchanged and nothing moves at runtime.
 *
 * These are deliberately NOT published from the agents package root. They are
 * consumer-owned use-case contracts, not a second god-object assembled from
 * whatever the package happens to need. Add a new interface per use case
 * rather than widening an existing one to fit an unrelated caller.
 *
 * Part of the #2615 Config decomposition.
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core/runtime/contracts/index.js';

/** Reads the identifier of the active session. */
export interface SessionIdSource {
  getSessionId(): string;
}

/** Reads whether debug output is enabled. */
export interface DebugModeSource {
  getDebugMode(): boolean;
}

/** Reaches the settings service. */
export interface SettingsServiceSource {
  getSettingsService(): SettingsService;
}

/** Reads the image payload budget applied to tool output. */
export interface ImageBudgetSource {
  getImagePayloadBudgetBytes(): number;
}

/** Reaches the provider manager, which may not be bound yet. */
export interface ProviderManagerSource {
  getProviderManager(): RuntimeProviderManager | undefined;
}

/** Re-resolves authentication for the active provider. */
export interface AuthRefresher {
  refreshAuth(authMethod?: string): Promise<void>;
}

/** Reads and writes ephemeral (session-scoped) settings. */
export interface EphemeralSettingsAccess {
  getEphemeralSetting(key: string): unknown;
  setEphemeralSetting(key: string, value: unknown): void;
}

/** Reads the session limits that bound a message stream. */
export interface SessionLimitsSource {
  getIdeMode(): boolean;
  getMaxSessionTurns(): number;
}
