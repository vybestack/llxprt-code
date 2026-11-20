/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The part of `bun:ffi` that `flushRecords` uses. `bun-types` is not loaded
 * for this package (only its test declarations are), so the module has no type
 * otherwise. The declaration names the FFI types as strings and uses a function
 * overload, so it merges with the other minimal declarations of this module in
 * the repo instead of clashing with them.
 */
declare module 'bun:ffi' {
  interface FcntlDefinition {
    readonly args: readonly ['i32', 'i32', 'i32'];
    readonly returns: 'i32';
  }

  function dlopen(
    name: string,
    definitions: { readonly fcntl: FcntlDefinition },
  ): {
    readonly symbols: {
      readonly fcntl: (fd: number, command: number, argument: number) => number;
    };
  };
}
