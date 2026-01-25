/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from 'node:events';
import type { Config, GeminiCLIExtension } from '../config/config.js';

export type { GeminiCLIExtension } from '../config/config.js';

type ExtensionMcpClientManager = {
  startExtension: (extension: GeminiCLIExtension) => Promise<void>;
  stopExtension: (extension: GeminiCLIExtension) => Promise<void>;
};

const isExtensionMcpClientManager = (
  manager: unknown,
): manager is ExtensionMcpClientManager => {
  if (!manager || typeof manager !== 'object') {
    return false;
  }
  const startExtension = Reflect.get(manager, 'startExtension');
  const stopExtension = Reflect.get(manager, 'stopExtension');
  return (
    typeof startExtension === 'function' && typeof stopExtension === 'function'
  );
};

const getExtensionMcpClientManager = (
  config: Config,
): ExtensionMcpClientManager | undefined => {
  if (!('getMcpClientManager' in config)) {
    return;
  }
  const getter = Reflect.get(config, 'getMcpClientManager');
  if (typeof getter !== 'function') {
    return;
  }
  const manager = getter.call(config);
  if (!isExtensionMcpClientManager(manager)) {
    return;
  }
  return manager;
};

const isExtensionReloadingEnabled = (config: Config): boolean => {
  const reloadGetter = Reflect.get(config, 'getEnableExtensionReloading');
  if (typeof reloadGetter === 'function') {
    return Boolean(reloadGetter.call(config));
  }
  return config.getExtensionManagement();
};

export abstract class ExtensionLoader {
  // Assigned in `start`.
  protected config: Config | undefined;

  // Used to track the count of currently starting and stopping extensions and
  // fire appropriate events.
  protected startingCount: number = 0;
  protected startCompletedCount: number = 0;
  protected stoppingCount: number = 0;
  protected stopCompletedCount: number = 0;

  constructor(private readonly eventEmitter?: EventEmitter<ExtensionEvents>) {}

  /**
   * All currently known extensions, both active and inactive.
   */
  abstract getExtensions(): GeminiCLIExtension[];

  /**
   * Fully initializes all active extensions.
   *
   * Called within `Config.initialize`, which must already have an
   * McpClientManager, PromptRegistry, and GeminiChat set up.
   */
  async start(config: Config): Promise<void> {
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
  protected async startExtension(extension: GeminiCLIExtension) {
    if (!this.config) {
      throw new Error('Cannot call `startExtension` prior to calling `start`.');
    }
    this.startingCount++;
    this.eventEmitter?.emit('extensionsStarting', {
      total: this.startingCount,
      completed: this.startCompletedCount,
    });
    try {
      const manager = getExtensionMcpClientManager(this.config);
      if (manager) {
        await manager.startExtension(extension);
      }
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
    }
  }

  /**
   * If extension reloading is enabled and `start` has already been called,
   * then calls `startExtension` to include all extension features into the
   * program.
   */
  protected maybeStartExtension(
    extension: GeminiCLIExtension,
  ): Promise<void> | undefined {
    if (this.config && isExtensionReloadingEnabled(this.config)) {
      return this.startExtension(extension);
    }
    return;
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
  protected async stopExtension(extension: GeminiCLIExtension) {
    if (!this.config) {
      throw new Error('Cannot call `stopExtension` prior to calling `start`.');
    }
    this.stoppingCount++;
    this.eventEmitter?.emit('extensionsStopping', {
      total: this.stoppingCount,
      completed: this.stopCompletedCount,
    });

    try {
      const manager = getExtensionMcpClientManager(this.config);
      if (manager) {
        await manager.stopExtension(extension);
      }
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
    }
  }

  /**
   * If extension reloading is enabled and `start` has already been called,
   * then this also performs all necessary steps to remove all extension
   * features from the rest of the system.
   */
  protected maybeStopExtension(
    extension: GeminiCLIExtension,
  ): Promise<void> | undefined {
    if (this.config && isExtensionReloadingEnabled(this.config)) {
      return this.stopExtension(extension);
    }
    return;
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
    protected readonly extensions: GeminiCLIExtension[],
    eventEmitter?: EventEmitter<ExtensionEvents>,
  ) {
    super(eventEmitter);
  }

  getExtensions(): GeminiCLIExtension[] {
    return this.extensions;
  }

  async loadExtension(extension: GeminiCLIExtension) {
    this.extensions.push(extension);
    await this.maybeStartExtension(extension);
  }

  async unloadExtension(extension: GeminiCLIExtension) {
    const index = this.extensions.indexOf(extension);
    if (index === -1) {
      return;
    }
    this.extensions.splice(index, 1);
    await this.maybeStopExtension(extension);
  }
}
