/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type CleanupTask = () => void | Promise<void>;

export async function runCleanupTaskGroups(
  groups: readonly (readonly CleanupTask[])[],
  aggregateMessage: string,
): Promise<void> {
  let errors: unknown[] = [];
  for (const group of groups) {
    const results = await Promise.allSettled(group.map(async (task) => task()));
    errors = [
      ...errors,
      ...results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      ),
    ];
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, aggregateMessage);
  }
}
