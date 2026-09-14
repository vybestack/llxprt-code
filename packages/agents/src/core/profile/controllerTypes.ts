/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agents-side types for the profile controller.
 *
 * The controller wires the pure core reduction tree to agents-owned ports: a
 * repository, a runtime factory, a scheduler boundary, a model catalog, and the
 * trust/session/role policy ceilings. `getPolicyIntent` and `listeners` are
 * optional extensions; `isApplicationOwnedKey` classifies which document keys
 * the controller may rewrite.
 */

import type {
  PolicyCeiling,
  ProfileCommand,
  ProfileDocument,
  ProfileEvent,
  ProfilePolicyIntent,
  ProfileRepositoryPort,
  ProfileRuntimeFactoryPort,
  ProviderModelCatalogPort,
  SchedulerBoundaryPort,
  TrustToolEnvironmentPort,
} from '@vybestack/llxprt-code-core';

/**
 * Everything the profile controller needs to reduce commands and build runtimes.
 */
export interface ProfileControllerDeps {
  agentId: string;
  repository: ProfileRepositoryPort;
  runtimeFactory: ProfileRuntimeFactoryPort;
  boundary: SchedulerBoundaryPort;
  catalog: ProviderModelCatalogPort;
  trust: TrustToolEnvironmentPort;
  session: PolicyCeiling;
  role?: PolicyCeiling;
  isApplicationOwnedKey: (key: string) => boolean;
  getPolicyIntent?: (document: ProfileDocument) => ProfilePolicyIntent;
  listeners?: ReadonlyArray<(event: ProfileEvent) => void>;
  /**
   * Bound, in milliseconds, for best-effort disposal of candidate bindings. Defaults
   * to {@link DEFAULT_DISPOSE_TIMEOUT_MS}; a hanging binding dispose is abandoned
   * after this bound instead of stalling the commit route.
   */
  disposeTimeoutMs?: number;
}

/**
 * Default bound for best-effort disposal, matching the ActiveProfileRuntime default.
 */
export const DEFAULT_DISPOSE_TIMEOUT_MS = 5000;

/**
 * Options for executing a command against the profile controller.
 */
export interface ControllerExecuteOptions {
  signal?: AbortSignal;
  queue?: boolean;
}

/**
 * A command held for later execution, with its own cancellation signal.
 */
export interface QueuedProfileCommand {
  command: ProfileCommand;
  signal?: AbortSignal;
}
