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
  concatenateInstructions,
} from '../utils/memoryDiscovery.js';
import type { Config } from '../config/config.js';
import { coreEvents, CoreEvent } from '../utils/events.js';

export class ContextManager {
  private readonly loadedPaths: Set<string> = new Set();
  private globalMemory = '';
  private environmentMemory = '';

  constructor(private readonly config: Config) {}

  /**
   * Refreshes the memory by reloading global and environment memory.
   */
  async refresh(): Promise<void> {
    this.loadedPaths.clear();
    await this.loadGlobalMemory();
    await this.loadEnvironmentMemory();
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
      fileCount: this.loadedPaths.size,
    });
  }

  getGlobalMemory(): string {
    return this.globalMemory;
  }

  getEnvironmentMemory(): string {
    return this.environmentMemory;
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
