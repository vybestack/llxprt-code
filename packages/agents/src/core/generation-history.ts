/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import {
  admitSessionHistory,
  hasLocalMedia,
} from './sessionHistoryAdmission.js';
import type { AgentHistoryAdmission } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export async function appendGenerationHistory(
  history: HistoryService,
  admit: (
    contents: readonly IContent[],
  ) => Promise<AgentHistoryAdmission | undefined>,
  release: (
    admissions: readonly AgentHistoryAdmission[],
  ) => Promise<readonly unknown[]>,
  input: readonly IContent[],
  response: ModelOutput,
  model: string,
  signal: AbortSignal,
  historyOrigin?: object,
): Promise<void> {
  signal.throwIfAborted();
  const entries = [
    ...input,
    {
      ...response.content,
      metadata: {
        ...response.content.metadata,
        model,
        ...(response.usage === undefined ? {} : { usage: response.usage }),
      },
    },
  ];
  const ownership = await admit(entries);
  try {
    signal.throwIfAborted();
    await history.detachedValues.append(ownership?.rows ?? entries, model, {
      origin: historyOrigin,
      afterPublication: () => signal.throwIfAborted(),
    });
  } catch (error) {
    const failures = ownership === undefined ? [] : await release([ownership]);
    if (failures.length > 0)
      throw new AggregateError(
        [error, ...failures],
        'Generation history cleanup failed',
      );
    throw error;
  }
}

export class ChatHistoryAdmissions {
  all: readonly AgentHistoryAdmission[] = [];
  private sequence = 0;

  async admit(
    history: readonly IContent[],
    media: MediaAdmissionService | undefined,
  ): Promise<AgentHistoryAdmission | undefined> {
    if (media === undefined || !hasLocalMedia(history)) return undefined;
    this.sequence += 1;
    const ownership = admitSessionHistory(
      history,
      media,
      `set-history:${this.sequence}`,
    );
    this.all = [...this.all, ownership];
    return ownership;
  }

  async release(
    admissions: readonly AgentHistoryAdmission[],
  ): Promise<readonly unknown[]> {
    const failures: unknown[] = [];
    for (const admission of admissions) {
      try {
        await admission.release();
        this.all = this.all.filter((candidate) => candidate !== admission);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    return failures;
  }
}
