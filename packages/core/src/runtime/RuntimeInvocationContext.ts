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
import type { SettingsService } from '../settings/SettingsService.js';
import type { ProviderTelemetryContext } from '../providers/types/providerRuntime.js';
import type { ProviderRuntimeContext } from './providerRuntimeContext.js';
import { separateSettings } from '../settings/settingsRegistry.js';

export interface RuntimeInvocationContext {
  /** Stable identifier for the invocation/runtime */
  readonly runtimeId: string;
  /** Immutable metadata merged from caller + provider manager layers */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Per-call settings service (stateless view) */
  readonly settings: SettingsService;
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
  /** Optional telemetry context derived during normalization */
  readonly telemetry?: ProviderTelemetryContext;
  /** Optional user memory snapshot for providers that need it */
  readonly userMemory?: string;
  /** Optional redaction configuration for logging/telemetry surfaces */
  readonly redaction?: Readonly<RedactionConfig>;
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
  runtime: ProviderRuntimeContext;
  settings: SettingsService;
  providerName: string;
  telemetry?: ProviderTelemetryContext;
  metadata?: Record<string, unknown>;
  ephemeralsSnapshot?: Record<string, unknown>;
  /** Optional snapshot of user memory for downstream prompt resolution */
  userMemory?: string;
  /** Optional redaction configuration override */
  redaction?: RedactionConfig;
  /** Optional fallback runtime id when runtime.runtimeId is missing */
  fallbackRuntimeId?: string;
}

function cloneAndFreeze<T extends object>(
  value: T | undefined,
): Readonly<T> | undefined {
  if (!value) {
    return undefined;
  }
  const clone = Object.assign({}, value) as T;
  return Object.freeze(clone) as Readonly<T>;
}

export function createRuntimeInvocationContext(
  init: RuntimeInvocationContextInit,
): RuntimeInvocationContext {
  const runtimeId =
    typeof init.runtime.runtimeId === 'string' &&
    init.runtime.runtimeId.trim() !== ''
      ? (init.runtime.runtimeId as string)
      : (init.fallbackRuntimeId ?? '');

  if (!runtimeId) {
    throw new Error('RuntimeInvocationContext requires a non-empty runtimeId.');
  }

  const mergedMetadata = Object.freeze({
    ...(init.runtime.metadata ?? {}),
    ...(init.metadata ?? {}),
  });

  if (init.ephemeralsSnapshot === undefined) {
    throw new Error(
      `RuntimeInvocationContext requires provider ephemerals for provider "${init.providerName}".`,
    );
  }

  const ephemerals = Object.freeze({ ...init.ephemeralsSnapshot });

  const separated = separateSettings(
    init.ephemeralsSnapshot,
    init.providerName,
  );

  const cliSettings = Object.freeze(separated.cliSettings);
  const modelBehavior = Object.freeze(separated.modelBehavior);
  const modelParams = Object.freeze(separated.modelParams);
  const customHeaders = Object.freeze(separated.customHeaders);

  const redaction = cloneAndFreeze(init.redaction) ?? undefined;

  const userMemory = init.userMemory;

  const context: RuntimeInvocationContext = {
    runtimeId,
    metadata: mergedMetadata,
    settings: init.settings,
    ephemerals,
    cliSettings,
    modelBehavior,
    modelParams,
    customHeaders,
    telemetry: init.telemetry,
    userMemory,
    redaction,
    getEphemeral<T = unknown>(key: string): T | undefined {
      return ephemerals[key] as T | undefined;
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
      if (!raw || typeof raw !== 'object') {
        return undefined;
      }
      return raw as T;
    },
  };

  return Object.freeze(context);
}
