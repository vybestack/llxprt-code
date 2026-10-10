/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryMediaIndex } from '@vybestack/llxprt-code-core/storage/history-media-index.js';
import type {
  MediaAdmissionContext,
  MediaAdmissionService,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { collectMediaReferences } from '@vybestack/llxprt-code-core/storage/media-reference-lifecycle.js';

export interface SessionHistoryAdmission {
  /** Admits and yields one row at a time; no admitted array is ever built. */
  readonly rows: AsyncGenerator<IContent, void, unknown>;
  /** Releases every reservation the admitted rows acquired, from the disk index. */
  release(): Promise<void>;
}

export function hasLocalMedia(history: readonly IContent[]): boolean {
  return history.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'media' &&
        (block.encoding === 'base64' || block.encoding === 'reference'),
    ),
  );
}

/**
 * Disk-backed ownership for replacing session history. Only the media
 * reference index (on disk) outlives the replacement; the admitted rows
 * stream through and are not retained.
 */
export function admitSessionHistory(
  history: readonly IContent[],
  admission: MediaAdmissionService,
  scope: string,
): SessionHistoryAdmission {
  const references = new HistoryMediaIndex();
  return {
    rows: admitRowsOneAtATime(history, admission, scope, references),
    release: async (): Promise<void> => {
      for (const reference of references.values()) {
        await admission.releaseReference(reference.contentId);
        references.delete(reference.contentId);
      }
      references.close();
    },
  };
}

async function* admitRowsOneAtATime(
  history: readonly IContent[],
  admission: MediaAdmissionService,
  scope: string,
  references: HistoryMediaIndex,
): AsyncGenerator<IContent, void, unknown> {
  for (const [index, row] of history.entries()) {
    const context: MediaAdmissionContext = {
      turnId: `${scope}:${index}`,
      source: scope,
    };
    const [admitted] = await admission.admitContents([row], context);
    for (const reference of collectMediaReferences([admitted]))
      references.set(reference);
    yield admitted;
  }
}
