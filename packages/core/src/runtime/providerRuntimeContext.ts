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

/**
 * Issue #2616 PR A: this module is explicit-only. The former module-level
 * activeContext pointer, its set/clear/peek/get accessors, and the
 * defaultRuntimeStateFactory fallback are deleted — a context exists only
 * when a caller supplies its settings service.
 */
import type { Config } from '../config/config.js';
import { MissingRuntimeProviderError } from './errors/MissingRuntimeProviderError.js';
import type { RequestMediaResolutionService } from '../storage/request-media-resolver.js';
import type { ProviderFileReferenceMetadata } from '../services/history/IContent.js';

export interface ProviderFileBindingStore {
  bind(
    contentId: string,
    reference: ProviderFileReferenceMetadata,
  ): Promise<void>;
  unbind(
    contentId: string,
    reference: ProviderFileReferenceMetadata,
  ): Promise<void>;
}

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
  mediaResolver?: RequestMediaResolutionService;
  requestMediaBudgetBytes?: number;
  providerFileBindings?: ProviderFileBindingStore;
}

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export interface ProviderRuntimeContextInit {
  settingsService?: RuntimeSettingsState | null;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  mediaResolver?: RequestMediaResolutionService;
  requestMediaBudgetBytes?: number;
  providerFileBindings?: ProviderFileBindingStore;
}

export function createProviderRuntimeContext(
  init: ProviderRuntimeContextInit = {},
): ProviderRuntimeContext {
  const settingsService = init.settingsService;
  if (!settingsService) {
    throw new MissingRuntimeProviderError({
      providerKey: 'provider-runtime',
      missingFields: ['settings'],
      requirement: 'REQ-SP4-004',
      stage: 'createProviderRuntimeContext',
      metadata: {
        hint: 'init.settingsService is not provided. Construct the service at the composition site (e.g. via the runtime settings adapter) and pass it explicitly before creating provider runtime contexts.',
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
    mediaResolver: init.mediaResolver,
    requestMediaBudgetBytes: init.requestMediaBudgetBytes,
    providerFileBindings: init.providerFileBindings,
  };
}
