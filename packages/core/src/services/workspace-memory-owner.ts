/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ContextManager } from './contextManager.js';
export type {
  InstructionSnapshot,
  InstructionReadOperations,
  WorkspaceMemoryOperations,
  WorkspaceMemoryInputs,
} from './contextManager.js';

export class WorkspaceMemoryOwner extends ContextManager {}
