/**
 * Ambient module declaration for Bun mock-bypass query-param imports.
 *
 * At runtime, `import('./path?__importActual')` returns the REAL module
 * even when `mock.module('./path')` is active, because Bun treats
 * specifiers with different query strings as distinct modules.
 * TypeScript cannot resolve the query param, so this declaration lets
 * `tsc --noEmit` accept these imports without error.
 */
declare module '*?__importActual' {
  const mod: any;
  export = mod;
}
