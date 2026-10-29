/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Thrown by the `recalculate` step of a tail removal when an observer of the
 * recalculation failed: the store then takes the removal back and reports
 * `failure` as the cause.
 */
export class RemovalObserverFailure extends Error {
  constructor(readonly failure: unknown) {
    super('History removal observer failed', { cause: failure });
  }
}
