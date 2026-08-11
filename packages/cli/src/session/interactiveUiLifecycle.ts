/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Production lifecycle helpers for the interactive UI instance and perf owner.
 *
 * Centralizes the clear/unmount/dispose teardown and the render/setup-failure
 * rollback so {@link interactiveUI.tsx} and its behavior tests exercise ONE
 * shared routine rather than mirrored copies. Every cleanup step runs
 * independently — a throw in one step NEVER prevents a later step from running.
 * Internal errors are collected and surfaced (never swallowed); when a primary
 * failure exists it is preserved first and every cleanup error aggregated
 * after it.
 */

/**
 * Structural capability for a rendered Ink instance. Ink's `render()` return
 * value satisfies this structurally (`{ clear, unmount }`).
 */
export interface InteractiveInstanceCapability {
  clear(): void;
  unmount(): void;
}

/**
 * Structural capability for the interactive perf owner. The
 * `InteractivePerfRuntime` satisfies this structurally (`{ dispose }`).
 */
export interface InteractiveOwnerCapability {
  dispose(): Promise<void>;
}

/**
 * Shared instance + owner teardown used by both public cleanup functions.
 * Runs `instance.clear()`, `instance.unmount()`, and `owner.dispose()` in
 * order, each independently of the others — a throw in one step NEVER prevents
 * a later step from running. Every error is pushed into `errors` (never
 * swallowed) so the caller can aggregate them identically.
 */
async function teardownInstanceAndOwner(
  instance: InteractiveInstanceCapability | undefined,
  owner: InteractiveOwnerCapability | null,
  errors: unknown[],
): Promise<void> {
  if (instance !== undefined) {
    try {
      instance.clear();
    } catch (err) {
      errors.push(err);
    }
    try {
      instance.unmount();
    } catch (err) {
      errors.push(err);
    }
  }
  if (owner !== null) {
    try {
      await owner.dispose();
    } catch (err) {
      errors.push(err);
    }
  }
}

/**
 * Runs `instance.clear()`, `instance.unmount()`, and `owner.dispose()` in
 * order, each independently of the others. A throw in one step NEVER prevents
 * a later step from running. Collects every error and throws a single `Error`
 * (one error) or `AggregateError` (many); resolves cleanly when none throw.
 *
 * Shared by the pre-start previous-instance/owner replacement and the
 * registered global cleanup so both paths behave identically.
 */
export async function cleanupInstanceAndOwner(
  instance: InteractiveInstanceCapability | undefined,
  owner: InteractiveOwnerCapability | null,
): Promise<void> {
  const errors: unknown[] = [];
  await teardownInstanceAndOwner(instance, owner, errors);
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'interactive instance/owner cleanup failed',
    );
  }
}

/**
 * Mouse-events teardown capability for the rollback path. Holds the RAW
 * disable function (not the swallowing exit handler) so failures surface
 * rather than being silently swallowed, plus the listener-removal callback.
 */
export interface InteractiveMouseTeardown {
  readonly disable: () => void;
  readonly removeListener: () => void;
}

/**
 * Terminal protocol restore capability for the rollback path. Holds the
 * restore function plus the listener-removal callback.
 */
export interface InteractiveTerminalRestore {
  readonly restore: () => void;
  readonly removeListener: () => void;
}

/**
 * Capabilities the rollback helper tears down. `instance` is the rendered Ink
 * instance (present on setup failure; `undefined` on render failure where no
 * instance was produced). `mouse` is `null` when mouse events were not
 * enabled. `owner` is `null` when perf is disabled.
 */
export interface InteractiveRollbackCapabilities {
  readonly instance: InteractiveInstanceCapability | undefined;
  readonly owner: InteractiveOwnerCapability | null;
  readonly mouse: InteractiveMouseTeardown | null;
  readonly restore: InteractiveTerminalRestore;
}

/**
 * Interactive-failure rollback used by BOTH the render-failure path and the
 * post-render setup-failure transactional catch. Attempts, each independently:
 * instance.clear + instance.unmount (when an instance exists), owner.dispose,
 * mouse disable + mouse listener removal (when enabled), and terminal restore
 * + restore listener removal. The `primaryError` is always preserved first;
 * every cleanup error is aggregated after it via `AggregateError` (or the
 * primary error is thrown alone when no cleanup step failed). Never swallows
 * internal errors.
 */
export async function rollbackInteractiveFailure(
  primaryError: unknown,
  capabilities: InteractiveRollbackCapabilities,
): Promise<never> {
  const errors: unknown[] = [];
  await teardownInstanceAndOwner(
    capabilities.instance,
    capabilities.owner,
    errors,
  );
  if (capabilities.mouse !== null) {
    try {
      capabilities.mouse.disable();
    } catch (err) {
      errors.push(err);
    }
    try {
      capabilities.mouse.removeListener();
    } catch (err) {
      errors.push(err);
    }
  }
  try {
    capabilities.restore.restore();
  } catch (err) {
    errors.push(err);
  }
  try {
    capabilities.restore.removeListener();
  } catch (err) {
    errors.push(err);
  }
  if (errors.length === 0) {
    throw primaryError;
  }
  throw new AggregateError(
    [primaryError, ...errors],
    'interactive failure and one or more cleanup steps also failed',
  );
}
