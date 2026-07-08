/**
 * Shared AST-grep utilities for all tools that use @ast-grep/napi.
 * Single source of truth for language mapping, parsing, and error normalization.
 *
 * Native grammar addons load LAZILY on first real parse/search use (issue #2399).
 * Importing this module performs no native dlopen, so credential-proxy / startup
 * paths that only need a constant are never forced to load @ast-grep native code.
 * A native load failure (e.g. Windows Smart App Control OS error 4551) degrades
 * gracefully instead of crashing.
 *
 * @plan PLAN-20260211-ASTGREP.P03
 */

import {
  Lang,
  parse as napiParse,
  findInFiles as napiFindInFiles,
  registerDynamicLanguage,
  type DynamicLangRegistrations,
} from '@ast-grep/napi';

import python from '@ast-grep/lang-python';
import go from '@ast-grep/lang-go';
import rust from '@ast-grep/lang-rust';
import java from '@ast-grep/lang-java';
import cpp from '@ast-grep/lang-cpp';
import c from '@ast-grep/lang-c';
import json from '@ast-grep/lang-json';
import ruby from '@ast-grep/lang-ruby';

import * as path from 'node:path';

let dynamicLanguagesRegistered = false;
let dynamicLanguagesAvailable = false;

/**
 * Register the dynamic grammar addons (python, go, rust, ...) on first use.
 *
 * Lazy and fault-tolerant: a native load failure (e.g. Windows Smart App
 * Control blocking the unsigned .node grammar DLLs) is caught and recorded so
 * AST tooling can degrade to "unavailable" instead of panicking the process.
 */
function ensureDynamicLanguages(): void {
  if (dynamicLanguagesRegistered) return;
  try {
    registerDynamicLanguage({
      python,
      go,
      rust,
      java,
      cpp,
      c,
      json,
      ruby,
    } as unknown as DynamicLangRegistrations);
    dynamicLanguagesAvailable = true;
  } catch {
    dynamicLanguagesAvailable = false;
  }
  dynamicLanguagesRegistered = true;
}

/**
 * File extension to ast-grep language mapping.
 * Single source of truth across all AST tools.
 */
export const LANGUAGE_MAP: Record<string, string | Lang> = {
  ts: Lang.TypeScript,
  js: Lang.JavaScript,
  tsx: Lang.Tsx,
  jsx: Lang.Tsx,
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  html: Lang.Html,
  css: Lang.Css,
  json: 'json',
};

/**
 * Reverse mapping from full language names to Lang/string values.
 */
const LANGUAGE_NAME_MAP: Record<string, string | Lang> = {
  typescript: Lang.TypeScript,
  javascript: Lang.JavaScript,
  tsx: Lang.Tsx,
  jsx: Lang.Tsx,
  python: 'python',
  ruby: 'ruby',
  go: 'go',
  rust: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  html: Lang.Html,
  css: Lang.Css,
  json: 'json',
};

/**
 * File extensions that belong to the JavaScript/TypeScript language family.
 */
export const JAVASCRIPT_FAMILY_EXTENSIONS: readonly string[] = [
  'ts',
  'js',
  'tsx',
  'jsx',
];

/**
 * Resolve a file extension or language name to an ast-grep language.
 * Accepts both extensions ('ts', 'py') and full names ('typescript', 'python').
 * Returns undefined for unrecognized inputs.
 */
export function getAstLanguage(extOrName: string): string | Lang | undefined {
  // Try extension first
  if (extOrName in LANGUAGE_MAP) {
    return LANGUAGE_MAP[extOrName];
  }

  // Try full name (case-insensitive)
  const lower = extOrName.toLowerCase();
  if (lower in LANGUAGE_NAME_MAP) {
    return LANGUAGE_NAME_MAP[lower];
  }

  return undefined;
}

/**
 * Detect the ast-grep language from a file path's extension.
 * Returns undefined if the extension is not recognized.
 */
export function resolveLanguageFromPath(
  filePath: string,
): string | Lang | undefined {
  const ext = path.extname(filePath).slice(1); // remove the dot
  if (!ext) return undefined;
  return LANGUAGE_MAP[ext];
}

/**
 * Languages built into @ast-grep/napi that do NOT require dynamic registration.
 * Dynamic addons (python, go, rust, …) need `registerDynamicLanguage` first.
 */
const BUILTIN_LANG_VALUES = new Set<string | Lang>([
  Lang.TypeScript,
  Lang.JavaScript,
  Lang.Tsx,
  Lang.Html,
  Lang.Css,
]);

function isBuiltinLang(language: string | Lang): boolean {
  return BUILTIN_LANG_VALUES.has(language);
}

/**
 * Check if @ast-grep/napi is available and usable.
 *
 * Reports whether the core napi binding loaded successfully (parse / findInFiles
 * are callable). Does NOT conflate this with dynamic grammar registration:
 * built-in languages (TypeScript, JavaScript, …) work regardless of addon load
 * outcome, so a dynamic registration failure must not hide core capability.
 */
export function isAstGrepAvailable(): boolean {
  try {
    return (
      typeof napiParse === 'function' && typeof napiFindInFiles === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Parse source code with error normalization.
 * Returns { root } on success or { error } on failure.
 * Does not throw. Triggers lazy grammar registration on first call.
 */
export function parseSource(
  language: string | Lang,
  content: string,
): { root: ReturnType<typeof napiParse> } | { error: string } {
  try {
    ensureDynamicLanguages();
    if (!dynamicLanguagesAvailable && !isBuiltinLang(language)) {
      return {
        error:
          'ast-grep dynamic grammars are unavailable (native addon load failed)',
      };
    }
    const result = napiParse(language as Lang, content);
    return { root: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to parse source: ${message}` };
  }
}

/**
 * Wrapped `parse` that ensures dynamic grammars are registered before parsing.
 * Routes through the lazy registration path so direct callers benefit from the
 * same lazy-init + graceful-degradation behavior as `parseSource`.
 *
 * Built-in languages (TypeScript, JavaScript, …) always work; a dynamic
 * language throws a clear error when addon registration failed rather than
 * an opaque napi binding error.
 */
export function parse(
  language: string | Lang,
  content: string,
): ReturnType<typeof napiParse> {
  ensureDynamicLanguages();
  if (!dynamicLanguagesAvailable && !isBuiltinLang(language)) {
    throw new Error(
      'ast-grep dynamic grammars are unavailable (native addon load failed)',
    );
  }
  return napiParse(language as Lang, content);
}

/**
 * Wrapped `findInFiles` that ensures dynamic grammars are registered first.
 *
 * Callers (e.g. cross-file-analyzer.ts) catch errors from findInFiles and
 * degrade to empty results, so a dynamic-language napi error is already
 * handled gracefully. The explicit guard in `parse` / `parseSource` covers
 * the primary parse path where a clearer message is most valuable.
 */
export function findInFiles(
  ...args: Parameters<typeof napiFindInFiles>
): ReturnType<typeof napiFindInFiles> {
  ensureDynamicLanguages();
  return napiFindInFiles(...args);
}

// Re-export the Lang enum directly (enum, no native side effects).
export { Lang } from '@ast-grep/napi';
