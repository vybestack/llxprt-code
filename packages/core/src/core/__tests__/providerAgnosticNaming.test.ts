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
import { execSync } from 'child_process';

// ---- Configuration ----

// __dirname = .../packages/core/src/core/__tests__
// ../../.. = packages/core, ../../../.. = packages
const PACKAGES_DIR = resolve(__dirname, '../../../..');
const CORE_DIR = resolve(PACKAGES_DIR, 'core');
const CLI_DIR = resolve(PACKAGES_DIR, 'cli');
const A2A_DIR = resolve(PACKAGES_DIR, 'a2a-server');
const PROVIDERS_DIR = resolve(PACKAGES_DIR, 'providers');

// Paths to exclude from scans (generated, build artifacts, test output, etc.)
const EXCLUDE_PATTERNS = [
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
const ALLOWED_GEMINI_PATTERNS: Array<{ pattern: string; reason: string }> = [
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

// ---- Helpers ----

function isExcludedPath(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((pat) => filePath.includes(pat));
}

function isAllowedGeminiName(name: string, filePath: string): boolean {
  // Allow if the name/directory is in the allowed patterns
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
 */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/'[^']*'/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '""');
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
      if (isExcludedPath('/' + rel + '/')) continue;
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (
          entry === 'dist' ||
          entry === 'coverage' ||
          entry === 'node_modules' ||
          entry === 'tmp' ||
          entry === 'project-plans'
        ) {
          continue;
        }
        walk(full);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        if (
          !isExcludedPath(full) &&
          !full.includes('providerAgnosticNaming.test.ts')
        ) {
          results.push(full);
        }
      }
    }
  }
  walk(rootDir);
  return results;
}

/**
 * Search file contents for a regex pattern, excluding lines that are
 * inside allowed Gemini-specific contexts.
 */
function searchInFiles(
  files: string[],
  pattern: RegExp,
  label: string,
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
      if (pattern.test(line)) {
        const relPath = relative(PACKAGES_DIR, filePath);
        hits.push({ file: relPath, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
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
      const exports = pkg.exports || {};
      const hasOldExport = './core/geminiChat.js' in exports;
      expect(hasOldExport).toBe(false);
    });
  });

  describe('Old import paths must not remain in source/test files', () => {
    // These import paths reference the old module names, not legitimate Gemini provider paths.
    // We specifically target import/from declarations to avoid false positives from
    // documentation or plan files.

    const oldImportPathPatterns: Array<{
      pattern: RegExp;
      description: string;
    }> = [
      {
        pattern: /from\s+['"].*\/geminiChat\.js['"]/,
        description:
          "import from './geminiChat.js' (should be './chatSession.js')",
      },
      {
        pattern: /from\s+['"].*\/geminiChatTypes\.js['"]/,
        description:
          "import from './geminiChatTypes.js' (should be './chatSessionTypes.js')",
      },
      {
        pattern: /from\s+['"]\.\.?\/gemini\.js['"]/,
        description: "CLI import from '../gemini.js' (should be '../cli.js')",
      },
      {
        pattern: /from\s+['"]\.\.?\/gemini\.tsx['"]/,
        description: "CLI import from '../gemini.tsx' (should be '../cli.tsx')",
      },
    ];

    for (const { pattern, description } of oldImportPathPatterns) {
      it(`must not contain ${description}`, () => {
        const hits = searchInFiles(allFiles, pattern, description);
        expect(hits).toEqual([]);
      });
    }
  });

  describe('Old class/type names must not remain as provider-agnostic exports', () => {
    const oldClassPatterns: Array<{
      pattern: RegExp;
      description: string;
    }> = [
      {
        // Match: "class GeminiChat " or "export.*GeminiChat" but NOT "class MockGeminiChat"
        // We want to find "GeminiChat" as a type/class name, not as part of
        // a larger provider-specific identifier like "ServerGeminiChatCompressedEvent"
        // However, the plan scope says "GeminiChat" as a standalone old name must go.
        // This regex catches: import { GeminiChat }, : GeminiChat, class GeminiChat, etc.
        pattern:
          /(?:\b)(?:import\s+(?:type\s+)?\{[^}]*)\bGeminiChat\b(?:[^}]*\})|\bclass\s+GeminiChat\b|\bexport\s+.*\bGeminiChat\b|\bGeminiChat\b(?=\s*[,;}\)\s])/,
        description: 'GeminiChat class/type name (should be ChatSession)',
      },
      {
        pattern:
          /(?:\b)(?:import\s+(?:type\s+)?\{[^}]*)\bGeminiClient\b(?:[^}]*\})|\bclass\s+GeminiClient\b|\bexport\s+.*\bGeminiClient\b|\bGeminiClient\b(?=\s*[,;}\)\s])/,
        description: 'GeminiClient class/type name (should be AgentClient)',
      },
    ];

    for (const { pattern, description } of oldClassPatterns) {
      it(`must not contain ${description}`, () => {
        const hits = searchInFiles(allFiles, pattern, description);
        // Filter out allowed patterns
        const violations = hits.filter(
          (h) => !isAllowedGeminiName(h.text, h.file),
        );
        expect(violations).toEqual([]);
      });
    }
  });

  describe('Old accessor/field/variable names must not remain', () => {
    const oldNamePatterns: Array<{
      pattern: RegExp;
      description: string;
    }> = [
      {
        // getGeminiClient() method/accessor
        pattern: /\bgetGeminiClient\s*\(/,
        description: 'getGeminiClient() accessor (should be getAgentClient())',
      },
      {
        // geminiClient as a field/property/parameter (but not string literals)
        // Match: .geminiClient, this.geminiClient, { geminiClient, geminiClient:, geminiClient =
        pattern: /(?:\.|this\.|\{\s*|\,\s*)geminiClient\b/,
        description: 'geminiClient field/property (should be agentClient)',
      },
      {
        // createGeminiChatRuntime function
        pattern: /\bcreateGeminiChatRuntime\b/,
        description:
          'createGeminiChatRuntime (should be createChatSessionRuntime)',
      },
      {
        // GeminiChatConfigShape type
        pattern: /\bGeminiChatConfigShape\b/,
        description: 'GeminiChatConfigShape (should be ChatSessionConfigShape)',
      },
      {
        // GeminiChatRuntimeOptions type
        pattern: /\bGeminiChatRuntimeOptions\b/,
        description:
          'GeminiChatRuntimeOptions (should be ChatSessionRuntimeOptions)',
      },
      {
        // GeminiChatRuntimeResult type
        pattern: /\bGeminiChatRuntimeResult\b/,
        description:
          'GeminiChatRuntimeResult (should be ChatSessionRuntimeResult)',
      },
      {
        // getRuntimeGeminiClient helper
        pattern: /\bgetRuntimeGeminiClient\b/,
        description: 'getRuntimeGeminiClient (should be getRuntimeAgentClient)',
      },
      {
        // createGeminiChat() function in providers test
        pattern: /\bcreateGeminiChat\b/,
        description: 'createGeminiChat() (should be createChatSession())',
      },
      {
        // mockGeminiClient / MockGeminiClient local mock variable
        pattern: /\bmockGeminiClient\b/i,
        description: 'mockGeminiClient (should be mockAgentClient)',
      },
      {
        // makeGeminiClient helper
        pattern: /\bmakeGeminiClient\b/,
        description: 'makeGeminiClient (should be makeAgentClient)',
      },
      {
        // previousGeminiClient local variable
        pattern: /\bpreviousGeminiClient\b/,
        description: 'previousGeminiClient (should be previousAgentClient)',
      },
      {
        // newGeminiClient local variable
        pattern: /\bnewGeminiClient\b/,
        description: 'newGeminiClient (should be newAgentClient)',
      },
    ];

    for (const { pattern, description } of oldNamePatterns) {
      it(`must not contain ${description}`, () => {
        const hits = searchInFiles(allFiles, pattern, description);
        if (hits.length > 0) {
          // Still report but let the assertion produce the failure
          // with details of where the old names are found.
        }
        expect(hits).toEqual([]);
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
      const hits = searchInFiles(
        geminiStreamFiles,
        /\bGeminiClient\b/,
        'GeminiClient in geminiStream',
      );
      expect(hits).toEqual([]);
    });

    it('must not contain geminiClient field/param references inside geminiStream/', () => {
      const hits = searchInFiles(
        geminiStreamFiles,
        /(?:\.|this\.|\{\s*|\,\s*)geminiClient\b/,
        'geminiClient in geminiStream',
      );
      expect(hits).toEqual([]);
    });

    it('must not contain getGeminiClient accessor inside geminiStream/', () => {
      const hits = searchInFiles(
        geminiStreamFiles,
        /\bgetGeminiClient\s*\(/,
        'getGeminiClient in geminiStream',
      );
      expect(hits).toEqual([]);
    });

    it('must not contain mockGeminiClient inside geminiStream/', () => {
      const hits = searchInFiles(
        geminiStreamFiles,
        /\bmockGeminiClient\b/i,
        'mockGeminiClient in geminiStream',
      );
      expect(hits).toEqual([]);
    });

    it('must not contain makeGeminiClient inside geminiStream/', () => {
      const hits = searchInFiles(
        geminiStreamFiles,
        /\bmakeGeminiClient\b/,
        'makeGeminiClient in geminiStream',
      );
      expect(hits).toEqual([]);
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
      expect(codeOnly).not.toMatch(/\bgetGeminiClient\b/);
    });

    it('configBaseCore must not have geminiClient field', () => {
      const filePath = resolve(CORE_DIR, 'src/config/configBaseCore.ts');
      const content = readFileSync(filePath, 'utf-8');
      const codeOnly = stripCommentsAndStrings(content);
      expect(codeOnly).not.toMatch(/\bgeminiClient\b/);
    });

    it('config.ts must not have getGeminiClient() accessor or geminiClient field', () => {
      const filePath = resolve(CORE_DIR, 'src/config/config.ts');
      const content = readFileSync(filePath, 'utf-8');
      const codeOnly = stripCommentsAndStrings(content);
      expect(codeOnly).not.toMatch(/\bgetGeminiClient\b/);
      expect(codeOnly).not.toMatch(/\bgeminiClient\b/);
    });
  });
});
