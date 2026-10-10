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
import type { Diagnostic, LspConfig } from './ILspService.js';

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
 * Hosts expose a bound diagnostic operation and optional declarative filtering settings.
 */
export interface HostLspCap {
  checkFileDiagnostics(
    filePath: string,
    timeout: number,
  ): Promise<Diagnostic[]>;
  getLspConfig?(): LspConfig | undefined;
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
 * Requires `checkFileDiagnostics`; `getLspConfig` remains optional.
 */
export function hasLspCap(host: IToolHost): host is IToolHost & HostLspCap {
  return (
    'checkFileDiagnostics' in host &&
    typeof host.checkFileDiagnostics === 'function'
  );
}
