/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

export type AgentRetainedProviderFile = Omit<
  Parameters<ProviderFileLifecycle['retain']>[0],
  'scopeId'
>;

export interface AgentProviderFileOperations {
  retainProviderFile(
    input: AgentRetainedProviderFile,
  ): ReturnType<ProviderFileLifecycle['retain']>;
  captureProviderFiles(): ReturnType<ProviderFileLifecycle['snapshot']>;
  retryProviderFileDeletions(): ReturnType<
    ProviderFileLifecycle['retryDeletions']
  >;
}

export function assembleProviderFileOperations(
  owner: object | undefined,
  scopeId: string,
  assertAdmission: () => void,
): AgentProviderFileOperations {
  if (!(owner instanceof ProviderFileLifecycle))
    throw new Error('Agent requires its provider-file owner');
  return {
    async retainProviderFile(input) {
      assertAdmission();
      return owner.retain({ ...input, scopeId });
    },
    captureProviderFiles: () => owner.snapshot(),
    retryProviderFileDeletions: () => owner.retryDeletions(),
  };
}

export abstract class AgentProviderFileDomain
  implements AgentProviderFileOperations
{
  readonly retainProviderFile: AgentProviderFileOperations['retainProviderFile'];
  readonly captureProviderFiles: AgentProviderFileOperations['captureProviderFiles'];
  readonly retryProviderFileDeletions: AgentProviderFileOperations['retryProviderFileDeletions'];

  protected constructor(owner: object | undefined, scopeId: string) {
    const files = assembleProviderFileOperations(owner, scopeId, () =>
      this.assertFileAdmission(),
    );
    this.retainProviderFile = files.retainProviderFile;
    this.captureProviderFiles = files.captureProviderFiles;
    this.retryProviderFileDeletions = files.retryProviderFileDeletions;
  }

  protected abstract assertFileAdmission(): void;
}
