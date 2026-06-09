/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P03
 * @requirement:REQ-SP-002.1
 * Derived from pseudocode/provider-invocation.md:2 and pseudocode/cli-runtime.md:5.
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-04, lines 40-44
 *
 * Updated to import MissingRuntimeProviderError from the core-owned
 * runtime errors module instead of the providers package.
 */
import type { Config } from '../config/config.js';
import { MissingRuntimeProviderError } from './errors/MissingRuntimeProviderError.js';

export interface RuntimeSettingsState {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getProviderSettings(provider: string): Record<string, unknown>;
  setProviderSetting(provider: string, key: string, value: unknown): void;
  getAllGlobalSettings(): Record<string, unknown>;
  clear(): void;
  getSettings(): Promise<Record<string, unknown>>;
  getSettings(provider: string): Promise<Record<string, unknown>>;
  updateSettings(changes: Record<string, unknown>): Promise<void>;
  updateSettings(
    provider: string,
    changes: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export interface ProviderRuntimeContext {
  settingsService: RuntimeSettingsState;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

let activeContext: ProviderRuntimeContext | null = null;

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export interface ProviderRuntimeContextInit {
  settingsService?: RuntimeSettingsState;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
let defaultRuntimeStateFactory: (() => RuntimeSettingsState) | null = null;

export function setProviderRuntimeStateFactory(
  factory: (() => RuntimeSettingsState) | null,
): void {
  defaultRuntimeStateFactory = factory;
}

export function createProviderRuntimeContext(
  init: ProviderRuntimeContextInit = {},
): ProviderRuntimeContext {
  const settingsService =
    init.settingsService ?? defaultRuntimeStateFactory?.();
  if (!settingsService) {
    const missingReasons = [];
    if (init.settingsService === undefined || init.settingsService === null) {
      missingReasons.push('init.settingsService is not provided');
    }
    if (defaultRuntimeStateFactory === null) {
      missingReasons.push(
        'defaultRuntimeStateFactory is not set via setProviderRuntimeStateFactory()',
      );
    }
    throw new MissingRuntimeProviderError({
      providerKey: 'provider-runtime',
      missingFields: ['settings'],
      requirement: 'REQ-SP4-004',
      stage: 'createProviderRuntimeContext',
      metadata: {
        hint: `${missingReasons.join('; ')}. Provide settingsService or initialise the settings runtime adapter before creating provider runtime contexts.`,
      },
      message:
        'MissingProviderRuntimeError(provider-runtime): provider runtime context creation requires settings (REQ-SP4-004).',
    });
  }

  return {
    settingsService,
    config: init.config,
    runtimeId: init.runtimeId,
    metadata: init.metadata,
  };
}

export function setActiveProviderRuntimeContext(
  context: ProviderRuntimeContext | null,
): void {
  activeContext = context;
}

export function clearActiveProviderRuntimeContext(): void {
  activeContext = null;
}

export function peekActiveProviderRuntimeContext(): ProviderRuntimeContext | null {
  return activeContext;
}

export function getActiveProviderRuntimeContext(): ProviderRuntimeContext {
  if (activeContext) {
    return activeContext;
  }

  throw new MissingRuntimeProviderError({
    providerKey: 'provider-runtime',
    missingFields: ['settings'],
    requirement: 'REQ-SP4-004',
    stage: 'getActiveProviderRuntimeContext',
    metadata: {
      hint: 'Call setActiveProviderRuntimeContext() before provider operations.',
    },
    message:
      'MissingProviderRuntimeError(provider-runtime): active provider runtime context is missing settings (REQ-SP4-004).',
  });
}
