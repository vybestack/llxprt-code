/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for settings access.
 *
 * Provides settings service retrieval and key-value get/set
 * needed by task and tool-registry tools.
 *
 * Unconditionally defined as a tools-owned interface even though
 * current usage may route through IToolRegistryHost, because
 * settings will get its own package in a future phase.
 *
 * Consumed by: task, tool-registry.
 * Implemented by: CoreSettingsServiceAdapter in packages/core.
 */

/** Opaque handle to the settings service. */
export interface SettingsService {
  /** Get a setting value by key. */
  get?: (key: string) => unknown;
  /** Set a setting value by key. */
  set?: (key: string, value: unknown) => void;
  /** Get all global settings. */
  getAllGlobalSettings?: () => Record<string, unknown>;
}

export interface ISettingsService {
  /**
   * Get the settings service instance.
   * @returns The settings service.
   */
  getSettingsService(): SettingsService;

  /**
   * Get a setting value by key.
   * @param key - The setting key.
   * @returns The setting value.
   */
  getSetting(key: string): unknown;

  /**
   * Set a setting value by key.
   * @param key - The setting key.
   * @param value - The value to set.
   */
  setSetting(key: string, value: unknown): Promise<void>;
}
