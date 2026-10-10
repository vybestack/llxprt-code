/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import type { Config } from '../config/config.js';
import type { WorkspaceTrustReader } from './workspace-trust-reader.js';
import type { WorkspaceTrustWritePort } from './workspace-trust-mutation.js';
import type { WorkspaceTrustSettlementPort } from './workspace-trust-transition.js';

export interface WorkspaceIdePort {
  getClient(): IdeClient | undefined;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export class WorkspaceIdeOwner implements WorkspaceIdePort {
  private client: IdeClient | undefined;
  private initialization: Promise<void> | undefined;
  private acquisition: Promise<IdeClient> | undefined;
  private disposal: Promise<void> | undefined;
  private closing = false;
  private readonly closedAdmission = new Error(
    'Workspace IDE owner is disposed',
  );
  private readonly trustOperations = new Set<Promise<void>>();
  private readonly trustFailures: unknown[] = [];
  private readonly onTrust = (trusted: boolean | undefined): void => {
    if (this.closing) return;
    const operation = this.trustWriter.setIdeTrustLive(trusted).then(
      () => undefined,
      (error: unknown) => {
        this.trustFailures.push(error);
      },
    );
    this.trustOperations.add(operation);
    void operation.then(() => this.trustOperations.delete(operation));
  };

  constructor(
    private readonly configIdentity: Config,
    private readonly trustWriter: WorkspaceTrustWritePort &
      WorkspaceTrustReader,
    private readonly trustSettlement: Pick<
      WorkspaceTrustSettlementPort,
      'whenSettled'
    >,
    private readonly acquireClient: () => Promise<IdeClient> = () =>
      IdeClient.create(),
    private enabled = false,
  ) {}

  assertConfig(config: Config): void {
    if (config !== this.configIdentity)
      throw new Error('IDE owner belongs to a different Config');
    if (this.closing) throw this.closedAdmission;
  }

  assertTrustAuthority(view: WorkspaceTrustReader): void {
    this.assertConfig(this.configIdentity);
    if (view !== this.trustWriter)
      throw new Error('IDE owner belongs to a different trust authority');
  }

  initialize(): Promise<void> {
    this.assertConfig(this.configIdentity);
    this.initialization ??= this.performInitialization();
    return this.initialization;
  }

  private async performInitialization(): Promise<void> {
    this.acquisition = this.acquireClient();
    const client = await this.acquisition;
    this.client = client;
    this.assertConfig(this.configIdentity);
    client.addTrustChangeListener(this.onTrust);
    await this.trustWriter.setIdeTrustLive(client.getWorkspaceTrust());
    this.assertConfig(this.configIdentity);
  }

  isEnabled(): boolean {
    this.assertConfig(this.configIdentity);
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.assertConfig(this.configIdentity);
    this.enabled = enabled;
  }

  getClient(): IdeClient | undefined {
    this.assertConfig(this.configIdentity);
    return this.client;
  }

  whenSettled(): Promise<void> {
    return this.trustSettlement.whenSettled();
  }

  closeAdmission(): void {
    this.closing = true;
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    this.disposal ??= this.performDisposal();
    return this.disposal;
  }

  private async performDisposal(): Promise<void> {
    const failures: unknown[] = [];
    const results = await Promise.allSettled([this.acquisition]);
    const result = results[0];
    if (result.status === 'rejected' || result.value === undefined) {
      await this.joinInitialization(failures);
      this.reportDisposalFailures(failures);
      return;
    }
    const client = result.value;
    try {
      client.removeTrustChangeListener(this.onTrust);
    } catch (error) {
      failures.push(error);
    }
    for (const release of [
      () => client.disconnect(),
      () => this.whenSettled(),
    ]) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    await this.joinInitialization(failures);
    this.client = undefined;
    this.reportDisposalFailures(failures);
  }
  private async joinInitialization(failures: unknown[]): Promise<void> {
    const results = await Promise.allSettled([
      this.initialization,
      ...this.trustOperations,
    ]);
    for (const result of results)
      if (
        result.status === 'rejected' &&
        result.reason !== this.closedAdmission
      )
        failures.push(result.reason);
    failures.push(...this.trustFailures);
    this.trustOperations.clear();
  }

  private reportDisposalFailures(failures: unknown[]): void {
    if (failures.length > 0)
      throw new AggregateError(
        [...new Set(failures)],
        'IDE owner cleanup failed',
      );
  }
}
