/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  InstructionReadOperations,
  WorkspaceMemoryOwner,
} from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentMemoryControl } from '../api/agent.js';
import { SessionInstructionOwner } from './session-instruction-owner.js';

export class SessionInstructionBinding {
  private owner: SessionInstructionOwner | undefined;
  private inherited: InstructionReadOperations | undefined;
  private workspace: WorkspaceMemoryOwner | undefined;

  readonly reads: InstructionReadOperations = {
    snapshot: () => this.requireReads().snapshot(),
    jit: (path) => this.requireReads().jit(path),
  };

  get memory(): AgentMemoryControl {
    if (this.owner === undefined)
      throw new Error('Session memory requires workspace composition');
    return this.owner.memory;
  }

  bindInherited(reads: InstructionReadOperations): void {
    if (this.owner !== undefined || this.inherited !== undefined)
      throw new Error('Session instructions are already composed');
    this.inherited = reads;
  }

  bindWorkspace(
    workspace: WorkspaceMemoryOwner,
    config: Pick<Config, 'getProvidedInstructions' | 'isJitContextEnabled'>,
    publish: (instructions: InstructionReadOperations) => Promise<void>,
  ): void {
    if (this.inherited !== undefined)
      throw new Error('Inherited session instructions cannot be rebound');
    if (this.owner !== undefined) {
      if (this.workspace !== workspace)
        throw new Error('Session instruction workspace must retain its owner');
      return;
    }
    this.workspace = workspace;
    this.owner = new SessionInstructionOwner(
      workspace.operations,
      config.getProvidedInstructions(),
      config.isJitContextEnabled(),
      publish,
    );
  }

  dispose(): Promise<void> | undefined {
    return this.owner?.dispose();
  }

  private requireReads(): InstructionReadOperations {
    const reads = this.owner?.reads ?? this.inherited;
    if (reads === undefined)
      throw new Error(
        'Session instructions require explicit workspace composition',
      );
    return reads;
  }
}
