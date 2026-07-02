# Phase 01a: Preflight Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P01a`

## Prerequisites
- Required: Phase 01 completed.
- Verification: `test -f project-plans/issue2285/analysis/preflight-results.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **preflight-results.md exists** and contains real command output (not
   placeholders) for all 9 preflight checks.
2. **Generated artifact policy**: evidence shows `dist` is gitignored and
   untracked; policy recorded.
3. **Import inventory**: classification matches actual grep output; any
   discrepancy between `import-inventory.md` and reality is corrected.
4. **A2A consumers**: all four known compile-breakers confirmed; migration
   target decided for each; per-use exception records written for any retained
   internals subpath. **Architect review findings 1, 2, 3**: preflight results
   record (a) A2A test convention is COLOCATED (not `__tests__/`), (b) real A2A
   APIs (`sendMessageStream`, `Task.create`, `scheduler.schedule`,
   `eventBus.publish` — NOT `.sendMessage` or `new Task()`), (c) exact working
   workspace-scoped test commands (NOT root path args).
5. **CLI test compile-breakers**: confirmed; `App.*.test.tsx` import source
   verified (core vs agents root).
6. **app-service non-scope**: decision recorded; not modified.
7. **Internals subpath resolution**: export-map entry confirmed; resolves under
   typecheck/Vitest for legitimate consumers.
8. **API guard mechanism**: Option B confirmed; `dist/index.d.ts` exists after
   build; contains parseable declarations.
9. **Runtime factory decision**: dependency direction confirmed (agents →
   providers, NOT reverse); core-ownership evaluated; decision recorded with
   named tsconfig command. **Architect review finding 1: the decision record
   file `runtime-factory-contract-decision.md` is CREATED in P01** (not P09)
   with a machine-greppable `decision:` line and optional
   `drift-guard-path:` line. P01a verifies the file exists and contains the
   `decision:` line.
10. **cliSessionDispatch seams**: six exports enumerated; side effects listed;
    safe test seams recorded; `validateDnsResolutionOrder` confirmed NOT in
    cliSessionDispatch.

## Verification Commands

```bash
# Preflight results exist with real content — fail-closed
test -s project-plans/issue2285/analysis/preflight-results.md || { echo "FAIL: preflight-results.md missing or empty"; exit 1; }
LINE_COUNT="$(wc -l < project-plans/issue2285/analysis/preflight-results.md | tr -d ' ')"
test "$LINE_COUNT" -gt 50 || { echo "FAIL: preflight-results.md too short ($LINE_COUNT lines, expected > 50)"; exit 1; }

# All 9 sections present — fail-closed
SECTION_COUNT="$(grep -c '^### ' project-plans/issue2285/analysis/preflight-results.md || true)"
test "$SECTION_COUNT" -ge 9 || { echo "FAIL: preflight-results.md has $SECTION_COUNT sections (expected >= 9)"; exit 1; }

# Decisions recorded — fail-closed
grep -iq 'decision' project-plans/issue2285/analysis/preflight-results.md || { echo "FAIL: no decisions recorded in preflight-results.md"; exit 1; }

# Architect review finding 1: runtime-factory-contract-decision.md CREATED in
# P01 with a machine-greppable decision: line — fail-closed
test -f project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: runtime-factory-contract-decision.md not created in P01 (architect review finding 1)"; exit 1; }
grep -qE '^decision: (single-source|retained-duplication)$' project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: decision record missing machine-greppable 'decision: single-source' or 'decision: retained-duplication' line"; exit 1; }
# If retained-duplication, verify the drift-guard-path: line exists
DECISION_VAL="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^decision:[[:space:]]*//' || true)"
if [ "$DECISION_VAL" = "retained-duplication" ]; then
  grep -qE '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: retained-duplication but no 'drift-guard-path:' line in decision record"; exit 1; }
fi
echo "OK: decision record created with decision: $DECISION_VAL"

# Architect review findings 1, 2, 3: preflight records A2A test convention,
# real APIs, and exact working test commands — fail-closed
PREFLIGHT="project-plans/issue2285/analysis/preflight-results.md"
grep -qi 'colocated' "$PREFLIGHT" || { echo "FAIL: preflight does not record A2A colocated test convention (architect review finding 1)"; exit 1; }
grep -q 'sendMessageStream' "$PREFLIGHT" || { echo "FAIL: preflight does not record sendMessageStream as the real dispatch method (architect review finding 2)"; exit 1; }
grep -q 'Task.create' "$PREFLIGHT" || { echo "FAIL: preflight does not record Task.create as the real factory method (architect review finding 2)"; exit 1; }
grep -q 'workspace' "$PREFLIGHT" || { echo "FAIL: preflight does not record workspace-scoped test commands (architect review finding 3)"; exit 1; }
echo "OK: preflight records A2A test convention, real APIs, and workspace-scoped test commands"
```

## Semantic Verification Checklist

- [ ] I read preflight-results.md and the evidence is real command output.
- [ ] Generated artifact policy is unambiguous.
- [ ] A2A migration targets are concrete (named function/type per consumer).
- [ ] API guard mechanism is confirmed against actual build output.
- [ ] Runtime factory decision names the exact tsconfig/package command.
- [ ] **Architect review finding 1**: the decision record file
      `runtime-factory-contract-decision.md` EXISTS with a machine-greppable
      `decision:` line (`decision: single-source` or
      `decision: retained-duplication`).
- [ ] cliSessionDispatch seams are concrete and the forbidden-mock rule is
      recorded.
- [ ] **Architect review findings 1, 2, 3**: preflight records (a) A2A test
      convention is COLOCATED (not `__tests__/`), (b) real A2A APIs
      (`sendMessageStream`, `Task.create`, `scheduler.schedule` — NOT
      `.sendMessage` or `new Task()`), (c) exact working workspace-scoped test
      commands.
- [ ] No blocking issues left unresolved.

## Blocking Issues Handling

If the verifier finds a plan assumption is wrong:
- The verifier FAILS this phase.
- The worker updates `import-inventory.md` and/or `api-guard-mechanism.md`.
- Re-run P01 → P01a until PASS.

## Success Criteria
- PASS: all 10 verification tasks green; no unresolved blocking issues.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P01a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
