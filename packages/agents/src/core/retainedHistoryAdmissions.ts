/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  prepareDeferredArrayAdmission,
  type DeferredArrayAdmission,
} from './deferredArrayAdmission.js';

interface DeferredRetainedArrayAdmission extends DeferredArrayAdmission {
  readonly retained: RetainedHistoryAdmission;
}

export function replaceDeferredArray(
  admissions: RetainedHistoryAdmissions,
  history: readonly IContent[],
  prior: RetainedHistoryAdmission | undefined,
  stored: HistoryService | undefined,
  options: DeferredHistorySourceOptions = {},
): Promise<{ journal: HistoryService; retained: RetainedHistoryAdmission }> {
  return publishDeferredArray(
    admissions,
    admissions.prepareDeferredArray(history, options),
    prior,
    stored,
    options,
  );
}

async function publishDeferredArray(
  admissions: RetainedHistoryAdmissions,
  admitted: DeferredRetainedArrayAdmission,
  prior: RetainedHistoryAdmission | undefined,
  stored: HistoryService | undefined,
  options: DeferredHistorySourceOptions,
): Promise<{ journal: HistoryService; retained: RetainedHistoryAdmission }> {
  const journal =
    stored ??
    new HistoryService({
      mutationOwnership: options.ownership,
      attachmentCounters: options.counters,
    });
  try {
    if (admitted.rows === undefined)
      throw new Error('Deferred array already submitted');
    const operation = journal.detachedValues.replace(admitted.rows, undefined, {
      signal: options.signal,
      publishTokens: true,
    });
    admitted.rows = undefined;
    await operation;
    await releaseDeferredArray(
      admissions,
      prior,
      'Prior deferred history cleanup failed',
    );
    return { journal, retained: admitted.retained };
  } catch (error) {
    if (journal !== stored) journal.dispose();
    try {
      await admitted.release();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Deferred array admission cleanup failed',
      );
    }
    throw error;
  } finally {
    admitted.discardInput();
  }
}

/** Ownership handle only: media reservations live in the disk index behind `release`. */
export interface RetainedHistoryAdmission {
  readonly release: () => Promise<void>;
}

export class RetainedHistoryAdmissions {
  private retained: readonly RetainedHistoryAdmission[] = [];
  private sequence = 0;

  constructor(private readonly getStore: () => LocalMediaStore) {}

  get all(): readonly RetainedHistoryAdmission[] {
    return this.retained;
  }

  prepareDeferredArray(
    history: readonly IContent[],
    options: DeferredHistorySourceOptions,
  ): DeferredRetainedArrayAdmission {
    this.sequence += 1;
    return this.retainDeferredArray(
      prepareDeferredArrayAdmission(
        history,
        this.getStore(),
        `agent-client-history:${this.sequence}`,
        options,
      ),
    );
  }

  private retainDeferredArray(
    admitted: DeferredArrayAdmission,
  ): DeferredRetainedArrayAdmission {
    const retained = this.register({ release: admitted.release });
    const rows = admitted.rows;
    admitted.rows = undefined;
    return {
      rows,
      retained,
      discardInput: admitted.discardInput,
      release: async (): Promise<void> => {
        const failures = await this.release([retained]);
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            'Deferred array media release failed',
          );
      },
    };
  }

  async release(
    admissions: readonly RetainedHistoryAdmission[],
  ): Promise<readonly unknown[]> {
    const failures: unknown[] = [];
    for (const admission of admissions) {
      if (!this.retained.includes(admission)) continue;
      try {
        await admission.release();
        this.retained = this.retained.filter(
          (candidate) => candidate !== admission,
        );
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    return failures;
  }

  async releaseAfterFailure(
    primaryError: unknown,
    admissions: readonly RetainedHistoryAdmission[],
    message: string,
    cleanup?: () => Promise<void>,
  ): Promise<never> {
    const cleanupFailures: unknown[] = [];
    if (cleanup !== undefined) {
      try {
        await cleanup();
      } catch (error: unknown) {
        cleanupFailures.push(error);
      }
    }
    cleanupFailures.push(...(await this.release(admissions)));
    if (cleanupFailures.length > 0) {
      throw new AggregateError([primaryError, ...cleanupFailures], message);
    }
    throw primaryError;
  }

  private register(
    admission: RetainedHistoryAdmission,
  ): RetainedHistoryAdmission {
    this.retained = [...this.retained, admission];
    return admission;
  }
}

export async function releaseDeferredArray(
  admissions: RetainedHistoryAdmissions,
  prior: RetainedHistoryAdmission | undefined,
  message: string,
): Promise<void> {
  const failures = await admissions.release(prior ? [prior] : []);
  if (failures.length > 0) throw new AggregateError(failures, message);
}
