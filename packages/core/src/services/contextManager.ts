/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  loadGlobalMemory,
  loadEnvironmentMemory,
  loadJitSubdirectoryMemory,
  loadCoreMemory,
  concatenateInstructions,
} from '../utils/memoryDiscovery.js';
import type { Config } from '../config/config.js';
import { coreEvents, CoreEvent } from '../utils/events.js';

export class ContextManager {
  private readonly loadedPaths: Set<string> = new Set();
  private readonly coreMemoryPaths: Set<string> = new Set();
  private globalMemory = '';
  private environmentMemory = '';
  private coreMemory = '';

  constructor(private readonly config: Config) {}

  /**
   * Refreshes the memory by reloading global and environment memory.
   */
  async refresh(): Promise<void> {
    this.loadedPaths.clear();
    this.coreMemoryPaths.clear();
    await this.loadGlobalMemory();
    await this.loadEnvironmentMemory();
    await this.loadCoreMemory();
    this.emitMemoryChanged();
  }

  private async loadGlobalMemory(): Promise<void> {
    const result = await loadGlobalMemory(this.config.getDebugMode());
    this.markAsLoaded(result.files.map((f) => f.path));
    this.globalMemory = concatenateInstructions(
      result.files.map((f) => ({ filePath: f.path, content: f.content })),
      this.config.getWorkingDir(),
    );
  }

  private async loadEnvironmentMemory(): Promise<void> {
    const result = await loadEnvironmentMemory(
      [...this.config.getWorkspaceContext().getDirectories()],
      this.config.getExtensionLoader(),
      this.config.getDebugMode(),
    );
    this.markAsLoaded(result.files.map((f) => f.path));
    const envMemory = concatenateInstructions(
      result.files.map((f) => ({ filePath: f.path, content: f.content })),
      this.config.getWorkingDir(),
    );
    const mcpInstructions =
      this.config.getMcpClientManager()?.getMcpInstructions() || '';
    this.environmentMemory = [envMemory, mcpInstructions.trimStart()]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Loads memory specific to a subdirectory path, returning only the newly loaded content
   * that hasn't already been loaded globally or environmentally.
   */
  async loadJitSubdirectoryMemory(subdirPath: string): Promise<string> {
    const result = await loadJitSubdirectoryMemory(
      subdirPath,
      [...this.config.getWorkspaceContext().getDirectories()],
      this.loadedPaths,
      this.config.getDebugMode(),
    );
    const newFiles = result.files.filter((f) => !this.loadedPaths.has(f.path));
    this.markAsLoaded(newFiles.map((f) => f.path));
    return concatenateInstructions(
      newFiles.map((f) => ({ filePath: f.path, content: f.content })),
      this.config.getWorkingDir(),
    );
  }

  private emitMemoryChanged(): void {
    coreEvents.emit(CoreEvent.MemoryChanged, {
      fileCount: this.getContextFileCount(),
      coreMemoryFileCount: this.getCoreMemoryFileCount(),
    });
  }

  getGlobalMemory(): string {
    return this.globalMemory;
  }

  getEnvironmentMemory(): string {
    return this.environmentMemory;
  }

  private async loadCoreMemory(): Promise<void> {
    const result = await loadCoreMemory(
      [...this.config.getWorkspaceContext().getDirectories()],
      this.config.getDebugMode(),
    );
    const paths = result.files.map((f) => f.path);
    this.markAsLoaded(paths);
    for (const p of paths) {
      this.coreMemoryPaths.add(p);
    }
    this.coreMemory = concatenateInstructions(
      result.files.map((f) => ({ filePath: f.path, content: f.content })),
      this.config.getWorkingDir(),
    );
  }

  getCoreMemory(): string {
    return this.coreMemory;
  }

  getContextFileCount(): number {
    return this.loadedPaths.size - this.coreMemoryPaths.size;
  }

  getCoreMemoryFileCount(): number {
    return this.coreMemoryPaths.size;
  }

  private markAsLoaded(paths: string[]): void {
    for (const path of paths) {
      this.loadedPaths.add(path);
    }
  }

  getLoadedPaths(): ReadonlySet<string> {
    return this.loadedPaths;
  }
}
