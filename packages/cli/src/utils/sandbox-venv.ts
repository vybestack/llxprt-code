/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sandbox-private Python venv destination planning (#3462).
 *
 * An in-workspace VIRTUAL_ENV is mounted by a per-run engine-owned volume
 * through the #3450 dependency plan (see sandbox-node-modules.ts), replacing
 * the old `<repo>/.llxprt/sandbox.venv` host backing directory that mixed
 * generated dependency state into the project's version-controlled LLxprt
 * configuration directory and was shared across worktrees.
 */

/** Marker kind for the extra dependency-plan destination. */
export const SANDBOX_VENV_DESTINATION_KIND = 'sandbox-venv' as const;

export interface SandboxVenvDestination {
  readonly kind: typeof SANDBOX_VENV_DESTINATION_KIND;
  /** Host path of the venv; mounted at the same path inside the container. */
  readonly destination: string;
}

/**
 * Resolves the in-workspace VIRTUAL_ENV into an additional protected
 * destination for the private dependency plan. The legacy gate is preserved:
 * the venv is only sandbox-private when it is set, non-empty, and lies under
 * the workspace (case-insensitive prefix match). Returns undefined otherwise,
 * leaving the launch exactly as it was without a venv.
 */
export function planSandboxVenvDestination(
  workdir: string,
): SandboxVenvDestination | undefined {
  const virtualEnv = process.env.VIRTUAL_ENV;
  if (
    virtualEnv === undefined ||
    virtualEnv.length === 0 ||
    !virtualEnv.toLowerCase().startsWith(workdir.toLowerCase())
  ) {
    return undefined;
  }
  return {
    kind: SANDBOX_VENV_DESTINATION_KIND,
    destination: virtualEnv,
  };
}
