/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow capability interfaces for genuinely-optional host accessors.
 *
 * `IToolHost` defines the required surface, but some concrete hosts expose
 * additional accessors (legacy workspace context, IDE/LSP bridges) that
 * tools detect at runtime. These interfaces capture only those optional
 * members so callers can use type guards instead of `as unknown as` casts.
 *
 * Consumed by: apply-patch.ts, edit-utils.ts, ast-edit.ts,
 * ast-edit-invocation.ts.
 */

import type { IToolHost } from './IToolHost.js';
import type { LspConfig } from './ILspService.js';

/**
 * Optional workspace-context capability.
 *
 * Some hosts expose a richer `getWorkspaceContext` accessor (returning
 * a directory list). `getWorkspaceRoots` and `getTargetDir` are already
 * required on `IToolHost`, so only `getWorkspaceContext` is genuinely
 * optional here.
 */
export interface HostWorkspaceContextCap {
  getWorkspaceContext(): { getDirectories?(): string[] };
}

/**
 * Optional IDE integration capability.
 *
 * Hosts backed by a live IDE expose `getIdeMode` / `getIdeClient` so
 * tools can build an `IIdeService` adapter for diff/apply flows.
 */
export interface HostIdeCap {
  getIdeMode(): boolean;
  getIdeClient(): unknown;
}

/**
 * Optional LSP integration capability.
 *
 * Hosts with a running LSP expose `getLspServiceClient` (required for
 * building a useful diagnostics adapter) and optionally `getLspConfig`.
 */
export interface HostLspCap {
  getLspServiceClient(): unknown;
  getLspConfig?(): LspConfig | undefined;
}

/**
 * Type guard: does the host expose the optional workspace-context capability?
 */
export function hasWorkspaceContextCap(
  host: IToolHost,
): host is IToolHost & HostWorkspaceContextCap {
  return (
    typeof (host as Partial<HostWorkspaceContextCap>).getWorkspaceContext ===
    'function'
  );
}

/**
 * Type guard: does the host expose the optional IDE capability?
 */
export function hasIdeCap(host: IToolHost): host is IToolHost & HostIdeCap {
  return (
    typeof (host as Partial<HostIdeCap>).getIdeMode === 'function' &&
    typeof (host as Partial<HostIdeCap>).getIdeClient === 'function'
  );
}

/**
 * Type guard: does the host expose the optional LSP capability?
 *
 * Requires `getLspServiceClient`; `getLspConfig` remains optional.
 */
export function hasLspCap(host: IToolHost): host is IToolHost & HostLspCap {
  return (
    typeof (host as Partial<HostLspCap>).getLspServiceClient === 'function'
  );
}
