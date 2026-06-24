<!-- @plan:PLAN-20260621-COREAPIREMED.P15a @requirement:REQ-004,REQ-006 -->
# Phase 15a: Contract Promotion TDD Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P15a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 15 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P15.md`

## Verification Goal

Confirm the Phase 15 tests (REQ-004 contract promotion + REQ-006 non-breaking export characterization)
are correct, behavioral/type-level as appropriate, RED for the right reason, and fraud-free.

## Verification Commands

```bash
set -e
shopt -s nullglob
CONTRACT=(packages/agents/src/api/__tests__/*ontract*)
EXPORTS=(packages/agents/src/api/__tests__/*xport* packages/agents/src/api/__tests__/*onBreaking*)
if [ ${#CONTRACT[@]} -eq 0 ]; then echo "FAIL: no contract-promotion test file"; exit 1; fi
if [ ${#EXPORTS[@]} -eq 0 ]; then echo "FAIL: no non-breaking export test file"; exit 1; fi
# BLOCKING fraud guards
if grep -rnE "toHaveBeenCalled" "${CONTRACT[@]}" "${EXPORTS[@]}"; then echo "FAIL: mock theater"; exit 1; fi
if grep -rnE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "${CONTRACT[@]}"; then echo "FAIL: reverse test"; exit 1; fi
# Non-breaking characterization enumerates current public exports and asserts each still present
grep -rnE "createAgent|listProviders|listTools|mapLoopStream|toConfigParameters" "${EXPORTS[@]}" || { echo "FAIL: export characterization not enumerated"; exit 1; }
# The contract test imports AgentClientContract type-only from the CURATED API barrel (CRIT-3),
# NOT from core internals or ./internals.js.
grep -rnE "import type .*AgentClientContract.* from ['\"]@vybestack/llxprt-code-agents['\"]" "${CONTRACT[@]}" \
  || { echo "FAIL: contract not imported type-only from curated API barrel root"; exit 1; }
if grep -rnE "from ['\"][^'\"]*(internals|core/clientContract|/src/)" "${CONTRACT[@]}"; then
  echo "FAIL: contract test deep-imports instead of using the curated barrel"; exit 1
fi

# RED-state enforcement (BLOCKING): contract promotion RED is a genuine TYPE error (the curated
# barrel does not re-export AgentClientContract yet), so the RED gate is `npm run typecheck`, NOT
# `npm test`. The type test MUST fail typecheck now and the suite MUST be authored.
set +e
npm run typecheck > /tmp/p15a_red.log 2>&1
STATUS=$?
set -e
tail -25 /tmp/p15a_red.log
if [ "$STATUS" -eq 0 ]; then
  echo "FAIL: typecheck unexpectedly PASSES — the contract type test is not RED before P16."; exit 1
fi
# The failing reason must reference the contract symbol/import, not an unrelated breakage.
if ! grep -qiE "AgentClientContract" /tmp/p15a_red.log; then
  echo "FAIL: typecheck RED is not attributable to the AgentClientContract promotion test."; exit 1
fi
echo "Type-error RED confirmed for AgentClientContract promotion (expected until P16)."
```

> NOTE (CRIT-5 exception): REQ-004 is a TYPE-surface requirement. The expected RED here is a genuine
> TypeScript compile error (the curated barrel lacks the type export), so this phase enforces RED via
> `npm run typecheck` failing, explicitly per the methodology's type-surface carve-out — NOT via a
> runtime behavioral assertion. The non-breaking export characterization tests (runtime) are
> additionally authored; they may pass against current exports (regression guard) and that is allowed.

### Semantic Verification Checklist

- [ ] Contract test asserts `AgentClientContract` is importable as a TYPE from the public root and is
      structurally usable (a value of that type is accepted where the API requires it).
- [ ] Non-breaking test enumerates the CURRENT public exports (createAgent, fromConfig once added,
      listProviders, listTools, mapLoopStream, mapStreamEvent, toConfigParameters, AdapterError, …)
      and asserts each remains exported (RED now if any are missing post-change — guards regressions).
- [ ] Asserts the concrete `AgentClient` class is NOT newly exported at the root (stays on
      `./internals.js`).
- [ ] No mock theater; no reverse testing; RED for the right reason.

## Holistic Functionality Assessment (MANDATORY — into marker)

### What do the tests verify? ### Do they prove non-breaking + type-only promotion? ### Verdict

## Success Criteria

- Tests correctly characterize promotion + non-breaking; fraud-free; RED for the right reason.

## Failure Recovery

- Return to Phase 15; do not proceed to Phase 16.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P15a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P15a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

