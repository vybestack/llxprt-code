# Phase 13: Final Boundary Hardening & Full Verification (pre-push local gate)

## Phase ID
`PLAN-20260629-ISSUE2285.P13`

## Prerequisites
- Required: Phase 12a completed.
- Verification: `test -f project-plans/issue2285/.completed/P12a.md`.

## Scope Clarification (architect finding 7)

**P13 is the pre-push LOCAL gate.** It runs the full verification suite
(`npm run test/lint/lint:eslint-guard/lint:cli-boundary/typecheck/format/build`,
smoke test) and detached OCR, all locally BEFORE pushing. The P13 completion
marker is created when the local gate is green.

**P13a is the POST-PR gate** (runs after `gh pr create`): CI watch +
CodeRabbit remediation. P13 does NOT include `gh pr checks` (the PR does not
exist yet).

## Requirements Implemented (Expanded)

### REQ-INT-001.2: Verification Gate (full verification suite + smoke test)

**Full Text**: Before PR completion, all required checks must pass —
`npm run test`, `npm run lint`, `npm run lint:eslint-guard`,
`npm run lint:cli-boundary`, `npm run typecheck`, `npm run format`,
`npm run build`, and the smoke test
`node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`.
`npm run lint:cli-boundary` must invoke
`node scripts/check-cli-import-boundary.mjs`. Open Code Review must run
detached with a 20-minute floor and every finding evaluated. After PR creation,
CI must be watched and failures/CodeRabbit comments remediated until green.

**Behavior**:
- GIVEN: all implementation phases (P03–P12) are complete and individually
  verified.
- WHEN: the full verification suite is run end-to-end against the whole repo.
- THEN: every command passes; the smoke test produces a haiku (proving the
  interactive runtime path works); the architecture itself enforces the
  boundary (root curated, API-surface guard green, boundary checker
  specifier-based, runtime factory drift-guarded, CLI session ownership
  stable).

**Why This Matters**: individual phase verification proves each slice; this
phase proves the WHOLE integrated state is green and the runtime actually
works. No phase is accepted on slice-local green alone.

## Implementation Tasks

### Files to Modify
- None expected. This is a verification + hardening phase. If any check
  reveals a cross-phase integration issue, return to the responsible phase
  (do NOT patch over it here). Any format-only changes (`npm run format`)
  are applied and committed.

### Full verification suite (run in order, all MUST pass)

**Plan-local note (format ordering)**: `npm run format` WRITES files, so
it must run BEFORE the final verification suite (so the suite validates the
formatted state), OR if run after, all affected checks must be re-run and
`git status`/`git diff` verified clean. The ordering below runs format FIRST
(it writes the canonical formatting), then lint (which validates the
now-formatted state), then the full suite, then verifies git diff is clean
at the end.

```bash
# Step 1: format first (writes files), then snapshot, then verify.
# Revision 4 architect finding 7: run `npm run format` FIRST, THEN take the
# before-suite git status snapshot, THEN run the rest of the suite. This avoids
# a false failure when format legitimately changes implementation files — the
# snapshot is taken AFTER format so format's changes are in the baseline.
set -e
npm run format
# Snapshot the git status AFTER format (so format changes are the baseline)
git status --short > /tmp/p13-status-before.txt
npm run lint
npm run lint:eslint-guard
npm run lint:cli-boundary
npm run lint:agents-api-surface
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
set +e
# Step 2: verify no NEW unexpected changes were produced BY THE SUITE (after format).
# (architect finding 1: NOT `git diff --stat --quiet`, which fails because the
# implementation is legitimately uncommitted. Instead, compare the post-suite
# status to the post-format snapshot — the only allowed additions/changes are
# gitignored build artifacts that may appear/disappear.)
# Revision 6 architect finding 8 + architect review finding 10: do NOT inspect
# only added lines from a unified diff (`grep '^+[^+]'`) — that misses
# modified/removed generated files. Instead, NORMALIZE both snapshots by
# filtering out gitignored paths via `git check-ignore`, then compare the
# normalized sorted sets. Any difference in the normalized sets is an
# unexpected change. The algorithm below MUST remain inline in this phase
# file (not referenced from the tracker) so workers do not revert to weaker
# prior diff checks.
# Architect review finding 4: completion evidence MUST also capture
# `git status --ignored --short` (or exact generated artifact evidence) so
# unexpected UNIGNORED build output is not hidden by assumptions. The
# normalized comparison above handles ignored files, but the explicit
# `--ignored` snapshot below provides a human-readable audit trail proving
# that build artifacts (dist/, tsbuildinfo, cache/) are correctly ignored
# and that NO new unignored build output appeared.
git status --ignored --short > /tmp/p13-status-ignored-snapshot.txt
# Verify the expected generated paths appear in the IGNORED section (## prefix
# in porcelain v1 --ignored output). If they appear as untracked/unmodified
# instead, the .gitignore is incomplete.
grep -qE '!!.*dist' /tmp/p13-status-ignored-snapshot.txt || echo "WARN: dist/ not shown as ignored (may not exist yet)"
# Capture exact generated artifact evidence for the completion marker
echo "=== Generated artifact evidence (git status --ignored) ===" >> /tmp/p13-build-evidence.txt
git status --ignored --short >> /tmp/p13-build-evidence.txt 2>&1
normalize_status() {
  # Read git status --short from stdin, filter out paths confirmed gitignored.
  while IFS= read -r line; do
    # Extract the path (column 4+, after the XY status + space)
    fpath="$(echo "$line" | cut -c4-)"
    # Skip empty lines
    [ -z "$fpath" ] && continue
    # Skip gitignored paths (dist/, node_modules/.cache/, tsbuildinfo, etc.)
    git check-ignore "$fpath" >/dev/null 2>&1 && continue
    echo "$line"
  done
}
git status --short | normalize_status | sort > /tmp/p13-status-after-normalized.txt
normalize_status < /tmp/p13-status-before.txt | sort > /tmp/p13-status-before-normalized.txt
# Revision 5 architect finding 6: verify expected generated paths are gitignored
for p in node_modules/.cache/agents-api-surface/report.json \
         node_modules/.cache/tsbuildinfo \
         dist; do
  git check-ignore "$p" >/dev/null 2>&1 || { echo "WARN: expected generated path not gitignored: $p"; }
done
if ! diff -u /tmp/p13-status-before-normalized.txt /tmp/p13-status-after-normalized.txt > /tmp/p13-status-diff.txt; then
  echo "FAIL: suite produced unexpected changes (normalized comparison):"; cat /tmp/p13-status-diff.txt; exit 1
fi
echo "OK: no unexpected new changes produced by the suite"
```

Notes:
- `npm run lint:cli-boundary` MUST invoke
  `node scripts/check-cli-import-boundary.mjs` — confirm the npm script
  mapping (this satisfies the issue's explicit acceptance criterion that the
  checker name be visibly invoked).
- `npm run lint:agents-api-surface` MUST invoke
  `node scripts/check-agents-api-surface.mjs` (architect finding 2: it is a
  CI-required lint script that runs in the full verification suite alongside
  `lint:cli-boundary`).
- `npm run format` runs FIRST so the entire suite validates the formatted
  state. **Revision 4 architect finding 7**: the before-suite git status
  snapshot is taken AFTER format (not before), so legitimate format changes
  are in the baseline and do not cause a false failure. After the suite, the
  before/after `git status --short` comparison MUST show no NEW unexpected
  changes beyond gitignored build artifacts.
- The smoke test exercises the real interactive runtime path; a successful
  haiku response proves the depollution + split did not break the CLI.

### Boundary hardening spot-checks (confirm the architecture enforces the gate)

**Architect review finding 9 (escape-hatch final gate):** the local
`LLXPRT_API_SURFACE_SKIP=1` escape hatch could undercut final fail-closed
behavior if it is accidentally set during final verification. Before running
the API-surface guard verification below, this phase MUST assert that
`LLXPRT_API_SURFACE_SKIP` is UNSET. If it is set, the phase FAILS immediately
— the final gate must run with the guard in full fail-closed mode.

```bash
# Architect review finding 9: assert LLXPRT_API_SURFACE_SKIP is UNSET before
# running API-surface guard verification. The escape hatch undercuts fail-closed
# behavior; the final gate MUST run with it unset so the guard cannot silently
# skip.
test -z "${LLXPRT_API_SURFACE_SKIP:-}" || { echo "FAIL: LLXPRT_API_SURFACE_SKIP is set to '$LLXPRT_API_SURFACE_SKIP' — unset it before final verification (architect review finding 9)"; exit 1; }
echo "OK: LLXPRT_API_SURFACE_SKIP is unset — guard runs in full fail-closed mode"

# Gate 1: agents root does NOT re-export internals (fail-closed)
test "$(grep -c "export \* from './internals.js'" packages/agents/src/index.ts)" -eq 0 || { echo "FAIL: root re-exports internals"; exit 1; }

# Gate 2: PUBLIC_AGENT_SYMBOLS gone from the checker (fail-closed)
test "$(grep -c 'PUBLIC_AGENT_SYMBOLS' scripts/check-cli-import-boundary.mjs || true)" -eq 0 || { echo "FAIL: PUBLIC_AGENT_SYMBOLS still present"; exit 1; }

# Gate 4: API-surface guard green (via explicit script — no in-lifecycle build)
# Architect review finding 8: the guard test reads
# node_modules/.cache/agents-api-surface/report.json and FAILS CLOSED when
# absent. Therefore lint:agents-api-surface MUST run immediately before the
# guard test. Do NOT reorder these two commands.
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script"; exit 1; }
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
test $? -eq 0 || { echo "FAIL: API-surface guard test (ensure lint:agents-api-surface ran immediately before — finding 8)"; exit 1; }

# Gate 5: runtime factory — branch by RECORDED DECISION (revision 3 findings 12, 14).
# The decision record declares single-source OR retained-duplication. For
# retained-duplication, the guard path is read FROM THE RECORD (not hard-coded).
FACTORY_COUNT="$(node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const out = execSync('grep -rln \"interface AgentRuntimeFactoryBindings\" packages/ --include=*.ts || true', {encoding:'utf8'}).split('\n').filter(Boolean);
let n = 0;
for (const f of out) { if (f.includes('node_modules') || f.includes('dist')) continue; const s = fs.readFileSync(f,'utf8'); if (/interface\\s+AgentRuntimeFactoryBindings/.test(s)) n++; }
process.stdout.write(String(n));
")"
DECISION="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^decision:[[:space:]]*//' 2>/dev/null || echo '')"
test -n "$DECISION" || { echo "FAIL: runtime-factory-contract-decision.md missing 'decision:' line"; exit 1; }
if [ "$DECISION" = "single-source" ]; then
  test "$FACTORY_COUNT" -eq 1 || { echo "FAIL: single-source decision but $FACTORY_COUNT declarations"; exit 1; }
  echo "OK: single-source (1 declaration)"
elif [ "$DECISION" = "retained-duplication" ]; then
  test "$FACTORY_COUNT" -ge 2 || { echo "FAIL: retained-duplication but $FACTORY_COUNT declarations"; exit 1; }
  GUARD_PATH="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  test -n "$GUARD_PATH" || { echo "FAIL: retained-duplication decision missing 'drift-guard-path:' line"; exit 1; }
  test -f "$GUARD_PATH" || { echo "FAIL: drift guard not found at recorded path: $GUARD_PATH"; exit 1; }
  echo "OK: retained-duplication with drift guard at $GUARD_PATH"
else
  echo "FAIL: unknown factory decision '$DECISION'"; exit 1
fi

# Gate 6: no quarantine language in the CLI session surface (fail-closed, revision 3 finding 5 — narrowed)
QUARANTINE="$(grep -rn -i 'quarantine\|holding pen\|holding-pen' packages/cli/src/cliSessionDispatch.tsx packages/cli/src/session/ packages/cli/src/cli.tsx 2>/dev/null || true)"
test -z "$QUARANTINE" || { echo "FAIL: quarantine language present:"; echo "$QUARANTINE"; exit 1; }

# Gate 3 (final guard — architect finding 11): production CLI source has ZERO
# imports of @vybestack/llxprt-code-agents/internals.js. Tests MAY still use
# the internals subpath (they are testing lower-level seams), but production
# source under packages/cli/src MUST NOT. Fail-closed.
CLI_PROD_INTERNALS="$(grep -rn '@vybestack/llxprt-code-agents/internals.js' packages/cli/src --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v dist | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v 'integration-tests' || true)"
test -z "$CLI_PROD_INTERNALS" || { echo "FAIL: production CLI source imports agents internals subpath (architect finding 11):"; echo "$CLI_PROD_INTERNALS"; exit 1; }
echo "OK: production CLI source has zero imports of agents internals subpath"
```

### Required Code Markers
- This phase adds no new code markers (no implementation code). Confirm
  completion markers exist for P03–P12a (including P10/P10a seam audit) under
  `project-plans/issue2285/.completed/`.

## Reachability

The full suite exercises every package, the CLI entrypoint, and the build.
This is the integrated whole, not an isolated feature.

## Verification Commands

The full verification suite above IS the verification. Additionally:

```bash
# Confirm lint:cli-boundary invokes the checker (fail-closed)
grep -q "lint:cli-boundary" package.json || { echo "FAIL: lint:cli-boundary missing"; exit 1; }
grep -q "check-cli-import-boundary.mjs" package.json || { echo "FAIL: checker not referenced"; exit 1; }

# Confirm no suppression directives anywhere in the changed surface
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# Cross-phase deferred-language scan across all touched areas (fail-closed,
# revision 3 finding 4 — scoped to issue-owned files only, NOT broad directory
# scans that would catch unrelated existing hits).
# Architect review finding 6 (pre-existing debt baseline): the scan greps
# whole issue-owned files which can fail on pre-existing debt. The baseline
# approach: scan ADDED/MODIFIED hunks only (git diff against the pre-issue
# state) for newly introduced deferred language. The per-phase baselines
# recorded in P04/P05/P07/P09/P12 completion markers established the
# pre-existing hit sets. This cross-phase scan diffs against those baselines
# so only NEWLY INTRODUCED deferred language FAILS.
# Step 1: capture current deferred-language hits in the issue surface.
ISSUE_SURFACE_FILES="packages/agents/src/index.ts packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts packages/agents/src/api/__tests__/publicSurface.guard.test.ts packages/agents/src/api/__tests__/apiSurfaceParser.mjs packages/a2a-server/src/config/config.ts packages/a2a-server/src/agent/task.ts packages/a2a-server/src/agent/task-runtime-helpers.ts packages/a2a-server/src/utils/testing_utils.ts scripts/check-cli-import-boundary.mjs scripts/check-agents-api-surface.mjs scripts/tests/cli-import-boundary.test.js"
# Only scan files that actually exist to avoid false "not found" noise
EXISTING_FILES=""
for f in $ISSUE_SURFACE_FILES; do [ -f "$f" ] && EXISTING_FILES="$EXISTING_FILES $f"; done
# Also scan CLI session files if they exist
for f in packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx; do [ -f "$f" ] && EXISTING_FILES="$EXISTING_FILES $f"; done
[ -d packages/cli/src/session ] && EXISTING_FILES="$EXISTING_FILES packages/cli/src/session/"
# Step 2: check git diff for newly ADDED lines containing deferred language
# (this catches only newly introduced debt, not pre-existing hits — finding 6).
NEW_DEFERRED="$(git diff -- $(echo $EXISTING_FILES) 2>/dev/null | grep '^+' | grep -v '^+++' | grep -iE '(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)' || true)"
test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language in issue surface (git diff added lines):"; echo "$NEW_DEFERRED"; exit 1; }
echo "OK: no newly introduced deferred language in issue surface (pre-existing baseline tolerated)"

# API-surface guard CI inclusion (revision 4 architect findings 1, 8: verify
# the ACTUAL GitHub workflow, NOT just package.json — package.json proves local
# wiring, not CI enforcement).
test -f scripts/check-agents-api-surface.mjs || { echo "FAIL: API-surface script missing"; exit 1; }
test -f packages/agents/src/api/__tests__/publicSurface.guard.test.ts || { echo "FAIL: guard test file missing"; exit 1; }
grep -q "check-agents-api-surface.mjs" package.json || { echo "FAIL: API-surface script not wired into npm scripts"; exit 1; }
grep -q "lint:agents-api-surface" .github/workflows/ci.yml || { echo "FAIL: lint:agents-api-surface NOT in .github/workflows/ci.yml (architect finding 1)"; exit 1; }
echo "OK: API-surface guard CI-enforced via .github/workflows/ci.yml"
# Revision 6 architect finding 7: CI job placement is mechanism-conditional
# (B1/B1a/B1b: lint_javascript + test job; B2: test job only). P03/P03a verify
# the specific placement; P13 confirms presence in the workflow.
# Confirm the guard test is included by the agents vitest config (default include: **/*.test.ts under src)
grep -rn "publicSurface.guard" packages/agents/src/api/__tests__/ >/dev/null 2>&1 || { echo "FAIL: guard test not found in agents test dir"; exit 1; }
# Confirm lint:agents-api-surface is wired and runs
node -e "const p=require('./package.json'); if(!(p.scripts&&p.scripts['lint:agents-api-surface'])) { console.error('FAIL: lint:agents-api-surface script not in package.json'); process.exit(1); }"
echo "OK: API-surface guard wired via npm script + CI workflow + test file present"

# git status before/after comparison (architect finding 1: the implementation
# is uncommitted, so `git diff --stat --quiet` would always fail. Instead,
# confirm the verification commands produced no NEW unexpected changes beyond
# the pre-existing uncommitted implementation work and gitignored build
# artifacts). Revision 6 architect finding 8: compare NORMALIZED filtered
# before/after snapshots (not unified-diff added-lines grep, which misses
# modified/removed generated files). The before-snapshot was taken at the
# start of the full suite above (/tmp/p13-status-before.txt); compare against
# a fresh after-snapshot.
normalize_status() {
  while IFS= read -r line; do
    fpath="$(echo "$line" | cut -c4-)"
    [ -z "$fpath" ] && continue
    git check-ignore "$fpath" >/dev/null 2>&1 && continue
    echo "$line"
  done
}
normalize_status < /tmp/p13-status-before.txt | sort > /tmp/p13-verify-status-before-norm.txt
git status --short | normalize_status | sort > /tmp/p13-verify-status-after-norm.txt
if ! diff -u /tmp/p13-verify-status-before-norm.txt /tmp/p13-verify-status-after-norm.txt > /tmp/p13-verify-status-diff.txt; then
  echo "FAIL: verification produced unexpected changes (normalized comparison):"; cat /tmp/p13-verify-status-diff.txt; exit 1
fi
echo "OK: no unexpected new changes"
```

## Comment discipline (architect finding 5 + architect review finding 5)

Plan-marker and `@plan`/`@requirement` annotations are RESTRICTED to test files
and plan artifacts. They must NOT be added to production source files where
they conflict with the project's comment-discouragement rules. Specifically:
- `@plan`/`@requirement` markers belong in test files (`.test.ts`, `.spec.ts`)
  and plan-facing docs only.
- Production source changes (e.g. `packages/agents/src/index.ts`,
  `packages/cli/src/cli.tsx`) must NOT gain NEW `@plan:PLAN-20260629-ISSUE2285`
  decorative comment blocks just to carry phase markers. If a production file
  is edited, update its EXISTING relevant comments only where the comment
  content changed semantically (e.g. removing a stale "non-breaking barrel"
  description); do NOT add unrelated comment churn.
- **Pre-existing marker debt (architect review finding 5):** production source
  files such as `packages/a2a-server/src/config/config.ts`, `packages/tools/**`,
  and `packages/settings/**` ALREADY contain `@plan`/`@requirement` markers
  from PRIOR issues (e.g. `@plan PLAN-20260610-ISSUE1592`). These PRE-EXISTING
  markers are NOT to be removed by this issue unless the line they annotate is
  itself changed for issue #2285 scope. The policy prohibits only NEW
  issue2285 markers in production source — it does NOT imply existing markers
  must be removed.
- The cross-phase scan below confirms no production source gained NEW
  issue2285 marker-only comment additions.

## Deferred Implementation Detection

Covered by the cross-phase scan above. Expected: 0 in the issue's surface.

## Semantic Verification

- [ ] Every command in the full suite passed (real output reviewed, not just
      exit codes assumed).
- [ ] The smoke test produced a haiku — the interactive runtime path works.
- [ ] The architecture itself enforces the boundary (root curated, API guard
      green, checker specifier-based, factory single-sourced or drift-guarded,
      session ownership stable) — passing the checker is not the sole
      evidence; the package shape, export map, and API contract agree.
- [ ] `npm run format` ran BEFORE the final suite; before/after git status
      comparison shows no NEW unexpected changes after the suite (format
      ordering — architect finding 1: NOT `git diff --stat --quiet`, which
      fails because the implementation is uncommitted; revision 4 finding 7:
      format runs FIRST, then the before-suite snapshot is taken so format
      changes are in the baseline).
- [ ] The API-surface guard is wired into CI as an explicit step in
      `.github/workflows/ci.yml` (revision 4 findings 1, 8: NOT just
      package.json — verify the actual workflow file contains the step).
      `npm run lint:agents-api-surface` runs in the `lint_javascript` job
      alongside `lint:cli-boundary` (revision 6 finding 7: only for B1/B1a/B1b;
      if B2, it runs only in the post-build `test` job). The guard test
      (`publicSurface.guard.test.ts`) runs in `npm run test` and reads the
      report the lint script emits.
- [ ] No NEW `@plan:PLAN-20260629-ISSUE2285`/`@requirement:REQ-` marker-only
      comment churn in production source (finding 5 + architect review finding 5)
      — markers are in tests and plan artifacts only. Pre-existing markers from
      other issues are NOT counted as failures.
- [ ] `LLXPRT_API_SURFACE_SKIP` is UNSET during final verification (architect
      review finding 9) — the API-surface guard ran in full fail-closed mode.
- [ ] `git status --ignored --short` evidence captured (architect review finding
      4) — generated artifacts (dist/, tsbuildinfo, cache/) confirmed ignored;
      no unexpected unignored build output appeared after `npm run build`.
- [ ] No lint/complexity loosening or suppression directives anywhere in the
      changed surface.

## Constraints (restate for the worker)

- NO `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint
  severity downgrade, complexity threshold increase, or ignore expansion. If
  any check in the suite fails because of a lint/complexity rule, FIX THE
  UNDERLYING ISSUE — do NOT silence or loosen the rule.
- If a failure is discovered, return to the responsible phase; do not patch
  here.

## OCR (Open Code Review) — run BEFORE pushing

Run detached with a 20-minute floor; never foreground-capture (the shell
watchdog SIGTERM-kills foreground OCR and loses buffered output). Ensure test
files are NOT excluded (ocr excludes test/spec files by default — rely on the
global `~/.opencodereview/rule.json` include patterns to re-include them, and
verify with `ocr review --preview` that test files appear under "Will review").

**Architect finding (revision 2): the prior revision mentioned `ocr review
--preview` only in prose. This revision adds an EXECUTABLE preview gate that
MUST run before the review and FAILS if test/spec files are excluded.**

```bash
# ── OCR preview gate (architect finding 10 — fail-closed) ──────────────
# Range: use `main...HEAD` to review all commits on the feature branch
# relative to main. This is valid before the PR is created (local branch)
# and after (GitHub remote). If the branch was created from a different
# base, substitute the actual merge-base (e.g. `origin/main...HEAD`).
OCR_RANGE="main...HEAD"
ocr review --preview "$OCR_RANGE" > /tmp/ocr_preview.log 2>&1
test $? -eq 0 || { echo "FAIL: ocr review --preview failed"; cat /tmp/ocr_preview.log; exit 1; }
grep -E '\.test\.|\.spec\.|__tests__' /tmp/ocr_preview.log | grep -i "excluded" && { echo "FAIL: test/spec files EXCLUDED from OCR — fix rule.json includes"; cat /tmp/ocr_preview.log; exit 1; } || echo "OK: preview does not exclude test/spec files"
grep -qE '\.test\.|\.spec\.|__tests__' /tmp/ocr_preview.log || { echo "FAIL: no test/spec files shown in OCR preview"; cat /tmp/ocr_preview.log; exit 1; }

# ── Launch the review detached (20-min floor) ──────────────────────────
nohup ocr review --audience agent --timeout 20 "$OCR_RANGE" > /tmp/ocr_review.log 2>&1 & echo PID=$!
# Then POLL with short tool calls until DONE:
#   sleep 90; ps -p $PID; cat /tmp/ocr_review.log
# Repeat until the process is DONE.
```

Classify findings High/Medium/Low. Fix all High and Medium findings (return to
the responsible phase). Low findings: fix, or explicitly justify as
non-actionable / factual mistake / outside issue scope. If stdout is lost,
recover findings from `~/.opencodereview/sessions/*/*.jsonl` (grep for
`code_comment` tool calls).

## PR workflow (after push)

**Revision 3 (architect finding 23): the pre-push LOCAL gate is separate from
the post-PR CI workflow.** The literal `gh pr checks NUM` command cannot run
before the PR exists (NUM is unknown). The two steps are:

1. **Pre-push local gate (runs BEFORE pushing):** the full verification suite
   above + OCR must all pass. This is the local go/no-go gate. Do NOT include a
   literal `gh pr checks NUM` here — the PR number does not exist yet.
2. **Post-PR CI workflow (runs AFTER the PR is created):** push, create the PR
   with `gh`, THEN run `gh pr checks <actual-pr-number> --watch --interval 300`
   with the REAL PR number substituted in.

- Create the PR with `gh`, title including the issue number being fixed
  (e.g. "... (Fixes #2285)"), body with exquisite detail and "closes #2285".
- Watch CI:
  ```bash
  # <actual-pr-number> is the REAL PR number returned by gh pr create — NOT the
  # literal token NUM. This runs ONLY after the PR exists (revision 3 finding 23).
  gh pr checks <actual-pr-number> --watch --interval 300
  ```
  Loop up to 5 times; between iterations print the current timestamp. Never
  make unsourced claims about wait durations.
- Investigate every workflow failure and CodeRabbit comment. Never assume a
  failure is "unrelated" unless proven via `gh` that the same test fails on
  main/recent PRs — and even then, fix if possible. Remediate, re-run the
  full verification suite, push, watch again until all checks are green and
  all actionable CodeRabbit comments are resolved (resolve each with a
  comment explaining the action taken).

### Per-phase diff evidence (revision 3 — architect finding 24 + architect finding 8)

Using `git diff HEAD` to attribute per-phase modifications becomes unreliable
after multiple phases accumulate uncommitted changes. Each phase MUST record
structured diff evidence in its completion marker (`.completed/PNN.md`) per
the **Standard Completion Marker Template** in `overview.md` (architect
finding 8):
- **Files changed**: the worker captures `git diff --name-only` of its
  phase-owned files at the end of the implementation phase.
- **Diff stats**: `git diff --stat` of phase-owned files.
- **Command outputs**: exit status + key output for each required verification
  command.
- **Tracker evidence**: which execution-tracker.md gate items are satisfied +
  verifier evidence recorded.
- The verifier confirms the files listed match the phase's declared
  "Files to Modify/Create" section.
P13/P13a do NOT re-derive attribution from a single broad `git diff HEAD`;
they rely on each phase's recorded evidence. If a broad diff is needed for a
final sanity check, the verifier treats unexpected files as requiring
explanation from the claiming phase — not as automatic attribution to the
current phase.

## Success Criteria
- Full verification suite passes: `npm run test`, `npm run lint`,
  `npm run lint:eslint-guard`, `npm run lint:cli-boundary`,
  `npm run lint:agents-api-surface`, `npm run typecheck`,
  `npm run format`, `npm run build`, and the smoke test.
- Smoke test produces a haiku (runtime path works).
- `npm run lint:cli-boundary` invokes `check-cli-import-boundary.mjs`.
- `npm run lint:agents-api-surface` invokes `check-agents-api-surface.mjs`
  (architect finding 2 + revision 4 findings 1, 8: CI-enforced via
  `.github/workflows/ci.yml`; revision 6 finding 7: in the `lint_javascript`
  job for B1/B1a/B1b, or in the post-build `test` job only for B2).
- OCR run detached (20-min floor), High/Medium findings fixed, Low findings
  fixed-or-justified.
- Cross-phase deferred-language scan clean.
- No lint/complexity loosening or suppression directives.
- Architecture enforces the boundary (not just the checker passing).

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery (architect
finding 10 — `git checkout` can discard unrelated/user changes in the worktree).
Instead:
- For any suite failure: identify the responsible phase, return to that phase,
  and fix the issue in place. Re-run that phase's verifier, then return to P13.
- If a targeted revert is truly needed: revert ONLY the confirmed phase-owned
  files, and ONLY after inspecting each with `git diff` to confirm it contains
  no unrelated/user changes. Never run a broad `git checkout` that could
  discard uncommitted work outside this issue's scope.
- Report any blocking issue to the coordinator rather than reverting blindly.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P13.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
