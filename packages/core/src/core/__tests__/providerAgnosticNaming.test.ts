/**
 * Regression test: provider-agnostic naming must not use old Gemini-specific names.
 *
 * This test fails before the rename implementation because the old names still exist.
 * After implementation (P04–P07), it must pass.
 *
 * @plan:PLAN-20260608-ISSUE1423.P03
 * @requirement:REQ-VERIFY-001.2
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';

// ---- Configuration ----

// __dirname = .../packages/core/src/core/__tests__
// ../../.. = packages/core, ../../../.. = packages
const PACKAGES_DIR = resolve(__dirname, '../../../..');
const CORE_DIR = resolve(PACKAGES_DIR, 'core');
const CLI_DIR = resolve(PACKAGES_DIR, 'cli');
const A2A_DIR = resolve(PACKAGES_DIR, 'a2a-server');
const PROVIDERS_DIR = resolve(PACKAGES_DIR, 'providers');

// Paths to exclude from scans (generated, build artifacts, test output, etc.)
const EXCLUDE_TOKENS = [
  '/dist/',
  '/coverage/',
  '/node_modules/',
  '/tmp/',
  '/project-plans/',
  '.log',
  '.xml',
];

// Legitimate Gemini provider-specific paths/names that MUST NOT trigger failures.
// These use "gemini" for genuine Gemini-provider reasons, not for
// provider-agnostic agent/chat concepts.
const ALLOWED_GEMINI_PATTERNS: ReadonlyArray<{
  pattern: string;
  reason: string;
}> = [
  // Provider-specific auth and config
  { pattern: 'gemini-oauth-provider', reason: 'Gemini OAuth provider' },
  { pattern: 'gemini.config', reason: 'Gemini provider config alias' },
  // Provider implementation and request handling
  { pattern: 'geminiRequest', reason: 'Gemini provider request module' },
  { pattern: 'GeminiEventType', reason: 'Gemini stream event type enum' },
  { pattern: 'ServerGeminiStreamEvent', reason: 'Gemini stream event type' },
  {
    pattern: 'ServerGeminiChatCompressedEvent',
    reason: 'Gemini stream event type',
  },
  // Gemini model names (not code identifiers)
  { pattern: 'gemini-1', reason: 'Gemini model name string literal' },
  { pattern: 'gemini-embedding', reason: 'Gemini embedding model name' },
  { pattern: 'gemini-2', reason: 'Gemini model name string literal' },
  // Directory and hook names that stay
  {
    pattern: 'geminiStream/',
    reason: 'Directory name preserved per plan scope decision',
  },
  {
    pattern: 'useGeminiStream',
    reason: 'Hook name preserved as directory-level scope',
  },
  {
    pattern: 'geminiStreamLogger',
    reason: 'Directory-scoped logger inside geminiStream/',
  },
  // Provider-specific test references
  {
    pattern: 'provider-gemini-switching',
    reason: 'Provider switching test file',
  },
];

const SKIP_DIR_NAMES = new Set([
  'dist',
  'coverage',
  'node_modules',
  'tmp',
  'project-plans',
]);

// ---- Helpers ----

function isExcludedPath(filePath: string): boolean {
  return EXCLUDE_TOKENS.some((tok) => filePath.includes(tok));
}

function isAllowedGeminiName(name: string, filePath: string): boolean {
  for (const ap of ALLOWED_GEMINI_PATTERNS) {
    if (name.includes(ap.pattern) || filePath.includes(ap.pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Strip JS/TS comments and string literals to avoid false positives
 * from commented-out code or documentation strings.
 * Uses string scanning instead of regex to satisfy sonarjs/regular-expr.
 */
function stripCommentsAndStrings(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    let processed = line;
    if (inBlock) {
      const endIdx = processed.indexOf('*/');
      if (endIdx === -1) {
        continue;
      }
      processed = processed.slice(endIdx + 2);
      inBlock = false;
    }
    // Remove remaining block comments on the same line
    let safety = 0;
    while (processed.includes('/*') && safety < 20) {
      const startIdx = processed.indexOf('/*');
      const endIdx = processed.indexOf('*/', startIdx + 2);
      if (endIdx === -1) {
        processed = processed.slice(0, startIdx);
        inBlock = true;
        break;
      }
      processed = processed.slice(0, startIdx) + processed.slice(endIdx + 2);
      safety++;
    }
    // Remove line comments
    const lineCommentIdx = processed.indexOf('//');
    if (lineCommentIdx !== -1) {
      processed = processed.slice(0, lineCommentIdx);
    }
    result.push(processed);
  }
  return result.join('\n');
}

/** Directories to skip by name during walk. */
function isSkippedDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

/** Check if a file entry is a .ts/.tsx source file we care about. */
function isSourceFileEntry(name: string, fullPath: string): boolean {
  return (
    (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !isExcludedPath(fullPath) &&
    !fullPath.includes('providerAgnosticNaming.test.ts')
  );
}

/**
 * Handle a directory entry: recurse if it is a non-skipped directory,
 * or collect if it is a source file.
 */
function processEntry(
  entry: string,
  full: string,
  results: string[],
  walk: (d: string) => void,
): void {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(full);
  } catch {
    // stat failed — skip entry
    return;
  }
  if (st.isDirectory()) {
    if (!isSkippedDir(entry)) {
      walk(full);
    }
  } else if (isSourceFileEntry(entry, full)) {
    results.push(full);
  }
}

/**
 * Collect all .ts/.tsx file paths under a directory, respecting exclusions.
 */
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
      const rel = relative(rootDir, full);
      if (!isExcludedPath('/' + rel + '/')) {
        processEntry(entry, full, results, walk);
      }
    }
  }
  walk(rootDir);
  return results;
}

/**
 * Search file contents for a simple string token (avoids regex lint issues).
 */
function searchTokenInFiles(
  files: string[],
  token: string,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(token)) {
        const relPath = relative(PACKAGES_DIR, filePath);
        hits.push({ file: relPath, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
}

/**
 * Filter hits to only include real violations (not allowed Gemini names).
 */
function filterViolations(
  hits: Array<{ file: string; line: number; text: string }>,
): Array<{ file: string; line: number; text: string }> {
  return hits.filter((h) => !isAllowedGeminiName(h.text, h.file));
}

// ---- Test Suite ----

describe('Provider-Agnostic Naming Regression', () => {
  // @plan:PLAN-20260608-ISSUE1423.P03
  // @requirement:REQ-VERIFY-001.2

  const coreFiles = collectSourceFiles(CORE_DIR);
  const cliFiles = collectSourceFiles(CLI_DIR);
  const a2aFiles = collectSourceFiles(A2A_DIR);
  const providersFiles = collectSourceFiles(PROVIDERS_DIR);
  const allFiles = [...coreFiles, ...cliFiles, ...a2aFiles, ...providersFiles];

  describe('Old source files must not exist after rename', () => {
    const oldFiles = [
      resolve(CORE_DIR, 'src/core/geminiChat.ts'),
      resolve(CORE_DIR, 'src/core/geminiChatTypes.ts'),
      resolve(CLI_DIR, 'src/gemini.tsx'),
    ];

    it.each(oldFiles)('old file %s must not exist', (filePath) => {
      // BEFORE IMPLEMENTATION: These files still exist, so the test fails.
      // AFTER IMPLEMENTATION: These files are removed, so the test passes.
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe('Package metadata must not expose old export subpaths', () => {
    it('packages/core/package.json must not expose ./core/geminiChat.js', () => {
      const pkgPath = resolve(CORE_DIR, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const exports = pkg.exports ?? {};
      const hasOldExport = './core/geminiChat.js' in exports;
      expect(hasOldExport).toBe(false);
    });
  });

  describe('Old import paths must not remain in source/test files', () => {
    // These import paths reference the old module names, not legitimate Gemini provider paths.
    // Uses string token checks instead of regex to satisfy sonarjs rules.

    const oldImportPathChecks: ReadonlyArray<{
      token: string;
      description: string;
    }> = [
      {
        token: "from './geminiChat.js'",
        description:
          "import from './geminiChat.js' (should be './chatSession.js')",
      },
      {
        token: 'geminiChat.js',
        description:
          'import referencing geminiChat.js (should be chatSessionTypes.js)',
      },
      {
        token: 'geminiChatTypes.js',
        description:
          "import from './geminiChatTypes.js' (should be './chatSessionTypes.js')",
      },
      {
        token: "from './gemini.js'",
        description: "CLI import from '../gemini.js' (should be '../cli.js')",
      },
      {
        token: "from '../gemini.js'",
        description: "CLI import from '../gemini.js' (should be '../cli.js')",
      },
      {
        token: "from './gemini.tsx'",
        description: "CLI import from '../gemini.tsx' (should be '../cli.tsx')",
      },
      {
        token: "from '../gemini.tsx'",
        description: "CLI import from '../gemini.tsx' (should be '../cli.tsx')",
      },
    ];

    for (const { token, description } of oldImportPathChecks) {
      it(`must not contain ${description}`, () => {
        const hits = searchTokenInFiles(allFiles, token);
        expect(hits).toStrictEqual([]);
      });
    }
  });

  describe('Old class/type names must not remain as provider-agnostic exports', () => {
    const oldClassChecks: ReadonlyArray<{
      token: string;
      description: string;
    }> = [
      {
        token: 'GeminiChat',
        description: 'GeminiChat class/type name (should be ChatSession)',
      },
      {
        token: 'GeminiClient',
        description: 'GeminiClient class/type name (should be AgentClient)',
      },
    ];

    for (const { token, description } of oldClassChecks) {
      it(`must not contain ${description}`, () => {
        const hits = searchTokenInFiles(allFiles, token);
        const violations = filterViolations(hits);
        expect(violations).toStrictEqual([]);
      });
    }
  });

  describe('Old accessor/field/variable names must not remain', () => {
    const oldNameChecks: ReadonlyArray<{
      token: string;
      description: string;
    }> = [
      {
        token: 'getGeminiClient',
        description: 'getGeminiClient() accessor (should be getAgentClient())',
      },
      {
        token: 'geminiClient',
        description: 'geminiClient field/property (should be agentClient)',
      },
      {
        token: 'createGeminiChatRuntime',
        description:
          'createGeminiChatRuntime (should be createChatSessionRuntime)',
      },
      {
        token: 'GeminiChatConfigShape',
        description: 'GeminiChatConfigShape (should be ChatSessionConfigShape)',
      },
      {
        token: 'GeminiChatRuntimeOptions',
        description:
          'GeminiChatRuntimeOptions (should be ChatSessionRuntimeOptions)',
      },
      {
        token: 'GeminiChatRuntimeResult',
        description:
          'GeminiChatRuntimeResult (should be ChatSessionRuntimeResult)',
      },
      {
        token: 'getRuntimeGeminiClient',
        description: 'getRuntimeGeminiClient (should be getRuntimeAgentClient)',
      },
      {
        token: 'createGeminiChat',
        description: 'createGeminiChat() (should be createChatSession())',
      },
      {
        token: 'addShellCommandToGeminiHistory',
        description:
          'addShellCommandToGeminiHistory (should be addShellCommandToAgentHistory)',
      },
      {
        token: 'mockGeminiClient',
        description: 'mockGeminiClient (should be mockAgentClient)',
      },
      {
        token: 'makeGeminiClient',
        description: 'makeGeminiClient (should be makeAgentClient)',
      },
      {
        token: 'previousGeminiClient',
        description: 'previousGeminiClient (should be previousAgentClient)',
      },
      {
        token: 'newGeminiClient',
        description: 'newGeminiClient (should be newAgentClient)',
      },
    ];

    for (const { token, description } of oldNameChecks) {
      it(`must not contain ${description}`, () => {
        const hits = searchTokenInFiles(allFiles, token);
        expect(hits).toStrictEqual([]);
      });
    }
  });

  describe('GeminiClient/geminiClient inside geminiStream directory must not remain', () => {
    // Even though geminiStream/ directory name is preserved,
    // provider-agnostic client symbols inside must be renamed.
    const geminiStreamFiles = collectSourceFiles(
      resolve(CLI_DIR, 'src/ui/hooks/geminiStream'),
    );

    it('must not contain GeminiClient type references inside geminiStream/', () => {
      const hits = searchTokenInFiles(geminiStreamFiles, 'GeminiClient');
      expect(hits).toStrictEqual([]);
    });

    it('must not contain geminiClient field/param references inside geminiStream/', () => {
      const hits = searchTokenInFiles(geminiStreamFiles, 'geminiClient');
      expect(hits).toStrictEqual([]);
    });

    it('must not contain getGeminiClient accessor inside geminiStream/', () => {
      const hits = searchTokenInFiles(geminiStreamFiles, 'getGeminiClient');
      expect(hits).toStrictEqual([]);
    });

    it('must not contain mockGeminiClient inside geminiStream/', () => {
      const hits = searchTokenInFiles(geminiStreamFiles, 'mockGeminiClient');
      expect(hits).toStrictEqual([]);
    });

    it('must not contain makeGeminiClient inside geminiStream/', () => {
      const hits = searchTokenInFiles(geminiStreamFiles, 'makeGeminiClient');
      expect(hits).toStrictEqual([]);
    });
  });

  describe('Core barrel export must not re-export old module path', () => {
    it('packages/core/src/index.ts must not export from ./core/geminiChat.js', () => {
      const indexPath = resolve(CORE_DIR, 'src/index.ts');
      const content = readFileSync(indexPath, 'utf-8');
      const hasOldExport = content.includes("from './core/geminiChat.js'");
      expect(hasOldExport).toBe(false);
    });
  });

  describe('Old CLI entry import paths must not remain', () => {
    it('packages/cli/index.ts must not import from ./src/gemini.js', () => {
      const indexPath = resolve(CLI_DIR, 'index.ts');
      const content = readFileSync(indexPath, 'utf-8');
      const hasOldImport = content.includes("from './src/gemini.js'");
      expect(hasOldImport).toBe(false);
    });
  });

  describe('Old Config accessor and field names must not remain', () => {
    it('configBaseCore must not have getGeminiClient() accessor', () => {
      const filePath = resolve(CORE_DIR, 'src/config/configBaseCore.ts');
      const content = readFileSync(filePath, 'utf-8');
      const codeOnly = stripCommentsAndStrings(content);
      expect(codeOnly.includes('getGeminiClient')).toBe(false);
    });

    it('configBaseCore must not have geminiClient field', () => {
      const filePath = resolve(CORE_DIR, 'src/config/configBaseCore.ts');
      const content = readFileSync(filePath, 'utf-8');
      const codeOnly = stripCommentsAndStrings(content);
      expect(codeOnly.includes('geminiClient')).toBe(false);
    });

    it('config.ts must not have getGeminiClient() accessor or geminiClient field', () => {
      const filePath = resolve(CORE_DIR, 'src/config/config.ts');
      const content = readFileSync(filePath, 'utf-8');
      const codeOnly = stripCommentsAndStrings(content);
      expect(codeOnly.includes('getGeminiClient')).toBe(false);
      expect(codeOnly.includes('geminiClient')).toBe(false);
    });
  });
});
