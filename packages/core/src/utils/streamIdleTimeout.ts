/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { delay } from './delay.js';

export class StreamIdleTimeoutError extends Error {
  constructor(message = 'Stream idle timeout') {
    super(message);
    this.name = 'StreamIdleTimeoutError';
  }
}

/**
 * Default stream idle timeout in milliseconds.
 * Disabled by default (0). Set to a positive number via
 * LLXPRT_STREAM_IDLE_TIMEOUT_MS env var or 'stream-idle-timeout-ms'
 * ephemeral setting to enable the watchdog.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 0;

/**
 * Environment variable name for stream idle timeout override.
 * Takes precedence over config setting.
 */
export const LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV =
  'LLXPRT_STREAM_IDLE_TIMEOUT_MS';

/**
 * Ephemeral setting key for stream idle timeout.
 * This hyphenated key is the canonical source-of-truth key used by
 * the SettingsService / registry. It takes priority over the camelCase alias.
 */
export const STREAM_IDLE_TIMEOUT_SETTING_KEY = 'stream-idle-timeout-ms';

/**
 * CamelCase alias for the stream idle timeout setting key.
 * settings.json surfaces this key via the CLI schema (see schema-core.ts).
 * Without reading it here, a settings.json value would never reach the
 * watchdog because there is no automatic camelCase→hyphenated conversion
 * in the SettingsService.
 */
export const STREAM_IDLE_TIMEOUT_CAMEL_CASE_KEY = 'streamIdleTimeoutMs';

function parseTimeoutConfigValue(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value.trim());
  }
  return NaN;
}

function normalizeTimeoutConfigValue(value: unknown): number | undefined {
  const isEmptyString = typeof value === 'string' && value.trim() === '';
  if (value === undefined || isEmptyString) {
    return undefined;
  }

  const parsed = parseTimeoutConfigValue(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(0, parsed);
}

/**
 * Resolves the effective stream idle timeout value.
 *
 * Priority order:
 * 1. Environment variable LLXPRT_STREAM_IDLE_TIMEOUT_MS (if set and valid)
 * 2. Config ephemeral setting 'stream-idle-timeout-ms' (hyphenated; canonical)
 * 3. Config ephemeral setting 'streamIdleTimeoutMs' (camelCase alias from settings.json)
 * 4. DEFAULT_STREAM_IDLE_TIMEOUT_MS (0 — disabled)
 *
 * The hyphenated key takes priority over the camelCase alias for backward
 * compatibility with profiles and code that set 'stream-idle-timeout-ms'
 * directly.
 *
 * Values <= 0 disable the watchdog (return 0).
 * Invalid string values (including empty/whitespace) fall back to the next priority level.
 *
 * @param config - Optional Config instance to read ephemeral setting from
 * @returns Resolved timeout in ms, or 0 if watchdog should be disabled
 */
export function resolveStreamIdleTimeoutMs(config?: {
  getEphemeralSetting?: (key: string) => unknown;
}): number {
  // Check environment variable first (highest priority)
  const envValue = normalizeTimeoutConfigValue(
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV],
  );
  if (envValue !== undefined) {
    return envValue;
  }

  // Check config ephemeral settings: hyphenated first (canonical), then camelCase alias
  for (const settingKey of [
    STREAM_IDLE_TIMEOUT_SETTING_KEY,
    STREAM_IDLE_TIMEOUT_CAMEL_CASE_KEY,
  ]) {
    const configValue = normalizeTimeoutConfigValue(
      config?.getEphemeralSetting?.(settingKey),
    );
    if (configValue !== undefined) {
      return configValue;
    }
  }

  return DEFAULT_STREAM_IDLE_TIMEOUT_MS;
}

export interface NextStreamEventWithIdleTimeoutOptions<T> {
  iterator: AsyncIterator<T>;
  timeoutMs: number;
  signal?: AbortSignal;
  onTimeout?: () => void | Promise<void>;
  createTimeoutError?: () => Error;
}

export async function nextStreamEventWithIdleTimeout<T>({
  iterator,
  timeoutMs,
  signal,
  onTimeout,
  createTimeoutError = () => new StreamIdleTimeoutError(),
}: NextStreamEventWithIdleTimeoutOptions<T>): Promise<IteratorResult<T>> {
  const timeoutController = new AbortController();
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted === true) {
    signal.removeEventListener('abort', onAbort);
    await onTimeout?.();
    throw createTimeoutError();
  }

  try {
    const timeoutPromise = delay(timeoutMs, timeoutController.signal).then(
      async () => {
        await onTimeout?.();
        throw createTimeoutError();
      },
    );

    return await Promise.race([iterator.next(), timeoutPromise]);
  } finally {
    timeoutController.abort();
    signal?.removeEventListener('abort', onAbort);
  }
}
