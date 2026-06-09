/**
 * @plan PLAN-20260608-ISSUE1588.P05
 *
 * SettingsService singleton management — migrated from core.
 * Settings-owned: does NOT import core runtime context.
 * Explicit temporary duplicate; core copy remains until P09.
 */

import type { SettingsService } from './SettingsService.js';

let settingsServiceInstance: SettingsService | null = null;

/**
 * Get the global SettingsService singleton instance.
 * Throws if no service has been registered.
 */
export function getSettingsService(): SettingsService {
  if (settingsServiceInstance) {
    return settingsServiceInstance;
  }

  throw new Error(
    '[settings] No SettingsService registered. Call registerSettingsService() before accessing settings.',
  );
}

/**
 * Register a SettingsService as the global singleton.
 */
export function registerSettingsService(
  settingsService: SettingsService,
): void {
  settingsServiceInstance = settingsService;
}

/**
 * Reset the settings service instance (for testing).
 */
export function resetSettingsService(): void {
  if (settingsServiceInstance) {
    settingsServiceInstance.clear();
  }
  settingsServiceInstance = null;
}
