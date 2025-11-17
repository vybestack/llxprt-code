/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250214-AUTOCOMPLETE.P03
 * @requirement:REQ-001
 * @pseudocode ArgumentSchema.md lines 1-6
 * - Line 1: LiteralArgument structure (value, description, next)
 * - Line 2: ValueArgument structure (name, description, options, completer, hint, next)
 * - Line 3: Option structure definition
 * - Line 4: CompleterFn signature
 * - Line 5: HintFn signature
 * - Line 6: Union CommandArgumentSchema type
 */

import { CommandContext } from '../types.js';

// Line 1: LiteralArgument structure
export interface LiteralArgument {
  readonly kind: 'literal';
  readonly value: string;
  readonly description?: string;
  readonly next?: CommandArgumentSchema;
  readonly stopPropagation?: boolean;
}

// Line 3: Option structure definition
export interface Option {
  readonly value: string;
  readonly description?: string;
}

// Line 4: CompleterFn signature
export type CompleterFn = (
  ctx: CommandContext,
  partial: string,
  tokens: TokenInfo,
) => Promise<readonly Option[]>;

// Line 5: HintFn signature
export type HintFn = (
  ctx: CommandContext,
  tokens: TokenInfo,
) => Promise<string>;

// Line 2: ValueArgument structure
export interface ValueArgument {
  readonly kind: 'value';
  readonly name: string;
  readonly description?: string;
  readonly options?: readonly Option[];
  readonly completer?: CompleterFn;
  readonly hint?: HintFn | string;
  readonly next?: CommandArgumentSchema;
}

// Line 6: Union CommandArgumentSchema type
export type CommandArgumentSchema = ReadonlyArray<
  LiteralArgument | ValueArgument
>;

// Additional types needed for token processing
export interface TokenInfo {
  readonly tokens: readonly string[];
  readonly partialToken: string;
  readonly hasTrailingSpace: boolean;
  readonly position: number;
}

export interface ResolvedContext {
  readonly activeNode: LiteralArgument | ValueArgument | null;
  readonly position: number;
  readonly consumedValues: readonly string[];
  readonly isValid: boolean;
}

export interface CompletionResult {
  readonly suggestions: readonly Option[];
  readonly hint: string;
  readonly position: number;
}

/**
 * @plan:PLAN-20250214-AUTOCOMPLETE.P03a
 * @requirement:REQ-001
 * Verification: `npm run typecheck` (2025-02-15) confirmed schema stubs compile; not invoked before Phase 04.
 */
