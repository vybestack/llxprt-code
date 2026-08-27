/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from 'node:events';
import type { Config, LlxprtExtension } from '../config/config.js';

export type { LlxprtExtension } from '../config/config.js';

export abstract class ExtensionLoader {
  // Assigned in `start`.
  protected config: Config | undefined;

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

  constructor(private readonly eventEmitter?: EventEmitter<ExtensionEvents>) {}

  /**
   * All currently known extensions, both active and inactive.
   */
  abstract getExtensions(): LlxprtExtension[];

  /**
   * Fully initializes all active extensions.
   *
   * Called within `Config.initialize`, which must already have an
   * McpClientManager, PromptRegistry, and ChatSession set up.
   */
  async start(config: Config): Promise<void> {
    this.isStarting = true;
    try {
      if (!this.config) {
        this.config = config;
      } else {
        throw new Error('Already started, you may only call `start` once.');
      }
      await Promise.all(
        this.getExtensions()
          .filter((e) => e.isActive)
          .map(this.startExtension.bind(this)),
      );
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
    this.startingCount++;
    this.eventEmitter?.emit('extensionsStarting', {
      total: this.startingCount,
      completed: this.startCompletedCount,
    });
    try {
      // Before the await: loadExtension/unloadExtension have already mutated
      // the collection discoverSkills reads, so if the MCP transition rejects
      // the skill surface is stale and still needs reconciling.
      this.markSkillsDirty(extension);
      await this.config.getMcpClientManager()!.startExtension(extension);
      await this.maybeRefreshAgentTools(extension);
      // Register extension subagents
      if (
        Array.isArray(extension.subagents) &&
        extension.subagents.length > 0
      ) {
        const subagentMgr = this.config.getSubagentManager();
        if (subagentMgr != null) {
          subagentMgr.registerExtensionSubagents(
            extension.name,
            extension.subagents,
          );
        }
      }
      // Note: Context files are loaded only once all extensions are done
      // loading/unloading to reduce churn, see the `maybeRefreshMemory` call
      // below.
      // Follow-up (#1569): Move all extension features here, including at least:
      // - custom command loading
    } finally {
      this.startCompletedCount++;
      this.eventEmitter?.emit('extensionsStarting', {
        total: this.startingCount,
        completed: this.startCompletedCount,
      });
      if (this.startingCount === this.startCompletedCount) {
        this.startingCount = 0;
        this.startCompletedCount = 0;
      }
      await this.maybeRefreshMemory();
      await this.maybeRefreshSkills();
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
      const agentClient = this.config?.getAgentClient();
      if (agentClient?.isInitialized() === true) {
        await agentClient.setTools();
      }
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
   * Skipped during the initial `start()`: `Config.initialize` runs
   * `discoverSkills` immediately after `start()` returns, so anything done here
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
      await this.config.refreshSkills();
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
      await this.config.refreshMemory();
      await this.config.getHookSystem()?.initialize();
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
    this.stoppingCount++;
    this.eventEmitter?.emit('extensionsStopping', {
      total: this.stoppingCount,
      completed: this.stopCompletedCount,
    });

    try {
      // See startExtension: mark before the await so a rejected transition
      // does not leave the skill surface stale.
      this.markSkillsDirty(extension);
      await this.config.getMcpClientManager()!.stopExtension(extension);
      await this.maybeRefreshAgentTools(extension);
      // Remove extension subagents
      const subagentMgr = this.config.getSubagentManager();
      if (subagentMgr) {
        subagentMgr.removeExtensionSubagents(extension.name);
      }
      // Note: Context files are loaded only once all extensions are done
      // loading/unloading to reduce churn, see the `maybeRefreshMemory` call
      // below.
      // Follow-up (#1569): Remove all extension features here, including at least:
      // - custom commands
    } finally {
      this.stopCompletedCount++;
      this.eventEmitter?.emit('extensionsStopping', {
        total: this.stoppingCount,
        completed: this.stopCompletedCount,
      });
      if (this.stoppingCount === this.stopCompletedCount) {
        this.stoppingCount = 0;
        this.stopCompletedCount = 0;
      }
      await this.maybeRefreshMemory();
      await this.maybeRefreshSkills();
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
    eventEmitter?: EventEmitter<ExtensionEvents>,
  ) {
    super(eventEmitter);
  }

  getExtensions(): LlxprtExtension[] {
    return this.extensions;
  }

  /// Adds `extension` to the list of extensions and calls
  /// `maybeStartExtension`.
  ///
  /// This is intended for dynamic loading of extensions after calling `start`.
  async loadExtension(extension: LlxprtExtension) {
    this.extensions.push(extension);
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
    await this.maybeStopExtension(extension);
  }
}
