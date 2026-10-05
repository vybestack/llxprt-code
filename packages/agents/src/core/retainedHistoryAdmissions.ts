/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

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

export interface RetainedHistoryAdmission {
  readonly detached?: true;
  readonly history: readonly IContent[];
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
    const retained = this.register({
      detached: true,
      history: [],
      release: admitted.release,
    });
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

  async admitRetainedHistory(
    history: readonly IContent[],
    source: string,
  ): Promise<RetainedHistoryAdmission | undefined> {
    if (!hasLocalMedia(history)) return undefined;
    this.sequence += 1;
    const admissionScope = `${source}:${this.sequence}`;
    const context = {
      turnId: admissionScope,
      source: admissionScope,
      reservationOwnerScope: `retained-history:${admissionScope}`,
    };
    const admission = new MediaAdmissionService(this.getStore());
    const admitted = await admission.admitContents(history, context);
    return this.register({
      history: admitted,
      release: () => admission.releaseContents(admitted, context),
    });
  }

  async replaceRetainedHistory(
    history: readonly IContent[],
    prior: RetainedHistoryAdmission | undefined,
    source: string,
  ): Promise<RetainedHistoryAdmission | undefined> {
    const retained = await this.admitRetainedHistory(history, source);
    const replacementFailures = await this.release(
      prior === undefined ? [] : [prior],
    );
    if (replacementFailures.length === 0) return retained;
    const replacementError = new AggregateError(
      replacementFailures,
      'Deferred history replacement cleanup failed',
    );
    if (retained !== undefined) {
      await this.releaseAfterFailure(
        replacementError,
        [retained],
        'Deferred history replacement and admitted media cleanup failed',
      );
    }
    throw replacementError;
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

function hasLocalMedia(history: readonly IContent[]): boolean {
  return history.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'media' &&
        (block.encoding === 'base64' || block.encoding === 'reference'),
    ),
  );
}
