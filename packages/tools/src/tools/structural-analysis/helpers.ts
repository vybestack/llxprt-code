/**
 * Shared AST helper functions for the structural-analysis tool sub-modules.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import { promises as fs } from 'node:fs';
import FastGlob from 'fast-glob';
import type { SgNode } from '@ast-grep/napi';
import { parse, LANGUAGE_MAP, type Lang } from '../../utils/ast-grep-utils.js';
import { statFileSizeGate } from '../../utils/fileUtils.js';
import type { ParseOmissionReason, ParsedFile, ResolvedLang } from './types.js';

/**
 * Bounded discriminated parse outcome for a single candidate file.
 *
 * - `{ ok: true, root, content }` — file parsed successfully.
 * - `{ ok: false, reason }` — file was NOT parsed. `reason` distinguishes the
 *   three omission kinds so each mode can count them and mark its result
 *   inexact (a lower bound), and so oversized sources are never materialized.
 */
export type ParseOutcome =
  | ({ ok: true } & ParsedFile)
  | { ok: false; reason: ParseOmissionReason };

/**
 * Classify a thrown error during readFile/parse as a read error vs a parse
 * error. Node filesystem errors carry an errno `code` (e.g. EACCES, EISDIR,
 * ENOENT); AST parse errors throw plain Errors without one.
 */
function classifyReadOrParseError(err: unknown): ParseOmissionReason {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? 'read-error' : 'parse-error';
}

const SPECIAL_REGEX_CHARS = new Set([
  '.',
  '*',
  '+',
  '?',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\',
]);

/**
 * Escapes special regex characters in a string so it can be used as a literal
 * in a RegExp. Uses character-by-character scanning to avoid a complex
 * character-class regex.
 */
export function escapeRegex(s: string): string {
  let result = '';
  for (const ch of s) {
    if (SPECIAL_REGEX_CHARS.has(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Returns the list of file extensions associated with the given language.
 */
export function getExtensionsForLanguage(lang: string | Lang): string[] {
  const exts: string[] = [];
  for (const [ext, mapped] of Object.entries(LANGUAGE_MAP)) {
    if (mapped === lang) exts.push(ext);
  }
  return exts.length > 0 ? exts : ['*'];
}

/**
 * Collects all files under `searchPath` that match the given language.
 * If `searchPath` is a single file, returns just that file.
 *
 * Kept for callers that still need the full materialized list (reverse-import
 * discovery resolves against the whole workspace). Bounded traversal modes use
 * {@link iterateFiles} instead so FastGlob never returns an unbounded array
 * before slicing.
 */
export async function getFiles(
  searchPath: string,
  lang: string | Lang,
): Promise<string[]> {
  const stat = await fs.stat(searchPath).catch(() => null);
  if (stat !== null && stat.isFile() === true) {
    return [searchPath];
  }
  const extensions = getExtensionsForLanguage(lang);
  return FastGlob(
    extensions.map((ext) => `**/*.${ext}`),
    {
      cwd: searchPath,
      absolute: true,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    },
  );
}

/**
 * Lazily yields files under `searchPath` matching `lang` using FastGlob's
 * streaming API, so discovery is bounded at the source rather than collecting
 * an unbounded path array before slicing. Honours the abort signal so a
 * traversal can stop mid-discovery.
 */
export async function* iterateFiles(
  searchPath: string,
  lang: string | Lang,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const stat = await fs.stat(searchPath).catch(() => null);
  if (stat !== null && stat.isFile() === true) {
    yield searchPath;
    return;
  }
  const extensions = getExtensionsForLanguage(lang);
  const stream = FastGlob.stream(
    extensions.map((ext) => `**/*.${ext}`),
    {
      cwd: searchPath,
      absolute: true,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    },
  );
  for await (const entry of stream) {
    if (signal.aborted) return;
    yield String(entry);
  }
}

/**
 * Parses a file and returns a bounded discriminated outcome. An oversized
 * source (over the shared pre-read size gate) is never read or materialized;
 * read, stat, and parse failures carry their reason so callers can count
 * omissions and mark the result inexact.
 */
export async function parseFile(
  filePath: string,
  lang: string | Lang,
): Promise<ParseOutcome> {
  try {
    const sizeError = await statFileSizeGate(filePath);
    if (sizeError !== null) {
      return { ok: false, reason: 'oversized' };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    const result = parse(lang as Lang, content);
    return { ok: true, root: result.root(), content };
  } catch (err) {
    return { ok: false, reason: classifyReadOrParseError(err) };
  }
}

/**
 * AST node kinds that represent function-like containers.
 * Used for callers mode to find the scope a call lives in.
 */
const FUNCTION_CONTAINER_KINDS = new Set([
  'method_definition',
  'function_declaration',
  'generator_function_declaration',
  'arrow_function',
  'function_expression',
  'generator_function',
]);

export function isFunctionContainerKind(kind: string): boolean {
  return FUNCTION_CONTAINER_KINDS.has(kind);
}

/**
 * Extract a name from a function-like container node.
 * - method_definition: first property_identifier child
 * - function_declaration/generator_function_declaration: first identifier child
 * - arrow_function/function_expression/generator_function: name from parent
 *   variable_declarator's identifier
 */
export function getContainerName(node: SgNode): string | null {
  const kind = String(node.kind());

  if (kind === 'method_definition') {
    const nameNode = node
      .children()
      .find((c: SgNode) => String(c.kind()) === 'property_identifier');
    return nameNode?.text() ?? null;
  }

  if (
    kind === 'function_declaration' ||
    kind === 'generator_function_declaration'
  ) {
    const nameNode = node
      .children()
      .find((c: SgNode) => String(c.kind()) === 'identifier');
    return nameNode?.text() ?? null;
  }

  if (
    kind === 'arrow_function' ||
    kind === 'function_expression' ||
    kind === 'generator_function'
  ) {
    const parent = node.parent();
    if (parent && String(parent.kind()) === 'variable_declarator') {
      const nameNode = parent
        .children()
        .find((c: SgNode) => String(c.kind()) === 'identifier');
      return nameNode?.text() ?? null;
    }
    return null;
  }

  return null;
}

/**
 * Walks up the AST from `node` to find the nearest function-like container.
 */
export function findFunctionContainer(node: SgNode): SgNode | null {
  let container: SgNode | null = node.parent();
  while (container && !isFunctionContainerKind(String(container.kind()))) {
    container = container.parent();
  }
  return container;
}

/**
 * Returns a trimmed snippet of text representing the calling context of a node.
 */
export function getViaContext(callNode: SgNode): string {
  let node: SgNode = callNode;
  let parentNode = node.parent();
  while (parentNode) {
    const parentKind = String(parentNode.kind());
    if (
      parentKind.includes('statement') ||
      isFunctionContainerKind(parentKind)
    ) {
      break;
    }
    node = parentNode;
    parentNode = node.parent();
  }
  return node.text().trim().substring(0, 200);
}

/**
 * Extracts the function/method name from a call_expression node.
 * Handles: `foo()` → "foo", `obj.bar()` → "bar", `a.b.c()` → "c"
 */
export function extractCalleeName(callNode: SgNode): string | null {
  const children = callNode.children();
  if (children.length === 0) return null;
  const callee = children[0];
  const kind = String(callee.kind());
  if (kind === 'identifier') {
    return callee.text();
  }
  if (kind === 'member_expression') {
    const props = callee
      .children()
      .filter((c: SgNode) => String(c.kind()) === 'property_identifier');
    if (props.length > 0) {
      return props[props.length - 1].text();
    }
  }
  return null;
}

/**
 * Given a set of call-expression matches, returns only the outermost
 * (non-nested) ranges, sorted by start position.
 */
export function deduplicateCallRanges(
  callMatches: SgNode[],
): Array<{ node: SgNode; start: number; end: number }> {
  const ranges = callMatches.map((c: SgNode) => ({
    node: c,
    start: c.range().start.index,
    end: c.range().end.index,
  }));
  ranges.sort(
    (a: { start: number; end: number }, b: { start: number; end: number }) =>
      a.start - b.start !== 0 ? a.start - b.start : b.end - a.end,
  );

  const outermost: typeof ranges = [];
  for (const r of ranges) {
    const isContained = outermost.some(
      (o: { start: number; end: number }) =>
        r.start >= o.start && r.end <= o.end,
    );
    if (!isContained) outermost.push(r);
  }
  return outermost;
}

/**
 * Makes a path relative to the workspace root, re-exported for convenience.
 */
export { makeRelative } from '../../utils/paths.js';

export type { ResolvedLang, ParsedFile, ParseOmissionReason };
