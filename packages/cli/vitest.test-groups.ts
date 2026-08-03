/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Private, config-only test-file discovery and routing.
 *
 * Discovers the exact same test-file set as `vitest.config.ts` using an
 * authoritative include/exclude contract, then classifies each file by its
 * **real syntactic runtime imports** (via the TypeScript compiler API) into
 * one of three disjoint routing groups:
 *
 *   - `jsdom`          : files needing a DOM (real jsdom pragma, react-dom,
 *                        @testing-library/react, or @testing-library/dom import)
 *   - `react-ink-node` : files importing react, ink-testing-library, or the
 *                        local test-utils/render helper, but no DOM dependency
 *   - `pure-node`      : everything else (node-safe, base setup only)
 *
 * The classifier inspects actual import/export-from AST nodes — never raw
 * source text — so comments, strings, and type-only imports cannot trigger a
 * false-positive classification. Package root is resolved from
 * `import.meta.url` so classification is cwd-independent.
 */

import fg from 'fast-glob';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

interface Micromatch {
  isMatch(filepath: string, patterns: readonly string[]): boolean;
}

const require = createRequire(import.meta.url);
const micromatch: Micromatch = require('micromatch');

const __dirname = dirname(fileURLToPath(import.meta.url));

const INTEGRATION_EXCLUDE = '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)';

const baseInclude: readonly string[] = [
  '**/*.{test,spec}.?(c|m)[jt]s?(x)',
  'config.test.ts',
];

const explicitIncludePaths: readonly string[] = [
  'src/ui/contexts/KeypressContext.test.tsx',
  'src/ui/contexts/KeypressContext.parsing.test.tsx',
  'src/ui/hooks/useAgentStream.thinking.test.tsx',
  'src/ui/hooks/useAgentStream.ordering.test.tsx',
  'src/ui/hooks/useAgentStream.dedup.test.tsx',
  'src/ui/hooks/useToolScheduler.test.ts',
  'src/ui/components/messages/OAuthUrlMessage.test.tsx',
  'src/ui/hooks/useSlashCompletion.extensions.test.tsx',
  'src/agentStream.test.tsx',
  'src/ui/commands/directoryCommand.test.tsx',
  'src/ui/components/messages/ProfileChangeMessage.test.tsx',
  'src/ui/hooks/useTodoContinuation.spec.ts',
  'src/ui/components/PoliciesDialog.test.tsx',
];

const baseExclude: readonly string[] = [
  '**/node_modules/**',
  // JSP/1 observation producer tests are Bun-native and registered in
  // scripts/bun-test-manifest.ts, so they run under `bun test` only and
  // must not also be discovered by Vitest (issue #2779).
  '**/src/observation/**/*.test.ts',
  // Sandbox SSH agent preflight tests are Bun-native for the same reason
  // (issue #1699).
  '**/src/utils/sandbox-ssh-agent-preflight.test.ts',
  // Sandbox container credential-isolation tests are Bun-native for the same
  // reason (issue #2946).
  '**/src/utils/sandbox-containers.test.ts',
  '**/dist/**',
  '**/tmp/**',
  '**/cypress/**',
  INTEGRATION_EXCLUDE,
  '**/test-utils/**/*.test.tsx',
  '**/ui/App.e2e.test.tsx',
  '**/ui/App.test.tsx',
  '**/ui/App.context.test.tsx',
  '**/ui/App.components.test.tsx',
  '**/ui/App.dialogs.test.tsx',
  '**/ui/App.behavior.test.tsx',
  '**/ui/components/*.test.tsx',
  '**/ui/components/__tests__/*.test.tsx',
  '**/ui/components/__tests__/SessionBrowserDialog*.spec.tsx',
  '**/ui/components/messages/DiffRenderer.test.tsx',
  '**/ui/components/messages/AiMessage.test.tsx',
  '**/ui/components/messages/ToolMessage.test.tsx',
  '**/ui/components/messages/ToolConfirmationMessage.responsive.test.tsx',
  '**/ui/components/messages/ToolConfirmationMessage.test.tsx',
  '**/ui/components/messages/ToolGroupMessage.test.tsx',
  '**/ui/components/messages/ThinkingBlockDisplay.test.tsx',
  '**/ui/components/messages/WarningMessage.test.tsx',
  '**/ui/components/shared/*.test.tsx',
  '**/ui/components/views/*.test.tsx',
  '**/ui/containers/*.test.tsx',
  '**/ui/contexts/SessionContext.test.tsx',
  '**/ui/hooks/useEditorSettings.test.tsx',
  '**/ui/hooks/useReverseSearchCompletion.test.tsx',
  '**/ui/hooks/useAgentStream.integration.test.tsx',
  '**/ui/hooks/useAgentStream.test.tsx',
  '**/ui/hooks/useAgentStream.cancellation.test.tsx',
  '**/ui/hooks/useAgentStream.usercancel.test.tsx',
  '**/ui/hooks/useAgentStream.commands.test.tsx',
  '**/ui/hooks/useAgentStream.approval.test.tsx',
  '**/ui/hooks/useAgentStream.finished.test.tsx',
  '**/ui/hooks/useAgentStream.include.test.tsx',
  '**/ui/hooks/useAgentStream.thought.test.tsx',
  '**/ui/hooks/useAgentStream.loopdetect.test.tsx',
  '**/ui/hooks/useAgentStream.hooks.test.tsx',
  '**/ui/hooks/useAgentStream.mcp.test.tsx',
  '**/ui/hooks/useKeypress.test.tsx',
  '**/ui/hooks/usePermissionsModifyTrust.test.tsx',
  '**/ui/privacy/**/*.test.tsx',
  '**/ui/utils/**/*.test.tsx',
  '**/ui/components/**/*.test.ts',
  '**/ui/hooks/useEditorSettings.test.ts',
  '**/ui/hooks/useReverseSearchCompletion.test.ts',
  '**/ui/hooks/useAgentStream.test.ts',
  '**/ui/hooks/useAgentStream.integration.test.ts',
  '**/ui/hooks/useKeypress.test.ts',
  '**/ui/hooks/usePermissionsModifyTrust.test.ts',
  '**/ui/commands/toolformatCommand.test.ts',
];

function buildExclude(multiRuntime: boolean): readonly string[] {
  if (!multiRuntime) {
    return baseExclude;
  }
  return baseExclude.filter((p) => p !== INTEGRATION_EXCLUDE);
}

/** Authoritative include contract consumed by vitest.config.ts. */
export const INCLUDE_PATTERNS: readonly string[] = [
  ...baseInclude,
  ...explicitIncludePaths,
];

/** Authoritative base exclude contract consumed by vitest.config.ts. */
export const BASE_EXCLUDE_PATTERNS: readonly string[] = baseExclude;

/** Explicit re-include paths that carve out specific excluded files. */
export const EXPLICIT_INCLUDE_PATTERNS: readonly string[] =
  explicitIncludePaths;

/** Package root resolved from import.meta.url — never process.cwd(). */
export const PACKAGE_ROOT: string = __dirname;

/** Base setup file (node-safe). */
const BASE_SETUP = resolve(__dirname, './test-setup-base.ts');
/** Full setup file (React/Ink). */
const FULL_SETUP = resolve(__dirname, './test-setup.ts');

function normalizeToForwardSlash(p: string): string {
  return p.split(sep).join('/');
}

/**
 * Resolve a (possibly relative) module specifier from the importing file's
 * directory, returning the resolved file path on disk. Returns null if the
 * specifier cannot be resolved. Handles TypeScript's `.js` -> `.ts`/`.tsx`
 * extension mapping convention used throughout this codebase.
 */
function resolveModulePath(specifier: string, fromFile: string): string | null {
  const fromDir = dirname(fromFile);
  try {
    const req = createRequire(resolve(fromDir, 'noop.js'));
    return req.resolve(specifier, { paths: [fromDir] });
  } catch {
    // TypeScript convention: `.js` imports may map to `.ts`/`.tsx` source.
    if (specifier.endsWith('.js')) {
      const base = specifier.slice(0, -3);
      for (const ext of ['.tsx', '.ts', '.jsx']) {
        const candidate = resolve(fromDir, base + ext);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }
}

/** Predicates matching runtime DOM dependency module specifiers. */
function isJsdomSpecifier(specifier: string): boolean {
  return (
    specifier === 'react-dom' ||
    specifier.startsWith('react-dom/') ||
    specifier === '@testing-library/react' ||
    specifier.startsWith('@testing-library/react/') ||
    specifier === '@testing-library/dom' ||
    specifier.startsWith('@testing-library/dom/')
  );
}

/** Predicates matching runtime react/ink dependency module specifiers. */
function isReactInkSpecifier(specifier: string): boolean {
  return (
    specifier === 'react' ||
    specifier.startsWith('react/') ||
    specifier === 'ink-testing-library' ||
    specifier.startsWith('ink-testing-library/')
  );
}

/** Check if a resolved path points to the local test-utils/render helper. */
function isLocalRenderHelper(resolvedPath: string | null): boolean {
  if (resolvedPath === null) {
    return false;
  }
  const normalized = normalizeToForwardSlash(resolvedPath);
  return (
    normalized.endsWith('/test-utils/render.tsx') ||
    normalized.endsWith('/test-utils/render.jsx') ||
    normalized.endsWith('/test-utils/render.ts')
  );
}

interface ImportClassification {
  readonly hasJsdomDep: boolean;
  readonly hasReactInkDep: boolean;
}

/**
 * Parse a file with the TypeScript compiler API and walk only real import /
 * export-from declaration nodes to collect runtime module specifiers.
 * Type-only imports (import type / import { type X }) are excluded.
 */
function classifyImports(sourceFile: ts.SourceFile): ImportClassification {
  let hasJsdomDep = false;
  let hasReactInkDep = false;

  function visit(node: ts.Node): void {
    if (hasJsdomDep) {
      return;
    }

    // Handle: import ... from 'spec'
    if (ts.isImportDeclaration(node)) {
      const spec = getStringLiteral(node.moduleSpecifier);
      if (spec !== null && !isTypeOnlyImportClause(node.importClause)) {
        const fromFile = sourceFile.fileName;
        const resolved = resolveModulePath(spec, fromFile);
        if (isLocalRenderHelper(resolved)) {
          hasReactInkDep = true;
        } else if (isJsdomSpecifier(spec)) {
          hasJsdomDep = true;
        } else if (isReactInkSpecifier(spec)) {
          hasReactInkDep = true;
        }
      }
    }

    // Handle: export ... from 'spec'
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const spec = node.moduleSpecifier;
      if (spec !== undefined && ts.isStringLiteral(spec)) {
        const s = spec.text;
        if (isJsdomSpecifier(s)) {
          hasJsdomDep = true;
        } else if (isReactInkSpecifier(s)) {
          hasReactInkDep = true;
        }
      }
    }

    // Handle: require('spec')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.escapedText === 'require'
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteral(arg)) {
        const spec = arg.text;
        const fromFile = sourceFile.fileName;
        const resolved = resolveModulePath(spec, fromFile);
        if (isLocalRenderHelper(resolved)) {
          hasReactInkDep = true;
        } else if (isJsdomSpecifier(spec)) {
          hasJsdomDep = true;
        } else if (isReactInkSpecifier(spec)) {
          hasReactInkDep = true;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { hasJsdomDep, hasReactInkDep };
}

function getStringLiteral(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr)) {
    return expr.text;
  }
  return null;
}

function isTypeOnlyImportClause(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) {
    return false;
  }
  // import type ... from '...'
  if (clause.isTypeOnly) {
    return true;
  }
  if (clause.name !== undefined) {
    return false;
  }
  // import { type X, type Y } from '...' — fully type-only named bindings
  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamedImports(named)) {
    return named.elements.every((el) => el.isTypeOnly);
  }
  return false;
}

/**
 * Detect a real `@vitest-environment jsdom` pragma. Vitest pragmas must appear
 * at the top of the file as a block/line comment before any code. We scan only
 * comment ranges (never string literals or test descriptions) for the pragma.
 */
function hasJsdomPragma(sourceFile: ts.SourceFile): boolean {
  const fullText = sourceFile.text;
  const ranges = ts.getLeadingCommentRanges(fullText, 0);
  if (ranges === undefined) {
    return false;
  }
  for (const range of ranges) {
    const comment = fullText.slice(range.pos, range.end);
    if (/@vitest-environment\s+jsdom\b/.test(comment)) {
      return true;
    }
  }
  return false;
}

export type TestFileKind = 'jsdom' | 'react-ink-node' | 'pure-node';

/**
 * Classify a single test file by its real syntactic runtime imports and
 * environment pragma.
 *
 * @param filePath - absolute path to the test file
 * @returns the routing kind for the file
 */
export function classifyTestFile(filePath: string): TestFileKind {
  if (!existsSync(filePath)) {
    return 'pure-node';
  }
  const content = readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  if (hasJsdomPragma(sourceFile)) {
    return 'jsdom';
  }

  const { hasJsdomDep, hasReactInkDep } = classifyImports(sourceFile);
  if (hasJsdomDep) {
    return 'jsdom';
  }
  if (hasReactInkDep) {
    return 'react-ink-node';
  }
  return 'pure-node';
}

export interface TestGroup {
  readonly name: string;
  readonly environment: 'node' | 'jsdom';
  readonly setupFile: string;
  readonly testFiles: readonly string[];
}

export interface BuildGroupsOptions {
  readonly multiRuntimeGuardrail?: boolean;
}

const groupCache = new Map<boolean, readonly TestGroup[]>();

function discoverTestFiles(multiRuntime: boolean): readonly string[] {
  const exclude = buildExclude(multiRuntime);
  const globbed = fg.globSync(baseInclude, {
    cwd: __dirname,
    onlyFiles: true,
    absolute: false,
    dot: false,
    ignore: ['**/node_modules/**', '**/dist/**'],
  });
  // Explicit re-include entries carve out specific files that would otherwise
  // be excluded by baseExclude (e.g. `**/ui/components/*.test.tsx`). They
  // bypass the exclude filter so the file is always discovered and routed.
  const explicitSet = new Set(explicitIncludePaths);
  const candidates = [...globbed, ...explicitIncludePaths];
  const filtered = candidates.filter(
    (f) => explicitSet.has(f) || !micromatch.isMatch(f, exclude),
  );
  const existing = filtered.filter((f) =>
    existsSync(resolvePackageRelative(f)),
  );
  const unique = new Set(existing);
  return [...unique].sort();
}

function resolvePackageRelative(rel: string): string {
  return resolve(__dirname, rel);
}

function toPackageRelative(abs: string): string {
  return normalizeToForwardSlash(relative(__dirname, abs));
}

/**
 * Build the three disjoint routing groups for the current test-file set.
 *
 * Groups are exhaustive (every discovered file appears exactly once) and
 * disjoint (no file appears in two groups). Each group carries the
 * environment and setup file its members require. Test paths are normalized
 * to forward-slash package-relative paths.
 */
export function buildTestGroups(
  options: BuildGroupsOptions = {},
): readonly TestGroup[] {
  const multiRuntime = options.multiRuntimeGuardrail === true;
  const cached = groupCache.get(multiRuntime);
  if (cached !== undefined) {
    return cached;
  }
  const files = discoverTestFiles(multiRuntime);
  const jsdom: string[] = [];
  const reactInk: string[] = [];
  const pure: string[] = [];

  for (const rel of files) {
    const absolute = resolvePackageRelative(rel);
    const kind = classifyTestFile(absolute);
    if (kind === 'jsdom') {
      jsdom.push(toPackageRelative(absolute));
    } else if (kind === 'react-ink-node') {
      reactInk.push(toPackageRelative(absolute));
    } else {
      pure.push(toPackageRelative(absolute));
    }
  }

  const groups: readonly TestGroup[] = [
    {
      name: 'pure-node',
      environment: 'node',
      setupFile: BASE_SETUP,
      testFiles: pure,
    },
    {
      name: 'react-ink-node',
      environment: 'node',
      setupFile: FULL_SETUP,
      testFiles: reactInk,
    },
    {
      name: 'jsdom',
      environment: 'jsdom',
      setupFile: FULL_SETUP,
      testFiles: jsdom,
    },
  ];
  groupCache.set(multiRuntime, groups);
  return groups;
}

/**
 * The expected total selected file count after integrating the v0.11.0 test set.
 * Exported for behavioral tests to assert against an independent oracle.
 */
export const SELECTED_FILE_COUNT: number = 533;
