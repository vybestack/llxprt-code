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
 * when a caller supplies its identity data.
 */
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

export type RuntimeKind =
  | 'cli-bootstrap'
  | 'cli-interactive'
  | 'agent'
  | 'subagent';

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
export interface ProviderRequestCollaborators {
  readonly runtimeId?: string;
  readonly runtimeKind?: RuntimeKind;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderRuntimeContext {
  runtimeId?: string;
  runtimeKind?: RuntimeKind;
  metadata?: Record<string, unknown>;
}

export function createProviderRuntimeContext(
  init: ProviderRuntimeContext = {},
): ProviderRuntimeContext {
  return {
    runtimeId: init.runtimeId,
    runtimeKind: init.runtimeKind,
    metadata: init.metadata,
  };
}
