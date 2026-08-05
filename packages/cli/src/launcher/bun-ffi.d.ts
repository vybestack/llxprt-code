/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal ambient typing for the `bun:ffi` built-in module.
 *
 * The full `bun-types/ffi.d.ts` declaration is NOT auto-included by
 * `packages/cli/tsconfig.json` (only `bun-types/test` is in the `types`
 * array), so a plain `import('bun:ffi')` fails to typecheck even though the
 * module is available at runtime under Bun. This file declares only the
 * surface used by `process-memory-hardening.ts`.
 *
 * `FFIType` is a real Bun numeric enum; the members below use the true Bun
 * ordinals (see `bun-types/ffi.d.ts`). Only the members this module consumes
 * are declared.
 */
declare module 'bun:ffi' {
  enum FFIType {
    /** 32-bit signed integer (Bun ordinal 5). */
    i32 = 5,
    /** 64-bit unsigned integer (Bun ordinal 8). */
    u64 = 8,
  }

  interface FFIFunctionDefinition {
    readonly args: readonly FFIType[];
    readonly returns: FFIType;
  }

  type FFISymbol = (...args: number[]) => number;

  interface Library {
    readonly symbols: Readonly<Record<string, FFISymbol>>;
  }

  function dlopen(
    name: string,
    definitions: Readonly<Record<string, FFIFunctionDefinition>>,
  ): Library;
}
