/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config, LlxprtExtension } from '../config/config.js';
import {
  type ExtensionLoader,
  type ExtensionProgressEvents,
  SimpleExtensionLoader,
  type ExtensionRuntimeConfiguration,
} from './extensionLoader.js';

export type ExtensionProgress = Readonly<{ total: number; completed: number }>;
export type ExtensionProgressEvent =
  | 'extensionsStarting'
  | 'extensionsStopping';

export interface WorkspaceExtensionOperations {
  subscribeProgress(
    event: ExtensionProgressEvent,
    listener: (progress: ExtensionProgress) => void,
  ): () => void;
  list(): LlxprtExtension[];
  load(extension: LlxprtExtension): Promise<void>;
  unload(extension: LlxprtExtension): Promise<void>;
  restart(extension: LlxprtExtension): Promise<void>;
}

export class WorkspaceExtensionOwner {
  readonly operations: WorkspaceExtensionOperations;
  private readonly loader: ExtensionLoader;
  private readonly subscribers = new Map<
    ExtensionProgressEvent,
    ReadonlyArray<(progress: ExtensionProgress) => void>
  >();
  private readonly progress: ExtensionProgressEvents = {
    emit: (event, progress) => {
      if (this.closing) return false;
      const listeners = this.subscribers.get(event) ?? [];
      const failures: unknown[] = [];
      for (const listener of listeners) {
        try {
          listener(Object.freeze({ ...progress }));
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Extension progress publication failed',
        );
      return listeners.length > 0;
    },
  };
  private initialization: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private closing = false;
  private readonly accepted = new Set<Promise<void>>();

  constructor(
    private readonly config: ExtensionRuntimeConfiguration &
      Pick<Config, 'getExtensions'>,
    loader: ExtensionLoader | undefined,
    private readonly refreshMemory: () => Promise<void>,
    private readonly admitTransition?: (
      operation: () => Promise<void>,
    ) => Promise<void>,
    private readonly reloadHooks?: () => Promise<void>,
  ) {
    this.loader = loader ?? new SimpleExtensionLoader(config.getExtensions());
    this.config.setExtensions(this.loader.getExtensions());
    this.operations = {
      subscribeProgress: (event, listener) => {
        if (this.closing) throw new Error('Workspace extensions are closed');
        this.subscribers.set(event, [
          ...(this.subscribers.get(event) ?? []),
          listener,
        ]);
        return () =>
          this.subscribers.set(
            event,
            (this.subscribers.get(event) ?? []).filter(
              (item) => item !== listener,
            ),
          );
      },
      list: () => this.loader.getExtensions(),
      load: (extension) => this.accept(() => this.load(extension)),
      unload: (extension) =>
        this.accept(() => this.loader.unloadExtension(extension)),
      restart: (extension) =>
        this.accept(() => this.loader.restartExtension(extension)),
    };
  }

  initialize(
    startMcp: (extension: LlxprtExtension) => Promise<void>,
    stopMcp: (extension: LlxprtExtension) => Promise<void>,
    publishTools: () => Promise<void>,
    refreshSkills: () => Promise<void>,
  ): Promise<void> {
    if (this.initialization !== undefined) return this.initialization;
    if (this.closing) throw new Error('Workspace extensions are closed');
    this.initialization = this.loader.start(
      this.config,
      startMcp,
      stopMcp,
      publishTools,
      refreshSkills,
      () => (this.admitTransition ? Promise.resolve() : this.refreshMemory()),
      this.reloadHooks,
      this.progress,
    );
    return this.initialization;
  }

  private async load(extension: LlxprtExtension): Promise<void> {
    try {
      await this.loader.loadExtension(extension);
    } catch (error) {
      try {
        await this.loader.unloadExtension(extension);
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          'Extension load rollback failed',
        );
      }
      throw error;
    }
  }

  private accept(operation: () => Promise<void>): Promise<void> {
    if (this.closing)
      return Promise.reject(new Error('Workspace extensions are closed'));
    if (this.initialization === undefined)
      return Promise.reject(
        new Error('Workspace extensions are not initialized'),
      );
    const starting = this.initialization;
    const pending = this.admitTransition
      ? this.admitTransition(() => starting.then(operation))
      : starting.then(operation);
    this.accepted.add(pending);
    void pending
      .finally(() => this.accepted.delete(pending))
      .catch(() => undefined);
    return pending;
  }

  async joinAccepted(): Promise<void> {
    await Promise.allSettled([this.initialization, ...this.accepted]);
  }

  closeAdmission(): void {
    this.closing = true;
    this.subscribers.clear();
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.closeAdmission();
    this.disposal = this.close();
    return this.disposal;
  }

  private async close(): Promise<void> {
    const failures: unknown[] = [];
    const pending = await Promise.allSettled([
      this.initialization,
      ...this.accepted,
    ]);
    for (const result of pending)
      if (result.status === 'rejected') failures.push(result.reason);
    for (const extension of this.loader
      .getExtensions()
      .filter((item) => item.isActive)) {
      try {
        await this.loader.releaseExtension(extension);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Workspace extension cleanup failed');
  }
}
