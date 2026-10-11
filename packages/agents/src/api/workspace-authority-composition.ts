/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  coreEvents,
  type WorkspaceIdePort,
  type WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { WorkspaceIdeOwner } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';

export class WorkspaceAuthorityComposition {
  readonly trust: WorkspaceTrustControlPort;
  readonly ide: WorkspaceIdePort;
  private readonly ownedTrust: WorkspaceTrustLifecycle | undefined;
  private readonly ownedIde: WorkspaceIdeOwner | undefined;
  private unsubscribe: (() => void) | undefined;
  private admissionClosed = false;
  private closing: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;

  constructor(
    config: Config,
    trust?: WorkspaceTrustControlPort,
    ide?: WorkspaceIdePort,
    private readonly transferredCleanup?: () => Promise<void>,
  ) {
    this.ownedTrust =
      trust === undefined
        ? new WorkspaceTrustLifecycle({
            localTrust: config.initialWorkspaceTrust,
          })
        : undefined;
    const authority = trust ?? this.ownedTrust;
    if (authority === undefined)
      throw new Error('Workspace trust authority is required');
    this.trust = authority;
    this.ownedIde =
      ide === undefined
        ? new WorkspaceIdeOwner(
            config,
            authority,
            authority,
            undefined,
            config.getIdeMode(),
          )
        : undefined;
    const client = ide ?? this.ownedIde;
    if (client === undefined)
      throw new Error('Workspace IDE authority is required');
    this.ide = client;
  }

  initialize(): Promise<void> {
    if (this.admissionClosed)
      throw new Error('Workspace authority is disposed');
    this.unsubscribe ??= this.trust.subscribeTrustChange((transition) =>
      coreEvents.emitFolderTrustChanged(transition.trusted),
    );
    return this.ownedIde?.initialize() ?? Promise.resolve();
  }

  closeAdmission(): void {
    this.admissionClosed = true;
    this.ownedIde?.closeAdmission();
  }

  closeIde(): Promise<void> {
    this.closeAdmission();
    this.closing ??= this.releaseOperations([
      () => this.unsubscribe?.(),
      () => this.ownedIde?.dispose(),
    ]);
    return this.closing;
  }

  dispose(): Promise<void> {
    this.disposal ??= this.release();
    return this.disposal;
  }

  private release(): Promise<void> {
    return this.releaseOperations([
      () => this.closeIde(),
      () => this.transferredCleanup?.(),
      () => this.ownedTrust?.dispose(),
    ]);
  }

  private async releaseOperations(
    releases: ReadonlyArray<() => void | Promise<void>>,
  ): Promise<void> {
    const failures: unknown[] = [];
    for (const release of releases) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Workspace authority cleanup failed');
  }
}
