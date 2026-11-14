/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export async function finishClientDisposal(
  auxiliary: Promise<void>,
  releaseListeners: () => unknown[],
  releaseJournal: () => Promise<void>,
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
  const journal = await Promise.allSettled([
    Promise.resolve().then(releaseJournal),
  ]);
  failures.push(
    ...journal.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    ),
  );
  failures.push(...(await releaseHistory()));
  if (failures.length === 0) forgetReleasedHistory();
  if (failures.length > 0)
    throw new AggregateError(failures, 'Agent client disposal failed');
}
