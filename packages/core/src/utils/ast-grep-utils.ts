/**
 * Shared AST-grep utilities for all tools that use @ast-grep/napi.
 * Single source of truth for language mapping, parsing, and error normalization.
 *
 * @plan PLAN-20260211-ASTGREP.P03
 */

import {
  parse,
  Lang,
  findInFiles,
  registerDynamicLanguage,
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

function ensureDynamicLanguages(): void {
  if (dynamicLanguagesRegistered) return;
  registerDynamicLanguage({
    python,
    go,
    rust,
    java,
    cpp,
    c,
    json,
    ruby,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- Required for ast-grep dynamic language registration (third-party API limitation)
  dynamicLanguagesRegistered = true;
}

// Register on module load
ensureDynamicLanguages();

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
  const byExt = LANGUAGE_MAP[extOrName];
  if (byExt !== undefined) return byExt;

  // Try full name (case-insensitive)
  const lower = extOrName.toLowerCase();
  const byName = LANGUAGE_NAME_MAP[lower];
  if (byName !== undefined) return byName;

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
 * Check if @ast-grep/napi is available and usable.
 */
export function isAstGrepAvailable(): boolean {
  try {
    // If we got this far, the import succeeded
    return typeof parse === 'function' && typeof findInFiles === 'function';
  } catch {
    return false;
  }
}

/**
 * Parse source code with error normalization.
 * Returns { root } on success or { error } on failure.
 * Does not throw.
 */
export function parseSource(
  language: string | Lang,
  content: string,
): { root: ReturnType<typeof parse> } | { error: string } {
  try {
    ensureDynamicLanguages();
    const result = parse(language as Lang, content);
    return { root: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to parse source: ${message}` };
  }
}

// Re-export ast-grep APIs for convenience
export { parse, Lang, findInFiles } from '@ast-grep/napi';
