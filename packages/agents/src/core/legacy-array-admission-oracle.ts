/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

/**
 * Test oracle for the pre-WP03 array-owning media admission route. Production
 * no longer retains admitted arrays; parity tests compare the migrated
 * disk-backed route against this transcript-array reference behavior.
 */
export interface LegacyArrayAdmission {
  readonly history: readonly IContent[];
  readonly release: () => Promise<void>;
}

export class LegacyArrayAdmissions {
  private retained: readonly LegacyArrayAdmission[] = [];
  private sequence = 0;

  constructor(private readonly getStore: () => LocalMediaStore) {}

  async admitRetainedHistory(
    history: readonly IContent[],
    source: string,
  ): Promise<LegacyArrayAdmission | undefined> {
    const hasMedia = history.some((content) =>
      content.blocks.some(
        (block) =>
          block.type === 'media' &&
          (block.encoding === 'base64' || block.encoding === 'reference'),
      ),
    );
    if (!hasMedia) return undefined;
    this.sequence += 1;
    const scope = `${source}:${this.sequence}`;
    const context = {
      turnId: scope,
      source: scope,
      reservationOwnerScope: `retained-history:${scope}`,
    };
    const admission = new MediaAdmissionService(this.getStore());
    const admitted = await admission.admitContents(history, context);
    const entry: LegacyArrayAdmission = {
      history: admitted,
      release: () => admission.releaseContents(admitted, context),
    };
    this.retained = [...this.retained, entry];
    return entry;
  }

  async replaceRetainedHistory(
    history: readonly IContent[],
    prior: LegacyArrayAdmission | undefined,
    source: string,
  ): Promise<LegacyArrayAdmission | undefined> {
    const retained = await this.admitRetainedHistory(history, source);
    const failures = await this.release(prior === undefined ? [] : [prior]);
    if (failures.length === 0) return retained;
    const replacementError = new AggregateError(
      failures,
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
    admissions: readonly LegacyArrayAdmission[],
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
    admissions: readonly LegacyArrayAdmission[],
    message: string,
  ): Promise<never> {
    const cleanupFailures = await this.release(admissions);
    if (cleanupFailures.length > 0) {
      throw new AggregateError([primaryError, ...cleanupFailures], message);
    }
    throw primaryError;
  }
}
