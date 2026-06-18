/**
 * Async task service lifecycle helpers extracted from Config to keep
 * config.ts under size/complexity limits.
 *
 * Handles lazy initialization of AsyncTaskManager, AsyncTaskReminderService,
 * and AsyncTaskAutoTrigger.
 */

import { AsyncTaskManager } from '../services/asyncTaskManager.js';
import { AsyncTaskReminderService } from '../services/asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from '../services/asyncTaskAutoTrigger.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * Resolves the max-async setting from the settings service, defaulting to 5.
 */
export function normalizeMaxAsyncTasks(value: unknown, fallback = 5): number {
  let normalized: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    normalized = value;
  } else if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      normalized = parsed;
    }
  }

  if (normalized === -1 || (normalized !== undefined && normalized >= 1)) {
    return normalized;
  }
  return fallback;
}

export function resolveMaxAsyncTasks(settingsService: SettingsService): number {
  return normalizeMaxAsyncTasks(settingsService.get('task-max-async'));
}

/**
 * Lazily initializes and returns the AsyncTaskManager, storing it via
 * the provided setter for reuse on subsequent calls.
 */
export function getOrCreateAsyncTaskManager(
  settingsService: SettingsService,
  getter: () => AsyncTaskManager | undefined,
  setter: (manager: AsyncTaskManager) => void,
): AsyncTaskManager {
  const existing = getter();
  if (existing) {
    return existing;
  }
  const maxAsyncTasks = resolveMaxAsyncTasks(settingsService);
  const manager = new AsyncTaskManager(maxAsyncTasks);
  setter(manager);
  return manager;
}

/**
 * Lazily initializes and returns the AsyncTaskReminderService, storing it via
 * the provided setter for reuse on subsequent calls.
 */
export function getOrCreateAsyncTaskReminderService(
  settingsService: SettingsService,
  managerGetter: () => AsyncTaskManager | undefined,
  managerSetter: (manager: AsyncTaskManager) => void,
  reminderGetter: () => AsyncTaskReminderService | undefined,
  reminderSetter: (service: AsyncTaskReminderService) => void,
): AsyncTaskReminderService {
  const existing = reminderGetter();
  if (existing) {
    return existing;
  }
  const asyncTaskManager = getOrCreateAsyncTaskManager(
    settingsService,
    managerGetter,
    managerSetter,
  );
  const service = new AsyncTaskReminderService(asyncTaskManager);
  reminderSetter(service);
  return service;
}

/**
 * Sets up the AsyncTaskAutoTrigger with client callbacks, or refreshes
 * callbacks if already set up.
 *
 * @returns Cleanup function to unsubscribe from auto-trigger.
 */
export function setupAsyncTaskAutoTrigger(
  settingsService: SettingsService,
  accessors: {
    getManager: () => AsyncTaskManager | undefined;
    setManager: (manager: AsyncTaskManager) => void;
    getReminder: () => AsyncTaskReminderService | undefined;
    setReminder: (service: AsyncTaskReminderService) => void;
    getAutoTrigger: () => AsyncTaskAutoTrigger | undefined;
    setAutoTrigger: (trigger: AsyncTaskAutoTrigger) => void;
  },
  isAgentBusy: () => boolean,
  triggerAgentTurn: (message: string) => Promise<void>,
): () => void {
  const asyncTaskManager = getOrCreateAsyncTaskManager(
    settingsService,
    accessors.getManager,
    accessors.setManager,
  );
  const reminderService = getOrCreateAsyncTaskReminderService(
    settingsService,
    accessors.getManager,
    accessors.setManager,
    accessors.getReminder,
    accessors.setReminder,
  );

  const existing = accessors.getAutoTrigger();
  if (!existing) {
    const trigger = new AsyncTaskAutoTrigger(
      asyncTaskManager,
      reminderService,
      isAgentBusy,
      triggerAgentTurn,
    );
    accessors.setAutoTrigger(trigger);
    return trigger.subscribe();
  }

  // Refresh callbacks with the latest closures from React re-renders
  existing.updateCallbacks(isAgentBusy, triggerAgentTurn);
  return existing.subscribe();
}
