/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  RetainedHistoryAdmission,
  RetainedHistoryAdmissions,
} from './retainedHistoryAdmissions.js';

interface RestoreHistoryHost {
  readonly admissions: RetainedHistoryAdmissions;
  readonly logger: DebugLogger;
  initialize(): Promise<void>;
  getHistory(): HistoryService | null;
}
interface RestoreSubmission {
  rows: readonly IContent[];
  retained: RetainedHistoryAdmission | undefined;
  readonly count: number;
}

export function restoreClientHistory(
  host: RestoreHistoryHost,
  rows: readonly IContent[],
): Promise<void> {
  return host.admissions
    .admitRetainedHistory(rows, 'restore-history')
    .then((retained) =>
      publishRestoredHistory(host, {
        rows: retained?.history ?? rows,
        retained,
        count: rows.length,
      }),
    );
}

async function releaseRestoredAdmission(
  host: RestoreHistoryHost,
  submission: RestoreSubmission,
): Promise<void> {
  const failures = await host.admissions.release(
    submission.retained === undefined ? [] : [submission.retained],
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Restored history publication cleanup failed',
    );
  submission.retained = undefined;
}

async function publishRestoredHistory(
  host: RestoreHistoryHost,
  submission: RestoreSubmission,
): Promise<void> {
  try {
    await host.initialize();
    const history = host.getHistory();
    if (history === null)
      throw new Error(
        'Cannot restore history: History service unavailable after chat initialization',
      );
    try {
      history.validateAndFix();
      const operation = history.detachedValues.replace(
        submission.rows,
        undefined,
        {
          publishBatch: true,
          afterPublication: () => releaseRestoredAdmission(host, submission),
        },
      );
      submission.rows = [];
      await operation;
      history.resetCacheAnchorSeq();
      host.logger.debug('History restored successfully', {
        itemCount: submission.count,
        totalTokens: history.getTotalTokens(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to add history items to service: ${message}`);
    }
  } catch (error: unknown) {
    await host.admissions.releaseAfterFailure(
      error,
      submission.retained === undefined ? [] : [submission.retained],
      'History restoration failed and admitted media cleanup was incomplete',
    );
  }
}
