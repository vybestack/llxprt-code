/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compile-time assertion that the concrete {@link Config} satisfies every role
 * interface. If a role member is removed from Config or its signature drifts,
 * the constraint below fails and the build breaks here — in core — rather than
 * surfacing as a confusing error in a downstream consumer package.
 *
 * This file contains only type-level constructs; it emits no runtime code.
 */

import type { Config } from '../config.js';
import type { SessionIdentity } from './sessionIdentity.js';
import type { ModelSelection } from './modelSelection.js';
import type { EphemeralSettings } from './ephemeralSettings.js';
import type { WorkspacePaths } from './workspacePaths.js';
import type { MemoryAccess } from './memoryAccess.js';
import type { ToolAccess } from './toolAccess.js';
import type { PolicyAccess } from './policyAccess.js';
import type { McpAccess } from './mcpAccess.js';
import type { TelemetryAccess } from './telemetryAccess.js';
import type { Diagnostics } from './diagnostics.js';

/** Constrains Impl to extend Role; errors at the call site if it does not. */
type SatisfiesConstraint<Role, Impl extends Role> = Impl;

type _AssertSessionIdentity = SatisfiesConstraint<SessionIdentity, Config>;
type _AssertModelSelection = SatisfiesConstraint<ModelSelection, Config>;
type _AssertEphemeralSettings = SatisfiesConstraint<EphemeralSettings, Config>;
type _AssertWorkspacePaths = SatisfiesConstraint<WorkspacePaths, Config>;
type _AssertMemoryAccess = SatisfiesConstraint<MemoryAccess, Config>;
type _AssertToolAccess = SatisfiesConstraint<ToolAccess, Config>;
type _AssertPolicyAccess = SatisfiesConstraint<PolicyAccess, Config>;
type _AssertMcpAccess = SatisfiesConstraint<McpAccess, Config>;
type _AssertTelemetryAccess = SatisfiesConstraint<TelemetryAccess, Config>;
type _AssertDiagnostics = SatisfiesConstraint<Diagnostics, Config>;

/**
 * Single exported alias that references every per-role assertion so none are
 * flagged as unused. Each `SatisfiesConstraint` line above is still evaluated
 * independently, so a drift error points to the specific role.
 */
export type ConfigSatisfiesAllRoles = [
  _AssertSessionIdentity,
  _AssertModelSelection,
  _AssertEphemeralSettings,
  _AssertWorkspacePaths,
  _AssertMemoryAccess,
  _AssertToolAccess,
  _AssertPolicyAccess,
  _AssertMcpAccess,
  _AssertTelemetryAccess,
  _AssertDiagnostics,
];
