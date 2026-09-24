/**
 * Normalization and lifecycle helpers for session-owned asynchronous work.
 */

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
