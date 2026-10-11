/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GitService } from './gitService.js';

export interface WorkspaceCheckpointOperations {
  getCurrentCommitHash(): Promise<string>;
  createFileSnapshot(message: string): Promise<string>;
  restoreProjectFromSnapshot(commitHash: string): Promise<void>;
}

export class WorkspaceCheckpointOwner {
  private readonly service: GitService | undefined;
  private initialization: Promise<void> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Set<Promise<void>>();
  private closed = false;
  private disposal: Promise<void> | undefined;

  readonly operations: WorkspaceCheckpointOperations = {
    getCurrentCommitHash: () =>
      this.admit((service) => service.getCurrentCommitHash()),
    createFileSnapshot: (message) =>
      this.admit((service) => service.createFileSnapshot(message)),
    restoreProjectFromSnapshot: (commitHash) =>
      this.admit((service) => service.restoreProjectFromSnapshot(commitHash)),
  };

  constructor(projectRoot: string, historyDir: string, enabled: boolean) {
    this.service = enabled
      ? new GitService(projectRoot, historyDir)
      : undefined;
  }

  initialize(): Promise<void> {
    this.assertOpen();
    return this.service === undefined
      ? Promise.resolve()
      : this.initializeService(this.service);
  }

  private initializeService(service: GitService): Promise<void> {
    this.initialization ??= service.initialize();
    return this.initialization;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Workspace checkpoint owner is closed');
  }

  private admit<T>(operation: (service: GitService) => Promise<T>): Promise<T> {
    this.assertOpen();
    const service = this.service;
    if (service === undefined)
      throw new Error('Workspace checkpointing is disabled');
    const initialization = this.initializeService(service);
    const accepted = this.tail.then(async () => {
      await initialization;
      return operation(service);
    });
    const joined = accepted.then(() => undefined);
    this.pending.add(joined);
    this.tail = joined.then(
      () => {
        this.pending.delete(joined);
      },
      () => {
        this.pending.delete(joined);
      },
    );
    return accepted;
  }

  closeAdmission(): void {
    this.closed = true;
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.closeAdmission();
    this.disposal = this.drain();
    return this.disposal;
  }

  private async drain(): Promise<void> {
    const results = await Promise.allSettled([
      ...this.pending,
      ...(this.initialization === undefined ? [] : [this.initialization]),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Workspace checkpoint cleanup failed');
  }
}
