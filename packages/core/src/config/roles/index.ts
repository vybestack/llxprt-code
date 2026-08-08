/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role interfaces for the Config god-object decomposition (issue #2615, P05).
 *
 * Each interface is a narrow capability contract that the concrete
 * {@link Config} class satisfies structurally. Consumers depend on the role,
 * not on the Config type, so the service-locator members never leak through.
 *
 * Member signatures are transcribed verbatim from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json`.
 *
 * @see project-plans/issue2615/specification.md (REQ-002, REQ-004)
 */

export type { SessionIdentity } from './sessionIdentity.js';
export type { ModelSelection } from './modelSelection.js';
export type { EphemeralSettings } from './ephemeralSettings.js';
export type { WorkspacePaths } from './workspacePaths.js';
export type { MemoryAccess } from './memoryAccess.js';
export type { ToolAccess } from './toolAccess.js';
export type { PolicyAccess } from './policyAccess.js';
export type { McpAccess } from './mcpAccess.js';
export type { TelemetryAccess } from './telemetryAccess.js';
export type { Diagnostics } from './diagnostics.js';
export type { RuntimeLifecycle } from './runtimeLifecycle.js';

export type { RuntimeDependencies } from '../runtimeDependencies.js';
export { runtimeDependenciesFromConfig } from '../runtimeDependencies.js';
export { isRuntimeDependencies } from '../runtimeDependencies.js';

export type { RuntimeMutations } from '../runtimeMutations.js';
export { runtimeMutationsFromConfig } from '../runtimeMutations.js';
