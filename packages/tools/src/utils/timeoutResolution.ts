/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical timeout resolution shared by the `task` and `run_shell_command`
 * tools. The configured maximum is a CEILING ONLY: it bounds a request
 * upward and never overrides a shorter request. Unbounded execution is
 * reachable ONLY when the operator affirmatively declines to impose a ceiling
 * by setting the maximum to `-1`. An absent maximum is not an opt-out, so the
 * parameter is a required `number`.
 */

/** Outcome of resolving a timeout against the default and maximum bounds. */
export interface TimeoutResolution {
  /** Effective timeout in seconds; undefined means unbounded. */
  readonly effectiveTimeoutSeconds: number | undefined;
  /** What the caller asked for, verbatim (undefined when omitted). */
  readonly requestedTimeoutSeconds: number | undefined;
  /** Configured default that applies when the caller omits the parameter. */
  readonly defaultTimeoutSeconds: number;
  /**
   * Configured ceiling. `-1` means the operator declined a ceiling
   * (genuinely unbounded). This is always a finite number or `-1` — never
   * omitted, because an absent maximum is not an opt-out.
   */
  readonly maxTimeoutSeconds: number;
  /** True when the request (or default) was reduced to the ceiling. */
  readonly clamped: boolean;
}

export function resolveTimeout(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number,
): TimeoutResolution {
  // The effective "ask": the explicit request when provided, else the default.
  // -1 in either position expresses an unbounded intent.
  const chosen = requestedTimeoutSeconds ?? defaultTimeoutSeconds;
  const isUnboundedChoice = chosen === -1;

  // No ceiling: the operator affirmatively declined to bound upward (-1). An
  // unbounded ask is truly unbounded; a finite ask is honoured exactly.
  if (maxTimeoutSeconds === -1) {
    return {
      effectiveTimeoutSeconds: isUnboundedChoice ? undefined : chosen,
      requestedTimeoutSeconds,
      defaultTimeoutSeconds,
      maxTimeoutSeconds,
      clamped: false,
    };
  }

  // Finite ceiling: an unbounded ask, or any finite ask above the ceiling,
  // resolves to the ceiling. A finite ask at or below it is honoured exactly.
  const clamped = isUnboundedChoice || chosen > maxTimeoutSeconds;
  return {
    effectiveTimeoutSeconds: clamped ? maxTimeoutSeconds : chosen,
    requestedTimeoutSeconds,
    defaultTimeoutSeconds,
    maxTimeoutSeconds,
    clamped,
  };
}

export function resolveTimeoutSeconds(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number,
): number | undefined {
  return resolveTimeout(
    requestedTimeoutSeconds,
    defaultTimeoutSeconds,
    maxTimeoutSeconds,
  ).effectiveTimeoutSeconds;
}

/**
 * Validates a caller-supplied `timeout_seconds` value at the tool
 * parameter-validation boundary. The only allowed non-positive value is `-1`
 * ("as long as the configured maximum allows"); any other value must be a
 * finite number greater than zero. Returns an error message string when the
 * value is rejected, or `null` when it is acceptable (including `undefined`,
 * meaning the caller omitted the parameter) (Issue #3031).
 */
export function validateTimeoutSeconds(
  timeoutSeconds: number | undefined,
): string | null {
  if (timeoutSeconds === undefined) {
    return null;
  }
  if (
    timeoutSeconds === -1 ||
    (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)
  ) {
    return null;
  }
  return (
    `Invalid timeout_seconds: ${timeoutSeconds}. ` +
    `Allowed values are -1 (as long as the configured maximum allows) or a ` +
    `finite number of seconds greater than zero.`
  );
}

/**
 * Validates a CONFIGURED timeout setting (the default or the maximum) at the
 * resolution boundary. Profile-supplied ephemeral settings are not checked by
 * {@link validateTimeoutSeconds} (which only covers the caller's request), so
 * without this a profile value of `0`, `-2`, `Infinity`, or a non-numeric
 * value would flow straight through to `setTimeout` and terminate a command
 * almost immediately.
 *
 * Acceptable: `-1` (the operator declining a ceiling / unlimited default) or
 * a finite number greater than zero. Rejects anything else by THROWING an
 * error naming the setting and what is allowed — fail fast, no silent coerce,
 * no default substitution. Returns the validated value narrowed to `number`
 * (CodeRabbit Finding 2, #3031).
 */
export function validateConfiguredTimeoutSeconds(
  value: unknown,
  settingName: string,
): number {
  if (
    typeof value === 'number' &&
    (value === -1 || (Number.isFinite(value) && value > 0))
  ) {
    return value;
  }
  throw new Error(
    `Invalid value for ${settingName}: ${String(value)}. ` +
      `Allowed values are -1 (no ceiling / unlimited) or a finite number of ` +
      `seconds greater than zero.`,
  );
}

/**
 * Reads a configured timeout setting from a raw settings record and validates
 * it at the resolution boundary. When the setting is absent, the shipped
 * `fallback` (always a valid finite positive number) is used. When present,
 * it is validated by {@link validateConfiguredTimeoutSeconds} so a bad
 * profile value (0, -2, Infinity, non-numeric) is rejected here rather than
 * flowing unchecked to `setTimeout` (CodeRabbit Finding 2, #3031).
 */
export function readConfiguredTimeoutSeconds(
  settings: Record<string, unknown>,
  settingName: string,
  fallback: number,
): number {
  const raw = settings[settingName];
  return raw === undefined
    ? fallback
    : validateConfiguredTimeoutSeconds(raw, settingName);
}

export function describeTimeoutClamp(
  resolution: TimeoutResolution,
  settings: { readonly defaultSetting: string; readonly maxSetting: string },
): string | undefined {
  if (!resolution.clamped) {
    return undefined;
  }

  const requested = describeRequestedTimeout(resolution, settings);
  const applied = resolution.effectiveTimeoutSeconds;

  return (
    `Requested timeout ${requested} was reduced to the configured ceiling of ${applied}s. ` +
    `Raise ${settings.maxSetting} to allow a longer run.`
  );
}

/**
 * Returns the effective timeout seconds for a resolution, failing fast when
 * the resolution is unbounded. A timeout termination is only reachable when a
 * timer was actually armed — i.e. the resolution is bounded — so an unbounded
 * resolution reaching a timeout formatter is a broken invariant, not a state
 * to paper over. Every timeout-message path must read the effective seconds
 * through this accessor rather than `effectiveTimeoutSeconds` directly, so the
 * finite-timeout invariant is enforced at the type boundary (Issue #3031).
 */
export function requireEffectiveTimeoutSeconds(
  resolution: TimeoutResolution,
): number {
  const effective = resolution.effectiveTimeoutSeconds;
  if (effective === undefined) {
    throw new Error(
      'Timeout invariant violated: a timeout termination requires a finite ' +
        'effective timeout, but the resolution is unbounded ' +
        '(effectiveTimeoutSeconds is undefined). An unbounded run arms no ' +
        'timer and cannot time out.',
    );
  }
  return effective;
}

/**
 * Builds the legible timeout-termination message naming the termination
 * reason (TIMEOUT), the effective timeout applied, and the parameter +
 * settings that would raise it. The effective timeout is a finite `number`:
 * a timeout termination cannot be unbounded, because an unbounded run arms no
 * timer and therefore can never fire. Shared by the agents `task` tool and the
 * core `CoreSubagentServiceAdapter` so the wording cannot drift (Issue #3031).
 */
export function describeTimeoutTermination(
  effectiveTimeoutSeconds: number,
  settings: { readonly defaultSetting: string; readonly maxSetting: string },
): string {
  return (
    `Subagent terminated by TIMEOUT after ${effectiveTimeoutSeconds}s. ` +
    `The effective timeout is bounded by the timeout_seconds parameter and the ` +
    `${settings.maxSetting} / ${settings.defaultSetting} settings; ` +
    `raise them to allow a longer run.`
  );
}

function describeRequestedTimeout(
  resolution: TimeoutResolution,
  settings: { readonly defaultSetting: string },
): string {
  const explicit = resolution.requestedTimeoutSeconds;
  if (explicit !== undefined) {
    return explicit === -1 ? '-1 (unlimited)' : `${explicit}s`;
  }
  const d = resolution.defaultTimeoutSeconds;
  const dDesc = d === -1 ? '-1 (unlimited)' : `${d}s`;
  return `the configured default (${settings.defaultSetting} = ${dDesc})`;
}
