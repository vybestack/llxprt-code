/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RuntimeInvocationContext captures immutable, per-call metadata that providers
 * need to construct stateless requests without reading from Config directly.
 *
 * @plan PLAN-20251029-STATELESS8.P01
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P06
 * @requirement REQ-STAT8-001
 */

import type { RedactionConfig } from '../config/config.js';
/**
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * ProviderTelemetryContext import retained for backward compatibility;
 * core-owned TelemetryContext contract is available for injection path.
 */
import type { TelemetryContext as ProviderTelemetryContext } from './contracts/TelemetryContext.js';
import { deepFreeze } from '../profiles/contracts/routingContexts.js';
import { separateSettings } from '@vybestack/llxprt-code-settings';

/**
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * Re-export core-owned TelemetryContext for injection path.
 */
export type { TelemetryContext } from './contracts/TelemetryContext.js';

export interface RuntimeInvocationContext {
  /** Stable identifier for the invocation/runtime */
  readonly runtimeId: string;
  /** Immutable metadata merged from caller + provider manager layers */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Snapshot of global ephemeral overrides for this invocation */
  readonly ephemerals: Readonly<Record<string, unknown>>;
  /** CLI-only settings (never sent to API) */
  readonly cliSettings: Readonly<Record<string, unknown>>;
  /** Model behavior settings that require provider-specific translation */
  readonly modelBehavior: Readonly<Record<string, unknown>>;
  /** Model parameters that pass through unchanged to API */
  readonly modelParams: Readonly<Record<string, unknown>>;
  /** Custom HTTP headers for API requests */
  readonly customHeaders: Readonly<Record<string, string>>;
  readonly providerDefaults: Readonly<Record<string, unknown>>;
  /** Optional telemetry context derived during normalization */
  readonly telemetry?: ProviderTelemetryContext;
  /** Optional user memory snapshot for providers that need it */
  readonly userMemory?: string;
  /** Optional redaction configuration for logging/telemetry surfaces */
  readonly redaction?: Readonly<RedactionConfig>;
  /** Optional AbortSignal propagated through retry orchestration and providers */
  readonly signal?: AbortSignal;
  /** Helper to read a strongly-typed ephemeral override */
  getEphemeral<T = unknown>(key: string): T | undefined;
  /** Helper to read a CLI setting value */
  getCliSetting<T = unknown>(key: string): T | undefined;
  /** Helper to read a model behavior value */
  getModelBehavior<T = unknown>(key: string): T | undefined;
  /** Helper to read a model parameter value */
  getModelParam<T = unknown>(key: string): T | undefined;
  /** Helper to read nested provider-specific overrides (e.g. "openai") */
  getProviderOverrides<T = Record<string, unknown>>(
    providerName: string,
  ): T | undefined;
}

export interface RuntimeInvocationContextInit {
  providerDefaults?: Readonly<Record<string, unknown>>;
  configuredHeaders?: Readonly<Record<string, string>>;
  runtimeId?: string;
  runtimeMetadata?: Readonly<Record<string, unknown>>;
  modelParams?: Readonly<Record<string, unknown>>;
  modelParamsProviderName?: string;
  providerName: string;
  telemetry?: ProviderTelemetryContext;
  metadata?: Record<string, unknown>;
  ephemeralsSnapshot?: Record<string, unknown>;
  /** Optional snapshot of user memory for downstream prompt resolution */
  userMemory?: string;
  /** Optional redaction configuration override */
  redaction?: RedactionConfig;
  /** Optional AbortSignal propagated to retry orchestration and providers */
  signal?: AbortSignal;
  /** Optional fallback runtime id when runtime.runtimeId is missing */
  fallbackRuntimeId?: string;
}

function cloneAndFreeze<T extends object>(
  value: T | undefined,
): Readonly<T> | undefined {
  if (!value) {
    return undefined;
  }
  const clone = Object.assign({}, value);
  return Object.freeze(clone);
}

function assertInvocationPolicyData(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  )
    throw new TypeError(
      `Invocation policy at ${path} must contain only data values`,
    );
  if (value === null || value === undefined || typeof value !== 'object')
    return;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new TypeError(
      `Invocation policy at ${path} must contain only plain data`,
    );
  }
  if (ancestors.has(value))
    throw new TypeError(`Cyclic invocation policy at ${path}`);
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!('value' in descriptor))
      throw new TypeError(
        `Invocation policy at ${path}.${key} contains an accessor`,
      );
    assertInvocationPolicyData(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

export function captureInvocationEphemerals(
  values: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  assertInvocationPolicyData(values, 'ephemerals', new Set<object>());
  return deepFreeze(structuredClone(values));
}

export function readInvocationPolicyValue(
  values: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  let current: unknown = values;
  for (const part of key.split('.')) {
    if (!isPolicyRecord(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

export function createRuntimeInvocationContext(
  init: RuntimeInvocationContextInit,
): RuntimeInvocationContext {
  const runtimeId =
    typeof init.runtimeId === 'string' && init.runtimeId.trim() !== ''
      ? init.runtimeId
      : (init.fallbackRuntimeId ?? '');

  if (!runtimeId) {
    throw new Error('RuntimeInvocationContext requires a non-empty runtimeId.');
  }

  const mergedMetadata = freezeInvocationMetadata(init);

  if (init.ephemeralsSnapshot === undefined) {
    throw new Error(
      `RuntimeInvocationContext requires provider ephemerals for provider "${init.providerName}".`,
    );
  }

  const ephemerals = captureInvocationEphemerals(init.ephemeralsSnapshot);

  const separated = separateSettings(ephemerals, init.providerName);
  if (
    init.modelParams !== undefined &&
    init.modelParamsProviderName !== init.providerName
  ) {
    throw new Error(
      `Admitted model parameters belong to ${init.modelParamsProviderName}, not ${init.providerName}`,
    );
  }

  const cliSettings = Object.freeze(separated.cliSettings);
  const modelBehavior = Object.freeze(separated.modelBehavior);
  const modelParams = init.modelParams
    ? captureInvocationEphemerals(init.modelParams)
    : Object.freeze(separated.modelParams);
  captureInvocationEphemerals(init.configuredHeaders ?? {});
  const configuredHeaders = Object.freeze({ ...init.configuredHeaders });
  const customHeaders = Object.freeze({
    ...configuredHeaders,
    ...separated.customHeaders,
  });
  const providerDefaults = captureInvocationEphemerals(
    init.providerDefaults ?? {},
  );

  const redaction = cloneAndFreeze(init.redaction) ?? undefined;

  const userMemory = init.userMemory;

  const context: RuntimeInvocationContext = {
    runtimeId,
    metadata: mergedMetadata,
    ephemerals,
    cliSettings,
    modelBehavior,
    modelParams,
    customHeaders,
    providerDefaults,
    telemetry: init.telemetry,
    userMemory,
    redaction,
    signal: init.signal,
    getEphemeral<T = unknown>(key: string): T | undefined {
      return readInvocationPolicyValue(ephemerals, key) as T | undefined;
    },
    getCliSetting<T = unknown>(key: string): T | undefined {
      return cliSettings[key] as T | undefined;
    },
    getModelBehavior<T = unknown>(key: string): T | undefined {
      return modelBehavior[key] as T | undefined;
    },
    getModelParam<T = unknown>(key: string): T | undefined {
      return modelParams[key] as T | undefined;
    },
    getProviderOverrides<T = Record<string, unknown>>(
      providerName: string,
    ): T | undefined {
      const raw = ephemerals[providerName];
      if (raw === undefined || raw === null || typeof raw !== 'object') {
        return undefined;
      }
      return raw as T;
    },
  };

  return Object.freeze(context);
}

export function readInvocationPolicyRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === undefined) return {};
  if (!isPolicyRecord(value))
    throw new TypeError('Invocation policy must be a plain record');
  return value;
}

function isPolicyRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeInvocationMetadata(
  init: RuntimeInvocationContextInit,
): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...init.runtimeMetadata, ...init.metadata });
}
