/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Affected test-shard selector (issue #2709).
 *
 * Given a CI event and changed file paths, selects the subset of the six
 * canonical test shards whose workspaces can observe the changes. Path-only,
 * dependency-free (Node built-ins only), completes in <100ms.
 *
 * Fail-closed: unknown paths, selector errors, and non-PR events select all
 * six shards. The checked-in graph is validated by check-affected-test-shards.ts.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { argv, exit, stdout } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, 'affected-test-shards.data.json');

// ---------------------------------------------------------------------------
// Data types (see SelectionResult and ReplayResult returns below)
// ---------------------------------------------------------------------------

/** Observer rule: a package whose tests scan an observed package's source. */
interface ObserverRule {
  readonly observingPackage: string;
  readonly selectShard: string;
  readonly reason: string;
}

/** The checked-in import graph shape (validated by the checker). */
export interface GraphData {
  readonly packageToShard: Record<string, string>;
  readonly shardOrder: readonly string[];
  readonly shardTimingsSeconds: Record<string, number>;
  readonly importEdges: Record<string, readonly string[]>;
  readonly testOnlyEdges: Record<string, readonly string[]>;
  readonly observers: Record<string, readonly ObserverRule[]>;
  readonly sharedInputs: readonly string[];
}

/** Per-path explanation of why shards were (or were not) selected. */
interface PathReason {
  readonly path: string;
  readonly reason: string;
  readonly shards: readonly string[];
}

/** Result of selecting affected test shards for an event + changed paths. */
export interface SelectionResult {
  readonly selectedShards: readonly string[];
  readonly skippedShards: readonly string[];
  readonly hasTests: boolean;
  readonly coverageComplete: boolean;
  readonly fullRunReason: string | null;
  readonly pathReasons: readonly PathReason[];
}

/** Aggregate result of replaying history through the selector. */
export interface ReplayResult {
  readonly commits: number;
  readonly forcedFull: number;
  readonly selectedLegs: number;
  readonly aggregateSeconds: number;
  readonly fullRunSeconds: number;
  readonly aggregateSavingSeconds: number;
  readonly criticalPathSeconds: number;
  readonly fullCriticalPathSeconds: number;
  readonly criticalPathSavingSeconds: number;
}

/** Reverse-dependency graph: package → packages that import it. */
export type ReverseGraph = Record<string, readonly string[]>;

/** Cached selection context derived from loaded graph data. */
interface SelectionContext {
  readonly packageToShard: Record<string, string>;
  readonly observers: Record<string, readonly ObserverRule[]>;
  readonly reverseGraph: ReverseGraph;
  readonly sharedSet: Set<string>;
}

/** Classification of a single changed path into shards or a full-run. */
interface PathClassification {
  readonly shards: readonly string[];
  readonly reason: string;
  readonly fullRun: boolean;
  readonly fullRunReason?: string;
}

/** Parameters for {@link selectAffectedShards}. */
interface SelectAffectedShardsParams {
  readonly event: string;
  readonly changedPaths: readonly string[];
  readonly dataPath?: string;
}

/** Parameters for {@link replayHistory}. */
interface ReplayHistoryParams {
  readonly count: number;
  readonly base?: string;
  readonly dataPath?: string;
}

/** A single commit and the files it changed. */
interface HistoryCommit {
  readonly commit: string;
  readonly files: readonly string[];
}

/** Parsed CLI options. */
interface ParsedArgs {
  readonly event?: string;
  readonly filesFrom?: string;
  readonly base?: string;
  readonly head?: string;
  readonly output?: string;
  readonly replay?: number;
  readonly help?: boolean;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Loads the checked-in graph data. Exported for tests and the checker.
 */
export function loadData(dataPath: string = DATA_PATH): GraphData {
  const raw = readFileSync(dataPath, 'utf8');
  const data: GraphData = JSON.parse(raw);
  return data;
}

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

const TEST_FILE_RE =
  /(__tests__|\.test\.|\.spec\.|\/tests\/|\/integration-tests\/|\/test\/)/;

const DOCS_RE =
  /^docs\/|^README|^CHANGELOG|^CONTRIBUTING|^ROADMAP|^SECURITY|^CODE_OF_CONDUCT/i;
const MARKDOWN_RE = /\.(md|mdx|rst|txt|adoc)$/i;
const PROJECT_PLAN_RE = /^project-plans\//;
const RESEARCH_RE = /^research\//;
const DEV_DOCS_RE = /^dev-docs\//;
const EVALS_RE = /^evals\//;

/** Extracts the package name from a packages/<name>/... path. */
export function packageFromPath(p: string): string | undefined {
  const m = p.match(/^packages\/([a-z0-9-]+)\//);
  return m ? m[1] : undefined;
}

export function isTestPath(p: string): boolean {
  return TEST_FILE_RE.test(p);
}

// ---------------------------------------------------------------------------
// Reverse-dependency graph construction
// ---------------------------------------------------------------------------

/**
 * Builds a reverse-dependency map: for each package, which packages import it
 * (production or test-only). Used to compute the transitive reverse closure.
 */
export function buildReverseGraph(
  importEdges: Record<string, readonly string[]>,
  testOnlyEdges: Record<string, readonly string[]>,
): ReverseGraph {
  const reverse = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    let set = reverse.get(to);
    if (set === undefined) {
      set = new Set<string>();
      reverse.set(to, set);
    }
    set.add(from);
  };
  for (const [pkg, deps] of Object.entries(importEdges)) {
    for (const dep of deps) addEdge(pkg, dep);
  }
  for (const [pkg, deps] of Object.entries(testOnlyEdges)) {
    for (const dep of deps) addEdge(pkg, dep);
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of reverse) out[k] = [...v].sort();
  return out;
}

/**
 * Computes the transitive set of packages that (transitively) import `pkg`.
 * Uses BFS over the reverse graph.
 */
export function reverseClosure(
  pkg: string,
  reverseGraph: ReverseGraph,
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [pkg];
  while (queue.length > 0) {
    const cur = queue.shift();
    const importers = cur !== undefined ? reverseGraph[cur] : undefined;
    if (!importers) continue;
    for (const importer of importers) {
      if (!result.has(importer)) {
        result.add(importer);
        queue.push(importer);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core selection logic
// ---------------------------------------------------------------------------

/**
 * Selects affected test shards for a given event and changed paths.
 */
export function selectAffectedShards({
  event,
  changedPaths,
  dataPath,
}: SelectAffectedShardsParams): SelectionResult {
  const data = loadData(dataPath);
  const allShards: readonly string[] = [...data.shardOrder];

  // Only `pull_request` selects from paths; all other/missing/unknown events
  // select all shards (fail closed to full).
  if (event !== 'pull_request') {
    const reason =
      event && event.length > 0
        ? `non-PR event '${event}' runs all shards`
        : 'missing/empty event runs all shards (selection is pull_request-only)';
    return fullRunResult(
      allShards,
      reason,
      changedPaths.map((p) => ({
        path: p,
        reason: `full-run: ${reason}`,
        shards: allShards,
      })),
    );
  }

  // Empty changed paths in a PR → fail closed.
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return fullRunResult(
      allShards,
      'no changed paths provided — fail closed to all shards',
      [],
    );
  }

  const ctx = buildSelectionContext(data);
  return selectFromPaths(changedPaths, ctx, allShards);
}

/** Builds the shared selection context from loaded data. */
function buildSelectionContext(data: GraphData): SelectionContext {
  return {
    packageToShard: data.packageToShard,
    observers: data.observers,
    reverseGraph: buildReverseGraph(data.importEdges, data.testOnlyEdges),
    sharedSet: new Set<string>(data.sharedInputs),
  };
}

/** Creates a full-run result object. */
function fullRunResult(
  allShards: readonly string[],
  fullRunReason: string,
  pathReasons: readonly PathReason[],
): SelectionResult {
  return {
    selectedShards: allShards,
    skippedShards: [],
    hasTests: true,
    coverageComplete: true,
    fullRunReason,
    pathReasons,
  };
}

/** Iterates changed paths, selecting shards. Returns early on first full-run. */
function selectFromPaths(
  changedPaths: readonly string[],
  ctx: SelectionContext,
  allShards: readonly string[],
): SelectionResult {
  const selectedShardSet = new Set<string>();
  const pathReasons: PathReason[] = [];

  for (const p of changedPaths) {
    const pathShards = selectPathShards(p, ctx);
    if (pathShards.fullRun) {
      pathReasons.push({
        path: p,
        reason: pathShards.fullRunReason ?? '',
        shards: allShards,
      });
      return fullRunResult(
        allShards,
        pathShards.fullRunReason ?? 'full-run triggered',
        pathReasons,
      );
    }
    for (const s of pathShards.shards) selectedShardSet.add(s);
    pathReasons.push({
      path: p,
      reason: pathShards.reason,
      shards: pathShards.shards,
    });
  }

  return selectionResult(selectedShardSet, allShards, pathReasons);
}

/** Builds the final non-full-run selection result. */
function selectionResult(
  selectedShardSet: Set<string>,
  allShards: readonly string[],
  pathReasons: readonly PathReason[],
): SelectionResult {
  const selectedShards = allShards.filter((s) => selectedShardSet.has(s));
  const skippedShards = allShards.filter((s) => !selectedShardSet.has(s));
  return {
    selectedShards,
    skippedShards,
    hasTests: selectedShardSet.size > 0,
    coverageComplete:
      selectedShardSet.has('cli') && selectedShardSet.has('core'),
    fullRunReason: null,
    pathReasons,
  };
}

/** Creates a full-run path classification. */
function fullRun(reason: string, fullRunReason: string): PathClassification {
  return { shards: [], reason, fullRun: true, fullRunReason };
}

/** Creates a no-shards path classification. */
function noShards(reason: string): PathClassification {
  return { shards: [], reason, fullRun: false };
}

/** Creates a shard-selection path classification. */
function selectShards(
  shards: readonly string[],
  reason: string,
): PathClassification {
  return { shards, reason, fullRun: false };
}

/** Classifies a package source change (production or test-only). */
function classifyPackageChange(
  p: string,
  pkg: string,
  ctx: SelectionContext,
): PathClassification {
  const { packageToShard, observers, reverseGraph } = ctx;
  const ownerShard = packageToShard[pkg];
  if (!ownerShard) {
    return fullRun(
      `unknown package '${pkg}' → fail closed`,
      `unknown package '${pkg}' in path '${p}'`,
    );
  }
  if (isTestPath(p)) {
    return selectShards(
      [ownerShard],
      `test-only change in package '${pkg}' selects owner shard '${ownerShard}'`,
    );
  }
  // Production/manifest: owner + reverse closure + observers.
  const shards = new Set<string>([ownerShard]);
  const closure = reverseClosure(pkg, reverseGraph);
  const reasons = [`owner '${ownerShard}'`];
  if (closure.size > 0) {
    reasons.push(`reverse closure: ${[...closure].sort().join(', ')}`);
  }
  for (const dep of closure) {
    const shard = packageToShard[dep];
    if (shard) shards.add(shard);
  }
  for (const obs of observers[pkg] ?? []) {
    shards.add(obs.selectShard);
    reasons.push(
      `observer '${obs.observingPackage}' (${obs.selectShard}) scans '${pkg}'`,
    );
  }
  return selectShards([...shards].sort(), reasons.join('; '));
}

/** Metadata and config paths that never affect tests. */
const NO_TEST_METADATA = new Set<string>([
  'LICENSE',
  '.gitignore',
  '.gitattributes',
  '.lycheeignore',
  '.yamllint',
  '.coderabbit.yaml',
  'Dockerfile',
  'Makefile',
  'AGENTS.md',
  '.prettierrc.json',
  '.editorconfig',
  '.prettierignore',
  '.npmrc',
  'bunfig.toml',
  'junit-integration.xml',
  'tsconfig.scripts.json',
]);

/** Regexes for paths that never affect tests (docs, metadata). */
const NO_TEST_PATH_RES: readonly RegExp[] = [
  DOCS_RE,
  PROJECT_PLAN_RE,
  RESEARCH_RE,
  DEV_DOCS_RE,
  EVALS_RE,
  MARKDOWN_RE,
];

/** Path prefixes for repo-level config/infra directories that never affect tests. */
const NO_TEST_PREFIXES: readonly string[] = [
  '.allstar/',
  '.claude/',
  '.gcp/',
  '.gemini/',
  '.llxprt/',
  'shell-scripts/',
  'test-scripts/',
];

/**
 * Root-level config files that are exercised by scripts-shard tests (lint
 * guards, coverage-flag tests). They select the scripts shard so those guard
 * tests run, but do not force all six shards.
 */
const SCRIPTS_INFRA_FILES: readonly string[] = ['eslint.config.js'];

/**
 * Maps repository-relative paths whose tests read them without importing to the
 * shard that must run. The checker validates existence on disk.
 */
const FILE_OBSERVERS: Readonly<Record<string, readonly string[]>> = {
  'schemas/settings.schema.json': ['cli'],
};

/**
 * Classifies a non-package, non-scripts path. Returns null if unhandled.
 *
 * Order matters: integration-tests/ and file-observer rules are checked BEFORE
 * docs-suffix regexes so an integration-tests/*.md fixture is never treated as
 * docs-only.
 */
function classifyOtherPath(p: string): PathClassification | null {
  // integration-tests/ harness/logic (.ts) affects any shard → fail closed.
  // Fixture data (.responses, .jsonl, .md, etc.) is only consumed by the
  // integration-tests CI job, not by any unit-test shard → scripts shard.
  if (p.startsWith('integration-tests/')) {
    if (p.endsWith('.ts')) {
      return fullRun(
        `integration-tests harness '${p}' → fail closed`,
        `integration-tests harness '${p}' may affect any shard`,
      );
    }
    return selectShards(
      ['scripts'],
      `integration-tests fixture '${p}' selects scripts shard only`,
    );
  }
  const fileObs = FILE_OBSERVERS[p];
  if (fileObs) {
    return selectShards(
      fileObs,
      `file-observer rule selects shard(s) ${fileObs.join(', ')} for '${p}'`,
    );
  }
  if (NO_TEST_PATH_RES.some((re) => re.test(p))) {
    return noShards(`documentation/metadata path '${p}' selects no test shard`);
  }
  if (NO_TEST_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    return noShards(`repo config/infra path '${p}' selects no test shard`);
  }
  // Root-level config files exercised by scripts-shard guard tests.
  if (SCRIPTS_INFRA_FILES.includes(p)) {
    return selectShards(
      ['scripts'],
      `test-infra config '${p}' selects scripts shard`,
    );
  }
  // Workflow/hook/.github harness changes are exercised by scripts-shard tests.
  if (
    p.startsWith('.github/workflows/') ||
    p.startsWith('.husky/') ||
    p.startsWith('.github/')
  ) {
    return selectShards(
      ['scripts'],
      `workflow/harness change '${p}' selects scripts shard`,
    );
  }
  if (NO_TEST_METADATA.has(p)) {
    return noShards(`metadata/config path '${p}' selects no test shard`);
  }
  if (p.startsWith('profiles/') || p.startsWith('schemas/')) {
    return noShards(`path '${p}' selects no test shard`);
  }
  return null;
}

function selectPathShards(
  p: string,
  ctx: SelectionContext,
): PathClassification {
  // 1. Shared install/build/test/tooling inputs → full run.
  if (ctx.sharedSet.has(p)) {
    return fullRun(
      `shared input '${p}' affects all shards`,
      `shared input '${p}' affects install/build/test/tooling`,
    );
  }

  // 2. Package source change.
  const pkg = packageFromPath(p);
  if (pkg) {
    return classifyPackageChange(p, pkg, ctx);
  }

  // 3. Scripts harness change selects scripts shard.
  if (p.startsWith('scripts/')) {
    return selectShards(
      ['scripts'],
      `scripts harness change selects scripts shard`,
    );
  }

  // 4-10. Other known path categories.
  const other = classifyOtherPath(p);
  if (other) return other;

  // 11. Unknown path → fail closed.
  return fullRun(
    `unknown path '${p}' → fail closed`,
    `unknown path '${p}' cannot be classified`,
  );
}

// ---------------------------------------------------------------------------
// History replay
// ---------------------------------------------------------------------------

/**
 * Gets the changed files for a git commit range using first-parent non-merge
 * history.
 */
function getHistoryCommits(
  count: number,
  base?: string,
): readonly HistoryCommit[] {
  // Get first-parent commit SHAs (non-merge)
  const baseRef = base ?? 'HEAD';
  const logOut = execFileSync(
    'git',
    [
      'log',
      '--first-parent',
      '--no-merges',
      '--format=%H',
      `-n`,
      String(count),
      baseRef,
    ],
    { encoding: 'utf8', cwd: process.cwd() },
  ).trim();
  const commits = logOut ? logOut.split('\n') : [];
  const result: HistoryCommit[] = [];
  for (const commit of commits) {
    if (!commit) continue;
    const diffOut = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', commit],
      { encoding: 'utf8', cwd: process.cwd() },
    ).trim();
    const files = diffOut ? diffOut.split('\n') : [];
    result.push({ commit, files });
  }
  return result;
}

/**
 * Replays the last `count` first-parent non-merge commits through the selector
 * and computes aggregate and critical-path time savings using canonical shard
 * timings.
 */
export function replayHistory({
  count,
  base,
  dataPath,
}: ReplayHistoryParams): ReplayResult {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(
      `replay count must be a positive integer (received ${count})`,
    );
  }
  const data = loadData(dataPath);
  const timings: Record<string, number> = data.shardTimingsSeconds;
  const history = getHistoryCommits(count, base);

  // The full-run baseline: every commit runs every shard. The aggregate is
  // the total CI compute (sum of shard times × commits), and the critical
  // path is the longest shard (cli) × commits — that is the wall-clock a
  // developer waits when nothing is skipped.
  const allShardTimes = Object.values(timings);
  const fullAggregatePerCommit = allShardTimes.reduce((a, b) => a + b, 0);
  const fullCriticalPerCommit = allShardTimes.reduce(
    (max, t) => Math.max(max, t),
    0,
  );

  let forcedFull = 0;
  let selectedLegs = 0;
  let aggregateSeconds = 0;
  let fullRunSeconds = 0;
  let criticalPathSeconds = 0;
  let fullCriticalPathSeconds = 0;

  for (const { files } of history) {
    fullRunSeconds += fullAggregatePerCommit;
    fullCriticalPathSeconds += fullCriticalPerCommit;

    const result = selectAffectedShards({
      event: 'pull_request',
      changedPaths: files,
      dataPath,
    });
    if (result.fullRunReason) {
      forcedFull++;
      aggregateSeconds += fullAggregatePerCommit;
      criticalPathSeconds += fullCriticalPerCommit;
    } else if (result.selectedShards.length === 0) {
      // Zero-shard (docs-only): costs zero, not forced-full.
      continue;
    } else {
      const legTime = result.selectedShards.reduce(
        (sum, s) => sum + (timings[s] ?? 0),
        0,
      );
      aggregateSeconds += legTime;
      selectedLegs += result.selectedShards.length;
      const critical = result.selectedShards.reduce(
        (max, s) => Math.max(max, timings[s] ?? 0),
        0,
      );
      criticalPathSeconds += critical;
    }
  }

  return {
    commits: history.length,
    forcedFull,
    selectedLegs,
    aggregateSeconds,
    fullRunSeconds,
    aggregateSavingSeconds: fullRunSeconds - aggregateSeconds,
    criticalPathSeconds,
    fullCriticalPathSeconds,
    criticalPathSavingSeconds: fullCriticalPathSeconds - criticalPathSeconds,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args: readonly string[]): ParsedArgs {
  const opts: {
    event?: string;
    filesFrom?: string;
    base?: string;
    head?: string;
    output?: string;
    replay?: number;
    help?: boolean;
  } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--event') {
      opts.event = args[++i];
    } else if (a === '--files-from') {
      opts.filesFrom = args[++i];
    } else if (a === '--base') {
      opts.base = args[++i];
    } else if (a === '--head') {
      opts.head = args[++i];
    } else if (a === '--output') {
      opts.output = args[++i];
    } else if (a === '--replay') {
      opts.replay = parseInt(args[++i], 10);
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp(): void {
  stdout.write(`Usage: affected-test-shards.ts [options]

Options:
  --event <name>       CI event name (pull_request, push, merge_group, ...)
  --files-from <path>  Read changed file paths from a file (one per line)
  --base <sha>         Base commit SHA (uses git diff for changed files)
  --head <sha>         Head commit SHA (default: HEAD)
  --output <mode>      Output mode: json (default) or github-actions
  --replay <N>         Replay the last N first-parent commits locally
  --help               Show this help

Output (json): a single JSON object on stdout with selectedShards,
skippedShards, hasTests, coverageComplete, fullRunReason, and pathReasons.
Output (github-actions): writes GITHUB_OUTPUT and GITHUB_STEP_SUMMARY for CI.
`);
}

function readFilesFromFile(filePath: string): string[] {
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function readFilesFromGit(base: string, head?: string): string[] {
  const headRef = head ?? 'HEAD';
  const out = execFileSync(
    'git',
    ['diff', '--name-only', `${base}..${headRef}`],
    { encoding: 'utf8', cwd: process.cwd() },
  ).trim();
  return out ? out.split('\n') : [];
}

function main(): void {
  const opts = parseArgs(argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  const outputMode: string =
    typeof opts.output === 'string' ? opts.output : 'json';

  if (opts.replay !== undefined) {
    const replayCount = typeof opts.replay === 'number' ? opts.replay : 120;
    if (!Number.isInteger(replayCount) || replayCount <= 0) {
      stdout.write(
        `Error: --replay must be a positive integer (received ${opts.replay})\n`,
      );
      exit(2);
    }
    const result = replayHistory({
      count: replayCount,
      base: typeof opts.base === 'string' ? opts.base : undefined,
    });
    stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const event = typeof opts.event === 'string' ? opts.event : 'pull_request';
  let changedPaths: string[] = [];
  if (typeof opts.filesFrom === 'string') {
    changedPaths = readFilesFromFile(opts.filesFrom);
  } else if (typeof opts.base === 'string') {
    changedPaths = readFilesFromGit(
      opts.base,
      typeof opts.head === 'string' ? opts.head : undefined,
    );
  } else if (event !== 'pull_request') {
    // Non-PR invocation without a file source is valid: selection is
    // pull_request-only, so non-PR events select all shards regardless of paths.
    changedPaths = [];
  } else {
    stdout.write('Error: provide --files-from <path> or --base <sha>\n');
    exit(2);
  }

  const result = selectAffectedShards({ event, changedPaths });

  if (outputMode === 'github-actions') {
    outputGithubActions(result, event);
  } else {
    stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

/**
 * Writes selection results to GITHUB_OUTPUT and GITHUB_STEP_SUMMARY for use in
 * GitHub Actions CI. Builds a matrix JSON array (shard × node-version; issue
 * #2876 removed the per-OS dimension — the PR test matrix is ubuntu-only, and
 * macOS coverage moved to the nightly workflow) that the test_shard job
 * consumes via fromJSON().
 *
 * PR-controlled values (event, fullRunReason/path text) are sanitized of CR/LF
 * before being written to prevent GITHUB_OUTPUT injection. Keys/shape preserved.
 */
const CRLF_RE = new RegExp(
  `[${String.fromCharCode(13)}${String.fromCharCode(10)}]+`,
  'g',
);
function sanitizeGhValue(value: string): string {
  return value.replace(CRLF_RE, ' ');
}

// ---------------------------------------------------------------------------
// Matrix expansion (issue #3185)
// ---------------------------------------------------------------------------

/**
 * One physical matrix row consumed by the `test_shard` job's
 * `fromJSON(needs.shard_selector.outputs.matrix)`.
 */
export interface MatrixRow {
  readonly shard: string;
  readonly os: string;
  readonly 'node-version': string;
  readonly partition: string;
}

/**
 * Maps a logical shard name to the number of physical CI legs it expands into.
 * A shard absent from this map gets a single `1of1` leg. Only `cli` is
 * partitioned (issue #3185): it is the longest shard (~12 min) and splits into
 * three balanced legs to target a sub-10-minute critical path.
 */
export const SHARD_PARTITION_COUNTS: Readonly<Record<string, number>> = {
  cli: 3,
};

/**
 * Expands logical shard names into physical matrix rows. Each shard expands
 * into one or more rows carrying a canonical `NofM` partition identity that
 * the CLI runner consumes via `LLXPRT_CLI_TEST_PARTITION`.
 *
 * Pure: no I/O, no env, no side effects. The selection logic, coverage
 * calculation, and logical shard output are untouched — only the physical
 * matrix shape changes.
 */
export function buildMatrix(
  selectedShards: readonly string[],
): readonly MatrixRow[] {
  return selectedShards.flatMap((shard) => {
    const count = SHARD_PARTITION_COUNTS[shard] ?? 1;
    return Array.from({ length: count }, (_, i) => ({
      shard,
      os: 'ubuntu-latest',
      'node-version': '24.x',
      partition: `${i + 1}of${count}`,
    }));
  });
}

function outputGithubActions(result: SelectionResult, event: string): void {
  const ghOutputPath = process.env.GITHUB_OUTPUT;
  const ghSummaryPath = process.env.GITHUB_STEP_SUMMARY;

  // Build the matrix via the pure expander (issue #3185): logical shards
  // expand to physical partition rows — cli into 1of3/2of3/3of3; other
  // shards remain a single 1of1 row. All physical rows are ubuntu-only
  // (issue #2876); macOS test coverage moved to the nightly workflow.
  const matrix = buildMatrix(result.selectedShards);

  const selectedStr = sanitizeGhValue(result.selectedShards.join(','));
  const matrixStr = sanitizeGhValue(JSON.stringify(matrix));
  const hasTestsStr = String(result.hasTests);
  const coverageCompleteStr = String(result.coverageComplete);
  const fullRunReason = sanitizeGhValue(result.fullRunReason ?? '');
  const safeEvent = sanitizeGhValue(event);

  if (ghOutputPath) {
    const lines = [
      `selected_shards=${selectedStr}`,
      `matrix=${matrixStr}`,
      `has_tests=${hasTestsStr}`,
      `coverage_complete=${coverageCompleteStr}`,
      `full_run_reason=${fullRunReason}`,
    ];
    appendFileSync(ghOutputPath, lines.join('\n') + '\n');
  }

  if (ghSummaryPath) {
    const summary = [
      '### Test shard selection (issue #2709)',
      '',
      `**Event:** \`${safeEvent}\``,
      `**Selected shards:** \`${selectedStr}\``,
      `**Has tests:** \`${hasTestsStr}\``,
      `**Coverage complete:** \`${coverageCompleteStr}\``,
    ];
    if (fullRunReason) {
      summary.push(`**Full-run reason:** \`${fullRunReason}\``);
    }
    appendFileSync(ghSummaryPath, summary.join('\n') + '\n');
  }

  // Always print to stdout so the logs show the selection.
  stdout.write(
    `Selected shards: ${selectedStr}\n` +
      `Has tests: ${hasTestsStr}\n` +
      `Coverage complete: ${coverageCompleteStr}\n` +
      (fullRunReason ? `Full-run reason: ${fullRunReason}\n` : ''),
  );
}

const isMain =
  argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
