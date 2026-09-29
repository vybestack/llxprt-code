/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpClientManager } from '@vybestack/llxprt-code-mcp';

/** Only the manager operations required by the workspace lifetime. */
export type WorkspaceMcpManager = Pick<
  McpClientManager,
  | 'startConfiguredMcpServers'
  | 'whenDiscoverySettled'
  | 'getDiscoveryFailures'
  | 'getMcpInstructions'
  | 'getMcpServers'
  | 'getDiscoveryState'
  | 'restart'
  | 'restartServer'
  | 'reconcileConfiguredMcpServers'
  | 'onFolderTrustRevoked'
  | 'onFolderTrustGained'
  | 'stop'
>;

export class WorkspaceMcpLifetime {
  private readonly discovery: Promise<void>;
  private disposal: Promise<void> | undefined;
  private readonly trustTransitions: Array<Promise<void>> = [];

  constructor(private readonly manager: WorkspaceMcpManager) {
    this.discovery = manager.startConfiguredMcpServers();
  }

  get disposed(): boolean {
    return this.disposal !== undefined;
  }

  status(): {
    readonly servers: ReturnType<WorkspaceMcpManager['getMcpServers']>;
    readonly discoveryFailures: ReturnType<
      WorkspaceMcpManager['getDiscoveryFailures']
    >;
    readonly discoveryState: ReturnType<
      WorkspaceMcpManager['getDiscoveryState']
    >;
  } {
    return {
      servers: this.manager.getMcpServers(),
      discoveryFailures: this.manager.getDiscoveryFailures(),
      discoveryState: this.manager.getDiscoveryState(),
    };
  }

  async awaitDiscoveryGate(): Promise<ReadonlyMap<string, string>> {
    await this.manager.whenDiscoverySettled();
    return this.manager.getDiscoveryFailures();
  }

  instructions(): string {
    return this.manager.getMcpInstructions();
  }

  async refresh(
    server: string | undefined,
    refreshContext: () => Promise<void>,
  ): Promise<void> {
    if (server === undefined) {
      await this.manager.restart(refreshContext);
    } else {
      await this.manager.restartServer(server, refreshContext);
    }
  }

  async reconcile(refreshContext: () => Promise<void>): Promise<void> {
    await this.manager.reconcileConfiguredMcpServers(refreshContext);
  }

  transitionTrust(trusted: boolean): Promise<void> {
    const transition = trusted
      ? this.manager.onFolderTrustGained()
      : this.manager.onFolderTrustRevoked();
    this.trustTransitions.push(transition);
    return transition;
  }

  dispose(
    whenTrustSettled: () => Promise<void> = async () => {},
  ): Promise<void> {
    if (this.disposal === undefined) {
      // stop() must be invoked before a trust transition or background discovery
      // is awaited, so pending transport work can observe cancellation.
      const stopping = this.manager.stop();
      this.disposal = this.finishDisposal(stopping, whenTrustSettled);
    }
    return this.disposal;
  }

  private async finishDisposal(
    stopping: Promise<void>,
    whenTrustSettled: () => Promise<void>,
  ): Promise<void> {
    const results = await Promise.allSettled([
      whenTrustSettled(),
      ...this.trustTransitions,
      this.discovery,
      stopping,
    ]);
    const failures = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      .map((result) => result.reason as unknown);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Workspace MCP disposal failed');
    }
  }
}

export interface WorkspaceMcpLease {
  readonly surface: WorkspaceMcpLifetime;
  release(whenTrustSettled?: () => Promise<void>): Promise<void>;
}

interface SharedOwner {
  readonly surface: WorkspaceMcpLifetime;
  borrowers: number;
}

const owners = new WeakMap<object, SharedOwner>();

/** Borrowers sharing the same workspace identity share discovery and cancellation. */
export function borrowWorkspaceMcp(
  workspace: object,
  createManager: () => WorkspaceMcpManager,
): WorkspaceMcpLease {
  let owner = owners.get(workspace);
  if (owner === undefined) {
    owner = {
      surface: new WorkspaceMcpLifetime(createManager()),
      borrowers: 0,
    };
    owners.set(workspace, owner);
  }
  if (owner.borrowers === 0 && owner.surface.disposed) {
    throw new Error('Workspace MCP lifetime is closing');
  }
  owner.borrowers++;
  const shared = owner;
  let releasePromise: Promise<void> | undefined;
  return {
    surface: shared.surface,
    release(whenTrustSettled) {
      if (releasePromise !== undefined) return releasePromise;
      shared.borrowers--;
      if (shared.borrowers !== 0) {
        releasePromise = Promise.resolve();
      } else {
        releasePromise = shared.surface
          .dispose(whenTrustSettled)
          .finally(() => {
            owners.delete(workspace);
          });
      }
      return releasePromise;
    },
  };
}
