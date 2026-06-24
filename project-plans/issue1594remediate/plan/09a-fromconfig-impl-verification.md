<!-- @plan:PLAN-20260621-COREAPIREMED.P09a @requirement:REQ-001,REQ-005,REQ-INT-001 -->
# Phase 09a: fromConfig Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260621-COREAPIREMED.P09a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 09 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P09.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare `packages/agents/src/api/fromConfig.ts` and the extracted finalize in
`packages/agents/src/api/createAgent.ts` against `analysis/pseudocode/config-injection-seam.md`
line by line. Confirm EVERY numbered step (10–78) is implemented in order with no shortcuts.

```bash
set -e
FC=packages/agents/src/api/fromConfig.ts
CA=packages/agents/src/api/createAgent.ts
npx vitest run packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
npx vitest run packages/agents/src/api/__tests__/          # full agents api suite, incl. characterization
npm run typecheck
npm run lint
# Adoption invariants (BLOCKING — a found violation exits non-zero)
if grep -n "new Config(" "$FC"; then echo "FAIL: fromConfig constructs Config"; exit 1; fi
if grep -n "new SettingsService(" "$FC"; then echo "FAIL: fromConfig builds a second SettingsService"; exit 1; fi
if grep -n "new ProviderManager(" "$FC"; then echo "FAIL: fromConfig builds a second ProviderManager"; exit 1; fi
# CRIT-2: getConfig real impl is present (GREEN gate) — agentImpl returns the bound Config and no
# longer throws the P06 NotYetImplemented stub; interface declaration remains exactly once.
AI=packages/agents/src/api/agentImpl.ts
grep -qE "getConfig\(\)\s*:\s*Config\s*\{\s*return this\.deps\.config" "$AI" || { echo "FAIL: getConfig must return this.deps.config (real impl at P09 — CRIT-2)"; exit 1; }
if grep -nE "getConfig\(\)\s*:\s*Config\s*\{[^}]*NotYetImplemented" "$AI"; then echo "FAIL: getConfig still a NotYetImplemented stub — must be real at P09 (CRIT-2)"; exit 1; fi
if [ "$(grep -cE "getConfig\(\)\s*:\s*Config\s*;" packages/agents/src/api/agent.ts)" -ne 1 ]; then echo "FAIL: getConfig must remain declared exactly once on the Agent interface (CRIT-2)"; exit 1; fi
# fromConfig must NOT read a non-existent Config.getMessageBus accessor (CRIT-2)
if grep -n "getMessageBus" "$FC"; then echo "FAIL: Config has no getMessageBus accessor — adopt options.messageBus"; exit 1; fi
# fromConfig MUST derive the adopted manager from the Config and forward it
grep -q "config.getProviderManager(" "$FC" || { echo "FAIL: fromConfig must derive config.getProviderManager()"; exit 1; }
grep -qE "providerManager:" "$FC" || { echo "FAIL: fromConfig must pass providerManager into createIsolatedRuntimeContext"; exit 1; }
# CRIT-1 TYPE-SAFETY GATE (grep-enforced): config.getProviderManager() (RuntimeProviderManager |
# undefined) is passed into the providerManager? option (RuntimeProviderManager) with ZERO assertion.
NORM=$(tr -s '[:space:]' ' ' < "$FC")
if printf '%s' "$NORM" | grep -qE "getProviderManager\(\) (as |!)"; then echo "FAIL: assertion on getProviderManager() — adopt path must be assertion-free (CRIT-1)"; exit 1; fi
if printf '%s' "$NORM" | grep -qE "(adoptedManager|providerManager:) [^;,)]*\bas (any|ProviderManager|unknown)"; then echo "FAIL: unsafe cast on adopted manager (CRIT-1)"; exit 1; fi
if grep -nE "adoptedManager\s*:\s*any\b" "$FC"; then echo "FAIL: adoptedManager typed any (CRIT-1)"; exit 1; fi
echo "PASS: CRIT-1 type-safety gate (assertion-free adoption on the fromConfig path)."
# Shared finalize used by both entries
grep -q "finalizeAgent(" "$FC" || { echo "FAIL: fromConfig not reusing finalizeAgent"; exit 1; }
grep -q "finalizeAgent(" "$CA" || { echo "FAIL: createAgent lost shared finalize"; exit 1; }
# Deferred impl scan — scoped to CHANGED lines (MIN-3)
if git diff HEAD -- "$FC" "$CA" | grep -E "^\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)"; then echo "FAIL: deferred-impl marker on changed lines"; exit 1; fi
```

### Line-by-Line Compliance Table (fill in)

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 10–13 (validate/reject) | | [ ] |
| 14–18 (adopt config/ss/bus/manager) | | [ ] |
| 19–27 (runtime ctx incl. providerManager + activate) | | [ ] |
| 28–33,73–78 (conditional init/auth guards) | | [ ] |
| 35–49 (shared finalize, ownership) | | [ ] |
| 50–62 (createAgent shares finalize) | | [ ] |
| 63–72 (resolveMessageBus: adopt caller bus, never 2nd) | | [ ] |

### Semantic Verification Checklist

- [ ] All Phase 08 tests pass; createAgent characterization tests pass (non-breaking).
- [ ] CRIT-2: `getConfig()` is implemented (non-throwing identity, `return this.deps.config`); the
      P06 NotYetImplemented stub is gone; interface declaration remains exactly once.
- [ ] No second Config/SettingsService/ProviderManager/MessageBus.
- [ ] CRIT-1: `config.getProviderManager()` flows into the `RuntimeProviderManager`-typed option with NO assertion/`any` (grep gate PASS).
- [ ] Shared finalize used by both entries (single source).
- [ ] Ownership flag honored on dispose.
- [ ] lint + typecheck clean; no deferred-implementation patterns.

## Holistic Functionality Assessment (MANDATORY — into completion marker)

### What was implemented?
[Describe fromConfig and the finalize extraction in your own words after reading the code.]
### Does it satisfy REQ-001/REQ-INT-001/REQ-005?
[Cite code locations; explain identity + reachability + ownership.]
### Data flow
[Trace fromConfig(config) → adopt → runtime ctx → finalize → Agent; then a turn.]
### What could go wrong?
[Edge cases: already-authed Config, missing bus, model-only adoption.]
### Verdict
[PASS/FAIL with reasoning.]

## Success Criteria

- Full compliance table checked; assessment written; all suites green.

## Failure Recovery

- Return to Phase 09 with specific deviations; do not proceed to Phase 10.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P09a.md` (include the holistic assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P09a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
