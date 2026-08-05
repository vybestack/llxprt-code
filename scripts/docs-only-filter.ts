/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Documentation-only change detector (issue #342).
 *
 * A change set is documentation-only ONLY IF every touched path (including
 * both sides of a rename) is documentation. Classification is a conservative
 * ALLOWLIST: anything not explicitly documentation is CODE, which makes the
 * required `Test`/`Lint` checks run (fail closed toward *more* CI).
 *
 * Why this exists separately from the inline workflow bash it replaces:
 * the prompt-config defaults markdown tree under packages/core/src, the
 * `.expected.txt` test fixtures, packages/cli/src markdown packaged source,
 * etc. are `.md`/`.txt` files that are NOT documentation — they are runtime
 * prompt inputs, test fixtures, or packaged source. A naive "any .md is docs"
 * rule turns a runtime behaviour change into a green required check with zero
 * testing (a real fail-open found in review).
 *
 * Cross-classifier invariant (MUST hold): every path this module classifies as
 * DOCS must be a no-shard path for `scripts/affected-test-shards.ts`
 * (selectAffectedShards selects no shards). That is why the CODE prefixes below
 * are excluded from DOCS — they correspond to paths that select shards or force
 * a full test run. Being stricter than the shard selector is safe; being looser
 * is a bug because the `test` aggregator still consults the shard selector, so a
 * misclassification here fails closed instead of greening the required check.
 *
 * Path-only, dependency-free (Node built-ins only). The GitHub PR file-list API
 * response is external/untrusted input, so its shape is validated here.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stdout, stderr } from 'node:process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A structured entry from GET /repos/{owner}/{repo}/pulls/{n}/files. */
export interface ChangedFileEntry {
  readonly filename: string;
  readonly status: string;
  readonly previous_filename?: string;
  readonly patch?: string;
}

/** Per-path classification. DOCS may skip heavy CI; CODE must run it. */
export type PathClassification = 'docs' | 'code';

/** Per-path explanation of the docs/code decision. */
export interface DocsPathReason {
  readonly path: string;
  readonly classification: PathClassification;
  readonly reason: string;
}

/** Result of classifying a whole change set. */
export interface DocsOnlyResult {
  readonly docsOnly: boolean;
  readonly reason: string;
  readonly pathReasons: readonly DocsPathReason[];
}

/** Parameters for {@link classifyDocsOnly}. */
export interface ClassifyDocsOnlyParams {
  readonly entries: readonly ChangedFileEntry[];
  /**
   * Authoritative PR `changed_files` count. Deliberately a required key (not
   * `?:`) so a caller cannot silently omit the ceiling check; an unusable
   * count must be passed explicitly as `undefined` and fails closed.
   */
  readonly changedFiles: number | undefined;
}

/** Parsed CLI options. */
interface ParsedArgs {
  readonly filesJson?: string;
  readonly changedFiles?: number;
  readonly output?: string;
  readonly help?: boolean;
}

// ---------------------------------------------------------------------------
// Classification tables
// ---------------------------------------------------------------------------

/**
 * Directory prefixes that are always CODE — checked BEFORE any extension rule.
 * Each corresponds to a path that selects test shards or forces a full test run
 * in `scripts/affected-test-shards.ts` (see the cross-classifier invariant
 * above), or is otherwise source/infra rather than documentation.
 */
const CODE_PREFIXES: readonly string[] = [
  'packages/',
  'scripts/',
  'integration-tests/',
  'evals/',
  'test-setup/',
  'test-scripts/',
  'shell-scripts/',
  'eslint-rules/',
  'schemas/',
  'profiles/',
  '.github/',
  '.husky/',
  'bundle/',
];

/**
 * Directory prefixes that are always DOCS. Each is a no-shard path for the test
 * shard selector, satisfying the cross-classifier invariant.
 */
const DOCS_PREFIXES: readonly string[] = [
  'docs/',
  'dev-docs/',
  'project-plans/',
  'research/',
];

/** Root-level (no `/`) documentation basenames/prefixes. */
const ROOT_DOC_PREFIX_RE =
  /^(README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|ROADMAP)/i;

/** Root-level documentation file extensions. */
const DOC_EXTENSION_RE = /\.(md|mdx|rst|txt|adoc)$/i;

/**
 * `.gitignore` patch is docs ONLY when every content add/remove line relates to
 * the `docs/reference` ignore carve-out (an `!docs/reference/` un-ignore line or
 * a `# ...docs/reference` comment line). Matches the rule the workflow used.
 */
const GITIGNORE_CONTENT_LINE_RE = /^[+-][^+-]/;
const GITIGNORE_DOCS_LINE_RE = /^[+-](!docs\/reference\/|#.*docs\/reference)/;

// ---------------------------------------------------------------------------
// Path classification (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * `.gitignore` counts as documentation ONLY when its patch touches nothing but
 * `docs/reference` ignore lines. No patch (unavailable) → CODE (fail closed).
 * Mirrors the patch-inspection rule the workflow has used since issue #342.
 */
export function gitignoreIsDocs(patch: string | undefined): boolean {
  if (patch === undefined || patch === '') return false;
  for (const line of patch.split('\n')) {
    if (!GITIGNORE_CONTENT_LINE_RE.test(line)) continue;
    if (!GITIGNORE_DOCS_LINE_RE.test(line)) return false;
  }
  return true;
}

function isRootLevel(path: string): boolean {
  return !path.includes('/');
}

/**
 * Classifies a single path. `.gitignore` needs its patch (the only path whose
 * docs-vs-code decision depends on content); pass `undefined` to fail closed.
 */
export function classifyPath(
  path: string,
  gitignorePatch?: string,
): PathClassification {
  if (path === '') return 'code';
  if (path === '.gitignore') {
    return gitignoreIsDocs(gitignorePatch) ? 'docs' : 'code';
  }
  if (CODE_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'code';
  if (DOCS_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'docs';
  if (isRootLevel(path)) {
    if (path === 'AGENTS.md') return 'docs';
    if (ROOT_DOC_PREFIX_RE.test(path)) return 'docs';
    if (DOC_EXTENSION_RE.test(path)) return 'docs';
  }
  return 'code';
}

/**
 * Classifies a single structured file entry. For a renamed entry, BOTH the new
 * filename AND the previous filename must classify as docs; otherwise CODE.
 * This closes the "rename .gitignore to something.md" bypass: the previous
 * `.gitignore` path is classified without a patch, which fails closed to CODE.
 */
export function classifyEntry(entry: ChangedFileEntry): PathClassification {
  const filenameSide = classifyPath(entry.filename, entry.patch);
  const previous = entry.previous_filename;
  if (previous === undefined || previous === '') return filenameSide;
  // The previous path has no dedicated patch; classifying `.gitignore` without
  // one fails closed to CODE (a rename away from .gitignore is a code change).
  const previousSide = classifyPath(previous);
  return filenameSide === 'docs' && previousSide === 'docs' ? 'docs' : 'code';
}

// ---------------------------------------------------------------------------
// Change-set classification (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Classifies a whole change set as docs-only iff every entry is docs AND the
 * returned entry count matches the authoritative PR `changed_files` count.
 *
 * Fail-closed rules (docsOnly=false):
 * - zero entries
 * - `changedFiles` is not a usable count (undefined, NaN, negative, fractional)
 * - `changedFiles` not equal to the entry count (API truncation)
 * - any entry that is CODE, unclassifiable, or part of a non-docs rename
 */
export function classifyDocsOnly({
  entries,
  changedFiles,
}: ClassifyDocsOnlyParams): DocsOnlyResult {
  if (entries.length === 0) {
    return {
      docsOnly: false,
      reason: 'no changed files provided — fail closed to full CI',
      pathReasons: [],
    };
  }

  // An unusable count must fail closed rather than skip the ceiling check:
  // without a trustworthy total there is no way to know the API returned every
  // changed file (issue #342 R3). Note this rejects the value, it does not
  // bypass the comparison — bypassing is exactly the fail-open being avoided.
  if (!Number.isInteger(changedFiles) || (changedFiles as number) < 0) {
    return {
      docsOnly: false,
      reason: `unusable changed_files count (${String(changedFiles)}); cannot verify the API returned every file — fail closed to full CI`,
      pathReasons: [],
    };
  }

  if (changedFiles !== entries.length) {
    return {
      docsOnly: false,
      reason: `API truncation: returned ${entries.length} entries but PR reports ${changedFiles} changed files — fail closed to full CI`,
      pathReasons: [],
    };
  }

  const pathReasons: DocsPathReason[] = [];
  for (const entry of entries) {
    const classification = classifyEntry(entry);
    const previous = entry.previous_filename;
    const detail =
      previous !== undefined && previous !== ''
        ? `rename '${previous}' -> '${entry.filename}'`
        : `'${entry.filename}'`;
    pathReasons.push({
      path: entry.filename,
      classification,
      reason:
        classification === 'docs'
          ? `${detail} is documentation`
          : `${detail} is not documentation (CODE)`,
    });
    if (classification === 'code') {
      return {
        docsOnly: false,
        reason: `${detail} is not documentation-only — fail closed to full CI`,
        pathReasons,
      };
    }
  }

  return {
    docsOnly: true,
    reason: 'all changed paths are documentation',
    pathReasons,
  };
}

// ---------------------------------------------------------------------------
// External input validation
// ---------------------------------------------------------------------------

/**
 * Validates one raw object from the GitHub PR files API. Returns the typed
 * entry, or `null` when the shape cannot be trusted (fail closed upstream).
 */
export function parseEntry(raw: unknown): ChangedFileEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const filename = rec['filename'];
  if (typeof filename !== 'string' || filename === '') return null;
  const status = rec['status'];
  const previous = rec['previous_filename'];
  const patch = rec['patch'];
  return {
    filename,
    status: typeof status === 'string' ? status : 'modified',
    previous_filename:
      typeof previous === 'string' && previous !== '' ? previous : undefined,
    patch: typeof patch === 'string' ? patch : undefined,
  };
}

/**
 * Parses JSON safely. Returns `undefined` when `text` is not valid JSON so
 * callers can fall back to line-by-line NDJSON parsing.
 */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Type guard keeping only parsed, non-null entries (no `as` assertion). */
function isEntry(entry: ChangedFileEntry | null): entry is ChangedFileEntry {
  return entry !== null;
}

/**
 * Parses a single JSON array of entries. Returns `null` when `raw` is not a
 * JSON array, so the caller can fall back to NDJSON parsing.
 */
function parseJsonArrayDocument(raw: string): ChangedFileEntry[] | null {
  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed)) return null;
  return parsed.map(parseEntry).filter(isEntry);
}

/**
 * Parses NDJSON (one JSON object per non-empty line, as emitted across pages by
 * `gh api --paginate --jq '.[]'`). Malformed lines are skipped.
 */
function parseNdjsonLines(raw: string): ChangedFileEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(tryParseJson)
    .map(parseEntry)
    .filter(isEntry);
}

/**
 * Parses a file that is either a JSON array of entries or NDJSON (one entry per
 * line, as `gh api --paginate --jq '.[]'` emits across pages). Malformed lines
 * are skipped; a totally unparseable file yields an empty list (fail closed).
 */
export function parseEntriesFile(filePath: string): ChangedFileEntry[] {
  const raw = readFileSync(filePath, 'utf8').trim();
  if (raw === '') return [];
  return parseJsonArrayDocument(raw) ?? parseNdjsonLines(raw);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args: readonly string[]): ParsedArgs {
  const opts: {
    filesJson?: string;
    changedFiles?: number;
    output?: string;
    help?: boolean;
  } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--files-json') {
      opts.filesJson = args[++i];
    } else if (a === '--changed-files') {
      opts.changedFiles = parseChangedFilesArg(args[++i]);
    } else if (a === '--output') {
      opts.output = args[++i];
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

/**
 * Parses the `--changed-files` value. An empty/non-numeric value yields
 * `undefined` (count unavailable), which the CLI treats as fail-closed.
 */
function parseChangedFilesArg(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function printHelp(): void {
  stdout.write(`Usage: docs-only-filter.ts [options]

Options:
  --files-json <path>    Path to PR files: a JSON array or NDJSON (gh api --paginate --jq '.[]')
  --changed-files <N>    Authoritative PR changed_files count; mismatch => docs_only=false
  --output <mode>        Output mode: json (default) or github-actions
  --help                 Show this help

Output (json): a single JSON object with docsOnly, reason, and pathReasons.
Output (github-actions): writes docs_only to GITHUB_OUTPUT and a summary to
GITHUB_STEP_SUMMARY for CI. Always exits 0; API/parse failures resolve to
docs_only=false (run full CI) so a detector blip never wedges a PR.
`);
}

/**
 * Flattens newlines out of a PR-controlled string so a filename containing one
 * cannot break the step-summary markdown. Uses split/join rather than a regex
 * because a literal CR/LF character class trips `no-control-regex`.
 */
function sanitizeGhValue(value: string): string {
  return value.split('\r').join(' ').split('\n').join(' ');
}

/**
 * Writes the docs_only decision to GITHUB_OUTPUT and a summary to
 * GITHUB_STEP_SUMMARY. PR-controlled values are sanitized of CR/LF to prevent
 * GITHUB_OUTPUT injection. Mirrors the output shape the workflow consumes.
 */
function outputGithubActions(result: DocsOnlyResult): void {
  const ghOutputPath = process.env.GITHUB_OUTPUT;
  const ghSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  const docsOnlyStr = String(result.docsOnly);
  const safeReason = sanitizeGhValue(result.reason);

  if (ghOutputPath) {
    appendFileSync(ghOutputPath, `docs_only=${docsOnlyStr}\n`);
  }

  if (ghSummaryPath) {
    const summary = [
      '### Documentation-only detection (issue #342)',
      '',
      `**Docs only:** \`${docsOnlyStr}\``,
      `**Reason:** \`${safeReason}\``,
    ];
    appendFileSync(ghSummaryPath, summary.join('\n') + '\n');
  }

  stdout.write(`docs_only=${docsOnlyStr}\nreason=${result.reason}\n`);
}

/** Builds a fail-closed result for CLI-level problems (always docs_only=false). */
function failClosed(reason: string): DocsOnlyResult {
  return { docsOnly: false, reason, pathReasons: [] };
}

function emit(result: DocsOnlyResult, outputMode: string): void {
  if (outputMode === 'github-actions') {
    outputGithubActions(result);
  } else {
    stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

function main(): void {
  const opts = parseArgs(argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  const outputMode: string =
    typeof opts.output === 'string' ? opts.output : 'json';

  try {
    // --files-json is required to classify a PR.
    if (typeof opts.filesJson !== 'string') {
      stderr.write('Error: --files-json <path> is required\n');
      emit(
        failClosed('no PR file list provided — fail closed to full CI'),
        outputMode,
      );
      return;
    }

    const entries = parseEntriesFile(opts.filesJson);

    // changed_files unavailable (empty/invalid flag) => cannot guard against the
    // 3000-file API ceiling, so fail closed to full CI (issue #342 R3: if either
    // value is unavailable, docs_only=false). classifyDocsOnly additionally
    // fails closed when the returned entry count disagrees with changed_files.
    if (opts.changedFiles === undefined) {
      emit(
        failClosed(
          'GitHub API changed_files count unavailable — fail closed to full CI',
        ),
        outputMode,
      );
      return;
    }

    const result = classifyDocsOnly({
      entries,
      changedFiles: opts.changedFiles,
    });
    emit(result, outputMode);
  } catch (error) {
    // Any unexpected failure resolves to docs_only=false so the job never
    // wedges a PR (issue #342 R4). Exit 0; GitHub then runs full CI.
    const msg = error instanceof Error ? error.message : String(error);
    emit(
      failClosed(`docs-only detector failed (${msg}) — fail closed to full CI`),
      outputMode,
    );
  }
}

const isMain =
  argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Single process-level boundary that makes the documented "always exits 0"
  // contract structurally true, rather than nesting guards around each write.
  // main() already reports its own failures; this only covers a failure of the
  // reporting path itself (e.g. GITHUB_OUTPUT is unwritable). When no
  // docs_only is emitted the workflow reads an empty output, which is
  // `!= 'true'` and therefore runs full CI — the fail-closed default.
  try {
    main();
  } catch (error) {
    stderr.write(
      `docs-only detector could not report a result: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
  exit(0);
}
