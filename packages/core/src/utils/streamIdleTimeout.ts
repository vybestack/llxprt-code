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

const STREAM_IDLE_TIMEOUT_CONFIG_KEYS = [
  STREAM_IDLE_TIMEOUT_SETTING_KEY,
  STREAM_IDLE_TIMEOUT_CAMEL_CASE_KEY,
] as const;

/**
 * Default first-response timeout in milliseconds (5 minutes).
 *
 * Unlike the inter-chunk idle timeout (DEFAULT-ON = 0, i.e. disabled), the
 * first-response watchdog is DEFAULT-ON because an unbounded wait from send
 * until the FIRST stream event is never legitimate — it is the exact
 * "Responding" hang seen in issue #2379 when a provider activation never
 * settles. 5 minutes is generous enough that slow reasoning-model activation
 * never false-trips, yet bounded enough that a truly-hung activation surfaces
 * an error instead of hanging the UI forever.
 *
 * A value of 0 (or <=0) explicitly disables this watchdog.
 */
export const DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = 300_000;

/**
 * Environment variable name for first-response timeout override.
 * Takes precedence over config settings.
 */
export const LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV =
  'LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS';

/**
 * Ephemeral setting key for the first-response timeout.
 * Hyphenated canonical key (mirrors stream-idle-timeout-ms convention);
 * takes priority over the camelCase alias.
 */
export const STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY =
  'stream-first-response-timeout-ms';

/**
 * CamelCase alias for the first-response timeout setting key, surfaced via
 * settings.json through the CLI schema (config-schema.ts).
 */
export const STREAM_FIRST_RESPONSE_TIMEOUT_CAMEL_CASE_KEY =
  'streamFirstResponseTimeoutMs';

const STREAM_FIRST_RESPONSE_CONFIG_KEYS = [
  STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY,
  STREAM_FIRST_RESPONSE_TIMEOUT_CAMEL_CASE_KEY,
] as const;

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
 * Resolves an effective timeout by checking, in priority order:
 * 1. A process.env override (if set and valid)
 * 2. Each config ephemeral setting key in order (hyphenated canonical first)
 * 3. The supplied fallback default
 *
 * Values <= 0 are normalized to 0 (disabled sentinel).
 * Invalid/empty string values fall through to the next priority level.
 */
function resolveTimeout(
  envName: string,
  configKeys: readonly string[],
  fallbackDefault: number,
  config?: { getEphemeralSetting?: (key: string) => unknown },
): number {
  const envValue = normalizeTimeoutConfigValue(process.env[envName]);
  if (envValue !== undefined) {
    return envValue;
  }

  for (const settingKey of configKeys) {
    const configValue = normalizeTimeoutConfigValue(
      config?.getEphemeralSetting?.(settingKey),
    );
    if (configValue !== undefined) {
      return configValue;
    }
  }

  return fallbackDefault;
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
  return resolveTimeout(
    LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV,
    STREAM_IDLE_TIMEOUT_CONFIG_KEYS,
    DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    config,
  );
}

/**
 * Resolves the effective stream first-response timeout value.
 *
 * This is the time-to-first-response watchdog: it bounds the ENTIRE window
 * from sending the request until the FIRST stream event is produced
 * (activation + connect + first token). An infinite wait here is never
 * legitimate — it is the exact "Responding" hang in issue #2379 — so this
 * watchdog is DEFAULT-ON (300000ms), unlike the inter-chunk idle timeout.
 *
 * Priority order (same semantics as resolveStreamIdleTimeoutMs):
 * 1. Environment variable LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS
 * 2. Config ephemeral setting 'stream-first-response-timeout-ms' (hyphenated)
 * 3. Config ephemeral setting 'streamFirstResponseTimeoutMs' (camelCase alias)
 * 4. DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS (300000 — enabled)
 *
 * Values <= 0 disable the watchdog (return 0).
 * Invalid/empty string values fall back to the next priority level.
 *
 * @param config - Optional Config instance to read ephemeral setting from
 * @returns Resolved timeout in ms, or 0 if watchdog should be disabled
 */
export function resolveStreamFirstResponseTimeoutMs(config?: {
  getEphemeralSetting?: (key: string) => unknown;
}): number {
  return resolveTimeout(
    LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS_ENV,
    STREAM_FIRST_RESPONSE_CONFIG_KEYS,
    DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS,
    config,
  );
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
