# Phase 04a: Consumer Import Migration Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P04a`

## Prerequisites
- Required: Phase 04 completed.
- Verification: `test -f project-plans/issue2285/.completed/P04.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **A2A production clean**: no `AgentClient`/`CoreToolScheduler` value import
   from agents root in A2A production source.
2. **Public-factory-first**: A2A uses `createAgentClient`/`createToolScheduler`
   (or documented exception).
3. **Exception records**: `a2a-exception-records.md` exists; every retained
   internals subpath use has a decision record.
4. **CLI tests migrated**: internals-only names come from the internals subpath,
   not the root.
5. **Core root imports used**: A2A type imports use `AgentClientContract` /
   `ToolSchedulerContract` from the **core root**
   (`@vybestack/llxprt-code-core`), NOT deep paths
   (`@vybestack/llxprt-code-core/core/clientContract.js`).
6. **A2A behavior preserved**: explicit, named tests prove the factory
   migration preserves A2A config/task runtime behavior (construction behavior
   + runtime behavior). Tests are GREEN. **The verification commands run these
   tests fail-closed — a test failure exits the phase nonzero (no `|| true`
   masking).**
7. **typecheck passes** (full repo).
8. **Affected tests pass** — **fail-closed; no `|| true` masking**. A failure
   in either the A2A workspace tests or the affected CLI tests exits the
   verification phase nonzero.
9. **Legitimate internals subpath consumers resolve** under typecheck and Vitest.
10. **Root STILL exports internals** — depollution is P05. The repo is GREEN
    because the root still exports internals AND consumers have been migrated
    (both old and new paths resolve).
11. **No deferred language**.
12. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# A2A production: no internals-only names from agents ROOT (fail-closed).
# Any hit that is NOT a public factory/curated symbol is a blocking failure.
NONPUBLIC_HITS="$(grep -rn "from '@vybestack/llxprt-code-agents'" packages/a2a-server/src --include="*.ts" | grep -v "createTaskToolRegistration\|createAgentClient\|createToolScheduler\|createTaskRegistration" || true)"
test -z "$NONPUBLIC_HITS" || { echo "FAIL: non-public agents root import in A2A:"; echo "$NONPUBLIC_HITS"; exit 1; }

# Public factory usage in A2A — fail-closed (at least one must exist)
FACTORY_HITS="$(grep -rn "createAgentClient\|createToolScheduler" packages/a2a-server/src --include="*.ts" || true)"
test -n "$FACTORY_HITS" || { echo "FAIL: no public factory usage found in A2A source"; exit 1; }
echo "Public factory usage confirmed:"; echo "$FACTORY_HITS"

# CLI tests: internals from subpath, not root (fail-closed). Any import of
# AgentClient/CoreToolScheduler FROM THE ROOT in a test is a blocking failure.
CLI_ROOT_INTERNALS="$(grep -rn "from '@vybestack/llxprt-code-agents'" packages/cli/src --include="*.test.ts" --include="*.test.tsx" --include="*.spec.ts" --include="*.spec.tsx" | grep -E "AgentClient|CoreToolScheduler" || true)"
test -z "$CLI_ROOT_INTERNALS" || { echo "FAIL: AgentClient/CoreToolScheduler imported from agents ROOT in CLI tests:"; echo "$CLI_ROOT_INTERNALS"; exit 1; }

# Exception records (fail-closed)
test -f project-plans/issue2285/analysis/a2a-exception-records.md || { echo "FAIL: a2a-exception-records.md missing"; exit 1; }
cat project-plans/issue2285/analysis/a2a-exception-records.md

# Revision 4 architect finding 4 + architect review finding 1: verify the two
# REQUIRED A2A behavior test files exist (COLOCATED, not __tests__), have
# markers, contain observable assertions referencing REAL APIs (NOT mock
# theater), and PASS.
test -f packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts missing (architect finding 4; colocated per review finding 1)"; exit 1; }
test -f packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts missing (architect finding 4; colocated per review finding 1)"; exit 1; }
grep -q "@plan:PLAN-20260629-ISSUE2285.P04" packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts missing @plan marker"; exit 1; }
grep -q "@requirement:REQ-004" packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config.factory-migration.test.ts missing @requirement marker"; exit 1; }
grep -q "@plan:PLAN-20260629-ISSUE2285.P04" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts missing @plan marker"; exit 1; }
grep -q "@requirement:REQ-004" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task.factory-migration.integration.test.ts missing @requirement marker"; exit 1; }
# Observable assertions (not mock theater) — referencing REAL APIs (architect review finding 2)
grep -q "createAgentClient\|createToolScheduler" packages/a2a-server/src/config/config.factory-migration.test.ts || { echo "FAIL: config test lacks factory assertion"; exit 1; }
# Task test must reference real APIs (Task.create / sendMessageStream / schedule / publish), NOT nonexistent .sendMessage or direct new Task
grep -qE "Task\.create|sendMessageStream|schedule|publish" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts || { echo "FAIL: task test lacks observable result assertion referencing real APIs"; exit 1; }
grep -qE "\.sendMessage[^S]|new Task\(" packages/a2a-server/src/agent/task.factory-migration.integration.test.ts && { echo "FAIL: task test references nonexistent .sendMessage or direct new Task (private constructor)"; exit 1; } || true
echo "OK: both A2A behavior test files exist (colocated) with markers and observable assertions (architect finding 4)"

# Full typecheck (fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: full typecheck"; exit 1; }

# No deep core paths for contract types (fail-closed)
DEEP_CORE="$(grep -rn "llxprt-code-core/core/clientContract\|llxprt-code-core/core/toolSchedulerContract" packages/a2a-server/src --include="*.ts" || true)"
test -z "$DEEP_CORE" || { echo "FAIL: deep core contract path used in A2A:"; echo "$DEEP_CORE"; exit 1; }
# Core ROOT import of the contract type (revision 3 findings 13, 18 — robust
# multiline-aware check via Node, NOT grep|grep with PIPESTATUS which is
# nonportable and brittle against multiline imports). Fail-closed.
node -e "
const { execSync } = require('child_process');
const out = execSync('grep -rln \"@vybestack/llxprt-code-core\" packages/a2a-server/src --include=*.ts || true', {encoding:'utf8'});
const files = out.split('\n').filter(Boolean);
let found = false;
const fs = require('fs');
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (/AgentClientContract|ToolSchedulerContract/.test(src)) { found = true; break; }
}
if (!found) { console.error('FAIL: no core-root AgentClientContract/ToolSchedulerContract import in A2A'); process.exit(1); }
console.log('OK: core-root contract type import present in A2A');
"

# Affected tests (fail-closed: no `|| true` masking — a test failure exits
# the verification phase nonzero). Architect review finding 3: use workspace-
# scoped Vitest invocations (proven reliable), NOT root path-argument fallbacks.
npm run test --workspace @vybestack/llxprt-code-a2a-server
test $? -eq 0 || { echo "FAIL: A2A tests did not pass"; exit 1; }
npm run test --workspace @vybestack/llxprt-code -- useToolScheduler useTodoContinuation useAgenticLoop
test $? -eq 0 || { echo "FAIL: affected CLI tests did not pass"; exit 1; }

# Root STILL exports internals (depollution is P05) — fail-closed
test "$(grep -c "export \* from './internals.js'" packages/agents/src/index.ts)" -eq 1 || { echo "FAIL: root internals re-export count != 1"; exit 1; }

# No NEWLY INTRODUCED deferred language (architect review finding 6: pre-phase
# baseline comparison). Pre-existing debt in A2A source is tolerated; only
# newly introduced TODO/FIXME/HACK/STUB/TEMPORARY/placeholder/for-now FAILS.
# The baseline was captured in P04's completion marker. Re-derive it here by
# diffing the P04-recorded baseline against the current state.
A2A_PHASE_FILES="packages/a2a-server/src/config/config.ts packages/a2a-server/src/agent/task.ts packages/a2a-server/src/agent/task-runtime-helpers.ts packages/a2a-server/src/utils/testing_utils.ts"
POST_FILE="$(mktemp)"
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $A2A_PHASE_FILES > "$POST_FILE" 2>/dev/null || true
# The P04 completion marker records the pre-phase baseline. Read it.
BASELINE_FILE="$(mktemp)"
# Extract the baseline from P04's completion marker (section "Deferred Baseline").
# If absent, all current hits are treated as pre-existing (the phase should have
# recorded the baseline; if it did not, verify manually).
if grep -q "Deferred Baseline" project-plans/issue2285/.completed/P04.md 2>/dev/null; then
  sed -n '/^## Deferred Baseline/,/^## /p' project-plans/issue2285/.completed/P04.md | grep -E 'TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now' > "$BASELINE_FILE" 2>/dev/null || true
  NEW_DEFERRED="$(diff "$BASELINE_FILE" "$POST_FILE" | grep '^>' || true)"
  test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language in A2A source:"; echo "$NEW_DEFERRED"; rm -f "$BASELINE_FILE" "$POST_FILE"; exit 1; }
  echo "OK: no newly introduced deferred language (pre-existing baseline tolerated)"
else
  echo "WARN: P04 baseline not found in completion marker — manual verification required for deferred language"
fi
rm -f "$BASELINE_FILE" "$POST_FILE"

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Semantic Verification Checklist

- [ ] I read the A2A config.ts: uses `createAgentClient`/`createToolScheduler`.
- [ ] A2A type imports use the core ROOT (`@vybestack/llxprt-code-core`), not
      deep paths.
- [ ] I read the exception records: every retained internals subpath justified.
- [ ] CLI tests import internals from the subpath, not root.
- [ ] A2A behavior tests prove factory migration preserves runtime behavior,
      not just compilation. Assertions use PUBLIC behavioral equivalence
      (revision 3 finding 10), NOT brittle own-enumerable-key identity.
- [ ] A2A behavior-test fixtures use the exact builder/API recorded by P01 in
      `analysis/preflight-results.md` section 3 (architect review finding 7 +
      revision 3 finding 11) — not an unspecified "real AgentConfig".
- [ ] typecheck passes across the whole repo.
- [ ] The root STILL exports internals (depollution is P05 — repo is GREEN
      because consumers are already migrated).
- [ ] No NEW `@plan:PLAN-20260629-ISSUE2285` marker comment blocks were added
      to production source files (finding 5 + architect review finding 5).
      Pre-existing markers from other issues (e.g. `@plan PLAN-20260610-ISSUE1592`
      in `config.ts`) are NOT counted as failures — the policy prohibits only
      NEW issue2285 markers in production source, not removal of prior markers.

## Non-Deferral Gate 3 (Production Consumer Internals) Evidence

Fill in execution-tracker.md Gate 3 verifier evidence with:
- grep confirming no internals-only root imports in A2A production.
- exception records content.
- confirmation core root imports used (not deep paths).
- A2A behavior test PASS output.
- typecheck PASS output.
- internals subpath resolution confirmation.

## Success Criteria
- PASS: all consumers migrated, core root imports used (not deep paths), A2A
  behavior tests GREEN, typecheck green, tests pass, exception records
  complete, root still exports internals (repo GREEN), gate 3 evidence recorded.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P04a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
