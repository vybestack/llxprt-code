import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export async function finishClientDisposal(
  auxiliary: Promise<void>,
  releaseListeners: () => unknown[],
  previousHistory: readonly IContent[] | undefined,
  clearMediaHistory: () => Promise<void> | undefined,
  retireChat: () => void,
  releaseHistory: () => Promise<readonly unknown[]>,
  forgetReleasedHistory: () => void,
): Promise<void> {
  const joined = await Promise.allSettled([auxiliary]);
  const failures = releaseListeners();
  failures.push(
    ...joined.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    ),
  );
  const media = await Promise.allSettled([
    Promise.resolve().then(async () => {
      if (
        previousHistory?.some((content) =>
          content.blocks.some(
            (block) => block.type === 'media' && block.encoding === 'reference',
          ),
        ) === true
      ) {
        await clearMediaHistory();
        retireChat();
      }
    }),
  ]);
  failures.push(
    ...media.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    ),
  );
  failures.push(...(await releaseHistory()));
  if (failures.length === 0) forgetReleasedHistory();
  if (failures.length > 0)
    throw new AggregateError(failures, 'Agent client disposal failed');
}
