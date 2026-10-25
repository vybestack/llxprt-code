/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ProviderFileDeletion,
  ProviderFileLifecycle,
  ProviderFileScope,
} from '@vybestack/llxprt-code-providers/providerFilePolicy.js';

export type ProviderFileInput = Omit<
  Parameters<ProviderFileLifecycle['retain']>[0],
  'scopeId'
>;

/**
 * Writes a provider file into `directory` and returns the retention input for
 * it. The scope is supplied by the caller of `retain`: `Agent.retainProviderFile`
 * uses the agent's runtime id and `ProviderFileLifecycle.retain` takes a
 * `scopeId`.
 */
export async function writeProviderFile(
  directory: string,
  fileId: string,
  deletion: ProviderFileDeletion = 'delete',
  scope: ProviderFileScope = 'session',
): Promise<ProviderFileInput> {
  await writeFile(join(directory, fileId), 'provider file');
  return {
    cacheKey: fileId,
    fileId,
    bytes: 13,
    identity: {
      provider: 'fake',
      baseURL: 'http://127.0.0.1',
      credentialHash: 'ownership-effects',
    },
    policy: {
      mode: 'enabled',
      scope,
      retentionMs: 60_000,
      deletion,
      zeroDataRetention: 'incompatible-while-retained',
    },
    deleteRemote: (id) => rm(join(directory, id)),
  };
}
