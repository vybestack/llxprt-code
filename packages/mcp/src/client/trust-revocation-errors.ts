/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function appendFailures(
  target: unknown[],
  error: unknown,
  visited = new Set<AggregateError>(),
): void {
  if (error instanceof AggregateError) {
    if (visited.has(error)) {
      return;
    }
    visited.add(error);
    for (const nestedError of error.errors) {
      appendFailures(target, nestedError, visited);
    }
    return;
  }
  target.push(error);
}

export function throwTrustRevocationFailures(
  failures: readonly unknown[],
  message: string,
): void {
  if (failures.length > 0) {
    throw new AggregateError(failures, message);
  }
}
