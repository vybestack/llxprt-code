/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IdeContext } from './ideContext.js';

export type ContextObserver = (context: IdeContext | undefined) => void;

/**
 * Per-client IDE context subscribers. Owners commit all internal state
 * (context, trust, trust-listener delivery, legacy global) before calling
 * `notify`, so an observer failure never leaves that state half-applied.
 */
export class ContextObservers {
  private readonly observers = new Set<ContextObserver>();

  add(observer: ContextObserver): void {
    this.observers.add(observer);
  }

  remove(observer: ContextObserver): void {
    this.observers.delete(observer);
  }

  /**
   * Invokes every observer even if an earlier one throws, then surfaces the
   * failures: the single error as-is, several as an AggregateError.
   */
  notify(context: IdeContext | undefined): void {
    const errors: unknown[] = [];
    for (const observer of this.observers) {
      try {
        observer(context);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, 'IDE context observers threw');
  }
}
