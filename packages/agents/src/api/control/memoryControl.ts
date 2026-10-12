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

import type { AgentMemoryControl } from '../agent.js';

export class MemoryControl implements AgentMemoryControl {
  constructor(private readonly operations: AgentMemoryControl) {}
  getMemory = (): string => this.operations.getMemory();
  setMemory = (content: string): void => this.operations.setMemory(content);
  getCoreMemory = (): string | undefined => this.operations.getCoreMemory();
  setCoreMemory = (content: string): void =>
    this.operations.setCoreMemory(content);
  getFileCount = (): number => this.operations.getFileCount();
  getCoreFileCount = (): number => this.operations.getCoreFileCount();
  getFilePaths = (): readonly string[] => this.operations.getFilePaths();
  refresh = (): ReturnType<AgentMemoryControl['refresh']> =>
    this.operations.refresh();
  onMemoryChanged = (
    listener: Parameters<AgentMemoryControl['onMemoryChanged']>[0],
  ): (() => void) => this.operations.onMemoryChanged(listener);
}
