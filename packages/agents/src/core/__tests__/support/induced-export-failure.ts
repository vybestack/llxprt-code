/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * RootTelemetry reports every export failure on flush and shutdown. Fixtures
 * that inject exporter faults on purpose accept exactly those failures when
 * they shut the root down; any other failure, and any failure from a run that
 * injected none, still propagates.
 */
export async function settleInducedExportFailure(
  injected: boolean,
  operation: () => Promise<void>,
  isInduced: (failure: unknown) => boolean = isInducedEisdir,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    const failures = error instanceof AggregateError ? error.errors : [error];
    if (!injected || !failures.every(isInduced)) throw error;
  }
}

function isInducedEisdir(failure: unknown): boolean {
  return (
    failure instanceof Error && 'code' in failure && failure.code === 'EISDIR'
  );
}
