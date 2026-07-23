/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authoritative configuration for the legacy-global-path guard (issue #2606,
 * Phase 10 / AD10).
 *
 * This module is the SINGLE source of truth for the guard's scan scope:
 *
 * 1. **Legacy-active patterns** — regexes matching HOME-anchored LLxprt
 *    legacy path constructions (`~/.llxprt`, `$HOME/.llxprt`,
 *    `${HOME}/.llxprt`, `homedir()` joined with `.llxprt`/`LLXPRT_DIR`, etc.).
 *    Workspace-relative `.llxprt` NEVER matches (it is not home-anchored).
 *
 * 2. **Scanned trees** — repo-relative globs for active surfaces (production
 *    source, scripts, docs, schemas). Tests are excluded (T1–T7 rewrites
 *    own test hygiene).
 *
 * 3. **Hard-excluded trees** — historical/plan directories that are never
 *    current guidance and must never be flagged.
 *
 * 4. **Allowlist** — loaded from `scripts/legacy-path-allowlist.json`; each
 *    entry narrows to a `path` and optional `pattern` (regex) so a new stale
 *    occurrence in an allowlisted file still fails.
 */

// ─── 1. Legacy-active patterns ──────────────────────────────────────────────

/**
 * A regex matching an active HOME-anchored legacy path construction.
 *
 * Design: the guard detects *newly added* active references rather than
 * comparing counts. Each pattern targets a concrete form of home anchoring.
 */
export interface LegacyPattern {
  /** Unique key identifying the pattern form. */
  readonly id: string;
  /** Case-sensitive regex (applied per-line). */
  readonly regex: RegExp;
  /** Human-readable description of the matched form. */
  readonly description: string;
}

export const LEGACY_PATTERNS: readonly LegacyPattern[] = [
  {
    id: 'tilde-slash',
    // Matches literal "~/.llxprt" — "~/" must be followed by ".llxprt"
    // (optionally with a trailing path, separator, space, or end-of-line).
    // The lookahead allows the path to be followed by /, end-of-line, or a
    // non-path character (space, quote, backtick, etc.) so that both
    // "~/.llxprt/settings.json" and "~/.llxprt is legacy" are detected.
    regex: /~\/\.llxprt(?=[/\s'"`)}$]|$)/,
    description: 'Literal `~/.llxprt` home-anchored path',
  },
  {
    id: 'dollar-home',
    regex: /\$HOME\/\.llxprt(?=[/\s'"`)}$]|$)/,
    description: 'Shell `$HOME/.llxprt` home-anchored path',
  },
  {
    id: 'brace-home',
    regex: /\$\{HOME\}\/\.llxprt(?=[/\s'"`)}$]|$)/,
    description: 'Shell `${HOME}/.llxprt` home-anchored path',
  },
  {
    id: 'windows-userprofile',
    regex: /%USERPROFILE%[/\\]+\.llxprt(?=[/\\\s'"`)}$]|$)/,
    description: 'Windows `%USERPROFILE%\\.llxprt` home-anchored path',
  },
  {
    id: 'unix-home-users',
    // Common explicit absolute home examples in documentation/guidance:
    // /Users/<name>/.llxprt (macOS) and /home/<name>/.llxprt (Linux).
    // These anchor to a concrete user home rather than a category path and
    // must use canonical `<config>`/`<data>` phrasing instead.
    regex: /\/(?:Users|home)\/[A-Za-z0-9._-]+\/\.llxprt(?=[/\s'"`)}$]|$)/,
    description:
      'Explicit absolute home path `/Users/<name>/.llxprt` or `/home/<name>/.llxprt`',
  },
  {
    id: 'windows-drive-home',
    // Windows drive-letter absolute home: C:\Users\<name>\.llxprt
    regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\\.llxprt(?=[/\\;\s'"`)}$]|$)/,
    description: 'Windows `C:\\Users\\<name>\\.llxprt` home-anchored path',
  },
  {
    id: 'homedir-dotllxprt',
    // homedir() followed (within a short window) by '.llxprt', either order
    regex:
      /homedir\(\)[^\n]{0,80}?['"`]?\s*[,)]\s*['"`]\.llxprt['"`]|['"`]\.llxprt['"`][^\n]{0,80}?homedir\(\)/,
    description: "`homedir()` joined with `'.llxprt'` (path.join/concat)",
  },
  {
    id: 'homedir-llxprt-dir',
    // homedir() followed (within a short window) by LLXPRT_DIR/LLXPRT_CONFIG_DIR
    regex:
      /homedir\(\)[^\n]{0,80}?\bLLXPRT_(CONFIG_)?DIR\b|\bLLXPRT_(CONFIG_)?DIR\b[^\n]{0,80}?homedir\(\)/,
    description:
      '`homedir()` joined with `LLXPRT_DIR`/`LLXPRT_CONFIG_DIR` (path.join/concat)',
  },
  {
    id: 'seatbelt-home-llxprt',
    // macOS Seatbelt sandbox profile: (string-append (param "HOME_DIR") "/.llxprt")
    // Matches any HOME_DIR param joined with .llxprt. Write grants using this
    // form are the active legacy write path that must be removed. Read-only
    // migration grants are allowlisted narrowly.
    regex: /\(string-append \(param "HOME_DIR"\) "\/\.llxprt"\)/,
    description:
      'macOS Seatbelt profile joins HOME_DIR with `/.llxprt` — write grants must use canonical CONFIG_DIR/DATA_DIR/LOG_DIR params instead',
  },
  {
    id: 'placeholder-home',
    // Documentation placeholder forms that anchor to the user home as the
    // active global default, e.g. `<home>/.llxprt` or `<home>/LLXPRT_DIR`.
    // These mislead readers into using the legacy home path and must use the
    // canonical `<config>`/`<data>` category shorthand instead. Workspace
    // placeholders like `<workspace>/.llxprt` are NOT home-anchored and do not
    // match.
    //
    // The `LLXPRT_(CONFIG_)?DIR` alternative uses a negative lookahead
    // `(?![\w-])` instead of a bare `\b`: `\b` would falsely match
    // `<home>/LLXPRT_DIR-backup` (word boundary between `R` and `-`), treating
    // a non-standard identifier as a legacy placeholder. The negative lookahead
    // rejects word-char and hyphen continuation only, so `LLXPRT_DIR-backup`
    // does not match while `LLXPRT_DIR.`, `LLXPRT_DIR)`, and `LLXPRT_DIR` at
    // end-of-line still do.
    regex:
      /<home>\/(?=\.llxprt(?=[/\s'"`)}$]|$)|LLXPRT_(CONFIG_)?DIR(?![\w-]))/,
    description:
      'Placeholder `<home>/.llxprt` home-anchored path in docs/guidance',
  },
  // ── Duplicate platform-path algorithm detection (finding C) ──────────────
  //
  // The central Storage authority computes the LLxprt data dir via
  // envPaths('llxprt-code') plus LLXPRT_DATA_HOME/CONFIG_HOME overrides.
  // Any other package that hand-rolls an equivalent algorithm
  // (XDG_DATA_HOME + LOCALAPPDATA + Library Application Support joined with
  // 'llxprt-code') is a forbidden duplicate. Storage is allowed via the
  // allowlist; these patterns flag new hand-rolled algorithms elsewhere.
  {
    id: 'platform-alg-xdg-data',
    // XDG_DATA_HOME joined with 'llxprt-code' outside the Storage authority.
    // The env-paths library (used by Storage) is excluded because it does
    // not reference XDG_DATA_HOME literally — it reads XDG_DATA_HOME via its
    // own internals.
    regex: /XDG_DATA_HOME[^\n]{0,60}?['"`]llxprt-code['"`]/,
    description:
      'Hand-rolled platform data-dir algorithm: XDG_DATA_HOME joined with `llxprt-code` (duplicate of Storage authority)',
  },
  {
    id: 'platform-alg-localappdata',
    regex: /LOCALAPPDATA[^\n]{0,60}?['"`]llxprt-code['"`]/,
    description:
      'Hand-rolled platform data-dir algorithm: LOCALAPPDATA joined with `llxprt-code` (duplicate of Storage authority)',
  },
  {
    id: 'platform-alg-app-support',
    regex:
      /Application Support[^\n]{0,60}?['"`](?:llxprt-code|LLxprtCode|LlxprtCode|LLxprt-Code)['"`]/,
    description:
      'Hand-rolled platform data-dir algorithm: Library/Application Support joined with an llxprt-code variant (duplicate of Storage authority)',
  },
  // ── Inconsistent system-settings env-name detection (finding C) ──────────
  //
  // The canonical system-settings env var is LLXPRT_SYSTEM_SETTINGS_PATH
  // (read inside Storage). The legacy alias LLXPRT_CODE_SYSTEM_SETTINGS_PATH
  // is honored ONLY inside Storage as a bounded compatibility fallback. Any
  // production source outside Storage that reads this alias is an
  // inconsistent duplicate authority.
  {
    id: 'legacy-sys-settings-env',
    // Matches reads of the deprecated alias in production source. Storage
    // itself is allowlisted (it implements the compatibility authority).
    regex: /\bLLXPRT_CODE_SYSTEM_SETTINGS_PATH\b/,
    description:
      'Deprecated system-settings env alias `LLXPRT_CODE_SYSTEM_SETTINGS_PATH` read outside the central Storage compatibility authority',
  },
  {
    id: 'legacy-sys-defaults-env',
    regex: /\bLLXPRT_CODE_SYSTEM_DEFAULTS_PATH\b/,
    description:
      'Deprecated system-defaults env alias `LLXPRT_CODE_SYSTEM_DEFAULTS_PATH` read outside the central Storage compatibility authority',
  },
];

// ─── 2. Scanned trees ───────────────────────────────────────────────────────

/**
 * Globs (relative to repo root) for active surfaces the guard scans.
 *
 * Production source excludes tests because the T1–T7 rewrites own test
 * hygiene; a test fixture with an injected temp `.llxprt` path is not an
 * active default.
 */
export const SCANNED_TREES: readonly string[] = [
  // Production source (tests/specs/__tests__ excluded via TEST_EXCLUDES).
  // Active production source suffixes include .js/.jsx/.mjs/.cjs in addition
  // to .ts/.tsx (issue #2606 finding G: expand active production source
  // suffixes as the plan requires).
  'packages/*/src/**/*.ts',
  'packages/*/src/**/*.tsx',
  'packages/*/src/**/*.js',
  'packages/*/src/**/*.jsx',
  'packages/*/src/**/*.mjs',
  'packages/*/src/**/*.cjs',
  // macOS Seatbelt sandbox profiles (.sb) — Finding #6: catch active
  // HOME_DIR/.llxprt write grants in sandbox profiles.
  'packages/*/src/**/*.sb',
  // Maintainer scripts
  'scripts/**',
  'shell-scripts/**',
  // User/developer documentation
  'docs/**',
  'dev-docs/**',
  // Generated schemas
  'schemas/**',
  // Root maintained docs
  'README.md',
  'CONTRIBUTING.md',
];

/**
 * Validate SCANNED_TREES entries fail-fast. The guard's `globToRegex`
 * supports ONLY `*` and `**`; any other glob metacharacter (`?`, `[...]`,
 * `{...}`), backslashes, absolute paths, parent traversal, or empty strings
 * would be silently dropped/mishandled, excluding active surfaces from
 * scanning. Returns a list of human-readable error strings (empty = valid).
 *
 * Pure function — no filesystem access — so it is unit-testable and called
 * from the guard's main() entry point to fail fast on malformed config.
 */
export function validateScannedTrees(
  trees: readonly string[],
): readonly string[] {
  const errors: string[] = [];
  for (const tree of trees) {
    if (tree === '') {
      errors.push(`SCANNED_TREES: empty entry is not allowed`);
      continue;
    }
    // Absolute paths (leading '/' or drive letter) escape the repo root.
    if (tree.startsWith('/')) {
      errors.push(
        `SCANNED_TREES: absolute path "${tree}" is not allowed (must be repo-relative)`,
      );
    }
    // Parent-directory traversal escapes the repo root.
    if (tree.split('/').includes('..')) {
      errors.push(
        `SCANNED_TREES: parent-directory traversal "${tree}" is not allowed (must stay within repo root)`,
      );
    }
    // Backslash is not a POSIX path separator and breaks globToRegex.
    if (tree.includes('\\')) {
      errors.push(
        `SCANNED_TREES: unsupported backslash in "${tree}" (use forward slashes)`,
      );
    }
    // Unsupported glob metacharacters: globToRegex only handles `*`/`**`.
    if (/[?[\]{}]/.test(tree)) {
      errors.push(
        `SCANNED_TREES: unsupported glob metacharacter in "${tree}" (only * and ** are supported)`,
      );
    }
  }
  return errors;
}

/**
 * Glob suffixes excluded from production-source scanning (test hygiene).
 */
export const TEST_EXCLUDE_SUFFIXES: readonly string[] = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.test.js',
  '.spec.js',
  '.test.jsx',
  '.spec.jsx',
  '.test.mjs',
  '.spec.mjs',
  '.test.cjs',
  '.spec.cjs',
  '/__tests__/',
  '/test-utils/',
];

/**
 * Repo-relative directory prefixes that are hard-excluded (historical/plan
 * material that is never current guidance).
 */
export const HARD_EXCLUDE_PREFIXES: readonly string[] = [
  'docs/plans/',
  'docs/release-notes/',
  'docs/merge-notes/',
  'project-plans/',
  'research/',
  'packages/core/analysis/',
  '.llxprt/',
  // The guard's own config module references the patterns by definition.
  'scripts/legacy-paths/',
];

/**
 * Specific files hard-excluded from scanning.
 */
export const HARD_EXCLUDE_FILES: readonly string[] = [
  'CHANGELOG.md',
  // The guard's own files reference the patterns by definition (pattern
  // definitions, self-test fixtures, and the allowlist reasons).
  'scripts/check-legacy-paths.ts',
  'scripts/legacy-path-allowlist.json',
];

/**
 * Directory base names pruned during filesystem walks (never scanned).
 */
export const PRUNE_DIRS: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__snapshots__',
  '.git',
  'bundle',
];

// ─── 4. Allowlist types ─────────────────────────────────────────────────────

/**
 * An allowlist entry from `scripts/legacy-path-allowlist.json`.
 *
 * - `path` — repo-relative file path (required). Whole-file allowlist.
 * - `pattern` — optional regex string. When present, only lines matching
 *   this regex in the file are suppressed; other legacy references in the
 *   same file still fail. Prefer `pattern` for narrow scoping.
 * - `reason` — human-readable justification identifying why the occurrence
 *   is intentional (migration-only, legacy-explanation, etc.).
 */
export interface AllowlistEntry {
  readonly path: string;
  readonly pattern?: string;
  readonly reason: string;
}

/**
 * Parsed allowlist: file path → compiled patterns (empty array = whole file).
 */
export type CompiledAllowlist = ReadonlyMap<
  string,
  Array<{ patterns: readonly RegExp[]; reason: string }>
>;
