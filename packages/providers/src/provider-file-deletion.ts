/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  OwnedFetch,
  type NetworkFetch,
} from '@vybestack/llxprt-code-core/utils/fetch.js';

export type ProviderFileRemoteDeletion = (
  fileId: string,
  requestFetch: NetworkFetch,
) => Promise<void>;

export async function deleteRetainedProviderFile(
  deletion: ProviderFileRemoteDeletion,
  fileId: string,
  proxy: string | undefined,
): Promise<void> {
  const network = new OwnedFetch(proxy);
  const failures: unknown[] = [];
  try {
    await deletion(fileId, network.fetch);
  } catch (error) {
    failures.push(error);
  }
  try {
    await network.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Provider file deletion and transport release failed',
    );
}
