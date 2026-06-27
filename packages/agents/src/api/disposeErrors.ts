/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class AggregateDisposeError extends Error {
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    super(AggregateDisposeError.buildMessage(errors));
    this.name = 'AggregateDisposeError';
    this.errors = errors;
    Object.setPrototypeOf(this, AggregateDisposeError.prototype);
  }

  private static buildMessage(errors: readonly unknown[]): string {
    if (errors.length === 0) {
      return 'Agent dispose completed with no errors.';
    }
    const details = errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join('; ');
    return `Agent dispose failed with ${errors.length} error(s): ${details}`;
  }
}
