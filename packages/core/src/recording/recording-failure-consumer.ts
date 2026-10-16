/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  RecordingFailureReport,
  type RecordingFailureDetail,
} from './recording-failure-report.js';

export type RecordingFailureSink = (
  detail: RecordingFailureDetail,
) => Promise<void>;
async function writeDetail(detail: RecordingFailureDetail): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stderr.write(`${JSON.stringify(detail)}\n`, (error) => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}
async function drain(
  error: unknown,
  sink: RecordingFailureSink,
): Promise<void> {
  let firstFailure: { error: unknown } | undefined;
  if (error instanceof RecordingFailureReport) {
    for await (const detail of error.details()) {
      try {
        await sink(detail);
      } catch (sinkError: unknown) {
        firstFailure ??= { error: sinkError };
      }
    }
  } else if (error instanceof AggregateError) {
    for (const failure of error.errors) {
      try {
        await drain(failure, sink);
      } catch (reportError: unknown) {
        firstFailure ??= { error: reportError };
      }
    }
  }
  if (firstFailure !== undefined) throw firstFailure.error;
}
export async function withRecordingFailureReport(
  operation: Promise<void> | undefined,
  sink: RecordingFailureSink = writeDetail,
): Promise<void> {
  try {
    await operation;
  } catch (error: unknown) {
    try {
      await drain(error, sink);
    } catch (reportingError: unknown) {
      throw new AggregateError(
        [error, reportingError],
        'Recording failure diagnostic consumption failed',
      );
    }
    throw error;
  }
}
