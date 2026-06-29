/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for what the runtime needs from a provider.
 *
 * This is NOT a provider API compatibility type — it describes only the surface
 * that core runtime consumes. Provider implementations are structurally compatible
 * with this contract without importing it.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-01, lines 10-15
 */

import type { IContent } from '../../services/history/IContent.js';
import type { RuntimeModel } from './RuntimeModel.js';
import type {
  RuntimeGenerateChatOptions,
  RuntimeProviderToolset,
} from './RuntimeProviderChat.js';

/**
 * Minimal set of tool declaration shapes that core runtime passes through.
 */
export interface RuntimeToolDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: unknown;
}

export interface RuntimeToolset {
  functionDeclarations: RuntimeToolDeclaration[];
}

/**
 * Core-owned structural provider contract.
 *
 * Covers only what core runtime consumes: name, model queries, and
 * chat completion generation. Provider implementations satisfy this
 * contract through structural typing — they do not import or extend it.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-06, lines 60-63
 */
export interface RuntimeProvider {
  readonly name: string;
  readonly isDefault?: boolean;

  getCurrentModel?(): string;
  getDefaultModel?(): string;
  getModels(): Promise<RuntimeModel[]>;
  setModel?(model: string): void | Promise<void>;
  getToolFormat?(): string;
  isPaidMode?(): boolean;
  getModelParams?(): Record<string, unknown> | undefined;
  clearAuthCache?(): void;
  clearAuth?(): void;

  setCompressionCallback?(
    callback: ((contents: IContent[]) => Promise<IContent[]>) | null,
  ): void;

  getServerTools(): string[];
  invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;

  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: IContent[],
    tools?: RuntimeProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent>;
}
