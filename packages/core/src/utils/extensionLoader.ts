/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, LlxprtExtension } from '../config/config.js';

export type { LlxprtExtension } from '../config/config.js';

export interface ExtensionProgressEvents {
  emit(
    event: 'extensionsStarting' | 'extensionsStopping',
    progress: { total: number; completed: number },
  ): boolean;
}

export type ExtensionRuntimeConfiguration = Pick<
  Config,
  'setExtensions' | 'getEnableExtensionReloading'
>;

export abstract class ExtensionLoader {
  // Assigned in `start`.
  protected config: ExtensionRuntimeConfiguration | undefined;

  // Used to track the count of currently starting and stopping extensions and
  // fire appropriate events.
  protected startingCount: number = 0;
  protected startCompletedCount: number = 0;
  protected stoppingCount: number = 0;
  protected stopCompletedCount: number = 0;

  // Whether or not we are currently executing `start`
  private isStarting: boolean = false;

  // Set when an extension that contributes skills starts or stops, so the
  // rediscovery happens once per settled batch instead of once per extension.
  private skillsNeedRefresh: boolean = false;

  constructor(private eventEmitter?: ExtensionProgressEvents) {}

  /**
   * All currently known extensions, both active and inactive.
   */
  abstract getExtensions(): LlxprtExtension[];
  abstract unloadExtension(extension: LlxprtExtension): Promise<void>;
  loadExtension(_extension: LlxprtExtension): Promise<void> {
    return Promise.reject(
      new Error('This extension loader does not support loading'),
    );
  }

  async releaseExtension(extension: LlxprtExtension): Promise<void> {
    await this.unloadExtension(extension);
    if (this.config && !this.config.getEnableExtensionReloading())
      await this.stopExtension(extension);
  }

  private refreshMemory!: () => Promise<void>;
  private publishTools: (() => Promise<void>) | undefined;
  private reloadHooks: (() => Promise<void>) | undefined;
  private refreshSkills: (() => Promise<void>) | undefined;
  private startMcpExtension!: (extension: LlxprtExtension) => Promise<void>;
  private stopMcpExtension!: (extension: LlxprtExtension) => Promise<void>;

  /**
   * Fully initializes all active extensions.
   *
   * Called within `Config.initialize`, which must already have an
   * McpClientManager, PromptRegistry, and ChatSession set up.
   */
  async start(
    config: ExtensionRuntimeConfiguration,
    startMcpExtension: (extension: LlxprtExtension) => Promise<void>,
    stopMcpExtension: (extension: LlxprtExtension) => Promise<void>,
    publishTools: (() => Promise<void>) | undefined,
    refreshSkills: (() => Promise<void>) | undefined,
    refreshMemory: () => Promise<void>,
    reloadHooks?: () => Promise<void>,
    progress?: ExtensionProgressEvents,
  ): Promise<void> {
    if (progress !== undefined) this.eventEmitter = progress;
    this.isStarting = true;
    try {
      if (!this.config) {
        this.config = config;
        this.startMcpExtension = startMcpExtension;
        this.stopMcpExtension = stopMcpExtension;
        this.publishTools = publishTools;
        this.refreshSkills = refreshSkills;
        this.reloadHooks = reloadHooks;
        this.refreshMemory = refreshMemory;
      } else {
        throw new Error('Already started, you may only call `start` once.');
      }
      const settled = await Promise.allSettled(
        this.getExtensions()
          .filter((e) => e.isActive)
          .map(this.startExtension.bind(this)),
      );
      const failures = settled.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'Extension startup failed');
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Unconditionally starts an `extension` and loads all its MCP servers,
   * context, custom commands, etc. Assumes that `start` has already been called
   * and we have a Config object.
   *
   * This should typically only be called from `start`, most other calls should
   * go through `maybeStartExtension` which will only start the extension if
   * extension reloading is enabled and the `config` object is initialized.
   */
  protected async startExtension(extension: LlxprtExtension) {
    if (!this.config) {
      throw new Error('Cannot call `startExtension` prior to calling `start`.');
    }
    this.config.setExtensions(this.getExtensions());
    this.startingCount++;
    try {
      this.eventEmitter?.emit('extensionsStarting', {
        total: this.startingCount,
        completed: this.startCompletedCount,
      });

      // Mark before the await, not after. By the time we get here the caller
      // has already changed what getExtensions() returns: SimpleExtensionLoader
      // pushes in loadExtension and splices in unloadExtension, both before
      // this runs. So if the MCP transition below rejects, the skill surface is
      // already stale and still needs reconciling. Moving this after the await
      // reintroduces issue #3383 for the failure path.
      this.markSkillsDirty(extension);
      await this.startMcpExtension(extension);
      await this.maybeRefreshAgentTools(extension);
      // Note: Context files are loaded only once all extensions are done
      // loading/unloading to reduce churn, see the `maybeRefreshMemory` call
      // below.
      // Follow-up (#1569): Move all extension features here, including at least:
      // - custom command loading
    } finally {
      this.startCompletedCount++;
      const progress = {
        total: this.startingCount,
        completed: this.startCompletedCount,
      };
      if (this.startingCount === this.startCompletedCount) {
        this.startingCount = 0;
        this.startCompletedCount = 0;
      }
      try {
        this.eventEmitter?.emit('extensionsStarting', progress);
      } finally {
        await this.maybeRefreshMemory();
        await this.maybeRefreshSkills();
      }
    }
  }

  /**
   * If extension reloading is enabled and `start` has already been called,
   * then calls `startExtension` to include all extension features into the
   * program.
   */
  protected maybeStartExtension(
    extension: LlxprtExtension,
  ): Promise<void> | undefined {
    if (this.config?.getEnableExtensionReloading() === true) {
      return this.startExtension(extension);
    }
    return;
  }

  /**
   * Refreshes the agent tools list if it is initialized and the extension has
   * any excludeTools settings.
   */
  private async maybeRefreshAgentTools(
    extension: LlxprtExtension,
  ): Promise<void> {
    if (extension.excludeTools && extension.excludeTools.length > 0) {
      await this.publishTools?.();
    }
  }

  /**
   * Records that an extension transition changed the available skills.
   *
   * Extension-contributed skills are one of the sources SkillManager reads, so
   * loading or unloading an extension that ships skills makes the discovered
   * set, and therefore the model-facing skill activation tool, stale
   * (issue #3383). Extensions that ship no skills cost nothing here.
   */
  private markSkillsDirty(extension: LlxprtExtension): void {
    if (Array.isArray(extension.skills) && extension.skills.length > 0) {
      this.skillsNeedRefresh = true;
    }
  }

  /**
   * Rediscovers skills once every extension transition has settled.
   *
   * Batched on the same counters as {@link maybeRefreshMemory}, so a batch of
   * concurrent transitions rediscovers once at the end rather than once each.
   * Sequential transitions are not collapsed: `restartExtension` awaits its
   * stop before its start, so each settles on its own and this runs twice. That
   * is harmless, because a restart leaves the extension listed and active, so
   * its skills stay available throughout.
   *
   * Skipped during the initial `start()`: the workspace skill owner runs
   * discovery after Config initialization returns, so anything done here
   * would be thrown away. The flag is cleared on that path so the first real
   * transition is not misattributed to startup.
   */
  private async maybeRefreshSkills(): Promise<void> {
    if (!this.config) {
      throw new Error('Cannot refresh skills prior to calling `start`.');
    }
    if (this.isStarting) {
      this.skillsNeedRefresh = false;
      return;
    }
    if (!this.skillsNeedRefresh || !this.transitionsSettled()) {
      return;
    }
    this.skillsNeedRefresh = false;
    try {
      await this.refreshSkills?.();
    } catch (error) {
      // The failure propagates; this only restores the marker so the next
      // transition retries rather than inheriting a skill surface that was
      // never reconciled.
      this.skillsNeedRefresh = true;
      throw error;
    }
  }

  /**
   * Whether every in-flight extension start and stop has completed.
   *
   * Shared by the memory and skill reconciliation steps so the two cannot
   * drift apart on what "settled" means.
   */
  private transitionsSettled(): boolean {
    return (
      this.startingCount === this.startCompletedCount &&
      this.stoppingCount === this.stopCompletedCount
    );
  }

  /**
   * Refreshes memory only after all extensions are done loading/unloading.
   */
  private async maybeRefreshMemory(): Promise<void> {
    if (!this.config) {
      throw new Error('Cannot refresh memory prior to calling `start`.');
    }
    if (
      !this.isStarting && // Don't refresh memories on the first call to `start`.
      this.transitionsSettled()
    ) {
      // Wait until all extensions are done starting and stopping before we
      // reload memory, this is somewhat expensive and also busts the context
      // cache, we want to only do it once.
      await this.refreshMemory();
      await this.reloadHooks?.();
    }
  }

  /**
   * Unconditionally stops an `extension` and unloads all its MCP servers,
   * context, custom commands, etc. Assumes that `start` has already been called
   * and we have a Config object.
   *
   * Most calls should go through `maybeStopExtension` which will only stop the
   * extension if extension reloading is enabled and the `config` object is
   * initialized.
   */
  protected async stopExtension(extension: LlxprtExtension) {
    if (!this.config) {
      throw new Error('Cannot call `stopExtension` prior to calling `start`.');
    }
    this.config.setExtensions(this.getExtensions());
    this.stoppingCount++;

    try {
      this.eventEmitter?.emit('extensionsStopping', {
        total: this.stoppingCount,
        completed: this.stopCompletedCount,
      });

      // See startExtension: the caller has already removed the extension from
      // the collection getExtensions() reads, so mark before the await or a
      // rejected transition leaves the skill surface stale.
      this.markSkillsDirty(extension);
      await this.stopMcpExtension(extension);
      await this.maybeRefreshAgentTools(extension);
      // Note: Context files are loaded only once all extensions are done
      // loading/unloading to reduce churn, see the `maybeRefreshMemory` call
      // below.
      // Follow-up (#1569): Remove all extension features here, including at least:
      // - custom commands
    } finally {
      this.stopCompletedCount++;
      const progress = {
        total: this.stoppingCount,
        completed: this.stopCompletedCount,
      };
      if (this.stoppingCount === this.stopCompletedCount) {
        this.stoppingCount = 0;
        this.stopCompletedCount = 0;
      }
      try {
        this.eventEmitter?.emit('extensionsStopping', progress);
      } finally {
        await this.maybeRefreshMemory();
        await this.maybeRefreshSkills();
      }
    }
  }

  /**
   * If extension reloading is enabled and `start` has already been called,
   * then this also performs all necessary steps to remove all extension
   * features from the rest of the system.
   */
  protected maybeStopExtension(
    extension: LlxprtExtension,
  ): Promise<void> | undefined {
    if (this.config?.getEnableExtensionReloading() === true) {
      return this.stopExtension(extension);
    }
    return;
  }

  /**
   * Restarts an extension by stopping and then starting it.
   * This is a public method available for runtime extension management.
   */
  async restartExtension(extension: LlxprtExtension): Promise<void> {
    if (!this.config) {
      throw new Error('Cannot restart extension prior to calling `start`.');
    }
    if (!this.config.getEnableExtensionReloading()) {
      throw new Error('Extension reloading is not enabled.');
    }
    await this.stopExtension(extension);
    await this.startExtension(extension);
  }
}

export interface ExtensionEvents {
  extensionsStarting: ExtensionsStartingEvent[];
  extensionsStopping: ExtensionsStoppingEvent[];
}

export interface ExtensionsStartingEvent {
  total: number;
  completed: number;
}

export interface ExtensionsStoppingEvent {
  total: number;
  completed: number;
}

export class SimpleExtensionLoader extends ExtensionLoader {
  constructor(
    protected readonly extensions: LlxprtExtension[],
    eventEmitter?: ExtensionProgressEvents,
  ) {
    super(eventEmitter);
  }

  getExtensions(): LlxprtExtension[] {
    return [...this.extensions];
  }

  /// Adds `extension` to the list of extensions and calls
  /// `maybeStartExtension`.
  ///
  /// This is intended for dynamic loading of extensions after calling `start`.
  override async loadExtension(extension: LlxprtExtension) {
    this.extensions.push(extension);
    this.config?.setExtensions(this.getExtensions());
    await this.maybeStartExtension(extension);
  }

  /// Removes `extension` from the list of extensions and calls
  // `maybeStopExtension` if it was found.
  ///
  /// This is intended for dynamic unloading of extensions after calling `start`.
  async unloadExtension(extension: LlxprtExtension) {
    const index = this.extensions.indexOf(extension);
    if (index === -1) return;
    this.extensions.splice(index, 1);
    this.config?.setExtensions(this.getExtensions());
    await this.maybeStopExtension(extension);
  }
}
