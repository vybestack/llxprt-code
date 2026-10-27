/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

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
  owner: ProviderFileLifecycle,
  scopeId: string,
  assertAdmission: () => void,
): AgentProviderFileOperations {
  return {
    async retainProviderFile(input) {
      assertAdmission();
      return owner.retain({ ...input, scopeId });
    },
    captureProviderFiles: () => owner.snapshot(),
    retryProviderFileDeletions: () => owner.retryDeletions(),
  };
}

export class SessionProviderFileBinding {
  private lifecycle: ProviderFileLifecycle | undefined;
  private retry: ((provider: string) => ProviderRetryOperations) | undefined;
  private cleanup: ((scope: string) => Promise<void>) | undefined;

  bind(
    client: Pick<
      AgentClientContract<ProviderFileLifecycle>,
      'bindProviderFiles'
    >,
    lifecycle: ProviderFileLifecycle,
    retry: (provider: string) => ProviderRetryOperations,
    cleanup: ((scope: string) => Promise<void>) | undefined,
  ): void {
    if (this.lifecycle !== undefined && this.lifecycle !== lifecycle)
      throw new Error('Session provider files cannot change owner');
    this.lifecycle = lifecycle;
    this.retry = retry;
    this.cleanup = cleanup ?? this.cleanup;
    this.bindClient(client);
  }

  bindClient(
    client: Pick<
      AgentClientContract<ProviderFileLifecycle>,
      'bindProviderFiles'
    >,
  ): void {
    if (this.lifecycle !== undefined && this.retry !== undefined)
      client.bindProviderFiles?.(this.lifecycle, this.retry);
  }

  cleanupScope(scope: string): Promise<void> | undefined {
    return this.cleanup?.(scope);
  }

  operations(
    scope: string,
    assertAdmission: () => void,
  ): AgentProviderFileOperations {
    if (this.lifecycle === undefined)
      throw new Error('Agent requires its provider-file owner');
    return assembleProviderFileOperations(
      this.lifecycle,
      scope,
      assertAdmission,
    );
  }
}
