/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IdeClient,
  type IdeContext,
  type IDEConnectionStatus,
  type IdeInfo,
} from '@vybestack/llxprt-code-ide-integration';
import type { Config } from '../config/config.js';
import type { WorkspaceTrustReader } from './workspace-trust-reader.js';
import type { WorkspaceTrustWritePort } from './workspace-trust-mutation.js';
import type { WorkspaceTrustSettlementPort } from './workspace-trust-transition.js';

export interface WorkspaceIdeConnection {
  readonly available: boolean;
  readonly status?: IDEConnectionStatus;
  readonly details?: string;
  readonly currentIde?: Readonly<IdeInfo>;
  readonly detectedIdeDisplayName?: string;
  readonly diffingEnabled: boolean;
}

export interface WorkspaceIdePort {
  getClient(): IdeClient | undefined;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  readConnection(): WorkspaceIdeConnection;
  readContext(): IdeContext | undefined;
  subscribeContext(
    listener: (context: IdeContext | undefined) => void,
  ): () => void;
  readWorkspaceTrust(): boolean | undefined;
  subscribeWorkspaceTrust(
    listener: (trusted: boolean | undefined) => void,
  ): () => void;
  subscribeConnection(
    listener: (connection: WorkspaceIdeConnection) => void,
  ): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  resolveDiff(
    filePath: string,
    outcome: 'accepted' | 'rejected',
  ): Promise<void>;
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
  private readonly contextListeners = new Set<
    (context: IdeContext | undefined) => void
  >();
  private readonly trustListeners = new Set<
    (trusted: boolean | undefined) => void
  >();
  private readonly connectionListeners = new Set<
    (connection: WorkspaceIdeConnection) => void
  >();
  private readonly onContext = (context: IdeContext | undefined): void => {
    for (const listener of this.contextListeners) listener(context);
  };
  private readonly onConnection = (): void => {
    if (this.closing) return;
    const connection = this.readConnection();
    for (const listener of this.connectionListeners) listener(connection);
  };
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
    for (const listener of this.trustListeners) listener(trusted);
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
    client.addContextChangeListener(this.onContext);
    client.addStatusChangeListener(this.onConnection);
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

  readConnection(): WorkspaceIdeConnection {
    this.assertConfig(this.configIdentity);
    const client = this.client;
    if (client === undefined)
      return { available: false, diffingEnabled: false };
    const currentIde = client.getCurrentIde();
    return {
      available: true,
      ...client.getConnectionStatus(),
      currentIde: currentIde === undefined ? undefined : { ...currentIde },
      detectedIdeDisplayName: client.getDetectedIdeDisplayName(),
      diffingEnabled: client.isDiffingEnabled(),
    };
  }

  readContext(): IdeContext | undefined {
    this.assertConfig(this.configIdentity);
    return this.client?.getIdeContext();
  }

  readWorkspaceTrust(): boolean | undefined {
    this.assertConfig(this.configIdentity);
    return this.client?.getWorkspaceTrust();
  }

  subscribeContext(
    listener: (context: IdeContext | undefined) => void,
  ): () => void {
    return this.subscribe(this.contextListeners, listener);
  }

  subscribeWorkspaceTrust(
    listener: (trusted: boolean | undefined) => void,
  ): () => void {
    return this.subscribe(this.trustListeners, listener);
  }

  subscribeConnection(
    listener: (connection: WorkspaceIdeConnection) => void,
  ): () => void {
    return this.subscribe(this.connectionListeners, listener);
  }

  private subscribe<T>(
    listeners: Set<(value: T) => void>,
    listener: (value: T) => void,
  ): () => void {
    this.assertConfig(this.configIdentity);
    const notify = (value: T): void => listener(value);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }

  async connect(): Promise<void> {
    this.assertConfig(this.configIdentity);
    await this.client?.connect();
  }

  async disconnect(): Promise<void> {
    this.assertConfig(this.configIdentity);
    await this.client?.disconnect();
  }

  async resolveDiff(
    filePath: string,
    outcome: 'accepted' | 'rejected',
  ): Promise<void> {
    this.assertConfig(this.configIdentity);
    await this.client?.resolveDiffFromCli(filePath, outcome);
  }

  whenSettled(): Promise<void> {
    return this.trustSettlement.whenSettled();
  }

  closeAdmission(): void {
    this.closing = true;
    this.contextListeners.clear();
    this.trustListeners.clear();
    this.connectionListeners.clear();
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
    const releases: ReadonlyArray<() => void | Promise<void>> = [
      () => client.removeTrustChangeListener(this.onTrust),
      () => client.removeContextChangeListener(this.onContext),
      () => client.removeStatusChangeListener(this.onConnection),
      () => client.disconnect(),
      () => this.whenSettled(),
    ];
    for (const release of releases) {
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
