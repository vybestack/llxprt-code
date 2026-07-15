/**
 * Regression test: provider-agnostic naming must not use old Gemini-specific
 * names. Uses AST-based scanning to catch provider-neutral Gemini identifiers
 * in ALL declaration categories: classes, functions, variables, methods,
 * properties, getters/setters, parameters, import aliases, enum members,
 * named expressions, and nested bindings — exported and non-exported.
 *
 * ALL package workspaces are scanned. Genuine Gemini identifiers are allowed
 * only via exact genuine provider tree predicates, exact genuine files, and
 * exact (relativePath, identifier) pairs. No global name-only allowances,
 * no whole-file exemptions, no substring path matching.
 *
 * @plan:PLAN-20260608-ISSUE1423.P03
 * @requirement:REQ-VERIFY-001.2
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, dirname } from 'path';
import ts from 'typescript';
import {
  extractDeclaredIdentifiers,
  shouldScanForGemini,
} from './geminiIdentifierScanner.js';
import {
  GENUINE_GEMINI_TREES,
  GENUINE_GEMINI_FILES,
  ALLOWED_GEMINI_PAIRS,
  ALLOWED_GEMINI_PAIRS_EXTENDED,
  ALLOWED_IMPORT_TUPLES,
  ALLOWED_EXPORT_TUPLES,
} from './providerAgnosticNamingAllowlist.js';

const PACKAGES_DIR = resolve(__dirname, '../../../..');
const REPOSITORY_ROOT = dirname(PACKAGES_DIR);
const CORE_DIR = resolve(PACKAGES_DIR, 'core');
const CLI_DIR = resolve(PACKAGES_DIR, 'cli');

function getWorkspaceRoots(): readonly string[] {
  const rootPackage: unknown = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf-8'),
  );
  if (typeof rootPackage !== 'object' || rootPackage === null) {
    return [];
  }
  const workspaces = Reflect.get(rootPackage, 'workspaces');
  if (!Array.isArray(workspaces)) {
    return [];
  }
  return workspaces
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => resolve(REPOSITORY_ROOT, entry))
    .filter((entry) => {
      try {
        return statSync(entry).isDirectory();
      } catch {
        return false;
      }
    });
}

/** Enumerate the exact package workspaces declared by the root package. */
const PACKAGE_ROOTS = getWorkspaceRoots();

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

const EXCLUDE_TOKENS = [
  '/geminiIdentifierScanner.test.ts',
  '/geminiIdentifierScanner.extended.test.ts',
  '/geminiIdentifierScanner.ts',
  '/providerAgnosticNamingAllowlist.ts',
  '/dist/',
  '/coverage/',
  '/node_modules/',
  '/tmp/',
  '/project-plans/',
  '.log',
  '.xml',
];

function isInGenuineTree(relPath: string): boolean {
  const normalized = normalizePath(relPath);
  // Root-prefix match only: the tree predicate must match the path as a
  // prefix from the start (e.g. "providers/src/gemini/..."). Do NOT use
  // includes('/') which would match the tree name anywhere in the path.
  return GENUINE_GEMINI_TREES.some((tree) => normalized.startsWith(tree));
}

function isExactGenuineFile(relPath: string): boolean {
  const normalized = normalizePath(relPath);
  return GENUINE_GEMINI_FILES.includes(normalized);
}

function isAllowedBoundary(relPath: string): boolean {
  return isInGenuineTree(relPath) || isExactGenuineFile(relPath);
}

/** Derived ReadonlySets from the allowlist data module. */
const ALL_ALLOWED_GEMINI_PAIRS: ReadonlySet<string> = new Set([
  ...ALLOWED_GEMINI_PAIRS,
  ...ALLOWED_GEMINI_PAIRS_EXTENDED,
]);
const ALLOWED_IMPORT_TUPLE_SET: ReadonlySet<string> = new Set(
  ALLOWED_IMPORT_TUPLES,
);
const ALLOWED_EXPORT_TUPLE_SET: ReadonlySet<string> = new Set(
  ALLOWED_EXPORT_TUPLES,
);

function isAllowedIdentifier(
  relPath: string,
  name: string,
  kind: string,
  moduleSpecifier?: string,
  importedSymbol?: string,
  exportedSymbol?: string,
): boolean {
  if (kind.startsWith('import-')) {
    if (isAllowedBoundary(relPath)) {
      return true;
    }
    // Exact 4-tuple: (filePath, moduleSpecifier, importedSymbol, localName).
    // The local name (`name`) is part of the key so that a same-symbol
    // import under a different alias is not allowed.
    if (
      moduleSpecifier !== undefined &&
      importedSymbol !== undefined &&
      ALLOWED_IMPORT_TUPLE_SET.has(
        `${relPath}::${moduleSpecifier}::${importedSymbol}::${name}`,
      )
    ) {
      return true;
    }
    return false;
  }
  if (kind.startsWith('export-')) {
    if (isAllowedBoundary(relPath)) {
      return true;
    }
    if (moduleSpecifier === undefined || importedSymbol === undefined) {
      return ALL_ALLOWED_GEMINI_PAIRS.has(`${relPath}::${name}`);
    }
    return ALLOWED_EXPORT_TUPLE_SET.has(
      `${relPath}::${moduleSpecifier}::${importedSymbol}::${exportedSymbol ?? name}`,
    );
  }
  if (isAllowedBoundary(relPath)) {
    return true;
  }
  return ALL_ALLOWED_GEMINI_PAIRS.has(`${relPath}::${name}`);
}

function isInAllowedPairFile(relPath: string, name: string): boolean {
  return ALL_ALLOWED_GEMINI_PAIRS.has(`${relPath}::${name}`);
}

const SKIP_DIR_NAMES = new Set([
  'dist',
  'coverage',
  'node_modules',
  'tmp',
  'project-plans',
]);

function isExcludedPath(filePath: string): boolean {
  return EXCLUDE_TOKENS.some((tok) => filePath.includes(tok));
}

function isSourceFileEntry(name: string, fullPath: string): boolean {
  return (
    (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !isExcludedPath(fullPath) &&
    !fullPath.includes('providerAgnosticNaming.test.ts')
  );
}

function collectSourceFiles(rootDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry)) walk(full);
      } else if (isSourceFileEntry(entry, full)) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

interface ScannedFile {
  absPath: string;
  relPath: string;
  lines: string[];
  identifiers: Array<{
    name: string;
    line: number;
    file: string;
    exported: boolean;
    kind: string;
    moduleSpecifier?: string;
    importedSymbol?: string;
    exportedSymbol?: string;
  }>;
}

interface CachedScan {
  entries: ScannedFile[];
}

function scanFile(absPath: string): ScannedFile | undefined {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf-8');
  } catch {
    return undefined;
  }
  const relPath = normalizePath(relative(PACKAGES_DIR, absPath));
  if (!shouldScanForGemini(text, relPath)) {
    return undefined;
  }
  const sf = ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const rawIds = extractDeclaredIdentifiers(sf);
  return {
    absPath,
    relPath,
    lines: text.split('\n'),
    identifiers: rawIds.map(
      ({
        name,
        line,
        exported,
        kind,
        moduleSpecifier,
        importedSymbol,
        exportedSymbol,
      }) => ({
        name,
        line,
        file: relPath,
        exported,
        kind,
        moduleSpecifier,
        importedSymbol,
        exportedSymbol,
      }),
    ),
  };
}

function buildCachedScan(files: string[]): CachedScan {
  const entries = files
    .map(scanFile)
    .filter((e: ScannedFile | undefined): e is ScannedFile => e !== undefined);
  return { entries };
}

function searchTokenInCachedFiles(
  scan: CachedScan,
  token: string,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const entry of scan.entries) {
    for (let i = 0; i < entry.lines.length; i++) {
      if (entry.lines[i].includes(token)) {
        hits.push({
          file: entry.relPath,
          line: i + 1,
          text: entry.lines[i].trim(),
        });
      }
    }
  }
  return hits;
}

function filterCachedScan(
  scan: CachedScan,
  predicate: (relPath: string) => boolean,
): CachedScan {
  return { entries: scan.entries.filter((e) => predicate(e.relPath)) };
}

/** Collect declared-identifier violations matching a forbidden name. */
function collectForbiddenNameViolations(
  scan: CachedScan,
  forbiddenName: string,
): Array<{ name: string; file: string; line: number }> {
  const violations: Array<{ name: string; file: string; line: number }> = [];
  for (const entry of scan.entries) {
    for (const id of entry.identifiers) {
      if (
        id.name === forbiddenName &&
        !isAllowedIdentifier(
          entry.relPath,
          id.name,
          id.kind,
          id.moduleSpecifier,
          id.importedSymbol,
          id.exportedSymbol,
        )
      ) {
        violations.push({ name: id.name, file: entry.relPath, line: id.line });
      }
    }
  }
  return violations;
}

describe('Provider-Agnostic Naming Regression', () => {
  const allFiles: string[] = [];
  for (const root of PACKAGE_ROOTS) {
    allFiles.push(...collectSourceFiles(root));
  }
  const fullScan = buildCachedScan(allFiles);

  it('scans declared workspace source files', () => {
    expect(PACKAGE_ROOTS.length).toBeGreaterThan(0);
    expect(allFiles.length).toBeGreaterThan(100);
  });

  describe('Old source files must not exist after rename', () => {
    const oldFiles = [
      resolve(CORE_DIR, 'src/core/geminiChat.ts'),
      resolve(CORE_DIR, 'src/core/geminiChatTypes.ts'),
      resolve(CLI_DIR, 'src/gemini.tsx'),
    ];
    it.each(oldFiles)('old file %s must not exist', (filePath) => {
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe('Package metadata must not expose old export subpaths', () => {
    it('packages/core/package.json must not expose ./core/geminiChat.js', () => {
      const pkg = JSON.parse(
        readFileSync(resolve(CORE_DIR, 'package.json'), 'utf-8'),
      );
      expect('./core/geminiChat.js' in (pkg.exports ?? {})).toBe(false);
    });
  });

  describe('Old import paths must not remain in source/test files', () => {
    const checks: ReadonlyArray<{ token: string; description: string }> = [
      {
        token: "from './geminiChat.js'",
        description: "import from './geminiChat.js'",
      },
      {
        token: 'geminiChat.js',
        description: 'import referencing geminiChat.js',
      },
      {
        token: 'geminiChatTypes.js',
        description: "import from './geminiChatTypes.js'",
      },
      {
        token: "from './gemini.js'",
        description: "CLI import from './gemini.js'",
      },
      {
        token: "from '../gemini.js'",
        description: "CLI import from '../gemini.js'",
      },
      {
        token: "from './gemini.tsx'",
        description: "CLI import from './gemini.tsx'",
      },
      {
        token: "from '../gemini.tsx'",
        description: "CLI import from '../gemini.tsx'",
      },
    ];
    for (const { token, description } of checks) {
      it(`must not contain ${description}`, () => {
        expect(searchTokenInCachedFiles(fullScan, token)).toStrictEqual([]);
      });
    }
  });

  describe('Old class/type names must not remain', () => {
    const forbiddenNames = [
      { name: 'GeminiChat', desc: 'GeminiChat (should be ChatSession)' },
      { name: 'GeminiClient', desc: 'GeminiClient (should be AgentClient)' },
    ];
    for (const { name, desc } of forbiddenNames) {
      it(`must not declare ${desc} outside allowed boundaries`, () => {
        const violations = collectForbiddenNameViolations(fullScan, name);
        expect(violations).toStrictEqual([]);
      });
    }
  });

  describe('Old accessor/field/variable names must not remain', () => {
    const checks: ReadonlyArray<{ token: string; description: string }> = [
      { token: 'getGeminiClient', description: 'getGeminiClient() accessor' },
      { token: 'geminiClient', description: 'geminiClient field/property' },
      {
        token: 'createGeminiChatRuntime',
        description: 'createGeminiChatRuntime',
      },
      { token: 'GeminiChatConfigShape', description: 'GeminiChatConfigShape' },
      {
        token: 'GeminiChatRuntimeOptions',
        description: 'GeminiChatRuntimeOptions',
      },
      {
        token: 'GeminiChatRuntimeResult',
        description: 'GeminiChatRuntimeResult',
      },
      {
        token: 'getRuntimeGeminiClient',
        description: 'getRuntimeGeminiClient',
      },
      { token: 'createGeminiChat', description: 'createGeminiChat()' },
      {
        token: 'addShellCommandToGeminiHistory',
        description: 'addShellCommandToGeminiHistory',
      },
      { token: 'mockGeminiClient', description: 'mockGeminiClient' },
      { token: 'makeGeminiClient', description: 'makeGeminiClient' },
      { token: 'previousGeminiClient', description: 'previousGeminiClient' },
      { token: 'newGeminiClient', description: 'newGeminiClient' },
    ];
    for (const { token, description } of checks) {
      it(`must not contain ${description}`, () => {
        expect(searchTokenInCachedFiles(fullScan, token)).toStrictEqual([]);
      });
    }
  });

  describe('GeminiClient/geminiClient inside agentStream must not remain', () => {
    const agentStreamScan = filterCachedScan(fullScan, (p) =>
      p.includes('ui/hooks/agentStream'),
    );
    const tokens = [
      'GeminiClient',
      'geminiClient',
      'getGeminiClient',
      'mockGeminiClient',
      'makeGeminiClient',
    ];
    for (const token of tokens) {
      it(`must not contain ${token} inside agentStream/`, () => {
        expect(searchTokenInCachedFiles(agentStreamScan, token)).toStrictEqual(
          [],
        );
      });
    }
  });

  describe('Core barrel and CLI entry must not re-export old paths', () => {
    it('core/src/index.ts must not export ./core/geminiChat.js', () => {
      expect(
        readFileSync(resolve(CORE_DIR, 'src/index.ts'), 'utf-8').includes(
          "from './core/geminiChat.js'",
        ),
      ).toBe(false);
    });
    it('cli/index.ts must not import from ./src/gemini.js', () => {
      expect(
        readFileSync(resolve(CLI_DIR, 'index.ts'), 'utf-8').includes(
          "from './src/gemini.js'",
        ),
      ).toBe(false);
    });
  });

  describe('Config must not have old accessor/field names', () => {
    it('configBaseCore must not have getGeminiClient or geminiClient', () => {
      const content = readFileSync(
        resolve(CORE_DIR, 'src/config/configBaseCore.ts'),
        'utf-8',
      );
      expect(content.includes('getGeminiClient')).toBe(false);
      expect(content.includes('geminiClient')).toBe(false);
    });
    it('config.ts must not have getGeminiClient or geminiClient', () => {
      const content = readFileSync(
        resolve(CORE_DIR, 'src/config/config.ts'),
        'utf-8',
      );
      expect(content.includes('getGeminiClient')).toBe(false);
      expect(content.includes('geminiClient')).toBe(false);
    });
  });

  describe('Provider-agnostic event types must not carry Gemini names', () => {
    for (const token of [
      'ServerGemini',
      'GeminiEventType',
      'GeminiErrorEventValue',
    ]) {
      it(`must not contain "${token}" outside allowed boundaries`, () => {
        const violations = searchTokenInCachedFiles(fullScan, token).filter(
          (h) => !isAllowedBoundary(h.file),
        );
        expect(violations).toStrictEqual([]);
      });
    }
  });

  describe('geminiRequest.ts must be retired', () => {
    it('must not exist', () => {
      expect(existsSync(resolve(CORE_DIR, 'src/core/geminiRequest.ts'))).toBe(
        false,
      );
    });
    it('core index must not export it', () => {
      expect(
        readFileSync(resolve(CORE_DIR, 'src/index.ts'), 'utf-8').includes(
          "from './core/geminiRequest.js'",
        ),
      ).toBe(false);
    });
  });

  describe('geminiLegacyAliases module must be deleted (0.10.0)', () => {
    const retiredFiles = [
      resolve(CORE_DIR, 'src/core/geminiLegacyAliases.ts'),
      resolve(CORE_DIR, 'src/core/geminiLegacyAliases.test.ts'),
      resolve(CORE_DIR, 'src/core/geminiLegacyAliases.test-d.ts'),
      resolve(CORE_DIR, 'src/config/__tests__/deprecatedGeminiAliases.test.ts'),
    ];
    it.each(retiredFiles)('retired file %s must not exist', (filePath) => {
      expect(existsSync(filePath)).toBe(false);
    });
    it('core index must not re-export geminiLegacyAliases', () => {
      expect(
        readFileSync(resolve(CORE_DIR, 'src/index.ts'), 'utf-8').includes(
          'geminiLegacyAliases',
        ),
      ).toBe(false);
    });
  });

  describe('GeminiCLIExtension type alias must be removed', () => {
    it('configTypes.ts must not export it', () => {
      expect(
        readFileSync(
          resolve(CORE_DIR, 'src/config/configTypes.ts'),
          'utf-8',
        ).includes('GeminiCLIExtension'),
      ).toBe(false);
    });
    it('core barrel must not re-export it', () => {
      expect(
        readFileSync(resolve(CORE_DIR, 'src/index.ts'), 'utf-8').includes(
          'GeminiCLIExtension',
        ),
      ).toBe(false);
    });
    it('config/index.ts must not import it', () => {
      expect(
        readFileSync(
          resolve(CORE_DIR, 'src/config/index.ts'),
          'utf-8',
        ).includes('GeminiCLIExtension'),
      ).toBe(false);
    });
  });

  describe('GEMINI_DIR must be removed from provider-neutral exports', () => {
    it('memoryTool.ts must not export GEMINI_DIR', () => {
      expect(
        readFileSync(
          resolve(PACKAGES_DIR, 'tools/src/tools/memoryTool.ts'),
          'utf-8',
        ).includes('GEMINI_DIR'),
      ).toBe(false);
    });
    it('tools barrel must not re-export GEMINI_DIR', () => {
      expect(
        readFileSync(
          resolve(PACKAGES_DIR, 'tools/src/index.ts'),
          'utf-8',
        ).includes('GEMINI_DIR'),
      ).toBe(false);
    });
    it('core barrel must not re-export GEMINI_DIR', () => {
      expect(
        readFileSync(resolve(CORE_DIR, 'src/index.ts'), 'utf-8').includes(
          'GEMINI_DIR',
        ),
      ).toBe(false);
    });
  });

  describe('Provider-neutral Gemini internal identifiers must be renamed', () => {
    const checks: ReadonlyArray<{ token: string; description: string }> = [
      { token: 'geminiResult', description: 'geminiResult variable' },
      {
        token: 'refreshGeminiTools',
        description: 'refreshGeminiTools function',
      },
      {
        token: 'maybeRefreshGeminiTools',
        description: 'maybeRefreshGeminiTools method',
      },
      { token: 'getGeminiDir', description: 'getGeminiDir accessor' },
      { token: 'setupGeminiClient', description: 'setupGeminiClient helper' },
      { token: 'useGeminiignore', description: 'useGeminiignore option' },
    ];
    for (const { token, description } of checks) {
      it(`must not contain ${description}`, () => {
        const violations = searchTokenInCachedFiles(fullScan, token).filter(
          (h) =>
            !isAllowedBoundary(h.file) && !isInAllowedPairFile(h.file, token),
        );
        expect(violations).toStrictEqual([]);
      });
    }
  });

  describe('Provider-neutral Gemini filenames must not exist', () => {
    const patterns = [
      '/geminiLegacyAliases.ts',
      '/geminiLegacyAliases.test.ts',
      '/geminiLegacyAliases.test-d.ts',
      '/deprecatedGeminiAliases.test.ts',
    ];
    it.each(patterns)('no file matching %s must exist', (suffix) => {
      expect(allFiles.filter((f) => f.endsWith(suffix))).toStrictEqual([]);
    });
  });

  describe('No provider-neutral Gemini-prefixed declared identifiers outside allowed boundaries', () => {
    it('every Gemini-prefixed declaration outside boundaries must be allowed', () => {
      const violations: Array<{
        name: string;
        file: string;
        line: number;
        kind: string;
      }> = [];
      for (const entry of fullScan.entries) {
        for (const id of entry.identifiers) {
          if (
            !isAllowedIdentifier(
              entry.relPath,
              id.name,
              id.kind,
              id.moduleSpecifier,
              id.importedSymbol,
              id.exportedSymbol,
            )
          ) {
            violations.push({
              name: id.name,
              file: entry.relPath,
              line: id.line,
              kind: id.kind,
            });
          }
        }
      }
      expect(violations).toStrictEqual([]);
    });
  });

  describe('No new provider-neutral Gemini source filenames outside allowed boundaries', () => {
    // Finding 7: exact relative paths, not global basenames. A file named
    // "geminiContent.ts" in the wrong directory must NOT be allowed.
    const ALLOWED_EXACT_PATHS = new Set([
      'core/src/llm-types/geminiContent.ts',
      'cli/src/ui/privacy/GeminiPrivacyNotice.tsx',
      'core/src/llm-types/finishReasons.ts',
    ]);
    it('no Gemini-named source file outside provider/allowed exact paths', () => {
      const violations: string[] = [];
      for (const entry of fullScan.entries) {
        if (isAllowedBoundary(entry.relPath)) continue;
        if (
          /[Gg]emini/.test(entry.relPath) &&
          !ALLOWED_EXACT_PATHS.has(entry.relPath)
        ) {
          violations.push(entry.relPath);
        }
      }
      expect(violations).toStrictEqual([]);
    });

    // Mutation test: a same-basename file in a wrong directory must be rejected
    it('rejects a geminiContent.ts file in a non-allowed directory (mutation guard)', () => {
      const wrongDir = 'cli/src/config/geminiContent.ts';
      expect(ALLOWED_EXACT_PATHS.has(wrongDir)).toBe(false);
      expect(isAllowedBoundary(wrongDir)).toBe(false);
    });
  });

  describe('Provider-neutral GEMINI_* constants must not exist outside boundaries', () => {
    it('no declared const GEMINI_* outside boundaries (except allowlisted)', () => {
      const violations: Array<{
        name: string;
        file: string;
        line: number;
      }> = [];
      for (const entry of fullScan.entries) {
        for (const id of entry.identifiers) {
          if (
            id.name.startsWith('GEMINI_') &&
            !isAllowedIdentifier(
              entry.relPath,
              id.name,
              id.kind,
              id.moduleSpecifier,
              id.importedSymbol,
              id.exportedSymbol,
            )
          ) {
            violations.push({
              name: id.name,
              file: entry.relPath,
              line: id.line,
            });
          }
        }
      }
      expect(violations).toStrictEqual([]);
    });
  });

  describe('compatibility file boundary is exact — no blanket exemption', () => {
    // Mutation test: if someone adds a Gemini identifier to a compat file,
    // it must NOT be allowed by a blanket boundary exemption. Only genuine
    // provider trees and exact genuine files are allowed.
    it('rejects a Gemini declaration in a former blanket-exempted compat file', () => {
      const compatFile = 'cli/src/config/extension.ts';
      // This file is no longer in a blanket exemption — verify
      expect(isAllowedBoundary(compatFile)).toBe(false);
      // A Gemini identifier declared here must be rejected
      expect(isAllowedIdentifier(compatFile, 'GeminiClient', 'class')).toBe(
        false,
      );
    });

    it('rejects a Gemini import in a former blanket-exempted compat file', () => {
      const compatFile = 'a2a-server/src/config/extension.ts';
      expect(isAllowedBoundary(compatFile)).toBe(false);
      expect(
        isAllowedIdentifier(
          compatFile,
          'GeminiClient',
          'import-named',
          './GeminiClient.js',
          'GeminiClient',
        ),
      ).toBe(false);
    });

    it('rejects a nested fake provider path that looks like a genuine tree', () => {
      // A file at providers/src/anthropic/gemini-converter.ts should NOT
      // match the 'providers/src/gemini/' tree prefix (it starts with
      // 'providers/src/anthropic/', not 'providers/src/gemini/').
      const fakePath = 'providers/src/anthropic/gemini-converter.ts';
      expect(isAllowedBoundary(fakePath)).toBe(false);
    });
  });

  describe('exact import tuple enforcement', () => {
    // Mutation test: misleading aliased import in neutral code must fail; only a
    // genuine exact (relPath, specifier, importedSymbol, localName) 4-tuple
    // passes.
    it('rejects misleading aliased import while genuine 4-tuple passes', () => {
      const f = 'core/src/services/history/ContentConverters.ts';
      const g = '../../llm-types/geminiContent.js';
      const cases: Array<
        [string | undefined, string | undefined, string, boolean]
      > = [
        ['./client.js', 'AgentClient', 'GeminiContent', false],
        [g, 'GeminiContent', 'GeminiContent', true],
        ['./wrong.js', 'GeminiContent', 'GeminiContent', false],
        [g, 'AgentClient', 'GeminiContent', false],
        // Same source but different local alias must be rejected
        [g, 'GeminiContent', 'GeminiContentAlias', false],
      ];
      for (const [mod, sym, local, ok] of cases) {
        expect(isAllowedIdentifier(f, local, 'import-named', mod, sym)).toBe(
          ok,
        );
      }
    });
  });

  describe('exact export tuple enforcement', () => {
    it('allows only the exact re-export source and public name', () => {
      const file = 'core/src/config/index.ts';
      const moduleSpecifier = './models.js';
      expect(
        isAllowedIdentifier(
          file,
          'DEFAULT_GEMINI_FLASH_MODEL',
          'export-source',
          moduleSpecifier,
          'DEFAULT_GEMINI_FLASH_MODEL',
          'DEFAULT_FLASH_MODEL',
        ),
      ).toBe(true);
      expect(
        isAllowedIdentifier(
          file,
          'DEFAULT_GEMINI_FLASH_MODEL',
          'export-source',
          './wrong.js',
          'DEFAULT_GEMINI_FLASH_MODEL',
          'DEFAULT_FLASH_MODEL',
        ),
      ).toBe(false);
      expect(
        isAllowedIdentifier(
          file,
          'DEFAULT_GEMINI_FLASH_MODEL',
          'export-source',
          moduleSpecifier,
          'DEFAULT_GEMINI_FLASH_MODEL',
          'MISLEADING_ALIAS',
        ),
      ).toBe(false);
    });
  });
});
