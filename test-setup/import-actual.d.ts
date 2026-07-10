/**
 * Ambient module declaration for Bun mock-bypass query-param imports.
 *
 * At runtime, `import('./path?__importActual')` returns the REAL module
 * even when `mock.module('./path')` is active, because Bun treats
 * specifiers with different query strings as distinct modules.
 *
 * TypeScript cannot resolve the query param, so this declaration provides
 * a minimal resolvable shape. Type safety at each call site is maintained
 * via `as typeof import('./path')` type assertions, which give the
 * query-param import the same type as the real module.
 */
declare module '*?__importActual' {
  export {};
}
