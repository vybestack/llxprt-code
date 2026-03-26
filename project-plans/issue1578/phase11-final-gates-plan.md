# Issue 1578 – Phase 11 Final Gates Plan (Test-First + Subagent Workflow)

## 0) Scope

This plan covers the remaining work to finish issue #1578 based on current branch state:
- Phases 1–10 are already implemented.
- Remaining objective is **Phase 11**: final structural gates + full verification suite before check-in.

Primary blockers currently tracked:
- `packages/cli/src/auth/auth-flow-orchestrator.ts` still has functions over 80 lines.
- Final import migration/cycle checks and full repo verification must all pass.

### Canonical File Scope

All structural gates (file size, function size, import audit) apply to these files:

```
packages/cli/src/auth/oauth-manager.ts
packages/cli/src/auth/provider-registry.ts
packages/cli/src/auth/proactive-renewal-manager.ts
packages/cli/src/auth/token-access-coordinator.ts
packages/cli/src/auth/auth-flow-orchestrator.ts
packages/cli/src/auth/auth-status-service.ts
packages/cli/src/auth/provider-usage-info.ts
packages/cli/src/auth/OAuthBucketManager.ts
packages/cli/src/auth/oauth-provider-base.ts
packages/cli/src/auth/types.ts
packages/cli/src/auth/anthropic-oauth-provider.ts
packages/cli/src/auth/codex-oauth-provider.ts
packages/cli/src/auth/gemini-oauth-provider.ts
packages/cli/src/auth/qwen-oauth-provider.ts
```

This list matches `function-audit.cjs`. Any structural gate command that names files must target exactly this set.

### Canonical File List Shell Variable

Whenever a command needs the canonical file list, use this expansion (do not hand-type the list):

```bash
AUTH_FILES=$(echo packages/cli/src/auth/{oauth-manager,provider-registry,proactive-renewal-manager,token-access-coordinator,auth-flow-orchestrator,auth-status-service,provider-usage-info,OAuthBucketManager,oauth-provider-base,types,anthropic-oauth-provider,codex-oauth-provider,gemini-oauth-provider,qwen-oauth-provider}.ts)
```

---

## 1) Non-Negotiable Acceptance Criteria

1. No auth file in scope exceeds 800 lines.
2. No function in scoped auth files exceeds 80 lines.
3. Import migration is complete (no moved symbols imported from `oauth-manager.ts`).
4. No circular dependencies in `packages/cli/src/auth`.
5. Full required verification commands all pass:
   - `npm run test`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run format` (apply formatting fixes)
   - `npm run format:check` (read-only validation — must exit 0)
   - `npm run build`
   - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

---

## 2) Test-First Execution Strategy

### RED/GREEN Evidence Protocol

Every stage that adds or modifies tests **must** capture and report:
1. **RED evidence**: the exact test command and failing output *before* the implementation change (either a new assertion that fails against current code, or a tightened assertion that exposes a gap).
2. **GREEN evidence**: the same test command and passing output *after* the implementation change.

If a stage only runs existing passing tests (no new/tightened assertions), it must state "no RED phase — existing tests used as regression guard" and report the passing output.

Subagents must include these transcripts verbatim in their stage report (see §3).

---

### Stage A — Lock behavior with tests before refactor

Goal: protect behavior before further decomposition of oversized methods.

**Test-first actions:**
1. Extend/add tests in `packages/cli/src/auth/__tests__/auth-flow-orchestrator.spec.ts` to cover:
   - auth-lock acquisition parameters (60000/360000)
   - nested refresh-lock acquisition parameters (10000/30000)
   - lock order: auth-lock before refresh-lock
   - lock release on all exception paths
   - fallback behavior when lock acquisition times out
2. For each new/tightened assertion:
   - Run: `npx vitest run packages/cli/src/auth/__tests__/auth-flow-orchestrator.spec.ts`
   - Capture **RED** output (test fails before implementation fix).
   - Apply the minimal implementation change.
   - Run again, capture **GREEN** output (test passes).

**Implementation actions:**
- Refactor oversized methods in `auth-flow-orchestrator.ts` into helpers while preserving lock semantics and public behavior.
- Keep each function ≤80 lines.

**Stage A gate — all must pass:**
- [ ] `npx vitest run packages/cli/src/auth/__tests__/auth-flow-orchestrator.spec.ts` — zero failures
- [ ] RED/GREEN transcript captured per new/tightened assertion
- [ ] No lock-order/timeout regressions in test output

---

### Stage B — Deterministic size and lint gates

Run both commands; both must report zero violations:

```bash
AUTH_FILES=$(echo packages/cli/src/auth/{oauth-manager,provider-registry,proactive-renewal-manager,token-access-coordinator,auth-flow-orchestrator,auth-status-service,provider-usage-info,OAuthBucketManager,oauth-provider-base,types,anthropic-oauth-provider,codex-oauth-provider,gemini-oauth-provider,qwen-oauth-provider}.ts)

# 1. AST-level function audit (canonical file scope)
node project-plans/issue1578/function-audit.cjs
# Expected: every file prints "no funcs >80", no "FILE>800" flags

# 2. ESLint max-lines-per-function on canonical scope
npx eslint $AUTH_FILES \
  --rule 'max-lines-per-function:[2,{"max":80,"skipBlankLines":true,"skipComments":true}]'
# Expected: exit 0, zero violations
```

If violations remain, return to Stage A test-first loop.

**Stage B gate — all must pass:**
- [ ] `function-audit.cjs` output shows zero `>80` functions and zero `FILE>800` flags
- [ ] ESLint command exits 0 with no violations
- [ ] Both outputs captured verbatim in stage report

---

### Stage C — Import migration and cycle hard gates

**Stage C exit-code contract:** All gate commands are normalized so **exit 0 = PASS** and **non-zero = FAIL**. Raw grep inverts this (exit 0 = match found = bad), so each gate wraps grep/perl in a conditional that normalizes the exit code. Subagents should check both the printed PASS/FAIL token AND the exit code.

```bash
# C1. Moved-symbol import gate — no file may import these symbols from oauth-manager.
# Uses multiline-aware search (perl -0777) to catch imports split across lines.
# macOS-safe (no GNU grep -P dependency).

MOVED_SYMS="OAuthProvider|OAuthManagerRuntimeMessageBusDeps|unwrapLoggingProvider\
|isQwenCompatibleUrl|getHigherPriorityAuth|getAnthropicUsageInfo\
|getAllAnthropicUsageInfo|getAllCodexUsageInfo|getAllGeminiUsageInfo\
|isLoggingWrapperCandidate|hasRequestMetadata"

C1_HITS=$(find packages/cli/src/ -name '*.ts' ! -path '*/node_modules/*' ! -path '*/dist/*' \
  -exec perl -0777 -ne \
    "print \"MATCH: \$ARGV\\n\" if /import\\s+(?:type\\s+)?\\{[^}]*(?:$MOVED_SYMS)[^}]*\\}\\s*from\\s*['\"][^'\"]*oauth-manager/s" {} \;)
if [ -z "$C1_HITS" ]; then
  echo "C1: PASS — no moved-symbol imports found"
  # exit 0 = PASS
else
  echo "$C1_HITS"
  echo "C1: FAIL — offending imports listed above"
  exit 2
fi

# C2. types.ts dependency-leaf check — types.ts must NOT import from any extracted module
if grep -rn -E "from.*(provider-registry|token-access|auth-flow|auth-status|proactive-renewal|provider-usage)" packages/cli/src/auth/types.ts; then
  echo "C2: FAIL — types.ts imports extracted modules"
  exit 2
else
  echo "C2: PASS — no forbidden imports in types.ts"
fi

# C3. Type-vs-value hygiene spot checks
# Multiline-safe: perl -0777 slurps each file so import statements split across lines
# are caught. Checks that OAuthProvider and OAuthManagerRuntimeMessageBusDeps from
# types.js are always imported with `import type`, never as value imports.
C3_SYMS="OAuthProvider|OAuthManagerRuntimeMessageBusDeps"
C3_HITS=$(find packages/cli/src/auth/ -name '*.ts' ! -path '*/node_modules/*' ! -path '*/dist/*' \
  -exec perl -0777 -ne '
    while (/^(import\s+\{[^}]*(?:'"$C3_SYMS"')[^}]*\}\s*from\s*['\''"]\.\/types\.js['\''"])/mg) {
      my $stmt = $1;
      next if $stmt =~ /^import\s+type\b/;
      print "MATCH: $ARGV: $stmt\n";
    }' {} \;)
if [ -z "$C3_HITS" ]; then
  echo "C3: PASS — no type-vs-value violations"
  # exit 0 = PASS
else
  echo "$C3_HITS"
  echo "C3: FAIL — value imports of type-only symbols listed above"
  exit 2
fi

# C4. Circular dependency check (HARD GATE — scoped to auth-internal cycles only)
#
# IMPORTANT: `npx madge --circular` traverses ALL transitive imports, so it reports
# pre-existing cross-directory cycles (runtime → config → providers → auth → runtime)
# that exist on main and are outside the scope of this issue. On main (before any of
# our changes) there are already 46 such cycles.
#
# Gate semantics: we check for cycles where EVERY node is within packages/cli/src/auth/.
# Cross-directory cycles that pass through auth files are pre-existing and not a FAIL.

MADGE_OUT=$(npx madge --circular --extensions ts --no-spinner packages/cli/src/auth/ 2>&1)
# Extract only numbered cycle lines (e.g. "1) a.ts > b.ts > c.ts"), then keep only
# those where ALL nodes are auth-internal (no "../" path segments = no cross-directory).
CYCLE_LINES=$(echo "$MADGE_OUT" | grep -E '^[0-9]+\)' || true)
AUTH_ONLY_CYCLES=$(echo "$CYCLE_LINES" | grep -v '\.\.\/' || true)

if [ -z "$AUTH_ONLY_CYCLES" ]; then
  TOTAL_CROSS=$(echo "$CYCLE_LINES" | grep -c '\.\.\/' || true)
  echo "C4: PASS — no auth-internal circular dependencies"
  echo "(Note: $TOTAL_CROSS pre-existing cross-directory cycles filtered out)"
  # exit 0 = PASS
else
  echo "$AUTH_ONLY_CYCLES"
  echo "C4: FAIL — auth-internal circular dependencies found above"
  exit 2
fi

# C5. Proxy directory import check (HARD GATE with explicit exception policy)
#
# Deterministic gate: undocumented proxy imports from oauth-manager always FAIL.
# The grep filters out lines containing an inline PROXY-IMPORT-EXCEPTION tag, so
# documented exceptions pass automatically.
#
# To resolve a C5 failure with legitimate exceptions:
#   1. Review each match against exception criteria a–d below.
#   2. Add an INLINE comment on the SAME LINE as the import:
#        import { Foo } from './oauth-manager.js'; // PROXY-IMPORT-EXCEPTION: <reason>
#      (Must be on the same line because grep only returns matching lines.)
#   3. Document each exception in the Stage C report under "C5 Allowed Exceptions".
#   4. Re-run this gate — properly tagged lines are filtered out.
C5_HITS=$(grep -rn --include='*.ts' "from.*oauth-manager" packages/cli/src/auth/proxy/ 2>/dev/null | grep -v "PROXY-IMPORT-EXCEPTION" || true)
if [ -z "$C5_HITS" ]; then
  echo "C5: PASS — no undocumented proxy imports from oauth-manager"
else
  echo "$C5_HITS"
  echo ""
  echo "C5: FAIL — undocumented proxy imports from oauth-manager found above."
  echo "To resolve: review each match against criteria a–d, add inline PROXY-IMPORT-EXCEPTION"
  echo "tag on the same line as the import, document in Stage C report, then re-run."
  exit 2
fi
#
# Exception criteria — ALL four must be met for each allowed import:
#   a) The imported symbol still legitimately lives in oauth-manager
#      (i.e., it is NOT in the MOVED_SYMS list from C1).
#   b) The import is required for a re-export barrel or integration wiring
#      (not for direct use in business logic).
#   c) The exception is tagged with an INLINE comment on the SAME LINE as the import:
#        import { X } from './oauth-manager.js'; // PROXY-IMPORT-EXCEPTION: <reason>
#   d) The exception is recorded in the Stage C report under
#      "C5 Allowed Exceptions" with file path, line number, symbol, and justification.
#   Any import that does not satisfy ALL four criteria is a gate FAIL.
#   If zero exceptions exist, state "C5: zero imports, no exceptions needed."
```

If any gate fails:
- Add/adjust tests first where behavior is impacted (RED/GREEN protocol).
- Fix imports/dependencies.
- If Stage C source-code changes affect runtime behavior, add/adjust targeted tests
  and capture RED/GREEN evidence; if existing tests are sufficient, document that
  rationale explicitly in the Stage C report.
- Rerun **all** Stage C gates.

**Stage C gate — all must pass:**
- [ ] C1 — zero moved-symbol import matches (exit 0) — multiline-aware
- [ ] C2 — types.ts imports zero extracted modules (exit 0)
- [ ] C3 — zero type-vs-value violations (exit 0) — multiline-aware
- [ ] C4 — zero auth-internal circular dependencies (exit 0; pre-existing cross-directory cycles filtered)
- [ ] C5 — proxy imports clean (exit 0, undocumented imports always fail; documented `PROXY-IMPORT-EXCEPTION` imports auto-filtered)
- [ ] All command outputs captured verbatim in stage report

---

### Stage C′ — Anti-regression re-gate (mandatory after any code change in Stages C or D)

If any Stage C or D fix required a source code change (not just running commands), rerun **both**:

```bash
AUTH_FILES=$(echo packages/cli/src/auth/{oauth-manager,provider-registry,proactive-renewal-manager,token-access-coordinator,auth-flow-orchestrator,auth-status-service,provider-usage-info,OAuthBucketManager,oauth-provider-base,types,anthropic-oauth-provider,codex-oauth-provider,gemini-oauth-provider,qwen-oauth-provider}.ts)

node project-plans/issue1578/function-audit.cjs

npx eslint $AUTH_FILES \
  --rule 'max-lines-per-function:[2,{"max":80,"skipBlankLines":true,"skipComments":true}]'
```

Both must still pass. If either regresses, return to Stage A/B loop before proceeding.

**Stage C′ gate:**
- [ ] function-audit.cjs — zero violations after Stage C/D code changes
- [ ] ESLint — zero violations after Stage C/D code changes
- [ ] (Skip if no code changes were made — state "no code changes, C′ not required")

---

### Stage D — Full verification suite

Run full required suite in order:

```bash
npm run test                    # unit + integration tests
npm run lint                    # ESLint
npm run typecheck               # tsc --noEmit
npm run format                  # apply Prettier formatting fixes
npm run format:check            # Prettier --check (read-only validation — must exit 0)
npm run build                   # production build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"  # smoke test
```

**Formatting gate semantics:** `npm run format` applies Prettier fixes to all files.
`npm run format:check` (= `prettier --check .`) is the deterministic validation gate —
it exits non-zero when any file is unformatted and never mutates files. Both are
required: `format` first (to fix), then `format:check` (to prove nothing remains).

**Failure handling — two categories with distinct remediation:**

Failures split into two categories that require different handling:

**Behavioral failures** (`npm run test`, smoke test):
- These indicate broken runtime behavior and **require RED/GREEN protocol**.
- Write/adjust tests first to capture the failure (RED), then fix implementation (GREEN).
- Rerun the failed step, then rerun full Stage D suite end-to-end.
- **Then rerun Stage C′** (anti-regression re-gate).

**Non-behavioral failures** (`npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`):
- These are static/tooling issues (style, types, formatting, compilation) with deterministic fixes.
- Fix directly (no RED/GREEN needed) — e.g., run `npm run format` to fix formatting, add missing types, fix lint violations.
- Rerun the failed step, then rerun full Stage D suite end-to-end.
- **Then rerun Stage C′** (anti-regression re-gate) if the fix involved source code changes.

**Stage D gate — all must pass:**
- [ ] `npm run test` — exit 0
- [ ] `npm run lint` — exit 0
- [ ] `npm run typecheck` — exit 0
- [ ] `npm run format` — exit 0
- [ ] `npm run format:check` — exit 0 (validates formatting is clean after format step)
- [ ] `npm run build` — exit 0
- [ ] Smoke test — exit code 0 AND stdout contains non-empty text
- [ ] Stage C′ re-gate passed (or confirmed no code changes)
- [ ] All command outputs captured in stage report (see truncation policy in §3)

---

## 3) Subagent Operating Model (Mandatory)

### Stage Report Schema

Every subagent must produce a structured report per stage:

```
## Stage [A/B/C/D] Report — [typescriptexpert|deepthinker]

### Files Changed
- <list of files added/modified/deleted>

### RED/GREEN Evidence (Stage A, or any stage with test changes)
- Test: <test name>
  - RED:  <command> → <exit code>, <key failure line>
  - GREEN: <command> → <exit code>, <key pass line>

### Gate Command Transcripts
- <command 1>: <exit code> — <one-line result summary>
  <command output (see truncation policy below)>
- <command 2>: <exit code> — <one-line result summary>
  <command output (see truncation policy below)>

(If a single command's output exceeds 200 lines, include first 100 + last 50 lines
and state "truncated — middle N lines omitted for length". All other outputs must be
included in full. Never summarize or excerpt without stating the truncation reason.)

### Gate Checklist
- [ ] <gate 1> — PASS/FAIL
- [ ] <gate 2> — PASS/FAIL
  ...

### Issues Found (deepthinker only)
- <issue description> — <severity> — <remediation required Y/N>
```

### Execution Rules

For each stage (A–D):

1. **typescriptexpert implements**
   - Must execute test-first per RED/GREEN protocol.
   - Must run every gate command listed for the stage and capture output.
   - Must produce a Stage Report per the schema above.

2. **deepthinker verifies**
   - Clean full-scope review each stage (no hints about prior reviews).
   - Validate architecture/SoC/DRY integrity and lock correctness.
   - Validate that gate command outputs genuinely show passing results (not truncated, not misread).
   - Must produce a Stage Report per the schema above (Issues Found section required).

3. If deepthinker finds issues:
   - Feed findings back to **typescriptexpert** for remediation.
   - typescriptexpert re-runs stage gates + Stage C′ if code changed.
   - deepthinker performs clean full-scope re-review.

No stage is marked complete until both subagent roles pass with conforming reports.

---

## 4) Final Deliverables

Before check-in, produce:
1. Stage Reports (A through D) from both subagent roles — conforming to §3 schema.
2. Final `function-audit.cjs` output (zero violations).
3. Final ESLint `max-lines-per-function` output (zero violations).
4. Final moved-symbol grep output (all empty).
5. Final `madge --circular` output (zero auth-internal cycles; pre-existing cross-directory cycles documented).
6. Final verification suite pass summary (all seven commands — test/lint/typecheck/format/format:check/build/smoke).

---

## 5) Immediate Next Action

Execute Stage A via `typescriptexpert` with a strict test-first prompt (RED/GREEN evidence required), then send resulting Stage Report for `deepthinker` clean full-scope verification before any commit actions.
