/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

export interface RetainedHistoryAdmission {
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

  async transferActiveHistory(
    history: readonly IContent[],
    releaseActiveHistory: () => Promise<void>,
  ): Promise<RetainedHistoryAdmission | undefined> {
    const priorAdmissions = this.retained;
    const retained = await this.admitRetainedHistory(
      history,
      'agent-client-reinitialize',
    );
    if (retained === undefined) return undefined;
    try {
      await releaseActiveHistory();
    } catch (error: unknown) {
      await this.releaseAfterFailure(
        error,
        [retained],
        'Client reinitialization failed and deferred media cleanup was incomplete',
      );
    }
    const releaseFailures = await this.release(priorAdmissions);
    if (releaseFailures.length > 0) {
      throw new AggregateError(
        releaseFailures,
        'Client reinitialization ownership transfer was incomplete',
      );
    }
    return retained;
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

function hasLocalMedia(history: readonly IContent[]): boolean {
  return history.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'media' &&
        (block.encoding === 'base64' || block.encoding === 'reference'),
    ),
  );
}
