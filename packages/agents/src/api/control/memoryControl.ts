/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02
 *
 * AgentMemoryControl implementation. Delegates to the bound Config's memory
 * surface so clients access runtime memory without a Config escape hatch.
 */

import { EventEmitter } from 'node:events';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  AgentMemoryControl,
  MemoryChangedEvent,
  MemoryRefreshResult,
  Unsubscribe,
} from '../agent.js';
import { createControlError } from './errorUtils.js';

/**
 * Deps bundle injected by AgentImpl so MemoryControl can read/write the live
 * Config memory surface.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02
 */
export interface MemoryControlDeps {
  readonly config: Config;
}

export class MemoryControl implements AgentMemoryControl {
  private readonly emitter = new EventEmitter();
  private disposed = false;

  constructor(private readonly deps: MemoryControlDeps) {}

  dispose(): void {
    this.disposed = true;
    this.emitter.removeAllListeners('memory-changed');
  }

  getMemory(): string {
    return this.deps.config.getUserMemory();
  }

  setMemory(content: string): void {
    try {
      this.deps.config.setUserMemory(content);
    } catch (err) {
      throw createControlError('Failed to update memory', err);
    }
    this.emitMemoryChangedBestEffort();
  }

  getFileCount(): number {
    return this.deps.config.getLlxprtMdFileCount();
  }

  getFilePaths(): readonly string[] {
    return [...this.deps.config.getLlxprtMdFilePaths()];
  }

  getCoreMemory(): string | undefined {
    return this.deps.config.getCoreMemory();
  }

  getCoreFileCount(): number {
    return this.deps.config.getCoreMemoryFileCount();
  }

  setCoreMemory(content: string): void {
    try {
      this.deps.config.setCoreMemory(content);
    } catch (err) {
      throw createControlError('Failed to update core memory', err);
    }
    this.emitMemoryChangedBestEffort();
  }

  async refresh(): Promise<MemoryRefreshResult> {
    let result: Awaited<ReturnType<Config['refreshMemory']>>;
    try {
      result = await this.deps.config.refreshMemory();
    } catch (err) {
      throw createControlError('Failed to refresh memory', err);
    }
    this.emitMemoryChangedBestEffort(
      this.buildMemoryChangedEvent(result.fileCount),
    );
    return {
      memoryContent: result.memoryContent,
      fileCount: result.fileCount,
      filePaths: [...result.filePaths],
    };
  }

  onMemoryChanged(cb: (event: MemoryChangedEvent) => void): Unsubscribe {
    if (this.disposed) {
      return () => undefined;
    }
    this.emitter.on('memory-changed', cb);
    return () => {
      this.emitter.off('memory-changed', cb);
    };
  }

  private emitMemoryChangedBestEffort(event?: MemoryChangedEvent): void {
    if (this.disposed) {
      return;
    }
    try {
      this.emitter.emit('memory-changed', event ?? this.currentMemoryEvent());
    } catch {
      // Memory operation already succeeded; listener failures must not mask it.
    }
  }

  private currentMemoryEvent(): MemoryChangedEvent {
    return this.buildMemoryChangedEvent(
      this.deps.config.getLlxprtMdFileCount(),
    );
  }

  private buildMemoryChangedEvent(fileCount: number): MemoryChangedEvent {
    try {
      return {
        fileCount,
        coreMemoryFileCount: this.deps.config.getCoreMemoryFileCount(),
      };
    } catch {
      return { fileCount };
    }
  }
}
