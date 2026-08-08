/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Affected lint-target selector (issue #2710).
 *
 * A focused package-target adapter that reuses the single import graph and
 * reverse-closure implementation from `scripts/affected-test-shards.ts` (issue
 * #2709). It does NOT duplicate graph/closure logic or perform runtime AST
 * scanning.
 *
 * Given a CI event and changed file paths, selects the package directories to
 * lint. Production/manifest changes select the owner plus its complete
 * transitive reverse import closure; package-local test changes select only
 * the owner. `integration-tests` is always an explicit scoped target so that
 * the separate integration-test ESLint pass remains covered after the runner
 * collapses duplicate integration traversals.
 *
 * Fail-closed: shared inputs, integration-tests changes, unknown paths,
 * non-PR events, and empty input select the full root (`.`).
 *
 * Deterministic and auditable: output is stable for identical input and every
 * selected target carries a per-path reason.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { argv, exit, stdout } from 'node:process';
import {
  loadData,
  packageFromPath,
  isTestPath,
  buildReverseGraph,
  reverseClosure,
  type GraphData,
} from './affected-test-shards.ts';

const INTEGRATION_TESTS_TARGET = 'integration-tests';
const FULL_TARGET = '.';

/** Per-path explanation of why lint targets were (or were not) selected. */
interface LintPathReason {
  readonly path: string;
  readonly reason: string;
  readonly targets: readonly string[];
}

/** Result of selecting affected lint targets for an event + changed paths. */
export interface LintTargetSelection {
  readonly targets: readonly string[];
  readonly fullRun: boolean;
  readonly fullRunReason: string | null;
  readonly pathReasons: readonly LintPathReason[];
}

/** Parameters for {@link selectLintTargets}. */
interface SelectLintTargetsParams {
  readonly event: string;
  readonly changedPaths: readonly string[];
  readonly dataPath?: string;
}

/** Reverse lookup: package → packages that import it. */
type ReverseGraph = Record<string, readonly string[]>;

/** Classification of a single changed path into targets or a full-run. */
interface PathClassification {
  readonly targets: readonly string[];
  readonly reason: string;
  readonly fullRun: boolean;
  readonly fullRunReason?: string;
}

/** Cached selection context derived from loaded graph data. */
interface SelectionContext {
  readonly reverseGraph: ReverseGraph;
  readonly sharedSet: Set<string>;
}

const DOCS_RE =
  /^docs\/|^README|^CHANGELOG|^CONTRIBUTING|^ROADMAP|^SECURITY|^CODE_OF_CONDUCT/i;
const MARKDOWN_RE = /\.(md|mdx|rst|txt|adoc)$/i;
const PROJECT_PLAN_RE = /^project-plans\//;
const RESEARCH_RE = /^research\//;
const DEV_DOCS_RE = /^dev-docs\//;
const EVALS_RE = /^evals\//;

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

const NO_TEST_PATH_RES: readonly RegExp[] = [
  DOCS_RE,
  PROJECT_PLAN_RE,
  RESEARCH_RE,
  DEV_DOCS_RE,
  EVALS_RE,
  MARKDOWN_RE,
];

/** Path prefixes for repo-level config/infra directories that never affect lint. */
const NO_TEST_PREFIXES: readonly string[] = [
  '.allstar/',
  '.claude/',
  '.gcp/',
  '.gemini/',
  '.llxprt/',
  'shell-scripts/',
  'test-scripts/',
];

/** Builds the reverse-graph and shared-input set from loaded data. */
function buildSelectionContext(data: GraphData): SelectionContext {
  return {
    reverseGraph: buildReverseGraph(data.importEdges, data.testOnlyEdges),
    sharedSet: new Set<string>(data.sharedInputs),
  };
}

/** Classifies a package source change (production or test-only). */
function classifyPackageChange(
  p: string,
  pkg: string,
  ctx: SelectionContext,
): PathClassification {
  if (isTestPath(p)) {
    return selectTargets(
      [`packages/${pkg}`],
      `test-only change in package '${pkg}' selects owner dir`,
    );
  }
  // Production/manifest: owner + complete reverse closure.
  const closure = reverseClosure(pkg, ctx.reverseGraph);
  const targets = new Set<string>([`packages/${pkg}`]);
  const reasons = [`owner 'packages/${pkg}'`];
  if (closure.size > 0) {
    for (const dep of closure) targets.add(`packages/${dep}`);
    reasons.push(`reverse closure: ${[...closure].sort().join(', ')}`);
  }
  return selectTargets([...targets].sort(), reasons.join('; '));
}

/** Creates a full-run path classification. */
function fullRun(reason: string, fullRunReason: string): PathClassification {
  return { targets: [], reason, fullRun: true, fullRunReason };
}

/** Creates a no-targets path classification. */
function noTargets(reason: string): PathClassification {
  return { targets: [], reason, fullRun: false };
}

/** Creates a target-selection path classification. */
function selectTargets(
  targets: readonly string[],
  reason: string,
): PathClassification {
  return { targets, reason, fullRun: false };
}

/** Classifies a non-package path. Returns null if unhandled. */
function classifyOtherPath(p: string): PathClassification | null {
  // integration-tests/ paths affect any package → fail closed to full.
  if (p.startsWith('integration-tests/')) {
    return fullRun(
      `integration-tests path '${p}' → fail closed`,
      `integration-tests path '${p}' may affect any package`,
    );
  }
  if (NO_TEST_PATH_RES.some((re) => re.test(p))) {
    return noTargets(`documentation/metadata path '${p}' selects no package`);
  }
  if (NO_TEST_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    return noTargets(`repo config/infra path '${p}' selects no package`);
  }
  if (
    p.startsWith('.github/workflows/') ||
    p.startsWith('.husky/') ||
    p.startsWith('.github/')
  ) {
    return fullRun(
      `workflow/harness change '${p}' → fail closed`,
      `workflow/harness change '${p}' may affect lint scope`,
    );
  }
  if (NO_TEST_METADATA.has(p)) {
    return noTargets(`metadata/config path '${p}' selects no package`);
  }
  if (p.startsWith('profiles/') || p.startsWith('schemas/')) {
    return fullRun(
      `path '${p}' → fail closed`,
      `path '${p}' is not package-scoped`,
    );
  }
  return null;
}

function selectPathTargets(
  p: string,
  ctx: SelectionContext,
): PathClassification {
  // 1. Shared install/build/test/tooling inputs → full run.
  if (ctx.sharedSet.has(p)) {
    return fullRun(
      `shared input '${p}' affects all packages`,
      `shared input '${p}' affects install/build/test/tooling`,
    );
  }

  // 2. Package source change.
  const pkg = packageFromPath(p);
  if (pkg) {
    return classifyPackageChange(p, pkg, ctx);
  }

  // 3. Scripts harness changes can alter lint config/scope → fail closed.
  if (p.startsWith('scripts/')) {
    return fullRun(
      `scripts harness change '${p}' → fail closed`,
      `scripts harness change '${p}' may affect lint scope`,
    );
  }

  // 4. Other known path categories.
  const other = classifyOtherPath(p);
  if (other) return other;

  // 5. Unknown path → fail closed.
  return fullRun(
    `unknown path '${p}' → fail closed`,
    `unknown path '${p}' cannot be classified`,
  );
}

/**
 * Selects affected lint targets for a given event and changed paths.
 */
export function selectLintTargets({
  event,
  changedPaths,
  dataPath,
}: SelectLintTargetsParams): LintTargetSelection {
  const data = loadData(dataPath);

  // Only `pull_request` selects from paths; all other/missing/unknown events
  // fail closed to a full root run.
  if (event !== 'pull_request') {
    const reason =
      event && event.length > 0
        ? `non-PR event '${event}' runs full lint`
        : 'missing/empty event runs full lint (selection is pull_request-only)';
    return fullRunResult(
      reason,
      changedPaths.map((p) => ({
        path: p,
        reason: `full-run: ${reason}`,
        targets: [FULL_TARGET],
      })),
    );
  }

  // Empty changed paths in a PR → fail closed.
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return fullRunResult(
      'no changed paths provided — fail closed to full lint',
      [],
    );
  }

  const ctx = buildSelectionContext(data);
  return selectFromPaths(changedPaths, ctx);
}

/** Creates a full-run result object. */
function fullRunResult(
  fullRunReason: string,
  pathReasons: readonly LintPathReason[],
): LintTargetSelection {
  return {
    targets: [FULL_TARGET],
    fullRun: true,
    fullRunReason,
    pathReasons,
  };
}

/** Iterates changed paths, selecting targets. Returns early on first full-run. */
function selectFromPaths(
  changedPaths: readonly string[],
  ctx: SelectionContext,
): LintTargetSelection {
  const targetSet = new Set<string>();
  const pathReasons: LintPathReason[] = [];

  for (let i = 0; i < changedPaths.length; i++) {
    const p = changedPaths[i];
    const pathClass = selectPathTargets(p, ctx);
    if (pathClass.fullRun) {
      pathReasons.push({
        path: p,
        reason: pathClass.fullRunReason ?? '',
        targets: [FULL_TARGET],
      });
      // Record the remaining paths so the audit trail covers the complete
      // set of changed files rather than omitting everything after the
      // triggering path.
      for (let j = i + 1; j < changedPaths.length; j++) {
        pathReasons.push({
          path: changedPaths[j],
          reason: `not classified — earlier path triggered full run`,
          targets: [FULL_TARGET],
        });
      }
      return fullRunResult(
        pathClass.fullRunReason ?? 'full-run triggered',
        pathReasons,
      );
    }
    for (const t of pathClass.targets) targetSet.add(t);
    pathReasons.push({
      path: p,
      reason: pathClass.reason,
      targets: pathClass.targets,
    });
  }

  // integration-tests is always an explicit scoped target.
  targetSet.add(INTEGRATION_TESTS_TARGET);

  const targets = [...targetSet].sort();
  return {
    targets,
    fullRun: false,
    fullRunReason: null,
    pathReasons,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface ParsedArgs {
  readonly event?: string;
  readonly filesFrom?: string;
  readonly base?: string;
  readonly head?: string;
  readonly output?: string;
  readonly help?: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const opts: {
    event?: string;
    filesFrom?: string;
    base?: string;
    head?: string;
    output?: string;
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
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp(): void {
  stdout.write(`Usage: affected-lint-targets.ts [options]

Options:
  --event <name>       CI event name (pull_request, push, merge_group, ...)
  --files-from <path>  Read changed file paths from a file (one per line)
  --base <sha>         Base commit SHA (uses git diff for changed files)
  --head <sha>         Head commit SHA (default: HEAD)
  --output <mode>      Output mode: json (default) or github-actions
  --help               Show this help

Output (json): a single JSON object with targets, fullRun, fullRunReason,
and pathReasons.
Output (github-actions): writes lint_targets and lint_full_run to
GITHUB_OUTPUT and a summary to GITHUB_STEP_SUMMARY for CI.
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

const CRLF_RE = new RegExp(
  `[${String.fromCharCode(13)}${String.fromCharCode(10)}]+`,
  'g',
);
function sanitizeGhValue(value: string): string {
  return value.replace(CRLF_RE, ' ');
}

/**
 * Writes selection results to GITHUB_OUTPUT and GITHUB_STEP_SUMMARY for CI.
 * PR-controlled values are sanitized of CR/LF to prevent injection.
 */
function outputGithubActions(result: LintTargetSelection, event: string): void {
  const ghOutputPath = process.env.GITHUB_OUTPUT;
  const ghSummaryPath = process.env.GITHUB_STEP_SUMMARY;

  const targetsStr = sanitizeGhValue(JSON.stringify(result.targets));
  const fullRunStr = String(result.fullRun);
  const fullRunReason = sanitizeGhValue(result.fullRunReason ?? '');
  const safeEvent = sanitizeGhValue(event);

  if (ghOutputPath) {
    const lines = [
      `lint_targets=${targetsStr}`,
      `lint_full_run=${fullRunStr}`,
      `lint_full_run_reason=${fullRunReason}`,
    ];
    appendFileSync(ghOutputPath, lines.join('\n') + '\n');
  }

  if (ghSummaryPath) {
    const summary = [
      '### Lint target selection (issue #2710)',
      '',
      `**Event:** \`${safeEvent}\``,
      `**Full run:** \`${fullRunStr}\``,
      `**Targets:** \`${targetsStr}\``,
    ];
    if (fullRunReason) {
      summary.push(`**Full-run reason:** \`${fullRunReason}\``);
    }
    appendFileSync(ghSummaryPath, summary.join('\n') + '\n');
  }

  stdout.write(
    `Full run: ${fullRunStr}\n` +
      `Targets: ${targetsStr}\n` +
      (fullRunReason ? `Full-run reason: ${fullRunReason}\n` : ''),
  );
}

function main(): void {
  const opts = parseArgs(argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  const outputMode: string =
    typeof opts.output === 'string' ? opts.output : 'json';

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
    changedPaths = [];
  } else {
    stdout.write('Error: provide --files-from <path> or --base <sha>\n');
    exit(2);
  }

  const result = selectLintTargets({ event, changedPaths });

  if (outputMode === 'github-actions') {
    outputGithubActions(result, event);
  } else {
    stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

const isMain =
  argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
