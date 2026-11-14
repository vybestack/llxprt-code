/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class HistorySourceError extends Error {
  constructor(readonly failure: unknown) {
    super('Failed to prepare request history', { cause: failure });
  }
}

export function historySourceFailure(
  error: unknown,
): { readonly error: unknown } | undefined {
  if (error instanceof HistorySourceError) return { error: error.failure };
  if (!(error instanceof AggregateError)) return undefined;
  const causes = error.errors.map((cause: unknown) => ({
    cause,
    source: historySourceFailure(cause),
  }));
  if (!causes.some(({ source }) => source !== undefined)) return undefined;
  return {
    error: new AggregateError(
      causes.map(({ cause, source }) =>
        source === undefined ? cause : source.error,
      ),
      error.message,
      { cause: error.cause },
    ),
  };
}
