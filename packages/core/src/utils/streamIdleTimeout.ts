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
 */
export const STREAM_IDLE_TIMEOUT_SETTING_KEY = 'stream-idle-timeout-ms';

/**
 * Resolves the effective stream idle timeout value.
 *
 * Priority order:
 * 1. Environment variable LLXPRT_STREAM_IDLE_TIMEOUT_MS (if set and valid)
 * 2. Config ephemeral setting 'stream-idle-timeout-ms' (if config provided and valid)
 * 3. DEFAULT_STREAM_IDLE_TIMEOUT_MS (0 — disabled)
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
  const envValue = process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
  if (envValue !== undefined && envValue.trim() !== '') {
    const parsed = Number(envValue.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
    // Invalid env var falls through to config/default
  }

  // Check config ephemeral setting (if config provided)
  if (config?.getEphemeralSetting) {
    const configValue = config.getEphemeralSetting(
      STREAM_IDLE_TIMEOUT_SETTING_KEY,
    );
    if (configValue !== undefined) {
      // Handle string values: empty/whitespace falls through to default
      if (typeof configValue === 'string' && configValue.trim() === '') {
        // Fall through to default
      } else {
        const parsed =
          typeof configValue === 'number'
            ? configValue
            : typeof configValue === 'string'
              ? Number(configValue.trim())
              : NaN;
        if (Number.isFinite(parsed)) {
          return Math.max(0, parsed);
        }
      }
      // Invalid config value falls through to default
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
  if (signal?.aborted) {
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
