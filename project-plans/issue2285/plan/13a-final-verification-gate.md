# Phase 13a: Final Verification Gate (post-PR CI + CodeRabbit)

## Phase ID
`PLAN-20260629-ISSUE2285.P13a`

## Prerequisites
- Required: Phase 13 completed (P13 is the pre-push local gate: full
  verification suite + OCR, all green BEFORE pushing).
- Verification: `test -f project-plans/issue2285/.completed/P13.md`.

## Scope Clarification (architect finding 7)

**P13 is the pre-push LOCAL gate**: the full verification suite (`npm run
test/lint/lint:eslint-guard/lint:cli-boundary/typecheck/format/build`, smoke
test) plus detached OCR, all run locally BEFORE pushing. P13's completion
marker (`P13.md`) is created when the local gate is green.

**P13a is the POST-PR gate**: it runs ONLY after `gh pr create` returns a real
PR number. It watches CI (`gh pr checks <real-number> --watch --interval 300`),
remediates workflow failures and CodeRabbit comments, and loops until all
checks are green and all actionable comments are resolved.

**The P13a completion marker (`P13a.md`) is created ONLY after CI is green AND
all CodeRabbit comments are addressed.** It is NOT created immediately after
pushing — the PR must pass CI first.

## Verification Tasks

The deepthinker verifier confirms the ENTIRE integrated state is green and
the architecture itself enforces the boundary. This is the final gate.

**Architect finding 7 (pre-push vs post-PR split)**: items 1–9 below were
already completed in P13 (the pre-push LOCAL gate). P13a CONFIRMS they remain
green (re-runs them as a final integrated check) and then performs the
POST-PR work (item 10: CI watch + CodeRabbit remediation). The P13a
completion marker is created ONLY after CI is green and all CodeRabbit
comments are addressed.

1. **`npm run test` passes** (full repo) — confirmed green (was green in P13).
2. **`npm run lint` passes** — confirmed green.
3. **`npm run lint:eslint-guard` passes** — no suppression directives, no rule
   loosening, no complexity threshold increases, no ignore expansion anywhere
   in the diff.
4. **`npm run lint:cli-boundary` passes** AND invokes
   `node scripts/check-cli-import-boundary.mjs` (confirm the npm script
   mapping).
5. **`npm run lint:agents-api-surface` passes** AND invokes
   `node scripts/check-agents-api-surface.mjs` (architect finding 2:
   CI-required lint script in the full verification suite alongside
   `lint:cli-boundary`; revision 4 architect findings 1, 8: the guard is
   wired into `.github/workflows/ci.yml`; revision 6 finding 7: CI job
   placement is mechanism-conditional — B1/B1a/B1b in the `lint_javascript`
   job, B2 in the post-build `test` job only; the guard test also runs in
   `npm run test`).
6. **`npm run typecheck` passes**.
7. **`npm run format` ran before the suite**; before/after git status
   comparison shows no NEW unexpected changes (architect finding 1: NOT
   `git diff --stat --quiet`; revision 4 architect finding 7: format runs
   FIRST, then the before-suite snapshot is taken so format changes are in
   the baseline).
8. **`npm run build` passes**.
9. **Smoke test passes**:
   `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`
   produces a haiku (interactive runtime path works).
10. **OCR** run detached with a 20-min floor (done in P13 before push);
    High/Medium findings fixed; Low findings fixed or justified. P13a confirms
    the OCR evidence is recorded.
11. **PR CI green** — this is the POST-PR step (architect finding 7): after
    `gh pr create` returns a REAL PR number, run
    `gh pr checks <real-pr-number> --watch --interval 300`. Workflow failures
    and CodeRabbit comments are remediated until all green and all actionable
    comments resolved. **The P13a completion marker is created ONLY after this
    step passes.**
12. **All seven Non-Deferral Gates** have verifier evidence recorded in
    `execution-tracker.md`.
13. **No deferred implementation language** in the issue's code surface.
14. **No lint/complexity loosening or suppression directives**.

## Verification Commands

```bash
# ── Architect review finding 9: assert LLXPRT_API_SURFACE_SKIP is UNSET ──
# The local escape hatch could undercut final fail-closed behavior. The final
# gate MUST run with the guard in full fail-closed mode.
test -z "${LLXPRT_API_SURFACE_SKIP:-}" || { echo "FAIL: LLXPRT_API_SURFACE_SKIP is set to '$LLXPRT_API_SURFACE_SKIP' — unset it before final verification (architect review finding 9)"; exit 1; }
echo "OK: LLXPRT_API_SURFACE_SKIP is unset — guard runs in full fail-closed mode"

# ── Full verification suite (every command MUST pass — fail-closed) ───
# Revision 4 architect finding 7: run `npm run format` FIRST, THEN take the
# before-suite git status snapshot, THEN run the rest of the suite. This avoids
# a false failure when format legitimately changes implementation files — the
# snapshot is taken AFTER format so format's changes are in the baseline.
set -e
npm run format
git status --short > /tmp/p13a-status-before.txt
npm run lint
npm run lint:eslint-guard
npm run lint:cli-boundary
npm run lint:agents-api-surface
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
set +e

# ── lint:cli-boundary invokes the checker (fail-closed) ───────────────
grep -q "lint:cli-boundary" package.json || { echo "FAIL: lint:cli-boundary missing"; exit 1; }
grep -q "check-cli-import-boundary.mjs" package.json || { echo "FAIL: checker not referenced"; exit 1; }

# ── API-surface guard CI inclusion (revision 4 architect findings 1, 8:
#    verify the ACTUAL GitHub workflow, NOT just package.json) ──────────
test -f scripts/check-agents-api-surface.mjs || { echo "FAIL: API-surface script missing"; exit 1; }
test -f packages/agents/src/api/__tests__/publicSurface.guard.test.ts || { echo "FAIL: guard test file missing"; exit 1; }
grep -q "check-agents-api-surface.mjs" package.json || { echo "FAIL: API-surface script not wired into npm scripts"; exit 1; }
grep -q "lint:agents-api-surface" .github/workflows/ci.yml || { echo "FAIL: lint:agents-api-surface NOT in .github/workflows/ci.yml (architect finding 1)"; exit 1; }
echo "OK: API-surface guard CI-enforced via .github/workflows/ci.yml"
# Confirm lint:agents-api-surface is wired
node -e "const p=require('./package.json'); if(!(p.scripts&&p.scripts['lint:agents-api-surface'])) { console.error('FAIL: lint:agents-api-surface script not in package.json'); process.exit(1); }"
echo "OK: API-surface guard wired via npm script + CI workflow + test file present"

# ── git status before/after comparison (revision 4 architect finding 7:
#    format runs FIRST, THEN the before-suite snapshot is taken so format
#    changes are in the baseline. The implementation is uncommitted, so
#    `git diff --stat --quiet` would always fail. Confirm the suite produced
#    no NEW unexpected changes beyond the pre-existing uncommitted work and
#    gitignored build artifacts.) Revision 6 architect finding 8 + architect
#    review finding 10: compare NORMALIZED filtered before/after snapshots
#    (not unified-diff added-lines grep, which misses modified/removed
#    generated files). The algorithm below MUST remain inline in this phase
#    file (not referenced from the tracker) so workers do not revert to
#    weaker prior diff checks. The `normalize_status` function filters via
#    `git check-ignore` (removing gitignored build artifacts like dist/,
#    node_modules/.cache/, tsbuildinfo), and the `diff -u` on the normalized
#    sorted snapshots detects ALL status changes (added, modified, removed,
#    renamed) — not just added lines. ────────────────────────────────────
normalize_status() {
  while IFS= read -r line; do
    fpath="$(echo "$line" | cut -c4-)"
    [ -z "$fpath" ] && continue
    git check-ignore "$fpath" >/dev/null 2>&1 && continue
    echo "$line"
  done
}
# Revision 5 architect finding 6: verify expected generated paths are gitignored
for p in node_modules/.cache/agents-api-surface/report.json \
         node_modules/.cache/tsbuildinfo \
         dist; do
  git check-ignore "$p" >/dev/null 2>&1 || { echo "WARN: expected generated path not gitignored: $p"; }
done
normalize_status < /tmp/p13a-status-before.txt | sort > /tmp/p13a-status-before-norm.txt
git status --short | normalize_status | sort > /tmp/p13a-status-after-norm.txt
if ! diff -u /tmp/p13a-status-before-norm.txt /tmp/p13a-status-after-norm.txt > /tmp/p13a-status-diff.txt; then
  echo "FAIL: suite produced unexpected changes (normalized comparison):"; cat /tmp/p13a-status-diff.txt; exit 1
fi
echo "OK: no unexpected new changes produced by the suite"

# Architect review finding 4: capture git status --ignored --short so
# unexpected UNIGNORED build output is not hidden by assumptions. The
# normalized comparison above handles ignored files, but this explicit
# snapshot provides human-readable audit trail proving build artifacts are
# correctly ignored and no new unignored build output appeared after the build.
git status --ignored --short > /tmp/p13a-status-ignored-snapshot.txt
echo "=== Generated artifact evidence (git status --ignored) ===" >> /tmp/p13a-build-evidence.txt
git status --ignored --short >> /tmp/p13a-build-evidence.txt 2>&1
# Verify expected generated paths appear in the IGNORED section
grep -qE '!!.*dist' /tmp/p13a-status-ignored-snapshot.txt || echo "WARN: dist/ not shown as ignored (may not exist yet)"

# ── Architecture enforces the boundary (spot-checks per gate — fail-closed) ─
# Gate 1: root clean
test "$(grep -c "export \* from './internals.js'" packages/agents/src/index.ts)" -eq 0 || { echo "FAIL: root re-exports internals"; exit 1; }
# Gate 2: symbol allowlist gone
test "$(grep -c 'PUBLIC_AGENT_SYMBOLS' scripts/check-cli-import-boundary.mjs || true)" -eq 0 || { echo "FAIL: PUBLIC_AGENT_SYMBOLS present"; exit 1; }
# Gate 4: API-surface guard green (via explicit script — no in-lifecycle build)
# Architect review finding 8: the guard test reads
# node_modules/.cache/agents-api-surface/report.json and FAILS CLOSED when
# absent. Therefore lint:agents-api-surface MUST run immediately before the
# guard test. Do NOT reorder these two commands.
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script"; exit 1; }
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
test $? -eq 0 || { echo "FAIL: API-surface guard test (ensure lint:agents-api-surface ran immediately before — finding 8)"; exit 1; }
# Gate 5: runtime factory — branch by RECORDED DECISION (revision 3 findings 12, 14)
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
  test "$FACTORY_COUNT" -eq 1 || { echo "FAIL: single-source but $FACTORY_COUNT declarations"; exit 1; }
  echo "OK: single-source"
elif [ "$DECISION" = "retained-duplication" ]; then
  test "$FACTORY_COUNT" -ge 2 || { echo "FAIL: retained-duplication but $FACTORY_COUNT declarations"; exit 1; }
  GUARD_PATH="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  test -n "$GUARD_PATH" || { echo "FAIL: retained-duplication missing 'drift-guard-path:'"; exit 1; }
  test -f "$GUARD_PATH" || { echo "FAIL: drift guard not found at $GUARD_PATH"; exit 1; }
  echo "OK: retained-duplication with drift guard at $GUARD_PATH"
else
  echo "FAIL: unknown factory decision '$DECISION'"; exit 1
fi
# Gate 6: no quarantine language (fail-closed, revision 3 finding 5 — narrowed to quarantine synonyms)
QUARANTINE="$(grep -rn -i 'quarantine\|holding pen\|holding-pen' packages/cli/src/cliSessionDispatch.tsx packages/cli/src/session/ packages/cli/src/cli.tsx 2>/dev/null || true)"
test -z "$QUARANTINE" || { echo "FAIL: quarantine language:"; echo "$QUARANTINE"; exit 1; }

# Gate 3 (final guard — architect finding 11): production CLI source has ZERO
# imports of @vybestack/llxprt-code-agents/internals.js. Tests MAY still use
# the internals subpath, but production source MUST NOT. Fail-closed.
CLI_PROD_INTERNALS="$(grep -rn '@vybestack/llxprt-code-agents/internals.js' packages/cli/src --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v dist | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v 'integration-tests' || true)"
test -z "$CLI_PROD_INTERNALS" || { echo "FAIL: production CLI source imports agents internals subpath (architect finding 11):"; echo "$CLI_PROD_INTERNALS"; exit 1; }
echo "OK: production CLI source has zero imports of agents internals subpath"

# ── Cross-phase deferred-language scan (architect review finding 6:
#    pre-existing debt baseline. Scan ADDED/MODIFIED hunks via git diff so
#    only NEWLY INTRODUCED TODO/FIXME/HACK/STUB/TEMPORARY/placeholder/for-now
#    FAILS, not pre-existing hits.) ─────────────────────────────────────
ISSUE_SURFACE_FILES="packages/agents/src/index.ts packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts packages/agents/src/api/__tests__/publicSurface.guard.test.ts packages/agents/src/api/__tests__/apiSurfaceParser.mjs packages/a2a-server/src/config/config.ts packages/a2a-server/src/agent/task.ts packages/a2a-server/src/agent/task-runtime-helpers.ts packages/a2a-server/src/utils/testing_utils.ts scripts/check-cli-import-boundary.mjs scripts/check-agents-api-surface.mjs scripts/tests/cli-import-boundary.test.js"
EXISTING_FILES=""
for f in $ISSUE_SURFACE_FILES; do [ -f "$f" ] && EXISTING_FILES="$EXISTING_FILES $f"; done
for f in packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx; do [ -f "$f" ] && EXISTING_FILES="$EXISTING_FILES $f"; done
[ -d packages/cli/src/session ] && EXISTING_FILES="$EXISTING_FILES packages/cli/src/session/"
NEW_DEFERRED="$(git diff -- $(echo $EXISTING_FILES) 2>/dev/null | grep '^+' | grep -v '^+++' | grep -iE '(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)' || true)"
test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language in issue surface (git diff added lines):"; echo "$NEW_DEFERRED"; exit 1; }
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated)"

# ── No suppression directives in the diff ──────────────────────────────
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# ── Mechanical placeholder/unchecked-gate guard (architect finding 8) ──
# The execution tracker MUST NOT contain unfilled placeholder evidence
# ("Verifier evidence: ___") or unchecked non-deferral gate items. These
# checks fail closed — a placeholder or unchecked gate item exits nonzero.
PLACEHOLDERS="$(grep -n 'Verifier evidence: ___' project-plans/issue2285/execution-tracker.md || true)"
test -z "$PLACEHOLDERS" || { echo "FAIL: unfilled Verifier evidence placeholders in execution-tracker.md:"; echo "$PLACEHOLDERS"; exit 1; }
UNCHECKED_GATES="$(grep -n '^- \[ \]' project-plans/issue2285/execution-tracker.md || true)"
test -z "$UNCHECKED_GATES" || { echo "FAIL: unchecked non-deferral gate items in execution-tracker.md:"; echo "$UNCHECKED_GATES"; exit 1; }
echo "OK: no placeholders or unchecked gates"
```

## OCR + PR workflow verification

```bash
# ── OCR preview gate (architect finding 10 — fail-closed) ──────────────
# Before launching the review, run `ocr review --preview` and confirm test/
# spec files appear under "Will review" (NOT "Excluded"). ocr excludes
# test/spec files by default; the global ~/.opencodereview/rule.json include
# patterns re-include them. This gate FAILS if test/spec files are excluded.
# Range: use `main...HEAD` (the feature-branch commits relative to main).
# If the branch was created from a different base, substitute the actual
# merge-base (e.g. `origin/main...HEAD`).
OCR_RANGE="main...HEAD"
ocr review --preview "$OCR_RANGE" > /tmp/ocr_preview.log 2>&1
test $? -eq 0 || { echo "FAIL: ocr review --preview failed"; cat /tmp/ocr_preview.log; exit 1; }
# Confirm test/spec files are under "Will review", not "Excluded"
grep -E '\.test\.|\.spec\.|__tests__' /tmp/ocr_preview.log | grep -i "excluded" && { echo "FAIL: test/spec files are EXCLUDED from OCR — fix rule.json includes"; cat /tmp/ocr_preview.log; exit 1; } || echo "OK: preview does not exclude test/spec files"
grep -qE '\.test\.|\.spec\.|__tests__' /tmp/ocr_preview.log || { echo "FAIL: no test/spec files shown in OCR preview — they may be excluded"; cat /tmp/ocr_preview.log; exit 1; }

# OCR was run detached with --timeout 20; findings addressed (fail-closed)
# (verifier reviews /tmp/ocr_review.log or the session jsonl for findings)
test -s /tmp/ocr_review.log || { echo "FAIL: OCR log missing or empty"; exit 1; }
echo "OK: OCR log present"

# PR CI watch (architect review finding 7: make this step EXECUTABLE, not
# just a documented note). The prior revision said "the verifier confirms
# evidence" but did not actually run `gh pr checks`. This revision reads the
# REAL PR number and runs the actual watch command with the required
# loop/remediation behavior.
# Step 1: read the REAL PR number from the current branch.
PR_NUMBER="$(gh pr view --json number --jq '.number' 2>/dev/null || true)"
test -n "$PR_NUMBER" || { echo "FAIL: could not read PR number via 'gh pr view' — ensure the PR was created and gh is authenticated (architect review finding 7)"; exit 1; }
echo "PR number: $PR_NUMBER"

# Step 2: run gh pr checks with the REAL number, watching until completion.
# Per the project memory: use --watch --interval 300, loop up to 5 times max.
# Between each iteration, print the current timestamp. NEVER make unsourced
# claims about wait durations — report status factually.
WATCH_ATTEMPT=0
MAX_WATCH=5
while [ "$WATCH_ATTEMPT" -lt "$MAX_WATCH" ]; do
  WATCH_ATTEMPT=$((WATCH_ATTEMPT + 1))
  echo "=== gh pr checks watch attempt $WATCH_ATTEMPT of $MAX_WATCH at $(date) ==="
  gh pr checks "$PR_NUMBER" --watch --interval 300 > /tmp/p13a-pr-checks.log 2>&1
  CHECKS_EXIT=$?
  cat /tmp/p13a-pr-checks.log
  if [ "$CHECKS_EXIT" -eq 0 ]; then
    echo "OK: all PR checks green (attempt $WATCH_ATTEMPT)"
    break
  fi
  if [ "$WATCH_ATTEMPT" -ge "$MAX_WATCH" ]; then
    echo "FAIL: PR checks not green after $MAX_WATCH watch attempts — remediate and re-run (architect review finding 7)"; exit 1
  fi
  echo "WARN: some checks failed on attempt $WATCH_ATTEMPT — remediate failures, push fixes, then re-watch"
  # The worker remediates failures here (investigate, fix, push), then loops.
  # If the worker cannot remediate within the loop, the phase FAILS.
  echo "Current time: $(date)"
done

# Record the PR number and checks evidence in the completion marker.
echo "PR_NUMBER=$PR_NUMBER" > /tmp/p13a-pr-evidence.txt
cat /tmp/p13a-pr-checks.log >> /tmp/p13a-pr-evidence.txt
```

## Semantic Verification Checklist

- [ ] I personally reviewed the output of every command in the full suite
      (not just exit codes): test, lint, eslint-guard, cli-boundary,
      agents-api-surface, typecheck, format, build, smoke.
- [ ] The smoke test produced a haiku — the interactive runtime works.
- [ ] `npm run lint:cli-boundary` invokes `check-cli-import-boundary.mjs`.
- [ ] `git status` before/after comparison shows no NEW unexpected changes
      after the suite (architect finding 1: the implementation is uncommitted,
      so the check is before/after, not `git diff --stat --quiet`).
- [ ] OCR ran detached with a 20-min floor; I reviewed every finding;
      High/Medium fixed; Low fixed-or-justified.
- [ ] PR CI is green (`gh pr checks <real-pr-number> --watch --interval 300`);
      CodeRabbit comments addressed.
- [ ] All seven Non-Deferral Gates have verifier evidence in
      `execution-tracker.md`.
- [ ] The architecture itself enforces the boundary — package root, export
      map, API contract, boundary checker, runtime factory (single-sourced or
      drift-guarded), and CLI session ownership all agree on the same final
      state.
- [ ] The API-surface guard is wired into CI as an explicit step in
      `.github/workflows/ci.yml` (revision 4 findings 1, 8: NOT just
      package.json). `npm run lint:agents-api-surface` runs in the
      `lint_javascript` job alongside `lint:cli-boundary` (revision 6 finding
      7: only if mechanism B1/B1a/B1b; if B2, it runs only in the post-build
      `test` job). The guard test runs in `npm run test` reading the report
      the lint script emits.
- [ ] `npm run format` ran before the final suite; before/after git status
      comparison shows no NEW unexpected changes (format ordering — architect
      finding 1; revision 4 finding 7: format runs FIRST, then snapshot;
      revision 6 finding 8: normalized filtered snapshot comparison, NOT
      unified-diff added-lines grep).
- [ ] No NEW `@plan:PLAN-20260629-ISSUE2285`/`@requirement:REQ-` marker-only
      comment churn in production source (finding 5 + architect review finding 5).
      Pre-existing markers from other issues are NOT counted as failures.
- [ ] `LLXPRT_API_SURFACE_SKIP` is UNSET during final verification (architect
      review finding 9) — the API-surface guard ran in full fail-closed mode.
- [ ] The REAL PR number was read via `gh pr view` and
      `gh pr checks "$PR_NUMBER" --watch --interval 300` was actually run
      (architect review finding 7) — not just documented. CI is green and all
      CodeRabbit comments are addressed.
- [ ] `git status --ignored --short` evidence captured (architect review finding
      4) — generated artifacts confirmed ignored; no unexpected unignored build
      output appeared.
- [ ] No newly introduced deferred implementation language and no lint/complexity
      loosening or suppression directives anywhere in the issue's surface
      (architect review finding 6: pre-existing baseline tolerated).

## Non-Deferral Gate 7 (Verification Gate) Evidence

Fill in execution-tracker.md Gate 7 verifier evidence with:
- PASS output for each of: `npm run format` (first), `npm run lint`,
  `npm run lint:eslint-guard`, `npm run lint:cli-boundary`,
  `npm run lint:agents-api-surface`, `npm run typecheck`, `npm run test`,
  `npm run build`.
- Smoke test output (the haiku).
- confirmation `npm run lint:cli-boundary` invokes
  `node scripts/check-cli-import-boundary.mjs`.
- confirmation the API-surface guard is wired into
  `.github/workflows/ci.yml` as an explicit step (revision 4 findings 1, 8:
  NOT just package.json — grep the workflow file; revision 6 finding 7:
  mechanism-conditional — B1/B1a/B1b in `lint_javascript`, B2 in `test` job
  only) and the guard test runs in `npm run test`.
- confirmation before/after git status comparison shows no NEW unexpected
  changes after the suite (architect finding 1: NOT `git diff --stat --quiet`;
  revision 4 finding 7: format runs first, then snapshot; revision 6 finding
  8: normalized filtered snapshot comparison, NOT unified-diff added-lines
  grep).
- OCR detached-run evidence + finding disposition.
- `gh pr checks <real-pr-number> --watch --interval 300` green output.

## Completion Markers (final)

- [ ] All phases P00–P13a (including P10/P10a seam audit) have completion
      markers under `project-plans/issue2285/.completed/`.
- [ ] All phase completion markers contain structured diff evidence per the
      Standard Completion Marker Template in `overview.md` (architect finding 8).
- [ ] All requirements have `@requirement:REQ-XXX` markers in tests/plan
      artifacts (NOT production source — finding 5).
- [ ] No phases skipped (sequential P00 → P13a).
- [ ] No deferred implementation language in completed code.
- [ ] No lint/complexity loosening or suppression directives.
- [ ] All seven Non-Deferral Gates have verifier evidence recorded.

## Success Criteria
- PASS: full verification suite green (including `lint:agents-api-surface`),
  smoke test produces a haiku, `lint:cli-boundary` invokes the checker,
  `lint:agents-api-surface` invokes `check-agents-api-surface.mjs`
  (architect finding 2 + revision 4 findings 1, 8: CI-enforced via
  `.github/workflows/ci.yml`; revision 6 finding 7: mechanism-conditional
  CI placement), OCR findings addressed, PR CI green (post-PR, architect
  finding 7), all seven gates evidenced, no deferred language, no
  suppression directives. The issue is complete only when the architecture
  enforces the boundary and the whole integrated state agrees.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P13a.md` — **ONLY after CI is green
AND all CodeRabbit comments are addressed** (architect finding 7). This marker
is NOT created immediately after pushing; it is created when the post-PR gate
(item 10) passes. This is the final completion marker; the plan is done when it
exists AND all gates are evidenced.

The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
