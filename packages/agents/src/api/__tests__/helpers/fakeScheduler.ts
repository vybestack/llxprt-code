/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P13
 * @requirement:REQ-006
 * @requirement:REQ-016
 *
 * Fake scheduler factory (infra fake — NOT the Agent under test). Lives under
 * __tests__/helpers/ so it is excluded from the T17 boundary scan. The public
 * {@link AgentSchedulerFactory} / {@link AgentSchedulerHandle} types are
 * exported from the package root (config-types.ts → api/index.ts → index.ts),
 * so this helper imports them from `@vybestack/llxprt-code-agents` (allowed:
 * the public root is always importable; this file is a helper, not a spec).
 *
 * Two variants:
 * - {@link createRecordingSchedulerFactory}: every created handle tracks a real
 *   `disposed` boolean flipped to true on `dispose()`. Used by the T19 spec to
 *   assert the factory-created instance is USED for tool scheduling and TORN
 *   DOWN on dispose, while the caller-owned factory function itself is never
 *   disposed.
 * - {@link createFailingSchedulerFactory}: each created handle's `dispose()`
 *   REJECTS. Used by the T13 AggregateDisposeError spec to INDUCE a partial
 *   teardown failure so `agent.dispose()` surfaces an AggregateDisposeError
 *   (dispose.md line 101) carrying the induced failure in its `errors` array.
 *
 * At RED the created handles are never reached (dispose() throws NYI first),
 * so their `disposed` flags stay false and the specs fail naturally. At GREEN
 * the real dispose() flips them and the assertions pass.
 */

import type {
  AgentSchedulerFactory,
  AgentSchedulerFactoryOptions,
  AgentSchedulerHandle,
} from '@vybestack/llxprt-code-agents';

/**
 * A recording scheduler handle. The Agent creates these via the injected
 * factory and disposes them via `AgentSchedulerHandle.dispose()`. The handle
 * owns a real, observable `disposed` boolean.
 */
export interface RecordingSchedulerHandle extends AgentSchedulerHandle {
  /** True after `dispose()` has resolved. Observable post-dispose flag. */
  readonly disposed: boolean;
  /** The options the factory was invoked with. */
  readonly options: AgentSchedulerFactoryOptions;
}

/**
 * Result of {@link createRecordingSchedulerFactory}. The `factory` is passed to
 * `AgentConfig.toolSchedulerFactory`; `createdHandles` lets the spec assert on
 * the real created instances (count, disposed flag) — behavioral, never
 * `toHaveBeenCalled`.
 */
export interface RecordingSchedulerFactory {
  /** The AgentSchedulerFactory to inject via AgentConfig.toolSchedulerFactory. */
  readonly factory: AgentSchedulerFactory;
  /** Every handle created by `factory`, in creation order. */
  readonly createdHandles: readonly RecordingSchedulerHandle[];
}

/**
 * Builds a recording scheduler factory whose handles record a real `disposed`
 * flag. The factory function itself is caller-owned and has no dispose method —
 * the spec asserts the FACTORY is not disposed (it remains callable / the handle
 * count equals the instances created).
 */
export function createRecordingSchedulerFactory(): RecordingSchedulerFactory {
  const createdHandles: RecordingSchedulerHandle[] = [];
  const factory: AgentSchedulerFactory = (options) => {
    const handle = new RecordingHandleImpl(options);
    createdHandles.push(handle);
    return handle;
  };
  return { factory, createdHandles };
}

/**
 * A failing scheduler handle whose `dispose()` REJECTS, used to INDUCE a partial
 * teardown failure so `agent.dispose()` surfaces an AggregateDisposeError.
 */
export interface FailingSchedulerHandle extends AgentSchedulerHandle {
  /** The options the factory was invoked with. */
  readonly options: AgentSchedulerFactoryOptions;
}

/**
 * Result of {@link createFailingSchedulerFactory}. Each created handle's
 * `dispose()` rejects with a distinctive error the spec can identify in the
 * aggregate's `errors` array.
 */
export interface FailingSchedulerFactory {
  /** The AgentSchedulerFactory to inject via AgentConfig.toolSchedulerFactory. */
  readonly factory: AgentSchedulerFactory;
  /** Every handle created by `factory`, in creation order. */
  readonly createdHandles: readonly FailingSchedulerHandle[];
  /** The error message each handle's dispose() rejects with. */
  readonly inducedFailureMessage: string;
}

/**
 * Builds a failing scheduler factory whose handles' `dispose()` rejects. The
 * induced failure is identifiable by `inducedFailureMessage` so the spec can
 * assert it appears in the AggregateDisposeError's `errors` array.
 */
export function createFailingSchedulerFactory(
  message = 'induced scheduler dispose failure',
): FailingSchedulerFactory {
  const createdHandles: FailingSchedulerHandle[] = [];
  const factory: AgentSchedulerFactory = (options) => {
    const handle = new FailingHandleImpl(options, message);
    createdHandles.push(handle);
    return handle;
  };
  return { factory, createdHandles, inducedFailureMessage: message };
}

// ─── Implementations ────────────────────────────────────────────────────────

class RecordingHandleImpl implements RecordingSchedulerHandle {
  private _disposed = false;
  readonly options: AgentSchedulerFactoryOptions;

  constructor(options: AgentSchedulerFactoryOptions) {
    this.options = options;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  async dispose(): Promise<void> {
    this._disposed = true;
  }
}

class FailingHandleImpl implements FailingSchedulerHandle {
  readonly options: AgentSchedulerFactoryOptions;
  private readonly failMessage: string;

  constructor(options: AgentSchedulerFactoryOptions, failMessage: string) {
    this.options = options;
    this.failMessage = failMessage;
  }

  async dispose(): Promise<void> {
    throw new Error(this.failMessage);
  }
}
