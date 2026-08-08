/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Windows installed-command semantic relevance classifier (issue #2693).
 *
 * GitHub path filters cannot distinguish fields within a single JSON file, so
 * the root package.json stays a coarse candidate in the workflow's
 * paths: filter. This module provides a cheap, Ubuntu-hosted semantic gate
 * that prevents an unrelated ordinary root manifest script (e.g. the
 * lint:doc-links / lint:doc-placement additions from PR #2686) from
 * allocating an expensive windows-latest runner while preserving every real
 * release/install/package input.
 *
 * Architecture: fail-closed at the external boundary (workflow event /
 * GitHub-API data), fail-fast everywhere else. Uncertainty — an unparseable
 * manifest, an incomplete file list, an untrustworthy push base, a count
 * mismatch, an unsupported event — always selects running the Windows smoke.
 * The only decision that resolves to "skip" is a clean, fully-validated
 * pull-request whose only root-manifest change is in known-irrelevant
 * top-level fields or unrelated named scripts.
 *
 * The workflow's paths: filter remains the coarse candidate selection
 * (trigger). This classifier is the fine-grained gate (run vs skip the
 * expensive runner). It is a workflow-specific module — not a universal
 * public relevance abstraction.
 *
 * Path-only, dependency-free (Node built-ins only). GitHub API responses are
 * external/untrusted input, validated at the boundary.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stdout, stderr } from 'node:process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of the semantic relevance evaluation. */
export interface WindowsRelevanceResult {
  readonly relevant: boolean;
  readonly reason: string;
}

/** A structured changed-file entry (subset of the GitHub PR files API). */
export interface WindowsChangedFileEntry {
  readonly filename: string;
  readonly status: string;
  readonly previous_filename?: string;
}

/** Parameters for the pure relevance classifier. */
export interface ClassifyWindowsRelevanceParams {
  /** The GitHub event name (pull_request, push, workflow_dispatch, ...). */
  readonly event: string;
  /**
   * Every changed-file entry in the PR or push (structured, as reported by
   * the GitHub API, including status and previous_filename so deletions and
   * renames of relevant inputs are detected). Empty list is valid for
   * workflow_dispatch.
   */
  readonly changedEntries: readonly WindowsChangedFileEntry[];
  /**
   * Authoritative PR changed_files count. Required for PR events so the
   * API-ceiling guard can verify completeness. undefined for non-PR events
   * or when unavailable (fails closed).
   */
  readonly changedFilesCount: number | undefined;
  /**
   * Root package.json content at the PR base SHA. undefined when the file
   * does not exist at base, the API failed, or this is not a PR.
   */
  readonly baseManifest: string | undefined;
  /**
   * Root package.json content at the PR head SHA (or the checked-out copy).
   * undefined only when the manifest is genuinely absent or unreadable.
   */
  readonly headManifest: string | undefined;
}

/** Parsed CLI options. */
interface ParsedArgs {
  readonly output?: string;
  readonly help?: boolean;
}

// ---------------------------------------------------------------------------
// Path-relevance tables
// ---------------------------------------------------------------------------

/**
 * Root-level and glob path patterns that are DIRECTLY relevant to the Windows
 * installed-command smoke — every entry is traceable to a real input the job
 * consumes (issue #2693 REQ-2693-003).
 *
 * The root package.json is intentionally NOT here: it is a coarse candidate
 * evaluated by the semantic manifest diff, not a path-pattern match.
 * package-lock.json IS here because it is always relevant (npm ci and
 * release dependency binding consume it unconditionally).
 */
const RELEVANT_PATH_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ['package-lock.json', 'root lockfile (npm ci + release dependency binding)'],
  ['.nvmrc', 'Node version file (setup-node node-version-file)'],
  ['.bun-version', 'Bun version file (setup-bun bun-version-file)'],
  ['.npmrc', 'install/pack config (npm ci + npm pack read it)'],
  ['packages/cli/bin/', 'CLI launcher shims'],
  [
    'packages/cli/package.json',
    'CLI manifest (smoke reads it for bun version)',
  ],
  [
    'packages/cli/scripts/install-native-launchers.cjs',
    'native launcher installer',
  ],
  ['scripts/postinstall.cjs', 'root postinstall lifecycle behavior'],
  ['scripts/preinstall.cjs', 'root preinstall lifecycle behavior'],
  ['scripts/bind-release-deps.ts', 'release dependency binding helper'],
  ['scripts/prepare-package.ts', 'release package preparation helper'],
  [
    'scripts/lib/non-npm-release-packages.cjs',
    'release package-selection list',
  ],
  [
    'scripts/lib/npm-command.cjs',
    'npm invocation helper (smoke + release-pack consume it)',
  ],
  [
    'scripts/lib/tar-command.cjs',
    'tar helper (release-pack + release-install-smoke consume it)',
  ],
  [
    'scripts/utils/release-packages.ts',
    'release package-selection list (bind-release-deps consumes it)',
  ],
  [
    'scripts/utils/error-guards.ts',
    'error-guard utilities (bind-release-deps + build consume it)',
  ],
  [
    'scripts/tests/issue-2603-release-pack.cjs',
    'release-pack helper (consumes root workspaces + manifests)',
  ],
  [
    'scripts/tests/issue-2603-windows-probe.ts',
    'Windows probe (smoke behavioral check input)',
  ],
  [
    'scripts/tests/issue-2603-startup-benchmark.cjs',
    'startup benchmark (smoke child process)',
  ],
  ['scripts/windows-installed-command-smoke.cjs', 'Windows smoke orchestrator'],
  ['scripts/windows-installed-command-smoke/', 'Windows smoke modules'],
  [
    'scripts/windows-installed-command-relevance.ts',
    'this classifier (workflow wiring test)',
  ],
  [
    '.github/workflows/windows-installed-command.yml',
    'this workflow definition',
  ],
];

/**
 * Workspace manifest glob: packages/STAR/package.json. The release-pack helper
 * reads every workspace manifest to enumerate internal packages, so a change
 * to any of them is relevant.
 */
function isWorkspaceManifest(path: string): boolean {
  return /^packages\/[^/]+\/package\.json$/.test(path);
}

/**
 * Matches publishable package runtime source/index/bundle paths (the
 * release-pack smoke copies and packs these workspaces). Test/spec/
 * __tests__/__snapshots__ content is excluded so a package test-only change
 * allocates only the cheap relevance job, not the Windows runner.
 *
 * Patterns:
 * - packages/STAR/src/STARSTAR (runtime source, excludes test/spec/snapshots)
 * - packages/STAR/index.ts (publishable entry point)
 * - packages/cli/bundle/STARSTAR (CLI bundle output)
 */
function publishablePackageRuntimeReason(path: string): string | undefined {
  // Exclude test, spec, __tests__, and __snapshots__ paths entirely.
  if (
    path.includes('__tests__/') ||
    path.includes('__snapshots__/') ||
    /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(path) ||
    /\.bun\.test\.(ts|js)$/.test(path)
  ) {
    return undefined;
  }

  // packages/STAR/src/STARSTAR — runtime source
  if (/^packages\/[^/]+\/src\//.test(path)) {
    return `'${path}' is a publishable package runtime source input (release-pack smoke packs this workspace)`;
  }

  // packages/STAR/index.ts — publishable entry point
  if (/^packages\/[^/]+\/index\.ts$/.test(path)) {
    return `'${path}' is a publishable package entry point (release-pack smoke packs this workspace)`;
  }

  // packages/cli/bundle/STARSTAR — CLI bundle
  if (/^packages\/cli\/bundle\//.test(path)) {
    return `'${path}' is a CLI bundle input (release-pack smoke packs it)`;
  }

  return undefined;
}

/**
 * Returns the relevance reason for a path, or undefined if not relevant.
 *
 * Patterns ending in `/` are directory prefixes (startsWith match); all other
 * patterns are exact-file matches (equality only). This prevents
 * `package-lock.json.backup` from matching `package-lock.json` or
 * `.nvmrc.old` from matching `.nvmrc`.
 */
function pathRelevanceReason(path: string): string | undefined {
  for (const [pattern, reason] of RELEVANT_PATH_PATTERNS) {
    if (pattern.endsWith('/')) {
      if (path.startsWith(pattern)) {
        return `'${path}' is a relevant Windows input (${reason})`;
      }
    } else if (path === pattern) {
      return `'${path}' is a relevant Windows input (${reason})`;
    }
  }
  if (isWorkspaceManifest(path)) {
    return `'${path}' is a workspace manifest (release-pack reads all workspace manifests)`;
  }
  const pkgRuntime = publishablePackageRuntimeReason(path);
  if (pkgRuntime !== undefined) return pkgRuntime;
  return undefined;
}

/** Root manifest path constant. */
const ROOT_MANIFEST = 'package.json';

/**
 * Recognized GitHub changed-file statuses (subset of the files API).
 * Any status outside this set is treated as malformed and forces fail-closed.
 */
const RECOGNIZED_STATUSES: ReadonlySet<string> = new Set([
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
]);

/**
 * Validates a structured changed-file entry's shape. Returns an error message
 * string when the entry is malformed (unknown/empty status, or a renamed
 * entry without a nonempty previous_filename); returns null when valid.
 *
 * Called in the pure classifier so malformed external data fails closed even
 * in direct pure-classifier calls, not only via CLI parsing.
 */
function validateEntryShape(entry: WindowsChangedFileEntry): string | null {
  if (!RECOGNIZED_STATUSES.has(entry.status)) {
    return `entry '${entry.filename}' has unrecognized status '${entry.status}' — fail closed`;
  }
  if (
    entry.status === 'renamed' &&
    (entry.previous_filename === undefined || entry.previous_filename === '')
  ) {
    return `renamed entry '${entry.filename}' lacks previous_filename — fail closed`;
  }
  return null;
}

/**
 * Required packed assets that npm ALWAYS includes in the tarball regardless of
 * the `files` field, and that prepare-package.ts copies into each publishable
 * workspace. An ordinary content EDIT to one of these must NOT allocate
 * Windows (it is documentation), but a DELETION (or rename-away) breaks the
 * package and must run.
 */
const PACKED_ASSET_PATHS: ReadonlySet<string> = new Set([
  'README.md',
  'LICENSE',
]);

/**
 * Determines whether a structured entry removes (deletes or renames away from)
 * a required packed asset. Returns the asset path being removed, or undefined.
 */
function removedPackedAsset(
  entry: WindowsChangedFileEntry,
): string | undefined {
  if (entry.status === 'removed' && PACKED_ASSET_PATHS.has(entry.filename)) {
    return entry.filename;
  }
  if (
    entry.status === 'renamed' &&
    entry.previous_filename !== undefined &&
    PACKED_ASSET_PATHS.has(entry.previous_filename)
  ) {
    return entry.previous_filename;
  }
  return undefined;
}

/**
 * Returns all paths an entry touches (both sides of a rename). Used so a
 * rename to OR from a relevant path selects run.
 */
function entryPaths(entry: WindowsChangedFileEntry): readonly string[] {
  const paths = [entry.filename];
  if (entry.previous_filename !== undefined && entry.previous_filename !== '') {
    paths.push(entry.previous_filename);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// JSON value helpers (no type assertions)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Structural deep-equality for JSON values (the result of JSON.parse).
 * Handles nested objects, arrays, and primitives. Key order is irrelevant.
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (isJsonArray(a)) {
    if (!isJsonArray(b) || a.length !== b.length) return false;
    return a.every((val, i) => jsonDeepEqual(val, b[i]));
  }
  if (isJsonRecord(a)) {
    if (!isJsonRecord(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key, i) => key === bKeys[i] && jsonDeepEqual(a[key], b[key]),
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Semantic manifest diff
// ---------------------------------------------------------------------------

/**
 * npm lifecycle script names that npm ci / npm install executes and that
 * the release-pack helper invokes directly. A change to any of these can
 * alter install, build, or pack behavior, so it is always relevant.
 */
const LIFECYCLE_SCRIPTS: readonly string[] = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'dependencies',
];

/**
 * Root-manifest top-level keys that are provably irrelevant to install, build,
 * bind, or pack behavior. Everything else (including unknown keys) is treated
 * as potentially relevant per the fail-closed principle (issue #2693
 * REQ-2693-004).
 */
const IRRELEVANT_MANIFEST_KEYS: readonly string[] = [
  'name',
  'version',
  'description',
  'author',
  'license',
  'keywords',
  'homepage',
  'bugs',
  'repository',
  'contributors',
  'maintainers',
  'lint-staged',
  'private',
];

/**
 * Compares the lifecycle-script subset of two scripts objects. Returns
 * true when any lifecycle script was added, removed, or changed.
 */
export function lifecycleScriptsDiffer(
  baseScripts: unknown,
  headScripts: unknown,
): boolean {
  if (!isJsonRecord(baseScripts) || !isJsonRecord(headScripts)) {
    return !jsonDeepEqual(baseScripts, headScripts);
  }
  for (const script of LIFECYCLE_SCRIPTS) {
    if (!jsonDeepEqual(baseScripts[script], headScripts[script])) {
      return true;
    }
  }
  return false;
}

/** Result of a semantic manifest comparison. */
export interface ManifestDiffResult {
  /** true when a relevant field differs (Windows should run). */
  readonly relevant: boolean;
  readonly reason: string;
}

/**
 * Classifies a single manifest key change. Returns a ManifestDiffResult when
 * the change is relevant, or null when the key is irrelevant (equal values,
 * non-lifecycle scripts, or known-irrelevant metadata).
 */
function classifyManifestKeyChange(
  key: string,
  baseVal: unknown,
  headVal: unknown,
): ManifestDiffResult | null {
  if (jsonDeepEqual(baseVal, headVal)) return null;

  if (key === 'scripts') {
    if (lifecycleScriptsDiffer(baseVal, headVal)) {
      return {
        relevant: true,
        reason: 'root manifest lifecycle script changed (scripts subset)',
      };
    }
    // Non-lifecycle script changes are irrelevant.
    return null;
  }

  if (IRRELEVANT_MANIFEST_KEYS.includes(key)) return null;

  // Any other changed key — including workspaces, dependencies, overrides,
  // engines, packageManager, trustedDependencies, bin, files, config, type,
  // main, exports, imports, and unknown keys — is relevant (fail-closed on
  // unknown fields).
  return {
    relevant: true,
    reason: `root manifest field '${key}' changed`,
  };
}

/**
 * Compares two parsed root manifests field by field. Returns a relevant result
 * when any install-relevant field differs; returns not-relevant when the diff
 * is limited to formatting, key order, irrelevant metadata, or unrelated named
 * scripts.
 */
export function compareRootManifests(
  base: JsonRecord,
  head: JsonRecord,
): ManifestDiffResult {
  const allKeys = new Set<string>([...Object.keys(base), ...Object.keys(head)]);

  for (const key of allKeys) {
    const result = classifyManifestKeyChange(key, base[key], head[key]);
    if (result !== null) return result;
  }

  return {
    relevant: false,
    reason:
      'root manifest diff is limited to formatting, key order, irrelevant metadata, or unrelated named scripts',
  };
}

/**
 * Safely parses a JSON manifest string. Returns the parsed record or null
 * when the string is not valid JSON or not a JSON object.
 */
function tryParseManifest(text: string | undefined): JsonRecord | null {
  if (text === undefined || text === '') return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Relevance classification (pure, exported for testing)
// ---------------------------------------------------------------------------

/** Outcome of scanning the changed entries for relevant paths. */
type EntryScanOutcome =
  | { readonly hit: true; readonly reason: string }
  | { readonly hit: false; readonly manifestChanged: boolean };

/**
 * Scans structured changed entries for any relevant path or packed-asset
 * deletion. Returns a hit (relevant, with reason) or whether the root
 * manifest was among the changes.
 */
function scanChangedEntries(
  entries: readonly WindowsChangedFileEntry[],
): EntryScanOutcome {
  let manifestChanged = false;
  for (const fileEntry of entries) {
    // Fail closed on malformed external entry shapes (pure classifier level).
    const shapeError = validateEntryShape(fileEntry);
    if (shapeError !== null) {
      return { hit: true, reason: shapeError };
    }
    const removedAsset = removedPackedAsset(fileEntry);
    if (removedAsset !== undefined) {
      return {
        hit: true,
        reason: `required packed asset '${removedAsset}' was deleted or renamed away — fail closed`,
      };
    }
    for (const path of entryPaths(fileEntry)) {
      if (path === ROOT_MANIFEST) {
        manifestChanged = true;
        continue;
      }
      const reason = pathRelevanceReason(path);
      if (reason !== undefined) {
        return { hit: true, reason };
      }
    }
  }
  return { hit: false, manifestChanged };
}

/**
 * The core relevance classifier. Pure function — no I/O. All external data
 * (event name, structured file entries, manifests) is passed in.
 *
 * Fail-closed rules (relevant=true):
 * - workflow_dispatch (always run)
 * - any non-pull_request event (push base is untrustworthy)
 * - unusable or mismatched changedFilesCount for PR events
 * - root manifest present in changes but base or head cannot be parsed
 * - any entry path (filename or previous_filename) that matches a relevant
 *   pattern
 * - any workspace manifest changed
 * - deletion or rename-away of a required packed asset (README.md/LICENSE)
 * - semantic manifest diff that includes a relevant field
 *
 * Skip (relevant=false) only when:
 * - event is pull_request
 * - changedFilesCount is valid and matches the entry count
 * - the only root-manifest change is in known-irrelevant fields or unrelated
 *   scripts
 * - no other entry touches a relevant path or deletes a packed asset
 */
export function classifyWindowsRelevance(
  params: ClassifyWindowsRelevanceParams,
): WindowsRelevanceResult {
  const {
    event,
    changedEntries,
    changedFilesCount,
    baseManifest,
    headManifest,
  } = params;

  // workflow_dispatch always runs (manual trigger is explicit).
  if (event === 'workflow_dispatch') {
    return {
      relevant: true,
      reason: 'workflow_dispatch always runs',
    };
  }

  // Non-PR events (push, schedule, merge_group, ...): the push base SHA is
  // not reliably available for a semantic diff, so fail closed.
  if (event !== 'pull_request') {
    return {
      relevant: true,
      reason: `non-PR event '${event}' has an untrustworthy comparison base — fail closed`,
    };
  }

  // --- Pull-request path ---

  // Guard against the 3000-file API ceiling: if the count is unusable or does
  // not match the returned entry count, we cannot trust the file list.
  if (
    changedFilesCount === undefined ||
    !Number.isInteger(changedFilesCount) ||
    changedFilesCount < 0
  ) {
    return {
      relevant: true,
      reason: `unusable changed_files count (${String(changedFilesCount)}) — fail closed`,
    };
  }

  if (changedFilesCount !== changedEntries.length) {
    return {
      relevant: true,
      reason: `file count mismatch: API reports ${changedFilesCount} but received ${changedEntries.length} entries (possible truncation) — fail closed`,
    };
  }

  // Evaluate every changed entry for relevant paths and packed-asset deletion.
  const scan = scanChangedEntries(changedEntries);
  if (scan.hit) {
    return { relevant: true, reason: scan.reason };
  }

  // If the root manifest did not change, nothing relevant was found.
  if (!scan.manifestChanged) {
    return {
      relevant: false,
      reason:
        'no Windows-relevant path changed and root manifest unchanged — skip',
    };
  }

  // Root manifest changed — evaluate the semantic diff.
  const baseParsed = tryParseManifest(baseManifest);
  const headParsed = tryParseManifest(headManifest);

  if (baseParsed === null || headParsed === null) {
    return {
      relevant: true,
      reason:
        'root manifest changed but base or head could not be parsed — fail closed',
    };
  }

  const diff = compareRootManifests(baseParsed, headParsed);
  if (diff.relevant) {
    return { relevant: true, reason: diff.reason };
  }

  // Clean skip: manifest diff is limited to irrelevant fields/scripts.
  return {
    relevant: false,
    reason: diff.reason,
  };
}

// ---------------------------------------------------------------------------
// gh API argument construction (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Builds the `gh api` argument vector to fetch the root manifest content at a
 * given ref. The ref is passed as a query parameter via `-f` (which `gh api`
 * serializes as `?ref=` for GET requests), NOT via `-q` (the short alias of
 * `--jq`, which would be a malformed jq query and silently drop `.content`).
 *
 * Extracted as a pure function so the argument construction is directly
 * testable without spawning a process.
 */
export function buildManifestApiArgs(
  repo: string,
  ref: string,
): readonly string[] {
  return [
    'api',
    '--method',
    'GET',
    `repos/${repo}/contents/${ROOT_MANIFEST}`,
    '-H',
    'Accept: application/vnd.github+json',
    '-f',
    `ref=${ref}`,
    '--jq',
    '.content',
  ];
}

/**
 * Builds the `gh api` argument vector to fetch the full structured PR file
 * list (every field including status and previous_filename) as paginated
 * NDJSON. Uses `--jq '.[]'` (full entries), NOT `--jq '.[].filename'`
 * (filenames only), so deletions and renames can be classified.
 */
export function buildChangedFilesApiArgs(
  repo: string,
  prNumber: string,
): readonly string[] {
  return [
    'api',
    '--paginate',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repo}/pulls/${prNumber}/files`,
    '--jq',
    '.[]',
  ];
}

/** Builds the `gh api` argument vector to fetch the PR changed_files count. */
function buildChangedFilesCountArgs(
  repo: string,
  prNumber: string,
): readonly string[] {
  return [
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repo}/pulls/${prNumber}`,
    '--jq',
    '.changed_files',
  ];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args: readonly string[]): ParsedArgs {
  const opts: { output?: string; help?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--output') {
      opts.output = args[++i];
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp(): void {
  stdout.write(`Usage: windows-installed-command-relevance.ts [options]

Options:
  --output <mode>   Output mode: json (default) or github-actions
  --help            Show this help

Reads GITHUB_EVENT_NAME, GITHUB_REPOSITORY, and (for PRs) env vars set by the
workflow to fetch changed files and manifests via 'gh api'. Writes
windows_relevant to GITHUB_OUTPUT. Always exits 0; any error resolves to
windows_relevant=true (fail closed to running the Windows smoke).
`);
}

/** Sanitizes a value for safe GITHUB_OUTPUT writing (no CR/LF injection). */
function sanitizeGhValue(value: string): string {
  return value.split('\r').join(' ').split('\n').join(' ');
}

/** Writes the relevance decision to GITHUB_OUTPUT and stdout. */
function outputGithubActions(result: WindowsRelevanceResult): void {
  const ghOutputPath = process.env.GITHUB_OUTPUT;
  const ghSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  const relevantStr = String(result.relevant);
  const safeReason = sanitizeGhValue(result.reason);

  if (ghOutputPath) {
    appendFileSync(ghOutputPath, `windows_relevant=${relevantStr}\n`);
  }

  if (ghSummaryPath) {
    const summary = [
      '### Windows installed-command relevance (issue #2693)',
      '',
      `**Relevant:** \`${relevantStr}\``,
      `**Reason:** \`${safeReason}\``,
    ];
    appendFileSync(ghSummaryPath, summary.join('\n') + '\n');
  }

  stdout.write(`windows_relevant=${relevantStr}\nreason=${result.reason}\n`);
}

/** Builds a fail-closed result (always relevant=true). */
function failClosed(reason: string): WindowsRelevanceResult {
  return { relevant: true, reason };
}

/** Reads the checked-out root manifest (head side of the diff). */
function readHeadManifest(): string | undefined {
  try {
    return readFileSync(ROOT_MANIFEST, 'utf8');
  } catch {
    return undefined;
  }
}

/** Result shape expected from spawnSync (for the injectable boundary). */
type SpawnResult = SpawnSyncReturns<string>;

/**
 * Fetches the root manifest at a given git ref via 'gh api'. Returns
 * undefined on any failure (fail-closed upstream). Uses
 * {@link buildManifestApiArgs} so the argument vector is tested.
 */
function fetchManifestAtRef(
  ref: string,
  spawn: (args: readonly string[]) => SpawnResult,
): string | undefined {
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  if (repo === '') return undefined;
  const result = spawn(buildManifestApiArgs(repo, ref));
  if (result.status !== 0 || result.error || !result.stdout) {
    return undefined;
  }
  const b64 = result.stdout.trim();
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

/**
 * Parses a single raw GitHub PR-files-API entry into a typed entry, or null
 * when the shape cannot be trusted (fail closed upstream).
 *
 * Exported for direct boundary testing only; this is a workflow-specific
 * module, not a public API.
 */
export function parseFileEntry(raw: unknown): WindowsChangedFileEntry | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const filename = rec['filename'];
  if (typeof filename !== 'string' || filename === '') return null;
  const status = rec['status'];
  // Fail closed at the external boundary: reject unrecognized, missing, or
  // non-string status rather than normalizing to 'modified'. Returning null
  // drops the entry, causing a count mismatch against the authoritative
  // changed_files total and therefore fail-closed (relevant=true).
  if (typeof status !== 'string' || !RECOGNIZED_STATUSES.has(status)) {
    return null;
  }
  const previous = rec['previous_filename'];
  // A renamed entry must carry a nonempty previous_filename; anything else is
  // malformed and must be rejected (not silently dropped).
  if (
    status === 'renamed' &&
    (typeof previous !== 'string' || previous === '')
  ) {
    return null;
  }
  return {
    filename,
    status,
    ...(typeof previous === 'string' && previous !== ''
      ? { previous_filename: previous }
      : {}),
  };
}

/** Keeps only parsed, non-null entries (type guard, no assertion). */
function isParsedEntry(
  entry: WindowsChangedFileEntry | null,
): entry is WindowsChangedFileEntry {
  return entry !== null;
}

/**
 * Parses NDJSON (one JSON object per non-empty line, as emitted across pages
 * by `gh api --paginate --jq '.[]'`). Malformed lines are skipped.
 */
function parseNdjsonEntries(raw: string): WindowsChangedFileEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .map(parseFileEntry)
    .filter(isParsedEntry);
}

/**
 * Fetches the full structured list of changed files for a PR via 'gh api'.
 * Returns the typed entries and the authoritative changed_files count.
 * Failures resolve to an empty list / undefined count (fail-closed upstream).
 */
function fetchChangedFiles(
  prNumber: string,
  spawn: (args: readonly string[]) => SpawnResult,
): {
  entries: WindowsChangedFileEntry[];
  changedFiles: number | undefined;
} {
  const repo = process.env.GITHUB_REPOSITORY ?? '';

  const filesResult = spawn(buildChangedFilesApiArgs(repo, prNumber));
  const entries: WindowsChangedFileEntry[] =
    filesResult.stdout && filesResult.status === 0
      ? parseNdjsonEntries(filesResult.stdout)
      : [];

  const countResult = spawn(buildChangedFilesCountArgs(repo, prNumber));
  let changedFiles: number | undefined;
  if (countResult.stdout && countResult.status === 0) {
    const n = Number(countResult.stdout.trim());
    if (Number.isInteger(n) && n >= 0) {
      changedFiles = n;
    }
  }

  return { entries, changedFiles };
}

/** Default spawn boundary used in production. */
function defaultSpawn(args: readonly string[]): SpawnResult {
  return spawnSync('gh', [...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
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
    const event = process.env.GITHUB_EVENT_NAME ?? '';

    const prNumber =
      event === 'pull_request' || event === 'pull_request_target'
        ? (process.env.PR_NUMBER ?? '')
        : '';

    let changedEntries: readonly WindowsChangedFileEntry[] = [];
    let changedFilesCount: number | undefined = undefined;
    let baseManifest: string | undefined = undefined;

    if (event === 'pull_request' && prNumber !== '') {
      const fetched = fetchChangedFiles(prNumber, defaultSpawn);
      changedEntries = fetched.entries;
      changedFilesCount = fetched.changedFiles;

      const baseSha = process.env.PR_BASE_SHA ?? '';
      if (baseSha !== '') {
        baseManifest = fetchManifestAtRef(baseSha, defaultSpawn);
      }
    }

    const headManifest = readHeadManifest();

    const result = classifyWindowsRelevance({
      event,
      changedEntries,
      changedFilesCount,
      baseManifest,
      headManifest,
    });

    if (outputMode === 'github-actions') {
      outputGithubActions(result);
    } else {
      stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const result = failClosed(
      `relevance classifier failed (${msg}) — fail closed`,
    );
    if (outputMode === 'github-actions') {
      outputGithubActions(result);
    } else {
      stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  }
}

const isMain =
  argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Always exit 0: a reporting failure must never block the workflow. When no
  // windows_relevant is emitted, the workflow reads an empty output, which
  // is treated as relevant (fail-closed default: run the smoke). The
  // workflow's if: condition runs unless an explicit windows_relevant=false
  // was produced by a SUCCESSFUL relevance job.
  try {
    main();
  } catch (error) {
    stderr.write(
      `relevance classifier could not report a result: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
  exit(0);
}
