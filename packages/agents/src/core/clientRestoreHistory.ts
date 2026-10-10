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
  rows: AsyncIterable<IContent> | undefined;
  readonly retained: RetainedHistoryAdmission;
  readonly count: number;
  discardInput(): void;
}

export function restoreClientHistory(
  host: RestoreHistoryHost,
  rows: readonly IContent[],
): Promise<void> {
  const admitted = host.admissions.prepareDeferredArray(rows, {});
  return publishRestoredHistory(host, {
    rows: admitted.rows,
    retained: admitted.retained,
    count: rows.length,
    discardInput: admitted.discardInput,
  });
}

async function releaseRestoredAdmission(
  host: RestoreHistoryHost,
  submission: RestoreSubmission,
): Promise<void> {
  const failures = await host.admissions.release([submission.retained]);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Restored history publication cleanup failed',
    );
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
      if (submission.rows === undefined)
        throw new Error('Restored history rows already submitted');
      const operation = history.detachedValues.replace(
        submission.rows,
        undefined,
        {
          publishBatch: true,
          afterPublication: () => releaseRestoredAdmission(host, submission),
        },
      );
      submission.rows = undefined;
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
      [submission.retained],
      'History restoration failed and admitted media cleanup was incomplete',
    );
  } finally {
    submission.discardInput();
  }
}
