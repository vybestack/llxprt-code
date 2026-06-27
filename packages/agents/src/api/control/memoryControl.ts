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

  constructor(private readonly deps: MemoryControlDeps) {}

  getMemory(): string {
    return this.deps.config.getUserMemory();
  }

  setMemory(content: string): void {
    this.deps.config.setUserMemory(content);
    this.emitLocalMemoryChanged();
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
    this.deps.config.setCoreMemory(content);
    this.emitLocalMemoryChanged();
  }

  async refresh(): Promise<MemoryRefreshResult> {
    try {
      const result = await this.deps.config.refreshMemory();
      this.emitLocalMemoryChanged({
        fileCount: result.fileCount,
        coreMemoryFileCount: this.deps.config.getCoreMemoryFileCount(),
      });
      return {
        memoryContent: result.memoryContent,
        fileCount: result.fileCount,
        filePaths: [...result.filePaths],
      };
    } catch (err) {
      throw createControlError('Failed to refresh memory', err);
    }
  }

  onMemoryChanged(cb: (event: MemoryChangedEvent) => void): Unsubscribe {
    this.emitter.on('memory-changed', cb);
    return () => {
      this.emitter.off('memory-changed', cb);
    };
  }

  private emitLocalMemoryChanged(event?: MemoryChangedEvent): void {
    this.emitter.emit('memory-changed', event ?? this.currentMemoryEvent());
  }

  private currentMemoryEvent(): MemoryChangedEvent {
    return {
      fileCount: this.deps.config.getLlxprtMdFileCount(),
      coreMemoryFileCount: this.deps.config.getCoreMemoryFileCount(),
    };
  }
}
