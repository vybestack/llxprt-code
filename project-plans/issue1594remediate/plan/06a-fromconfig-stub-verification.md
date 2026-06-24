<!-- @plan:PLAN-20260621-COREAPIREMED.P06a @requirement:REQ-001,REQ-INT-001 -->
# Phase 06a: fromConfig Stub Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P06a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 06 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P06.md`

## Verification Tasks

```bash
set -e
test -f packages/agents/src/api/fromConfig.ts
grep -q "export async function fromConfig" packages/agents/src/api/fromConfig.ts
grep -q "fromConfig" packages/agents/src/api/index.ts
grep -rq "@plan:PLAN-20260621-COREAPIREMED.P06" packages/agents/src/api/
npm run typecheck
# CANONICAL types location (MIN-2): FromConfigOptions in config-types.ts, NO parallel V2 file (BLOCKING)
grep -q "FromConfigOptions" packages/agents/src/api/config-types.ts || { echo "FAIL: FromConfigOptions not in config-types.ts"; exit 1; }
if [ -f packages/agents/src/api/fromConfig-types.ts ]; then echo "FAIL: parallel fromConfig-types.ts exists"; exit 1; fi
# CRIT-2: messageBus? field declared on FromConfigOptions (BLOCKING)
grep -qE "messageBus\?: MessageBus" packages/agents/src/api/config-types.ts || { echo "FAIL: FromConfigOptions missing messageBus?: MessageBus"; exit 1; }
# CRIT-2: getConfig() is DECLARED on the Agent interface HERE (type surface, allowed in a stub
# phase) so the P07 early parity slice + P08 TDD compile and reference identity. Its IMPL must be a
# NotYetImplemented STUB here — the REAL `return this.deps.config` behavior is deferred to P09
# (GREEN) per strict TDD (BLOCKING).
grep -q "getConfig(): Config" packages/agents/src/api/agent.ts || { echo "FAIL: getConfig() not declared on the Agent interface (CRIT-2)"; exit 1; }
# Single-declaration invariant: declared exactly once on the interface (P06).
if [ "$(grep -cE "getConfig\s*\(\s*\)\s*:\s*Config\s*;" packages/agents/src/api/agent.ts)" -ne 1 ]; then echo "FAIL: getConfig must be declared exactly once on the Agent interface (CRIT-2)"; exit 1; fi
# The agentImpl getConfig body MUST be a NotYetImplemented stub (NO real behavior in the stub phase).
# MIN-4 (formatting-tolerant): Prettier splits the stub body across lines, so normalize ALL
# whitespace (incl. newlines) to single spaces BEFORE matching (same technique as the adoption-`??`
# gate). A bare line-based grep with `[^}]*` would falsely FAIL on the Prettier-formatted file.
IMPL_NORM=$(tr -s '[:space:]' ' ' < packages/agents/src/api/agentImpl.ts)
printf '%s' "$IMPL_NORM" | grep -qE "getConfig\(\)\s*:\s*Config\s*\{[^}]*NotYetImplemented" || { echo "FAIL: getConfig must be a NotYetImplemented stub in P06 (real impl deferred to P09 — CRIT-2)"; exit 1; }
# The getConfig stub must NOT yet return this.deps.config — that real behavior is added at P09.
# (Whitespace-normalized so the negative guard still catches a multi-line real impl — strictness preserved.)
if printf '%s' "$IMPL_NORM" | grep -qE "getConfig\(\)\s*:\s*Config\s*\{\s*return this\.deps\.config"; then echo "FAIL: getConfig must NOT return this.deps.config in the stub phase — real impl deferred to P09 (CRIT-2)"; exit 1; fi
# No version duplication (BLOCKING — a found duplicate exits non-zero)
DUP=$(find packages/agents/src -name "*V2*" -o -name "*New*" -o -name "*Copy*")
if [ -n "$DUP" ]; then echo "FAIL: duplicate/parallel files: $DUP"; exit 1; fi
# No reverse tests added (BLOCKING). SCOPE the scan to ONLY the files Phase 06 adds/modifies (the
# new fromConfig spec glob) — NOT all of __tests__/, which carries pre-existing #1594 RED tests
# whose NotYetImplemented/not.toThrow() assertions are out of scope here (CRIT-1). Mirrors the
# `git ls-files` scoping the P06 worker uses (plan/06-fromconfig-stub.md).
FROMCONFIG_SPECS=$(git ls-files 'packages/agents/src/api/__tests__/*fromConfig*' 'packages/agents/src/api/__tests__/*from-config*' 2>/dev/null)
if [ -n "$FROMCONFIG_SPECS" ]; then
  if grep -rn "toThrow('NotYetImplemented')\|not\.toThrow()" $FROMCONFIG_SPECS; then echo "FAIL: reverse test in new fromConfig spec"; exit 1; fi
else
  echo "OK: no fromConfig spec files added by this stub phase (none expected)."
fi
echo "OK"
```

### Semantic Verification Checklist

- [ ] `fromConfig` is a SEPARATE function (createAgent signature unchanged — read both).
- [ ] `FromConfigOptions.config` is `readonly config: Config` (adopted).
- [ ] `getConfig(): Config` is DECLARED on the `Agent` interface (exactly once) with a NotYetImplemented STUB body in agentImpl.ts (CRIT-2 — the real `return this.deps.config` impl is deferred to P09); `fromConfig` itself also remains a NotYetImplemented stub.
- [ ] Exported from public root index.ts.
- [ ] No parallel/duplicate Agent or createAgent files created.
- [ ] typecheck clean; no `any`/assertions.

## Holistic Assessment (MANDATORY)

Confirm the stub introduces the seam additively (createAgent untouched in behavior) and is wired
into the public surface. Verdict PASS/FAIL.

## Success Criteria

- All checks pass.

## Failure Recovery

- Return to Phase 06 with findings; do not proceed to Phase 07.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P06a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P06a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

