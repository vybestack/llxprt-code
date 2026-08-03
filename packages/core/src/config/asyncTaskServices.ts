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
import { ShellJobManager } from '../services/shellJobManager.js';
import { ShellNotificationAdapter } from '../services/shellNotificationAdapter.js';
import type { ShellNotificationSource } from '../services/shellNotificationSource.js';
import {
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_MAX_BACKGROUND_JOBS,
} from '../services/shellJobTypes.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * Resolves the max-async setting from the settings service, defaulting to 5.
 */
function normalizeIntSetting(
  value: unknown,
  isValid: (n: number) => boolean,
  fallback: number,
): number {
  let normalized: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    normalized = value;
  } else if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      normalized = parsed;
    }
  }

  if (normalized !== undefined && isValid(normalized)) {
    return normalized;
  }
  return fallback;
}

const isUnlimitedOrPositive = (n: number): boolean => n === -1 || n >= 1;

export function normalizeMaxAsyncTasks(value: unknown, fallback = 5): number {
  return normalizeIntSetting(value, isUnlimitedOrPositive, fallback);
}

export function resolveMaxAsyncTasks(settingsService: SettingsService): number {
  return normalizeMaxAsyncTasks(settingsService.get('task-max-async'));
}

export function normalizeShellMaxBackgroundJobs(
  value: unknown,
  fallback = DEFAULT_MAX_BACKGROUND_JOBS,
): number {
  return normalizeIntSetting(value, isUnlimitedOrPositive, fallback);
}

export function normalizeShellLogMaxBytes(
  value: unknown,
  fallback = DEFAULT_LOG_MAX_BYTES,
): number {
  return normalizeIntSetting(value, (n) => n >= 1024, fallback);
}

export function resolveShellJobSettings(settingsService: SettingsService): {
  maxBackgroundJobs: number;
  logMaxBytes: number;
} {
  return {
    maxBackgroundJobs: normalizeShellMaxBackgroundJobs(
      settingsService.get('shell-max-background-jobs'),
    ),
    logMaxBytes: normalizeShellLogMaxBytes(
      settingsService.get('shell-background-log-max-bytes'),
    ),
  };
}

export function getOrCreateShellJobManager(
  settingsService: SettingsService,
  getter: () => ShellJobManager | undefined,
  setter: (manager: ShellJobManager) => void,
): ShellJobManager {
  const existing = getter();
  if (existing) {
    return existing;
  }
  const { maxBackgroundJobs, logMaxBytes } =
    resolveShellJobSettings(settingsService);
  const manager = new ShellJobManager({
    maxBackgroundJobs,
    logMaxBytes,
  });
  setter(manager);
  return manager;
}

/**
 * Dispose the shell job manager if it exists, terminating running jobs.
 * Returns any error so the caller can collect it in its own failure list.
 */
export async function disposeShellJobManager(
  manager: ShellJobManager | undefined,
  failures: unknown[],
): Promise<void> {
  if (!manager) {
    return;
  }
  try {
    await manager.dispose();
  } catch (error) {
    failures.push(error);
  }
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
 * callbacks if already set up. When a shell job manager provider is supplied,
 * shell job completions are coalesced into the same notification pipeline
 * (#1995 slice 7).
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
    getShellJobManager: () => ShellJobManager | undefined;
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

  const shellManager = accessors.getShellJobManager();
  const shellSource: ShellNotificationSource | undefined =
    shellManager !== undefined
      ? new ShellNotificationAdapter(shellManager)
      : undefined;
  reminderService.setShellNotificationSource(shellSource);

  const existing = accessors.getAutoTrigger();
  if (!existing) {
    const trigger = new AsyncTaskAutoTrigger(
      asyncTaskManager,
      reminderService,
      isAgentBusy,
      triggerAgentTurn,
    );
    trigger.setShellNotificationSource(shellSource);
    accessors.setAutoTrigger(trigger);
    return trigger.subscribe();
  }

  // Refresh callbacks with the latest closures from React re-renders
  existing.updateCallbacks(isAgentBusy, triggerAgentTurn);
  existing.setShellNotificationSource(shellSource);
  return existing.subscribe();
}
