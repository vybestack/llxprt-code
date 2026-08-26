/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test helpers for the auto-created-failure-issue metadata behavioral tests.
 *
 * These helpers extract the real `run:` script from a workflow's notification
 * step and execute that bash against a stateful fake `gh` on PATH. The fake
 * gh is infrastructure — it models GitHub API responses from a JSON fixture and
 * appends every invocation's argv to a log. Assertions are made against the
 * recorded argv and the resulting fake-API state, never against workflow source
 * text.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { parseWorkflowYaml } from './typed-test-helpers.ts';

const REPO_DEFAULT = 'vybestack/llxprt-code';

/**
 * The fake `gh` executable. Models just enough of the GitHub REST surface the
 * notifier scripts touch: package.json raw content, paged open milestones,
 * issue list/create/comment/edit/close, label list, auth status, and the
 * issue type PATCH. Every invocation is appended to the call log for argv
 * assertions; a `failOn` rule can make a specific method/endpoint fail.
 */
const FAKE_GH_SOURCE = String.raw`#!/usr/bin/env python3
import json, os, re, subprocess, sys

VALUE_FLAGS = {
    "-X", "--method", "-H", "--header", "-f", "--raw-field", "-F", "--field",
    "--input", "--jq", "-q", "--search", "--json", "--limit", "--title",
    "--body", "--body-file", "--milestone", "--label", "--repo", "--color",
    "--description",
}

def load(path):
    with open(path) as f:
        return json.load(f)

def save(path, state):
    with open(path, "w") as f:
        json.dump(state, f)

def should_fail(state, method, path):
    for rule in state.get("failOn") or []:
        if rule.get("method", method) != method:
            continue
        if rule.get("path") and rule.get("path") not in path:
            continue
        return True
    return False

def jq_output(data, expr, slurp=False):
    if expr is None:
        return data
    cmd = ["jq"] + (["-s", "-r", expr] if slurp else ["-r", expr])
    proc = subprocess.run(cmd, input=data, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        sys.exit(proc.returncode)
    return proc.stdout

def parse_args(argv):
    opts = {"method": "GET", "paginate": False, "slurp": False}
    pairs = {}
    tokens = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-X", "--method"):
            opts["method"] = argv[i + 1].upper()
            i += 2
        elif a == "--paginate":
            opts["paginate"] = True
            i += 1
        elif a == "--slurp":
            opts["slurp"] = True
            i += 1
        elif a in VALUE_FLAGS:
            if i + 1 < len(argv):
                pairs.setdefault(a, []).append(argv[i + 1])
                i += 2
            else:
                i += 1
        else:
            tokens.append(a)
            i += 1
    return opts, pairs, tokens

def handle_api(argv, state, state_file):
    opts, pairs, tokens = parse_args(argv)
    method = opts["method"]
    path = (tokens[0] if tokens else "").lstrip("/")
    jq = next(iter(pairs.get("--jq", []) + pairs.get("-q", [])), None)
    # Real gh validates these combinations before issuing any request. Both
    # messages and exit codes were captured from gh 2.83.2; modelling them is
    # what stops a workflow that cannot run in CI from passing these tests.
    if opts["slurp"] and jq is not None:
        sys.stderr.write(
            "the --slurp option is not supported with --jq or --template\n"
        )
        return 1
    if opts["slurp"] and not opts["paginate"]:
        sys.stderr.write("--paginate required when passing --slurp\n")
        return 1
    if should_fail(state, method, path):
        sys.stderr.write("HTTP 500: %s failed\n" % path)
        return 1
    if "contents/package.json" in path:
        if state.get("packageJsonFail"):
            sys.stderr.write("HTTP 500: package.json fetch failed\n")
            return 1
        pj = state.get("packageJson", "{}\n")
        sys.stdout.write(pj)
        if not pj.endswith("\n"):
            sys.stdout.write("\n")
        return 0
    if "milestones" in path:
        items = state.get("milestones", [])
        per_page = state.get("pageSize") or 100
        pages = [items[i:i + per_page] for i in range(0, len(items), per_page)]
        if not pages:
            pages = [[]]
        if opts["slurp"]:
            # gh --paginate --slurp emits ONE array whose elements are the
            # per-page arrays, which is why the workflow's jq uses .[][].
            sys.stdout.write(json.dumps(pages) + "\n")
        elif opts["paginate"]:
            outs = [jq_output(json.dumps(p), jq) for p in pages]
            sys.stdout.write("\n".join(outs) + "\n")
        else:
            sys.stdout.write(jq_output(json.dumps(pages[0]), jq))
        return 0
    m = re.match(r"^repos/[^/]+/[^/]+/issues/(\d+)$", path)
    if m and method == "PATCH":
        num = int(m.group(1))
        fields = pairs.get("-f", []) + pairs.get("--raw-field", [])
        state.setdefault("patched", []).append({"number": num, "fields": fields})
        save(state_file, state)
        applied = None
        for field in fields:
            if field.startswith("type="):
                applied = field.split("=", 1)[1]
        sys.stdout.write(json.dumps({"number": num, "type": applied}) + "\n")
        return 0
    sys.stdout.write("{}\n")
    return 0

def issue_reference(token):
    """gh accepts an issue number or an issue URL wherever it takes an issue."""
    if token is None:
        return None
    tail = token.rstrip("/").rsplit("/", 1)[-1]
    return int(tail) if tail.isdigit() else None


def handle_issue(argv, state, state_file):
    sub = argv[0] if argv else ""
    if sub == "list":
        opts, pairs, tokens = parse_args(argv[1:])
        search = next(iter(pairs.get("--search", [])), "")
        jq = next(iter(pairs.get("--jq", []) + pairs.get("-q", [])), None)
        fields = [f for f in next(iter(pairs.get("--json", [])), "number,title").split(",") if f]
        m = re.search(r'"([^"]*)"', search)
        title = m.group(1) if m else None
        objs = [
            {k: it.get(k) for k in fields}
            for it in state.get("issues", [])
            if it.get("state") in (None, "open") and (title is None or it.get("title") == title)
        ]
        sys.stdout.write(jq_output(json.dumps(objs), jq))
        return 0
    if sub == "create":
        opts, pairs, tokens = parse_args(argv[1:])
        # Real gh refuses to open an issue with no title or no body. Modelling
        # that is what stops a step whose title/body assignment silently failed
        # (e.g. an unresolved ${{}} expression) from passing as a success.
        if not pairs.get("--title"):
            sys.stderr.write("must provide --title when not running interactively\n")
            return 1
        if not pairs.get("--body") and not pairs.get("--body-file"):
            sys.stderr.write("must provide --body or --body-file\n")
            return 1
        if should_fail(state, "POST", "issue/create"):
            sys.stderr.write("HTTP 500: issue create failed\n")
            return 1
        num = state.get("nextIssueNumber", 4242)
        state["nextIssueNumber"] = num + 1
        state.setdefault("created", []).append({"number": num})
        save(state_file, state)
        out = state.get("issueCreateOutput")
        if out is None:
            out = "https://github.com/%s/issues/%d" % (state.get("repo", "vybestack/llxprt-code"), num)
        sys.stdout.write(out + "\n")
        return 0
    if sub == "comment":
        opts, pairs, tokens = parse_args(argv[1:])
        number = issue_reference(tokens[0] if tokens else None)
        if number is None:
            sys.stderr.write("invalid issue reference\n")
            return 1
        state.setdefault("commented", []).append({"number": number})
        save(state_file, state)
        return 0
    if sub == "edit":
        opts, pairs, tokens = parse_args(argv[1:])
        number = issue_reference(tokens[0] if tokens else None)
        if number is None:
            sys.stderr.write("invalid issue reference\n")
            return 1
        state.setdefault("edited", []).append({
            "number": number,
            "milestone": next(iter(pairs.get("--milestone", [])), None),
        })
        save(state_file, state)
        return 0
    if sub == "close":
        return 0
    return 0

def handle_label(argv, state):
    sub = argv[0] if argv else ""
    if sub == "list":
        opts, pairs, tokens = parse_args(argv[1:])
        search = next(iter(pairs.get("--search", [])), "")
        jq = next(iter(pairs.get("--jq", []) + pairs.get("-q", [])), None)
        names = [name for name in state.get("labels") or {} if not search or name == search]
        sys.stdout.write(jq_output(json.dumps([{"name": n} for n in names]), jq))
        return 0
    return 0

def main():
    argv = sys.argv[1:]
    state_file = os.environ.get("GH_FAKE_STATE", "")
    call_log = os.environ.get("GH_CALL_LOG", "")
    state = load(state_file)
    status = 0
    try:
        if len(argv) >= 2 and argv[0] == "auth" and argv[1] == "status":
            if state.get("authStatusFail"):
                status = 1
        elif argv[0] == "api":
            status = handle_api(argv[1:], state, state_file)
        elif argv[0] == "issue":
            status = handle_issue(argv[1:], state, state_file)
        elif argv[0] == "label":
            status = handle_label(argv[1:], state)
        else:
            status = 0
    finally:
        if call_log:
            with open(call_log, "a") as f:
                f.write(json.dumps({"argv": argv, "status": status}) + "\n")
    sys.exit(status)

if __name__ == "__main__":
    main()
`;

/**
 * The fake `gh` source, exposed so a test can assert it still compiles.
 *
 * It is Python embedded in a TypeScript template literal, so an escaping slip
 * (a stray backtick, or a `
` that became a real newline) turns it into a
 * syntax error. That failure surfaces only as `gh` exiting non-zero, which the
 * notifier scripts treat as an ordinary API failure and retry past -- so the
 * suite would go green against a fake that never ran.
 */
export const FAKE_GH_PYTHON_SOURCE = FAKE_GH_SOURCE;

export interface FakeIssue {
  title: string;
  number: number;
  state?: string;
  labels?: string[];
  milestone?: { title?: string; number?: number };
}

export interface FailOnRule {
  method?: string;
  path?: string;
}

export interface FakeMetadataState {
  repo?: string;
  packageJson?: string;
  packageJsonFail?: boolean;
  pageSize?: number;
  milestones?: Array<{ title: string; state?: string }>;
  issues?: FakeIssue[];
  labels?: Record<string, { name: string }>;
  nextIssueNumber?: number;
  issueCreateOutput?: string;
  authStatusFail?: boolean;
  failOn?: FailOnRule[];
  runId?: string;
  ref?: string;
  results?: Record<string, string>;
  /** Values for `needs.*.outputs.*` / `steps.*.outputs.*` expressions. */
  outputs?: Record<string, string>;
}

export interface NotificationScript {
  run: string;
  env: Record<string, string>;
  /** The step's declared `shell:`, or undefined when it relies on the default. */
  shell: string | undefined;
}

export interface RunNotificationOptions {
  script: string;
  env: Record<string, string>;
  fake: FakeMetadataState;
  /** The step's declared `shell:`, which decides the runner's bash flags. */
  shell: string | undefined;
}

export interface GhCall {
  argv: string[];
  status: number;
}

export interface RunNotificationResult {
  status: number;
  stdout: string;
  stderr: string;
  ghCalls: GhCall[];
}

function resolveExpression(expr: string, fake: FakeMetadataState): string {
  const text = expr.trim();
  if (text === 'github.repository') return fake.repo ?? REPO_DEFAULT;
  if (text === 'secrets.GITHUB_TOKEN' || text === 'github.token')
    return 'gh-token';
  if (text === 'github.server_url') return 'https://github.com';
  if (text === 'github.run_id') return fake.runId ?? '123456';
  if (text === 'github.event.inputs.ref') return fake.ref ?? 'main';
  if (text === 'github.event.workflow_run.html_url') {
    return `https://github.com/${fake.repo ?? REPO_DEFAULT}/actions/runs/${fake.runId ?? '123456'}`;
  }
  if (text === 'needs.classify-ocr-run.result') return 'success';
  if (text === 'needs.classify-ocr-run.outputs.classification') {
    return fake.results?.['classification'] ?? 'infrastructure-failure';
  }
  if (text.includes('||')) {
    const [candidate, fallback] = text.split('||');
    const base = resolveExpression(candidate, fake);
    const fallbackValue = fallback.trim().replace(/^['"]|['"]$/g, '');
    return base !== '' ? base : fallbackValue;
  }
  const needsResult = /^needs\.([A-Za-z0-9_-]+)\.result$/.exec(text);
  if (needsResult)
    return fake.results?.[`${needsResult[1]}.result`] ?? 'failure';
  // A job or step output that was never set is legitimately empty on the
  // runner, so '' here is faithful rather than a silent hole.
  const output =
    /^(?:needs|steps)\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_-]+$/.exec(text);
  if (output) return fake.outputs?.[text] ?? '';
  // Returning '' for an unknown expression silently changes the script under
  // test -- an unresolved `${{ }}` left in the run body is a bash "bad
  // substitution", which would drop whole arguments while the test still
  // passed. Fail loudly instead.
  throw new Error(
    `unhandled GitHub expression in workflow step: \${{ ${text} }}`,
  );
}

function substituteExpressions(text: string, fake: FakeMetadataState): string {
  // No `\s*` padding around the lazy group: adjacent optional-whitespace and
  // lazy-any quantifiers give the engine an ambiguous split to backtrack over.
  // `resolveExpression` trims, so the padding buys nothing.
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, exprBody: string) =>
    resolveExpression(exprBody, fake),
  );
}

/**
 * Parse a workflow file and pull the `run:` text plus declared `env` of one
 * step. GitHub `${{ ... }}` placeholders are left intact here; they are
 * resolved inside `runNotification`.
 */
export function notificationScript(
  workflowPath: string,
  jobId: string,
  stepName: string,
): NotificationScript {
  const source = readFileSync(
    path.join(path.resolve(import.meta.dirname, '../..'), workflowPath),
    'utf8',
  );
  const workflow = parseWorkflowYaml(source);
  const job = workflow?.jobs?.[jobId];
  if (job?.steps === undefined) {
    throw new Error(
      `workflow ${workflowPath} must define job ${jobId} with steps`,
    );
  }
  const step = job.steps.find((candidate) => candidate.name === stepName);
  if (!step) {
    throw new Error(`job ${jobId} must define step ${stepName}`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.env ?? {})) {
    env[key] = String(value);
  }
  return {
    run: String(step.run ?? ''),
    env,
    shell: step.shell === undefined ? undefined : String(step.shell),
  };
}

/**
 * The argv GitHub Actions uses to run a `run:` block.
 *
 * `shell: bash` means `bash --noprofile --norc -eo pipefail`; omitting `shell`
 * on Linux means plain `bash -e`. Both are fail-fast, so running the script
 * under a bare `bash -c` would let failures the real runner treats as fatal
 * pass silently here.
 */
function shellArgv(shell: string | undefined, scriptPath: string): string[] {
  if (shell === 'bash') {
    return ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath];
  }
  if (shell === undefined) {
    return ['-e', scriptPath];
  }
  throw new Error(`unsupported step shell: ${shell}`);
}

/**
 * Execute the extracted real shell against the fake `gh` on PATH. The fake gh
 * reads the JSON fixture from `GH_FAKE_STATE` and appends every invocation's
 * argv to `GH_CALL_LOG`. GitHub `${{ ... }}` expressions in the step env are
 * resolved deterministically.
 */
export function runNotification(
  opts: RunNotificationOptions,
): RunNotificationResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'issue3064-metadata-'));
  const stateFile = path.join(dir, 'state.json');
  const callLog = path.join(dir, 'calls.jsonl');
  const binDir = path.join(dir, 'bin');
  const workDir = path.join(dir, 'work');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(path.join(binDir, 'gh'), FAKE_GH_SOURCE, { mode: 0o755 });
  writeFileSync(stateFile, JSON.stringify(opts.fake));

  const env: Record<string, string> = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    GH_FAKE_STATE: stateFile,
    GH_CALL_LOG: callLog,
    GH_REPO: opts.fake.repo ?? REPO_DEFAULT,
    GH_TOKEN: 'gh-token',
    GITHUB_STEP_SUMMARY: path.join(dir, 'step-summary.md'),
  };
  for (const [key, value] of Object.entries(opts.env)) {
    env[key] = substituteExpressions(value, opts.fake);
  }

  // The runner substitutes `${{ }}` in the run body too, not just in env. Left
  // in place they become bash "bad substitution" errors that silently drop
  // arguments, so resolve them here and write the result to a real script file
  // the way the runner does.
  const scriptPath = path.join(dir, 'step.sh');
  writeFileSync(scriptPath, substituteExpressions(opts.script, opts.fake));

  try {
    const result = spawnSync('bash', shellArgv(opts.shell, scriptPath), {
      cwd: workDir,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ghCalls = readCallLog(callLog);
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ghCalls,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readCallLog(callLog: string): GhCall[] {
  let content: string;
  try {
    content = readFileSync(callLog, 'utf8');
  } catch {
    return [];
  }
  return content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as GhCall);
}
