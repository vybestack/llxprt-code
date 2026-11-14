/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export function publishResumeRestoration(
  notifications: ReadonlyArray<() => void>,
): void {
  const failures: unknown[] = [];
  for (const notify of notifications) {
    try {
      notify();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Resume restoration observers failed');
}
